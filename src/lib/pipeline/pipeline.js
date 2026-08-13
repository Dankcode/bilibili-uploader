import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import db, { finalizeUpload, logError, updateVideoStatus } from '../db/sqlite';
import { validateVideoOutput } from '../media/validation';
import {
  addAutomationBatchItem,
  createAutomationBatch,
  ensureVideoRecord,
  recordPublication,
  recordVideoVersion,
  syncAutomationBatch,
  updateVideoRecord,
} from '../operations/store';
import { getSource, getProcessor, getUploader } from './registry';
import { getCredentials } from './connections';
import { getPreset } from './presets';
import * as bilibiliSource from './sources/bilibili';
import * as douyinSource from './sources/douyin';
import * as localFileSource from './sources/localFile';
import * as voiceoverProcessor from './processors/voiceover';
import * as aiEditorProcessor from './processors/aiEditor';
import * as sceneCutProcessor from './processors/sceneCut';
import * as faceFusionProcessor from './processors/faceFusion';
import * as metadataProcessor from './processors/metadata';
import * as youtubeUploader from './uploaders/youtube';

const SOURCE_ADAPTERS = {
  localFile: localFileSource,
  bilibili: bilibiliSource,
  douyin: douyinSource,
};

const PROCESSOR_ADAPTERS = {
  voiceover: voiceoverProcessor,
  aiEditor: aiEditorProcessor,
  sceneCut: sceneCutProcessor,
  faceFusion: faceFusionProcessor,
  metadata: metadataProcessor,
};

const UPLOADER_ADAPTERS = {
  youtube: youtubeUploader,
};

let workerRunning = false;
let workerScheduled = false;
let workerTimer = null;
const cancelSignals = new Map();
const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function validateJobInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Job input is required');
  const sourceId = String(input.sourceId || '').trim();
  const sourceInput = String(input.sourceInput || '').trim();
  const processorIds = Array.isArray(input.processorIds) ? input.processorIds.map(String) : [];
  const uploaderId = String(input.uploaderId || '').trim();

  if (!sourceInput) throw new Error('sourceInput is required');
  if (!getSource(sourceId)) throw new Error(`Unknown sourceId "${sourceId}"`);
  for (const processorId of processorIds) {
    if (!getProcessor(processorId)) throw new Error(`Unknown processorId "${processorId}"`);
  }
  if (uploaderId && !getUploader(uploaderId)) throw new Error(`Unknown uploaderId "${uploaderId}"`);

  const scheduledFor = String(input.scheduledFor || input.scheduled_for || '').trim();
  if (scheduledFor && Number.isNaN(new Date(scheduledFor).getTime())) {
    throw new Error('scheduledFor must be a valid ISO datetime');
  }

  return {
    sourceId,
    sourceInput,
    processorIds,
    uploaderId,
    options: input.options && typeof input.options === 'object' ? input.options : {},
    videoRowId: input.videoRowId || input.video_row_id || null,
    sceneScriptId: input.sceneScriptId || input.scene_script_id || null,
    videoRecordId: String(input.videoRecordId || input.video_record_id || '').trim(),
    batchId: String(input.batchId || input.batch_id || '').trim(),
    priority: Math.max(-100, Math.min(100, Number(input.priority) || 0)),
    scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : '',
    maxAttempts: Math.max(1, Math.min(10, Number(input.maxAttempts) || 3)),
    title: String(input.title || '').trim(),
    campaign: String(input.campaign || '').trim(),
    language: String(input.language || '').trim(),
    presetId: String(input.presetId || '').trim(),
  };
}

function createSteps(jobId, sourceId, processorIds, uploaderId) {
  const steps = [
    `source:${sourceId}`,
    ...processorIds.map((processorId) => `processor:${processorId}`),
  ];
  if (uploaderId) steps.push(`uploader:${uploaderId}`);
  const insert = db.prepare(`
    INSERT INTO video_job_steps (job_id, step, status, progress, progress_note)
    VALUES (?, ?, 'pending', 0, '')
  `);
  for (const step of steps) insert.run(jobId, step);
}

function appendStepLog(stepId, message) {
  const row = db.prepare('SELECT log FROM video_job_steps WHERE id = ?').get(stepId);
  const nextLog = `${row?.log || ''}${nowIso()} ${message}\n`.slice(-65536);
  db.prepare('UPDATE video_job_steps SET log = ? WHERE id = ?').run(nextLog, stepId);
}

function setStepProgress(stepId, progress, note = '') {
  db.prepare(`
    UPDATE video_job_steps
    SET progress = ?, progress_note = ?
    WHERE id = ?
  `).run(Math.max(0, Math.min(100, Number(progress) || 0)), String(note || ''), stepId);
}

function setStepStatus(stepId, status, patch = {}) {
  const fields = ['status = ?'];
  const values = [status];
  if (patch.progress !== undefined) {
    fields.push('progress = ?');
    values.push(Math.max(0, Math.min(100, Number(patch.progress) || 0)));
  }
  if (patch.progressNote !== undefined) {
    fields.push('progress_note = ?');
    values.push(String(patch.progressNote || ''));
  }
  if (patch.startedAt !== undefined) {
    fields.push('started_at = ?');
    values.push(patch.startedAt);
  }
  if (patch.finishedAt !== undefined) {
    fields.push('finished_at = ?');
    values.push(patch.finishedAt);
  }
  values.push(stepId);
  db.prepare(`UPDATE video_job_steps SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function saveAsset(jobId, kind, filePath, meta = {}) {
  db.prepare(`
    INSERT INTO video_assets (job_id, kind, file_path, meta_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(jobId, kind, filePath, JSON.stringify(meta || {}), nowIso());
}

function getLatestLocalAsset(jobId) {
  const asset = db.prepare(`
    SELECT file_path, meta_json FROM video_assets
    WHERE job_id = ? AND kind != 'remote'
    ORDER BY id DESC
    LIMIT 1
  `).get(jobId);
  if (!asset) return null;
  return { filePath: asset.file_path, meta: parseJson(asset.meta_json, {}) };
}

function syncJobCatalog(job, status) {
  if (job.video_record_id) {
    const recordStatus = ({ running: 'processing', done: job.uploader_id ? 'published' : 'completed' })[status] || status;
    updateVideoRecord(job.video_record_id, { status: recordStatus });
  }
  if (job.batch_id) syncAutomationBatch(job.batch_id);
}

function scheduleWorker(delay = 25) {
  if (workerScheduled || workerRunning) return;
  workerScheduled = true;
  workerTimer = setTimeout(() => {
    workerTimer = null;
    workerScheduled = false;
    runNextQueuedJob().catch((error) => console.error('[Pipeline] Worker failed:', error.message));
  }, Math.max(25, Math.min(Number(delay) || 25, 60000)));
}

function scheduleNextDueJob() {
  const next = db.prepare(`
    SELECT scheduled_for FROM video_jobs
    WHERE status = 'queued' AND scheduled_for != '' AND scheduled_for > ?
    ORDER BY scheduled_for ASC LIMIT 1
  `).get(nowIso());
  if (!next?.scheduled_for) return;
  scheduleWorker(Math.max(25, new Date(next.scheduled_for).getTime() - Date.now()));
}

function insertJob(input, { schedule = true } = {}) {
  const job = validateJobInput(input);
  const createdAt = nowIso();
  const record = ensureVideoRecord({
    id: job.videoRecordId,
    legacyVideoId: job.videoRowId,
    title: job.title,
    sourceType: job.sourceId,
    sourceRef: job.sourceInput,
    sourcePath: job.sourceId === 'localFile' ? job.sourceInput : '',
    sourceUrl: job.sourceId === 'localFile' ? '' : job.sourceInput,
    campaign: job.campaign,
    language: job.language,
    status: job.scheduledFor ? 'scheduled' : 'queued',
    priority: job.priority,
    presetId: job.presetId,
    scheduledAt: job.scheduledFor,
    metadata: { sceneScriptId: job.sceneScriptId },
  });
  const result = db.prepare(`
    INSERT INTO video_jobs (
      source_id, source_input, processor_ids_json, uploader_id, options_json,
      status, current_step, error, video_row_id, scene_script_id, video_record_id,
      batch_id, priority, scheduled_for, max_attempts, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'queued', '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.sourceId,
    job.sourceInput,
    JSON.stringify(job.processorIds),
    job.uploaderId,
    JSON.stringify(job.options),
    job.videoRowId,
    job.sceneScriptId,
    record.id,
    job.batchId,
    job.priority,
    job.scheduledFor,
    job.maxAttempts,
    createdAt,
    createdAt
  );
  createSteps(result.lastInsertRowid, job.sourceId, job.processorIds, job.uploaderId);
  if (schedule) scheduleWorker();
  return { id: Number(result.lastInsertRowid), status: 'queued', videoRecordId: record.id, batchId: job.batchId };
}

export function createJob(input) {
  return insertJob(input);
}

export function createJobBatch(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length < 1 || items.length > 100) throw new Error('A batch must contain between 1 and 100 videos');
  const preset = input.presetId ? getPreset(input.presetId) : null;
  if (input.presetId && !preset) throw new Error(`Preset not found: ${input.presetId}`);
  const batch = createAutomationBatch({
    name: input.name,
    presetId: input.presetId,
    totalItems: items.length,
    options: input.options,
  });
  const created = [];
  const transaction = db.transaction(() => {
    items.forEach((item, index) => {
      const template = preset?.template || {};
      const job = insertJob({
        ...template,
        ...input.defaults,
        ...item,
        sourceId: item.sourceId || input.defaults?.sourceId || 'localFile',
        sourceInput: item.sourceInput || item.path || item.url,
        processorIds: item.processorIds || input.defaults?.processorIds || template.processorIds || [],
        uploaderId: item.uploaderId ?? input.defaults?.uploaderId ?? template.uploaderId ?? '',
        options: {
          ...(template.options || {}),
          ...(input.defaults?.options || {}),
          ...(item.options || {}),
        },
        presetId: input.presetId || '',
        batchId: batch.id,
      }, { schedule: false });
      addAutomationBatchItem(batch.id, { jobId: job.id, videoId: job.videoRecordId, ordinal: index + 1 });
      created.push(job);
    });
  });
  try {
    transaction();
  } catch (error) {
    db.prepare('DELETE FROM automation_batches WHERE id = ?').run(batch.id);
    throw error;
  }
  scheduleWorker();
  return { ...batch, totalItems: created.length, jobs: created };
}

async function runStep(job, step, currentFilePath, currentMeta) {
  const [role, id] = step.step.split(':');
  const credentials = getCredentials(id);
  const options = parseJson(job.options_json, {});
  const onProgress = (progress, note = '') => {
    setStepProgress(step.id, progress, note);
    db.prepare('UPDATE video_jobs SET heartbeat_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), job.id);
  };
  const workDir = path.join(process.cwd(), process.env.VIDEO_WORK_DIR || 'video-work', String(job.id));
  fs.mkdirSync(workDir, { recursive: true });

  setStepStatus(step.id, 'running', { startedAt: nowIso(), progressNote: 'Starting' });
  db.prepare('UPDATE video_jobs SET current_step = ?, updated_at = ? WHERE id = ?').run(step.step, nowIso(), job.id);
  appendStepLog(step.id, 'Step started');

  let result = null;
  if (role === 'source') {
    const adapter = SOURCE_ADAPTERS[id];
    if (!adapter) throw new Error(`Source adapter unavailable: ${id}`);
    const items = await adapter.resolveInput(job.source_input, credentials);
    const item = Array.isArray(items?.items) ? items.items[0] : items?.[0];
    if (!item) throw new Error(`No downloadable items resolved for ${job.source_input}`);
    result = await adapter.download(item, workDir, onProgress, credentials);
    if (!result?.filePath) throw new Error(`Source ${id} did not return filePath`);
    const validation = await validateVideoOutput(result.filePath);
    const sourceMeta = { ...(result.meta || {}), validation };
    saveAsset(job.id, 'original', result.filePath, sourceMeta);
    recordVideoVersion({
      videoId: job.video_record_id,
      jobId: job.id,
      kind: 'original',
      filePath: result.filePath,
      probe: validation.output,
      validation,
    });
    currentFilePath = result.filePath;
    currentMeta = { ...currentMeta, ...sourceMeta };
  } else if (role === 'processor') {
    const adapter = PROCESSOR_ADAPTERS[id];
    if (!adapter) throw new Error(`Processor adapter unavailable: ${id}`);
    result = await adapter.process(currentFilePath, options[id] || {}, onProgress, credentials, currentMeta);
    if (!result?.outputPath) throw new Error(`Processor ${id} did not return outputPath`);
    const previousFilePath = currentFilePath;
    const mediaChanged = path.resolve(result.outputPath) !== path.resolve(previousFilePath);
    const validation = mediaChanged
      ? await validateVideoOutput(result.outputPath, {
        expectedInputPath: previousFilePath,
        preserveDuration: ['aiEditor', 'faceFusion', 'voiceover'].includes(id)
          && !(id === 'faceFusion' && Number(options[id]?.trimFrameEnd)),
        preserveDimensions: ['aiEditor', 'faceFusion', 'voiceover'].includes(id),
        requireChanged: id === 'faceFusion',
      })
      : null;
    const processorArtifacts = { ...(result.artifacts || {}), ...(validation ? { validation } : {}) };
    saveAsset(job.id, id, result.outputPath, processorArtifacts);
    if (validation) {
      recordVideoVersion({
        videoId: job.video_record_id,
        jobId: job.id,
        kind: id,
        filePath: result.outputPath,
        probe: validation.output,
        validation,
      });
    }
    const providerDetails = [
      result.artifacts?.metadataProvider && `metadata=${result.artifacts.metadataProvider}/${result.artifacts.metadataModel || 'default'}`,
      result.artifacts?.translationProvider && `translation=${result.artifacts.translationProvider}/${result.artifacts.translationModel || 'default'}`,
      result.artifacts?.rescriptProvider && `rescript=${result.artifacts.rescriptProvider}/${result.artifacts.rescriptModel || 'default'}`,
    ].filter(Boolean);
    if (providerDetails.length) appendStepLog(step.id, `Providers: ${providerDetails.join(', ')}`);
    currentFilePath = result.outputPath;
    currentMeta = { ...currentMeta, ...processorArtifacts };
  } else if (role === 'uploader') {
    const adapter = UPLOADER_ADAPTERS[id];
    if (!adapter) throw new Error(`Uploader adapter unavailable: ${id}`);
    result = await adapter.upload(currentFilePath, { ...currentMeta, ...(options[id] || {}) }, onProgress);
    saveAsset(job.id, 'remote', result?.url || result?.remoteId || '', result || {});
    recordPublication({
      videoId: job.video_record_id,
      jobId: job.id,
      platformId: id,
      channelId: currentMeta.channelId || '',
      remoteId: result?.remoteId || '',
      url: result?.url || '',
      status: 'published',
      metadata: result || {},
    });
    if (job.video_row_id && result?.url) {
      finalizeUpload(job.video_row_id, result.url, new Date().toISOString().slice(0, 10));
    }
    currentMeta = { ...currentMeta, ...(result || {}) };
  } else {
    throw new Error(`Unknown step role: ${role}`);
  }

  setStepStatus(step.id, 'ok', { progress: 100, progressNote: 'Done', finishedAt: nowIso() });
  appendStepLog(step.id, 'Step finished');
  return { currentFilePath, currentMeta, pauseForReview: Boolean(result?.pauseForReview) };
}

export async function runNextQueuedJob() {
  if (workerRunning) return null;
  const claim = db.transaction(() => {
    const queued = db.prepare(`
      SELECT * FROM video_jobs
      WHERE status = 'queued' AND (scheduled_for = '' OR scheduled_for <= ?)
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get(nowIso());
    if (!queued) return null;
    const claimedAt = nowIso();
    const result = db.prepare(`
      UPDATE video_jobs
      SET status = 'running', error = '', claimed_at = ?, heartbeat_at = ?, worker_id = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(claimedAt, claimedAt, workerId, claimedAt, queued.id);
    return result.changes ? db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(queued.id) : null;
  });
  const job = claim();
  if (!job) {
    scheduleNextDueJob();
    return null;
  }

  workerRunning = true;
  cancelSignals.set(job.id, { canceled: false });
  let currentFilePath = null;
  let currentMeta = {};
  try {
    syncJobCatalog(job, 'running');
    const steps = db.prepare('SELECT * FROM video_job_steps WHERE job_id = ? ORDER BY id ASC').all(job.id);
    for (const step of steps) {
      if (cancelSignals.get(job.id)?.canceled) throw new Error('Job canceled');
      if (step.status === 'ok') {
        const latestAsset = getLatestLocalAsset(job.id);
        if (latestAsset) {
          currentFilePath = latestAsset.filePath;
          currentMeta = { ...currentMeta, ...latestAsset.meta };
        }
        continue;
      }
      const output = await runStep(job, step, currentFilePath, currentMeta);
      currentFilePath = output.currentFilePath;
      currentMeta = output.currentMeta;
      if (output.pauseForReview) {
        db.prepare(`
          UPDATE video_jobs
          SET status = 'review', current_step = 'review:metadata', error = '', updated_at = ?
          WHERE id = ?
        `).run(nowIso(), job.id);
        syncJobCatalog(job, 'review');
        return job.id;
      }
    }
    db.prepare("UPDATE video_jobs SET status = 'done', current_step = '', error = '', updated_at = ? WHERE id = ?").run(nowIso(), job.id);
    syncJobCatalog(job, 'done');
  } catch (error) {
    const status = cancelSignals.get(job.id)?.canceled ? 'canceled' : 'failed';
    const activeStep = db.prepare("SELECT id FROM video_job_steps WHERE job_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1").get(job.id);
    if (activeStep) {
      setStepStatus(activeStep.id, status === 'canceled' ? 'skipped' : 'failed', {
        progressNote: error.message,
        finishedAt: nowIso(),
      });
      appendStepLog(activeStep.id, error.message);
    }
    db.prepare('UPDATE video_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(status, error.message, nowIso(), job.id);
    syncJobCatalog(job, status);
    if (job.video_row_id) {
      updateVideoStatus(job.video_row_id, 'Not started');
      logError(job.video_row_id, error.message);
    }
  } finally {
    cancelSignals.delete(job.id);
    workerRunning = false;
    scheduleWorker();
  }
  return job.id;
}

export function listJobs(filter = {}) {
  const limit = Math.max(1, Math.min(100, Number(filter.limit) || 100));
  const status = filter.status ? String(filter.status) : '';
  const jobs = status
    ? db.prepare('SELECT * FROM video_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM video_jobs ORDER BY created_at DESC LIMIT ?').all(limit);
  const getSteps = db.prepare('SELECT * FROM video_job_steps WHERE job_id = ? ORDER BY id ASC');
  const getAssets = db.prepare('SELECT id, job_id, kind, meta_json, created_at FROM video_assets WHERE job_id = ? ORDER BY id ASC');
  return jobs.map((job) => ({
    id: job.id,
    sourceId: job.source_id,
    sourceInput: job.source_input,
    processorIds: parseJson(job.processor_ids_json, []),
    uploaderId: job.uploader_id,
    options: parseJson(job.options_json, {}),
    status: job.status,
    currentStep: job.current_step,
    error: job.error || '',
    videoRowId: job.video_row_id,
    videoRecordId: job.video_record_id,
    batchId: job.batch_id,
    priority: job.priority || 0,
    scheduledFor: job.scheduled_for || '',
    claimedAt: job.claimed_at || '',
    heartbeatAt: job.heartbeat_at || '',
    workerId: job.worker_id || '',
    maxAttempts: job.max_attempts || 3,
    sceneScriptId: job.scene_script_id,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    steps: getSteps.all(job.id).map((step) => ({
      id: step.id,
      step: step.step,
      attempt: step.attempt,
      status: step.status,
      progress: step.progress,
      progressNote: step.progress_note,
      log: step.log,
      startedAt: step.started_at,
      finishedAt: step.finished_at,
    })),
    assets: getAssets.all(job.id).map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      meta: parseJson(asset.meta_json, {}),
      createdAt: asset.created_at,
    })),
  }));
}

export function retryJob(jobId) {
  const job = db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (!['failed', 'canceled'].includes(job.status)) throw new Error('Only failed or canceled jobs can be retried');
  const attempts = db.prepare('SELECT MAX(attempt) AS attempts FROM video_job_steps WHERE job_id = ?').get(jobId)?.attempts || 1;
  if (attempts >= (job.max_attempts || 3)) throw new Error(`Maximum retry count reached (${job.max_attempts || 3})`);
  const failedStep = db.prepare("SELECT id, attempt FROM video_job_steps WHERE job_id = ? AND status = 'failed' ORDER BY id ASC LIMIT 1").get(jobId);
  if (failedStep) {
    db.prepare(`
      UPDATE video_job_steps
      SET status = 'pending', progress = 0, progress_note = '', attempt = ?, started_at = NULL, finished_at = NULL
      WHERE id = ?
    `).run((failedStep.attempt || 1) + 1, failedStep.id);
  }
  db.prepare("UPDATE video_jobs SET status = 'queued', error = '', updated_at = ? WHERE id = ?").run(nowIso(), jobId);
  syncJobCatalog(job, 'queued');
  if (job.video_row_id) updateVideoStatus(job.video_row_id, 'In progress');
  scheduleWorker();
  return { id: Number(jobId), status: 'queued' };
}

export function approveMetadata(jobId, patch = {}) {
  const job = db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (job.status !== 'review') throw new Error('Only jobs waiting for metadata review can be approved');
  const asset = db.prepare(`
    SELECT * FROM video_assets
    WHERE job_id = ? AND kind = 'metadata'
    ORDER BY id DESC
    LIMIT 1
  `).get(jobId);
  if (!asset) throw new Error('Metadata review asset was not found');
  const current = parseJson(asset.meta_json, {});
  const titleEn = String(patch.titleEn ?? current.titleEn ?? '').trim();
  const descriptionEn = String(patch.descriptionEn ?? current.descriptionEn ?? '').trim();
  const tags = Array.isArray(patch.tags)
    ? patch.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : current.tags;
  if (!titleEn || !descriptionEn || !Array.isArray(tags) || tags.length === 0) {
    throw new Error('Title, description, and at least one tag are required');
  }
  db.prepare('UPDATE video_assets SET meta_json = ? WHERE id = ?').run(JSON.stringify({
    ...current,
    titleEn,
    descriptionEn,
    tags,
    metadataReviewRequired: false,
    metadataApprovedAt: nowIso(),
  }), asset.id);
  db.prepare(`
    UPDATE video_jobs
    SET status = 'queued', current_step = '', error = '', updated_at = ?
    WHERE id = ?
  `).run(nowIso(), jobId);
  syncJobCatalog(job, 'queued');
  scheduleWorker();
  return { id: Number(jobId), status: 'queued' };
}

export function cancelJob(jobId) {
  const job = db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (job.status === 'running') {
    const signal = cancelSignals.get(Number(jobId));
    if (signal) signal.canceled = true;
  }
  if (job.status === 'queued' || job.status === 'review') {
    db.prepare("UPDATE video_jobs SET status = 'canceled', error = 'Canceled by user', updated_at = ? WHERE id = ?").run(nowIso(), jobId);
    db.prepare("UPDATE video_job_steps SET status = 'skipped', progress_note = 'Canceled by user' WHERE job_id = ? AND status = 'pending'").run(jobId);
    if (job.video_row_id) updateVideoStatus(job.video_row_id, 'Not started');
    syncJobCatalog(job, 'canceled');
  }
  return { id: Number(jobId), status: (job.status === 'queued' || job.status === 'review') ? 'canceled' : 'canceling' };
}

export function bulkJobAction(action, jobIds = []) {
  const ids = [...new Set((Array.isArray(jobIds) ? jobIds : []).map(Number).filter(Number.isInteger))].slice(0, 100);
  if (ids.length === 0) throw new Error('Select at least one job');
  if (!['retry', 'cancel'].includes(action)) throw new Error('Bulk action must be retry or cancel');
  const results = [];
  for (const jobId of ids) {
    try {
      results.push({ ok: true, job: action === 'retry' ? retryJob(jobId) : cancelJob(jobId) });
    } catch (error) {
      results.push({ ok: false, jobId, error: error.message });
    }
  }
  return results;
}
