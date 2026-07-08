import fs from 'fs';
import path from 'path';
import db from '../db/sqlite';
import { getSource, getProcessor, getUploader } from './registry';
import { getCredentials } from './connections';
import * as bilibiliSource from './sources/bilibili';
import * as douyinSource from './sources/douyin';
import * as voiceoverProcessor from './processors/voiceover';
import * as aiEditorProcessor from './processors/aiEditor';
import * as sceneCutProcessor from './processors/sceneCut';
import * as faceFusionProcessor from './processors/faceFusion';
import * as youtubeUploader from './uploaders/youtube';

const SOURCE_ADAPTERS = {
  bilibili: bilibiliSource,
  douyin: douyinSource,
};

const PROCESSOR_ADAPTERS = {
  voiceover: voiceoverProcessor,
  aiEditor: aiEditorProcessor,
  sceneCut: sceneCutProcessor,
  faceFusion: faceFusionProcessor,
};

const UPLOADER_ADAPTERS = {
  youtube: youtubeUploader,
};

let workerRunning = false;
let workerScheduled = false;
const cancelSignals = new Map();

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

  return {
    sourceId,
    sourceInput,
    processorIds,
    uploaderId,
    options: input.options && typeof input.options === 'object' ? input.options : {},
    videoRowId: input.videoRowId || input.video_row_id || null,
    sceneScriptId: input.sceneScriptId || input.scene_script_id || null,
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

function scheduleWorker() {
  if (workerScheduled || workerRunning) return;
  workerScheduled = true;
  setTimeout(() => {
    workerScheduled = false;
    runNextQueuedJob().catch((error) => console.error('[Pipeline] Worker failed:', error.message));
  }, 25);
}

export function createJob(input) {
  const job = validateJobInput(input);
  const createdAt = nowIso();
  const result = db.prepare(`
    INSERT INTO video_jobs (
      source_id, source_input, processor_ids_json, uploader_id, options_json,
      status, current_step, error, video_row_id, scene_script_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'queued', '', '', ?, ?, ?, ?)
  `).run(
    job.sourceId,
    job.sourceInput,
    JSON.stringify(job.processorIds),
    job.uploaderId,
    JSON.stringify(job.options),
    job.videoRowId,
    job.sceneScriptId,
    createdAt,
    createdAt
  );
  createSteps(result.lastInsertRowid, job.sourceId, job.processorIds, job.uploaderId);
  scheduleWorker();
  return { id: result.lastInsertRowid, status: 'queued' };
}

async function runStep(job, step, currentFilePath, currentMeta) {
  const [role, id] = step.step.split(':');
  const credentials = getCredentials(id);
  const options = parseJson(job.options_json, {});
  const onProgress = (progress, note = '') => {
    setStepProgress(step.id, progress, note);
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
    saveAsset(job.id, 'original', result.filePath, result.meta || {});
    currentFilePath = result.filePath;
    currentMeta = { ...currentMeta, ...(result.meta || {}) };
  } else if (role === 'processor') {
    const adapter = PROCESSOR_ADAPTERS[id];
    if (!adapter) throw new Error(`Processor adapter unavailable: ${id}`);
    result = await adapter.process(currentFilePath, options[id] || {}, onProgress, credentials);
    if (!result?.outputPath) throw new Error(`Processor ${id} did not return outputPath`);
    saveAsset(job.id, id, result.outputPath, result.artifacts || {});
    currentFilePath = result.outputPath;
    currentMeta = { ...currentMeta, ...(result.artifacts || {}) };
  } else if (role === 'uploader') {
    const adapter = UPLOADER_ADAPTERS[id];
    if (!adapter) throw new Error(`Uploader adapter unavailable: ${id}`);
    result = await adapter.upload(currentFilePath, { ...currentMeta, ...(options[id] || {}) }, onProgress);
    saveAsset(job.id, 'remote', result?.url || result?.remoteId || '', result || {});
    currentMeta = { ...currentMeta, ...(result || {}) };
  } else {
    throw new Error(`Unknown step role: ${role}`);
  }

  setStepStatus(step.id, 'ok', { progress: 100, progressNote: 'Done', finishedAt: nowIso() });
  appendStepLog(step.id, 'Step finished');
  return { currentFilePath, currentMeta };
}

export async function runNextQueuedJob() {
  if (workerRunning) return null;
  const job = db.prepare(`
    SELECT * FROM video_jobs
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 1
  `).get();
  if (!job) return null;

  workerRunning = true;
  cancelSignals.set(job.id, { canceled: false });
  let currentFilePath = null;
  let currentMeta = {};
  try {
    db.prepare("UPDATE video_jobs SET status = 'running', error = '', updated_at = ? WHERE id = ?").run(nowIso(), job.id);
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
    }
    db.prepare("UPDATE video_jobs SET status = 'done', current_step = '', error = '', updated_at = ? WHERE id = ?").run(nowIso(), job.id);
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
  if (job.status !== 'failed') throw new Error('Only failed jobs can be retried');
  const failedStep = db.prepare("SELECT id, attempt FROM video_job_steps WHERE job_id = ? AND status = 'failed' ORDER BY id ASC LIMIT 1").get(jobId);
  if (failedStep) {
    db.prepare(`
      UPDATE video_job_steps
      SET status = 'pending', progress = 0, progress_note = '', attempt = ?, started_at = NULL, finished_at = NULL
      WHERE id = ?
    `).run((failedStep.attempt || 1) + 1, failedStep.id);
  }
  db.prepare("UPDATE video_jobs SET status = 'queued', error = '', updated_at = ? WHERE id = ?").run(nowIso(), jobId);
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
  if (job.status === 'queued') {
    db.prepare("UPDATE video_jobs SET status = 'canceled', error = 'Canceled by user', updated_at = ? WHERE id = ?").run(nowIso(), jobId);
    db.prepare("UPDATE video_job_steps SET status = 'skipped', progress_note = 'Canceled by user' WHERE job_id = ? AND status = 'pending'").run(jobId);
  }
  return { id: Number(jobId), status: job.status === 'queued' ? 'canceled' : 'canceling' };
}
