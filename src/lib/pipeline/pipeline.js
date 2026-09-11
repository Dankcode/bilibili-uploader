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
import { getSource, getProcessor, getUploader, validateProcessorChain } from './registry';
import { getCredentials, recordOutcome } from './connections';
import { getPreset } from './presets';
import {
  attachPublicationToYouTubeBinding,
  bindJobToYouTubeAuthorization,
  getJobYouTubeAuthorization,
  getYouTubeAuthorization,
  markYouTubeAuthorizationVerified,
  publicYouTubeAuthorization,
} from '../youtube/authorizations';
import * as bilibiliSource from './sources/bilibili';
import * as douyinSource from './sources/douyin';
import * as localFileSource from './sources/localFile';
import * as voiceoverProcessor from './processors/voiceover';
import * as aiEditorProcessor from './processors/aiEditor';
import * as sceneCutProcessor from './processors/sceneCut';
import * as faceFusionProcessor from './processors/faceFusion';
import * as metadataProcessor from './processors/metadata';
import * as videoContextProcessor from './processors/videoContext';
import * as ocrContextProcessor from './processors/ocrContext';
import * as youtubeUploader from './uploaders/youtube';
import { isAllowedBilibiliHost, normalizeBilibiliVideoInput } from '../video/bilibiliUrl.js';
import { emitMailEvent } from '../mail/events.js';

const SOURCE_ADAPTERS = {
  localFile: localFileSource,
  bilibili: bilibiliSource,
  douyin: douyinSource,
};

const PROCESSOR_ADAPTERS = {
  videoContext: videoContextProcessor,
  ocrContext: ocrContextProcessor,
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

/**
 * OPERATIONAL LOGGING — every line carries the job id so a run can be followed
 * in stdout without reading SQLite by hand. Before this the pipeline emitted a
 * single console.error for a catastrophic worker failure and nothing else, so a
 * failed job left no trace in the server log at all.
 *
 * Never log credentials, tokens, cookies, or provider keys.
 */
function logJob(jobId, message, ...details) {
  console.log(`[Pipeline] job=${jobId} ${message}`, ...details);
}

function logJobError(jobId, message, error) {
  console.error(`[Pipeline] job=${jobId} ${message}: ${error?.message || error}`);
  if (error?.stack) console.error(error.stack);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Every API upload must be intentionally assigned to a channel at queue time.
 * This prevents a single newly-authorized account from silently receiving a
 * batch that an operator meant for a different channel.
 */
function resolveYouTubeAuthorizationId(requestedId) {
  if (requestedId) return requestedId;
  const env = globalThis.process?.env || {};
  if ((env.YOUTUBE_UPLOAD_METHOD || 'api').toLowerCase() === 'pygui') return '';
  if (env.YOUTUBE_CHANNEL_ID) return '';
  throw new Error(
    'Choose an authorized YouTube channel for this video before it is queued. '
    + 'Authorize a channel in Connections, then select it in the batch planner.',
  );
}

/**
 * Bilibili input is checked at queue time too. A space URL is left to the source
 * adapter (it has to scrape the page to know what is on it); anything else must
 * already look like a Bilibili video.
 */
function assertBilibiliSourceInput(sourceInput) {
  let hostname = '';
  try {
    hostname = new URL(sourceInput).hostname.toLowerCase();
  } catch {
    // Not a URL — fall through to identifier validation.
  }
  if (hostname === 'space.bilibili.com') return;
  if (hostname && !isAllowedBilibiliHost(hostname)) {
    throw new Error(
      `Bilibili source refused: ${hostname} is not a Bilibili host. `
      + 'The stored session cookie is only ever sent to bilibili.com or b23.tv.',
    );
  }
  normalizeBilibiliVideoInput(sourceInput);
}

/**
 * Local source paths are checked at queue time, not at run time. Mirrors the
 * check in sources/localFile.js so the two cannot drift apart.
 */
function assertReadableLocalSource(sourceInput) {
  if (!path.isAbsolute(sourceInput)) {
    throw new Error(`Local source must be an absolute path: ${sourceInput}`);
  }
  const resolved = path.resolve(sourceInput);
  let stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    throw new Error(`Local source file not found: ${sourceInput}`);
  }
  if (!stats.isFile()) throw new Error(`Local source is not a file: ${sourceInput}`);
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    throw new Error(`Local source file is not readable: ${sourceInput}`);
  }
  if (stats.size === 0) throw new Error(`Local source file is empty: ${sourceInput}`);
}

function assertLongUploadAllowed(authorization, durationSeconds) {
  const duration = Number(durationSeconds) || 0;
  if (duration <= 15 * 60 || authorization?.longUploadsStatus === 'allowed') return;
  throw new Error(
    `The selected YouTube channel is not phone-verified for uploads longer than 15 minutes. `
    + `This video is ${Math.ceil(duration / 60)} minutes; verify the channel with YouTube, then resolve and queue it again.`,
  );
}

export function validateJobInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Job input is required');
  const sourceId = String(input.sourceId || '').trim();
  const sourceInput = String(input.sourceInput || '').trim();
  const processorIds = Array.isArray(input.processorIds) ? input.processorIds.map(String) : [];
  const uploaderId = String(input.uploaderId || '').trim();
  const options = input.options && typeof input.options === 'object' ? structuredClone(input.options) : {};
  const agentPrincipal = String(input.agentPrincipal || '');
  if (agentPrincipal && uploaderId) {
    if (!processorIds.includes('metadata')) throw new Error('Agent publishing jobs require the metadata processor and human review');
    if (processorIds.at(-1) !== 'metadata') throw new Error('Agent publishing jobs require metadata as the final processor');
    options.metadata = { ...options.metadata, reviewMetadata: true };
  }
  const youtubeAuthorizationId = String(
    input.youtubeAuthorizationId || options.youtube?.authorizationId || '',
  ).trim();

  if (!sourceInput) throw new Error('sourceInput is required');
  if (!getSource(sourceId)) throw new Error(`Unknown sourceId "${sourceId}"`);
  const chain = validateProcessorChain(processorIds);
  if (!chain.ok) throw new Error(chain.errors.join(' '));
  if (uploaderId && !getUploader(uploaderId)) throw new Error(`Unknown uploaderId "${uploaderId}"`);
  if (youtubeAuthorizationId && uploaderId !== 'youtube') {
    throw new Error('A YouTube authorization can only be used with the YouTube uploader');
  }
  const selectedAuthorization = youtubeAuthorizationId
    ? getYouTubeAuthorization(youtubeAuthorizationId, { requireUsable: true })
    : null;

  // Resolve the publishing identity up front, rather than running the source and
  // every processor and only then failing on the last step for want of a
  // credential. The operator must choose the channel for every API upload.
  const resolvedAuthorizationId = uploaderId === 'youtube'
    ? resolveYouTubeAuthorizationId(youtubeAuthorizationId)
    : youtubeAuthorizationId;
  if (uploaderId === 'youtube' && selectedAuthorization) {
    assertLongUploadAllowed(selectedAuthorization, input.sourceDurationSeconds || input.durationSeconds);
  }

  // Validate the source input while the operator is still looking at the form.
  // Discovering a bad path or a non-Bilibili URL at run time turns a batch of
  // fifty bad inputs into fifty failures that arrive one at a time.
  if (sourceId === 'localFile') assertReadableLocalSource(sourceInput);
  if (sourceId === 'bilibili') assertBilibiliSourceInput(sourceInput);

  const scheduledFor = String(input.scheduledFor || input.scheduled_for || '').trim();
  if (scheduledFor && Number.isNaN(new Date(scheduledFor).getTime())) {
    throw new Error('scheduledFor must be a valid ISO datetime');
  }

  return {
    agentPrincipal,
    sourceId,
    sourceInput,
    processorIds,
    uploaderId,
    options,
    youtubeAuthorizationId: resolvedAuthorizationId,
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
    sourceDurationSeconds: Math.max(0, Number(input.sourceDurationSeconds || input.durationSeconds) || 0),
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
  if (patch.metrics !== undefined) {
    fields.push('metrics_json = ?');
    values.push(JSON.stringify(patch.metrics || {}));
  }
  values.push(stepId);
  db.prepare(`UPDATE video_job_steps SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  if (status === 'failed') {
    const row = db.prepare('SELECT j.id AS job_id,j.video_record_id,j.current_step,vr.title FROM video_job_steps s JOIN video_jobs j ON j.id=s.job_id LEFT JOIN video_records vr ON vr.id=j.video_record_id WHERE s.id=?').get(stepId);
    if (row?.video_record_id) emitMailEvent({ videoId: row.video_record_id, jobId: row.job_id, eventKind: 'job.step.failed', stepId, payload: { videoTitle: row.title || '', detail: patch.progressNote || row.current_step || 'Pipeline step failed' } });
  }
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
    WHERE job_id = ? AND kind IN (
      'original', 'voiceover', 'faceFusion', 'metadata', 'aiEditor', 'sceneCut',
      'videoContext', 'ocrContext'
    )
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
  if (process.env.VIDEO_INLINE_WORKER !== '1') return;
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
  const jobId = Number(result.lastInsertRowid);
  if (job.agentPrincipal) db.prepare('UPDATE video_jobs SET agent_principal = ? WHERE id = ?').run(job.agentPrincipal, jobId);
  createSteps(jobId, job.sourceId, job.processorIds, job.uploaderId);
  if (job.youtubeAuthorizationId) {
    bindJobToYouTubeAuthorization(jobId, job.youtubeAuthorizationId);
  }
  if (schedule) scheduleWorker();
  return {
    id: jobId,
    status: 'queued',
    videoRecordId: record.id,
    batchId: job.batchId,
    youtubeAuthorizationId: job.youtubeAuthorizationId,
  };
}

export function createJob(input) {
  return db.transaction(() => insertJob(input))();
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
        youtubeAuthorizationId: item.youtubeAuthorizationId
          ?? input.defaults?.youtubeAuthorizationId
          ?? template.youtubeAuthorizationId
          ?? '',
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

/**
 * Edit a workflow before any work begins. The authorization binding is changed
 * only while every step is still pending and no publication exists, preserving
 * the immutable channel lineage once a run starts.
 */
export function updateQueuedJob(jobId, patch = {}) {
  const existing = db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(Number(jobId));
  if (!existing) throw new Error(`Job not found: ${jobId}`);
  if (existing.status !== 'queued') throw new Error('Only queued jobs can be edited. Cancel and create a new run after processing starts.');
  const hasStarted = db.prepare("SELECT 1 FROM video_job_steps WHERE job_id = ? AND status != 'pending' LIMIT 1").get(existing.id);
  if (hasStarted) throw new Error('This queued job has already started a step and cannot be edited in place.');
  const binding = db.prepare('SELECT publication_id FROM youtube_upload_bindings WHERE job_id = ?').get(existing.id);
  if (binding?.publication_id) throw new Error('A job with a publication cannot be assigned to a different channel.');

  const previousOptions = parseJson(existing.options_json, {});
  const input = validateJobInput({
    sourceId: existing.source_id,
    sourceInput: existing.source_input,
    processorIds: patch.processorIds ?? parseJson(existing.processor_ids_json, []),
    uploaderId: patch.uploaderId ?? existing.uploader_id,
    options: { ...previousOptions, ...(patch.options || {}) },
    youtubeAuthorizationId: patch.youtubeAuthorizationId ?? patch.options?.youtube?.authorizationId ?? '',
    videoRowId: existing.video_row_id,
    sceneScriptId: existing.scene_script_id,
    videoRecordId: existing.video_record_id,
    batchId: existing.batch_id,
    priority: patch.priority ?? existing.priority,
    scheduledFor: patch.scheduledFor ?? existing.scheduled_for,
    maxAttempts: existing.max_attempts,
    agentPrincipal: existing.agent_principal,
  });
  const apply = db.transaction(() => {
    db.prepare(`
      UPDATE video_jobs
      SET processor_ids_json = ?, uploader_id = ?, options_json = ?, priority = ?, scheduled_for = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(input.processorIds), input.uploaderId, JSON.stringify(input.options), input.priority, input.scheduledFor, nowIso(), existing.id);
    db.prepare('DELETE FROM video_job_steps WHERE job_id = ?').run(existing.id);
    createSteps(existing.id, input.sourceId, input.processorIds, input.uploaderId);
    db.prepare('DELETE FROM youtube_upload_bindings WHERE job_id = ?').run(existing.id);
    if (input.youtubeAuthorizationId) bindJobToYouTubeAuthorization(existing.id, input.youtubeAuthorizationId);
    if (existing.video_record_id) updateVideoRecord(existing.video_record_id, {
      priority: input.priority,
      status: input.scheduledFor ? 'scheduled' : 'queued',
      scheduledAt: input.scheduledFor,
    });
  });
  apply();
  scheduleWorker();
  return { id: existing.id, status: 'queued', youtubeAuthorizationId: input.youtubeAuthorizationId };
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

  const stepStartedAtMs = Date.now();
  setStepStatus(step.id, 'running', { startedAt: nowIso(), progressNote: 'Starting' });
  db.prepare('UPDATE video_jobs SET current_step = ?, updated_at = ? WHERE id = ?').run(step.step, nowIso(), job.id);
  appendStepLog(step.id, 'Step started');
  logJob(job.id, `step=${step.step} attempt=${step.attempt || 1} started`);

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
    // Analysis-only processors intentionally return the input path unchanged.
    // Their metadata and artifact files are durable outputs even though no
    // video version is created.
    saveAsset(job.id, id, result.outputPath, processorArtifacts);
    for (const artifact of Array.isArray(result.artifactFiles) ? result.artifactFiles : []) {
      if (artifact?.kind && artifact?.path) saveAsset(job.id, artifact.kind, artifact.path, artifact.meta || {});
    }
    if (result.metrics) setStepStatus(step.id, 'running', { metrics: result.metrics });
    if (job.video_record_id && ['videoContext', 'ocrContext'].includes(id)) {
      const previous = db.prepare('SELECT context_summary_json FROM video_records WHERE id = ?').get(job.video_record_id);
      const summary = {
        ...parseJson(previous?.context_summary_json, {}),
        segmentCount: result.artifacts?.segmentCount ?? result.metrics?.segmentCount,
        frameCount: result.artifacts?.frameCount ?? result.metrics?.frameCount,
        correctionCount: result.artifacts?.correctionCount ?? result.metrics?.correctionCount,
        glossaryTerms: (result.artifacts?.glossary || []).map((item) => item.term).slice(0, 40),
      };
      db.prepare('UPDATE video_records SET context_summary_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(summary), nowIso(), job.video_record_id);
    }
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
    if (job.agent_principal) {
      const approval = db.prepare('SELECT metadata_approved_by FROM video_jobs WHERE id = ?').get(job.id);
      const asset = db.prepare("SELECT meta_json FROM video_assets WHERE job_id = ? AND kind = 'metadata' ORDER BY id DESC LIMIT 1").get(job.id);
      if (!approval?.metadata_approved_by || !asset) throw new Error('Human metadata approval is required before publishing');
      currentMeta = { ...currentMeta, ...parseJson(asset.meta_json, {}) };
    }
    const adapter = UPLOADER_ADAPTERS[id];
    if (!adapter) throw new Error(`Uploader adapter unavailable: ${id}`);
    const authorization = id === 'youtube'
      ? getJobYouTubeAuthorization(job.id, { requireUsable: true })
      : null;
    const uploadMeta = {
      ...currentMeta,
      ...(options[id] || {}),
      ...(authorization ? {
        youtubeAuthorization: {
          id: authorization.id,
          emailAddress: authorization.emailAddress,
          channelId: authorization.channelId,
          channelTitle: authorization.channelTitle,
          clientRef: authorization.clientRef,
          credentialRef: authorization.credentialRef,
        },
      } : {}),
    };
    result = await adapter.upload(currentFilePath, uploadMeta, onProgress);
    let publicationId = null;
    db.transaction(() => {
      saveAsset(job.id, 'remote', result?.url || result?.remoteId || '', result || {});
      publicationId = recordPublication({
        videoId: job.video_record_id,
        jobId: job.id,
        platformId: id,
        channelId: result?.channelId || authorization?.channelId || uploadMeta.channelId || '',
        remoteId: result?.remoteId || '',
        url: result?.url || '',
        status: 'published',
        metadata: result || {},
      });
      if (authorization && publicationId) {
        attachPublicationToYouTubeBinding(job.id, publicationId);
        markYouTubeAuthorizationVerified(authorization.id);
      }
      if (job.video_row_id && result?.url) {
        finalizeUpload(job.video_row_id, result.url, new Date().toISOString().slice(0, 10));
      }
    })();
    if (publicationId && job.video_record_id) emitMailEvent({
      videoId: job.video_record_id, jobId: job.id, eventKind: 'publish.ok', stepId: step.id,
      payload: { videoTitle: currentMeta.title || '', remoteId: result?.remoteId || '', url: result?.url || '', channelTitle: authorization?.channelTitle || '' },
    });
    currentMeta = { ...currentMeta, ...(result || {}) };
  } else {
    throw new Error(`Unknown step role: ${role}`);
  }

  const durationMs = Date.now() - stepStartedAtMs;
  // One successful step refreshes the shared health record that powers the
  // overview, Connections, and diagnostics. No screen probes a private state.
  recordOutcome(id, { error: null });
  setStepStatus(step.id, 'ok', {
    progress: 100,
    progressNote: 'Done',
    finishedAt: nowIso(),
    // metrics_json has always existed and always been empty; a step's own
    // duration is the first thing anyone wants when a run is slow.
    metrics: { durationMs, role, adapterId: id },
  });
  appendStepLog(step.id, `Step finished in ${durationMs} ms`);
  logJob(job.id, `step=${step.step} ok in ${durationMs} ms`);
  return {
    currentFilePath,
    currentMeta,
    pauseForReview: Boolean(result?.pauseForReview),
    reviewType: result?.reviewType || 'metadata',
  };
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
  const jobStartedAtMs = Date.now();
  let currentFilePath = null;
  let currentMeta = {};
  // `job` is the row as claimed, so job.current_step is stale by the time a
  // failure is logged. Track the step actually in flight.
  let activeStepName = '';
  try {
    logJob(job.id, `claimed by ${workerId}: source=${job.source_id} processors=${job.processor_ids_json} uploader=${job.uploader_id || 'none'}`);
    syncJobCatalog(job, 'running');
    const steps = db.prepare('SELECT * FROM video_job_steps WHERE job_id = ? ORDER BY id ASC').all(job.id);
    for (const step of steps) {
      if (cancelSignals.get(job.id)?.canceled || db.prepare('SELECT cancel_requested FROM video_jobs WHERE id = ?').get(job.id)?.cancel_requested) throw new Error('Job canceled');
      // A retry or an edited processor option must never bypass agent review.
      if (step.step.startsWith('uploader:') && job.agent_principal && !db.prepare('SELECT metadata_approved_by FROM video_jobs WHERE id = ?').get(job.id)?.metadata_approved_by) {
        db.prepare("UPDATE video_jobs SET status = 'review', current_step = 'review:metadata', updated_at = ? WHERE id = ?").run(nowIso(), job.id);
        syncJobCatalog(job, 'review');
        return job.id;
      }
      if (step.status === 'ok') {
        const latestAsset = getLatestLocalAsset(job.id);
        if (latestAsset) {
          currentFilePath = latestAsset.filePath;
          currentMeta = { ...currentMeta, ...latestAsset.meta };
        }
        continue;
      }
      activeStepName = step.step;
      const output = await runStep(job, step, currentFilePath, currentMeta);
      currentFilePath = output.currentFilePath;
      currentMeta = output.currentMeta;
      if (output.pauseForReview) {
        db.prepare(`
          UPDATE video_jobs
          SET status = 'review', current_step = ?, error = '', updated_at = ?
          WHERE id = ?
        `).run(`review:${output.reviewType}`, nowIso(), job.id);
        syncJobCatalog(job, 'review');
        logJob(job.id, `paused for ${output.reviewType} review`);
        return job.id;
      }
    }
    db.prepare("UPDATE video_jobs SET status = 'done', current_step = '', error = '', updated_at = ? WHERE id = ?").run(nowIso(), job.id);
    syncJobCatalog(job, 'done');
    if (job.video_record_id) emitMailEvent({ videoId: job.video_record_id, jobId: job.id, eventKind: 'job.completed', payload: { videoTitle: db.prepare('SELECT title FROM video_records WHERE id=?').get(job.video_record_id)?.title || '' } });
    logJob(job.id, `done in ${Date.now() - jobStartedAtMs} ms`);
  } catch (error) {
    const status = cancelSignals.get(job.id)?.canceled || db.prepare('SELECT cancel_requested FROM video_jobs WHERE id = ?').get(job.id)?.cancel_requested ? 'canceled' : 'failed';
    const failedServiceId = activeStepName.split(':')[1];
    if (failedServiceId && status === 'failed') {
      try { recordOutcome(failedServiceId, { error }); } catch (outcomeError) { console.error('[Pipeline] Could not record connection outcome:', outcomeError.message); }
    }
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
    if (job.video_record_id) emitMailEvent({ videoId: job.video_record_id, jobId: job.id, eventKind: `job.${status}`, payload: { videoTitle: db.prepare('SELECT title FROM video_records WHERE id=?').get(job.video_record_id)?.title || '', error: error.message } });
    if (status === 'canceled') {
      logJob(job.id, `canceled after ${Date.now() - jobStartedAtMs} ms`);
    } else {
      logJobError(job.id, `failed at ${activeStepName || 'claim'} after ${Date.now() - jobStartedAtMs} ms`, error);
    }
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

export function recoverStaleJobs(maxAgeMs = 15 * 60 * 1000) {
  const staleBefore = new Date(Date.now() - Math.max(60000, Number(maxAgeMs) || 0)).toISOString();
  const staleJobs = db.prepare(`
    SELECT id FROM video_jobs
    WHERE status = 'running' AND (heartbeat_at = '' OR heartbeat_at < ?)
  `).all(staleBefore);
  if (staleJobs.length === 0) return 0;
  const recover = db.transaction(() => {
    const resetStep = db.prepare(`
      UPDATE video_job_steps
      SET status = 'pending', progress_note = 'Recovered after worker interruption',
          started_at = NULL, finished_at = NULL
      WHERE job_id = ? AND status = 'running'
    `);
    const resetJob = db.prepare(`
      UPDATE video_jobs
      SET status = 'queued', current_step = '', error = 'Recovered after worker interruption',
          claimed_at = '', heartbeat_at = '', worker_id = '', updated_at = ?
      WHERE id = ?
    `);
    for (const job of staleJobs) {
      resetStep.run(job.id);
      resetJob.run(nowIso(), job.id);
    }
  });
  recover();
  return staleJobs.length;
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
    youtubeAuthorization: publicYouTubeAuthorization(getJobYouTubeAuthorization(job.id)),
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    steps: getSteps.all(job.id).map((step) => ({
      id: step.id,
      step: step.step,
      attempt: step.attempt,
      status: step.status,
      progress: step.progress,
      progressNote: step.progress_note,
      metrics: parseJson(step.metrics_json, {}),
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
  const failedStep = db.prepare("SELECT id, attempt FROM video_job_steps WHERE job_id = ? AND status != 'ok' ORDER BY id ASC LIMIT 1").get(jobId);
  if (failedStep) {
    db.prepare(`
      UPDATE video_job_steps
      SET status = 'pending', progress = 0, progress_note = '', attempt = ?, started_at = NULL, finished_at = NULL
      WHERE id = ?
    `).run(attempts + 1, failedStep.id);
  }
  db.prepare("UPDATE video_jobs SET status = 'queued', cancel_requested = 0, error = '', updated_at = ? WHERE id = ?").run(nowIso(), jobId);
  syncJobCatalog(job, 'queued');
  if (job.video_row_id) updateVideoStatus(job.video_row_id, 'In progress');
  scheduleWorker();
  return { id: Number(jobId), status: 'queued' };
}

export function approveMetadata(jobId, patch = {}, actor = 'operator') {
  const job = db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (job.status !== 'review' || job.current_step !== 'review:metadata') throw new Error('Only jobs waiting for metadata review can be approved');
  if (actor !== 'operator') throw new Error('Only a human operator can approve metadata');
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
  db.prepare('UPDATE video_jobs SET metadata_approved_by = ? WHERE id = ?').run(actor, jobId);
  if (job.agent_principal) db.prepare('INSERT INTO agent_actions (principal, tool, arguments_json, result_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(actor, 'human_approve_metadata', JSON.stringify({ jobId }), JSON.stringify({ status: 'queued' }), nowIso());
  db.prepare(`
    UPDATE video_jobs
    SET status = 'queued', current_step = '', error = '', updated_at = ?
    WHERE id = ?
  `).run(nowIso(), jobId);
  syncJobCatalog(job, 'queued');
  scheduleWorker();
  return { id: Number(jobId), status: 'queued' };
}

export function approveCorrections(jobId, selection = {}) {
  const job = db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (job.status !== 'review' || job.current_step !== 'review:corrections') {
    throw new Error('Only jobs waiting for correction review can be approved');
  }
  const asset = db.prepare(`
    SELECT * FROM video_assets WHERE job_id = ? AND kind = 'ocrContext'
    ORDER BY id DESC LIMIT 1
  `).get(jobId);
  if (!asset) throw new Error('OCR context review asset was not found');
  const current = parseJson(asset.meta_json, {});
  const corrections = Array.isArray(current.corrections) ? current.corrections : [];
  const accepted = Array.isArray(selection.acceptedIndexes)
    ? new Set(selection.acceptedIndexes.map(Number))
    : new Set(corrections.map((item) => Number(item.index)));
  const source = Array.isArray(current.segments) ? current.segments : [];
  const proposed = new Map((current.correctedSegments || []).map((segment) => [Number(segment.index), segment]));
  const correctedSegments = source.length
    ? source.map((segment) => accepted.has(Number(segment.index)) ? (proposed.get(Number(segment.index)) || segment) : segment)
    : current.correctedSegments;
  db.prepare('UPDATE video_assets SET meta_json = ? WHERE id = ?').run(JSON.stringify({
    ...current,
    correctedSegments,
    correctionsApplied: accepted.size,
    correctionsApprovedAt: nowIso(),
  }), asset.id);
  db.prepare("UPDATE video_jobs SET status = 'queued', current_step = '', error = '', updated_at = ? WHERE id = ?")
    .run(nowIso(), jobId);
  syncJobCatalog(job, 'queued');
  scheduleWorker();
  return { id: Number(jobId), status: 'queued' };
}

/**
 * Cancels a job. A job that has already finished is reported with the status it
 * actually has — returning "canceling" for a job that is already `failed` or
 * `canceled` leaves any UI that renders a spinner on that response spinning
 * forever, waiting for a transition that will never come.
 */
export function cancelJob(jobId) {
  const job = db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  if (job.status === 'running') {
    db.prepare('UPDATE video_jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?').run(nowIso(), jobId);
    const signal = cancelSignals.get(Number(jobId));
    if (signal) signal.canceled = true;
    logJob(jobId, 'cancel requested while running');
    return { id: Number(jobId), status: 'canceling' };
  }

  if (job.status === 'queued' || job.status === 'review') {
    db.prepare("UPDATE video_jobs SET status = 'canceled', error = 'Canceled by user', updated_at = ? WHERE id = ?").run(nowIso(), jobId);
    db.prepare("UPDATE video_job_steps SET status = 'skipped', progress_note = 'Canceled by user' WHERE job_id = ? AND status = 'pending'").run(jobId);
    if (job.video_row_id) updateVideoStatus(job.video_row_id, 'Not started');
    syncJobCatalog(job, 'canceled');
    logJob(jobId, `canceled from ${job.status}`);
    return { id: Number(jobId), status: 'canceled' };
  }

  // Already terminal (done / failed / canceled) — nothing to cancel.
  return { id: Number(jobId), status: job.status, alreadyFinished: true };
}

export function bulkJobAction(action, jobIds = []) {
  if (!Array.isArray(jobIds) || jobIds.length > 100 || jobIds.some((id) => !Number.isInteger(Number(id)) || Number(id) < 1)) throw new Error('Provide at most 100 positive job IDs');
  const ids = [...new Set(jobIds.map(Number))];
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
