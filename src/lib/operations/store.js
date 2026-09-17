import { randomUUID } from 'crypto';
import path from 'path';
import db from '../db/sqlite.js';
import { graphFromJob, graphFromPreset } from '../pipeline/graph.js';

const VIDEO_STATUSES = new Set([
  'draft', 'queued', 'processing', 'review', 'scheduled', 'published', 'completed', 'failed', 'canceled',
]);

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function boundedInt(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function titleFromSource(sourceRef) {
  const raw = cleanText(sourceRef, 2000);
  if (!raw) return 'Untitled video';
  try {
    const parsed = new URL(raw);
    const tail = parsed.pathname.split('/').filter(Boolean).pop();
    return decodeURIComponent(tail || parsed.hostname).slice(0, 240);
  } catch {
    return path.basename(raw).replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 240) || 'Untitled video';
  }
}

function mapJobStatus(status) {
  return ({ running: 'processing', done: 'completed' })[status] || status || 'draft';
}

function mapLegacyStatus(status) {
  return ({ 'Not started': 'draft', 'In progress': 'processing', Done: 'published' })[status] || 'draft';
}

function normalizeStatus(status, fallback = 'draft') {
  const value = cleanText(status, 40).toLowerCase();
  return VIDEO_STATUSES.has(value) ? value : fallback;
}

function rowToVideo(row) {
  if (!row) return null;
  return {
    id: row.id,
    legacyVideoId: row.legacy_video_id ?? null,
    title: row.title,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourcePath: row.source_path,
    sourceUrl: row.source_url,
    campaign: row.campaign,
    language: row.language,
    status: row.status,
    priority: row.priority,
    presetId: row.preset_id,
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    currentVersionId: row.current_version_id,
    metadata: parseJson(row.metadata_json, {}),
    contextSummary: parseJson(row.context_summary_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getVideoProcessGraph(videoId) {
  backfillOperationsCatalog();
  const videoRow = db.prepare('SELECT * FROM video_records WHERE id = ?').get(String(videoId));
  if (!videoRow) return null;
  const video = rowToVideo(videoRow);
  const job = db.prepare('SELECT * FROM video_jobs WHERE video_record_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(video.id);
  const steps = job ? db.prepare('SELECT * FROM video_job_steps WHERE job_id = ? ORDER BY id ASC').all(job.id) : [];
  const assets = job ? db.prepare('SELECT * FROM video_assets WHERE job_id = ? ORDER BY id ASC').all(job.id) : [];
  const graph = job ? graphFromJob({ ...job, steps, assets }) : graphFromPreset(video.presetId, { sourceId: video.sourceType });
  const versions = db.prepare('SELECT * FROM video_versions WHERE video_id = ? ORDER BY created_at DESC').all(video.id).map((row) => ({
    id: row.id, kind: row.kind, duration: row.duration_seconds, width: row.width, height: row.height,
    validationStatus: row.validation_status, validation: parseJson(row.validation_json, {}), createdAt: row.created_at,
  }));
  const publicationRow = db.prepare(`
    SELECT p.*, ya.id AS authorization_id, ya.email_address, ya.channel_id AS auth_channel_id, ya.channel_title
    FROM video_publications p
    LEFT JOIN youtube_upload_bindings b ON b.publication_id = p.id
    LEFT JOIN youtube_authorizations ya ON ya.id = b.authorization_id
    WHERE p.video_id = ? ORDER BY p.created_at DESC LIMIT 1
  `).get(video.id);
  const queuedAuthorization = job ? db.prepare(`
    SELECT ya.id, ya.email_address, ya.channel_id, ya.channel_title, ya.status, ya.enabled
    FROM youtube_upload_bindings b
    JOIN youtube_authorizations ya ON ya.id = b.authorization_id
    WHERE b.job_id = ?
  `).get(job.id) : null;
  let batchSiblings = { batchId: job?.batch_id || '', ordinal: 1, total: 1, prevVideoId: null, nextVideoId: null };
  if (job?.batch_id) {
    const siblings = db.prepare('SELECT video_id, ordinal FROM automation_batch_items WHERE batch_id = ? ORDER BY ordinal').all(job.batch_id);
    const index = siblings.findIndex((item) => item.video_id === video.id);
    batchSiblings = {
      batchId: job.batch_id, ordinal: index + 1, total: siblings.length,
      prevVideoId: siblings[index - 1]?.video_id || null,
      nextVideoId: siblings[index + 1]?.video_id || null,
    };
  }
  const jobPublic = job ? {
    assets: assets.filter((asset) => asset.kind === 'metadata').map((asset) => ({ id: asset.id, kind: asset.kind, meta: parseJson(asset.meta_json, {}) })),
    id: job.id, status: job.status, currentStep: job.current_step, error: job.error || '',
    batchId: job.batch_id || '', priority: job.priority || 0,
    processorIds: parseJson(job.processor_ids_json, []), uploaderId: job.uploader_id || '', options: parseJson(job.options_json, {}),
    youtubeAuthorization: queuedAuthorization ? {
      id: queuedAuthorization.id, emailAddress: queuedAuthorization.email_address,
      channelId: queuedAuthorization.channel_id, channelTitle: queuedAuthorization.channel_title,
      status: queuedAuthorization.status, enabled: Boolean(queuedAuthorization.enabled),
    } : null,
    attempts: Math.max(1, ...steps.map((step) => Number(step.attempt) || 1)), maxAttempts: job.max_attempts || 3,
    createdAt: job.created_at, updatedAt: job.updated_at, heartbeatAt: job.heartbeat_at || '', scheduledFor: job.scheduled_for || '',
  } : null;
  return {
    video: {
      id: video.id, title: video.title, campaign: video.campaign, status: video.status,
      sourceType: video.sourceType, sourceRef: video.sourceRef, language: video.language,
      priority: video.priority, scheduledAt: video.scheduledAt, presetId: video.presetId,
    },
    job: jobPublic,
    graph,
    versions,
    publication: publicationRow ? {
      platformId: publicationRow.platform_id, url: publicationRow.url,
      youtubeAuthorization: publicationRow.authorization_id ? {
        id: publicationRow.authorization_id, emailAddress: publicationRow.email_address,
        channelId: publicationRow.auth_channel_id, channelTitle: publicationRow.channel_title,
      } : null,
    } : null,
    batchSiblings,
    capabilities: {
      canRetry: ['failed', 'canceled'].includes(job?.status),
      canCancel: ['queued', 'running', 'review'].includes(job?.status),
      canApproveMetadata: job?.status === 'review' && job?.current_step === 'review:metadata',
      canApproveCorrections: job?.status === 'review' && job?.current_step === 'review:corrections',
      editable: job?.status === 'queued' && steps.every((step) => step.status === 'pending'),
    },
    planned: !job,
  };
}

export function getVideoProcessStepLog(videoId, stepId) {
  const row = db.prepare(`
    SELECT s.id, s.step, s.log FROM video_job_steps s
    JOIN video_jobs j ON j.id = s.job_id
    WHERE s.id = ? AND j.video_record_id = ?
  `).get(Number(stepId), String(videoId));
  return row ? { id: row.id, step: row.step, log: row.log || '' } : null;
}

export function ensureVideoRecord(input = {}) {
  const id = cleanText(input.id, 100) || randomUUID();
  const existing = db.prepare('SELECT * FROM video_records WHERE id = ?').get(id);
  if (existing) return rowToVideo(existing);

  const sourceRef = cleanText(input.sourceRef || input.sourcePath || input.sourceUrl, 4000);
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO video_records (
      id, legacy_video_id, title, source_type, source_ref, source_path, source_url,
      campaign, language, status, priority, preset_id, scheduled_at, published_at,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.legacyVideoId || null,
    cleanText(input.title, 240) || titleFromSource(sourceRef),
    cleanText(input.sourceType, 80) || 'localFile',
    sourceRef,
    cleanText(input.sourcePath, 4000),
    cleanText(input.sourceUrl, 4000),
    cleanText(input.campaign, 240),
    cleanText(input.language, 40),
    normalizeStatus(input.status),
    boundedInt(input.priority, 0, -100, 100),
    cleanText(input.presetId, 100),
    cleanText(input.scheduledAt, 80),
    cleanText(input.publishedAt, 80),
    JSON.stringify(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
    createdAt,
    createdAt,
  );
  return rowToVideo(db.prepare('SELECT * FROM video_records WHERE id = ?').get(id));
}

export function updateVideoRecord(videoId, patch = {}) {
  const current = db.prepare('SELECT * FROM video_records WHERE id = ?').get(videoId);
  if (!current) throw new Error(`Video record not found: ${videoId}`);
  const metadata = patch.metadata === undefined
    ? parseJson(current.metadata_json, {})
    : { ...parseJson(current.metadata_json, {}), ...(patch.metadata || {}) };
  db.prepare(`
    UPDATE video_records SET
      title = ?, campaign = ?, language = ?, status = ?, priority = ?, preset_id = ?,
      scheduled_at = ?, published_at = ?, source_path = ?, source_url = ?,
      current_version_id = ?, metadata_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.title === undefined ? current.title : (cleanText(patch.title, 240) || current.title),
    patch.campaign === undefined ? current.campaign : cleanText(patch.campaign, 240),
    patch.language === undefined ? current.language : cleanText(patch.language, 40),
    patch.status === undefined ? current.status : normalizeStatus(patch.status, current.status),
    patch.priority === undefined ? current.priority : boundedInt(patch.priority, current.priority, -100, 100),
    patch.presetId === undefined ? current.preset_id : cleanText(patch.presetId, 100),
    patch.scheduledAt === undefined ? current.scheduled_at : cleanText(patch.scheduledAt, 80),
    patch.publishedAt === undefined ? current.published_at : cleanText(patch.publishedAt, 80),
    patch.sourcePath === undefined ? current.source_path : cleanText(patch.sourcePath, 4000),
    patch.sourceUrl === undefined ? current.source_url : cleanText(patch.sourceUrl, 4000),
    patch.currentVersionId === undefined ? current.current_version_id : patch.currentVersionId,
    JSON.stringify(metadata),
    nowIso(),
    videoId,
  );
  return rowToVideo(db.prepare('SELECT * FROM video_records WHERE id = ?').get(videoId));
}

export function recordVideoVersion({ videoId, jobId = null, kind, filePath, probe = {}, validation = {} }) {
  if (!videoId) return null;
  const createdAt = nowIso();
  const result = db.prepare(`
    INSERT INTO video_versions (
      video_id, job_id, kind, file_path, mime_type, bytes, duration_seconds,
      width, height, fps, checksum_sha256, validation_status, validation_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    videoId,
    jobId || null,
    cleanText(kind, 80) || 'edited',
    cleanText(filePath, 4000),
    cleanText(probe.mimeType, 120),
    boundedInt(probe.bytes),
    Number(probe.durationSeconds) || 0,
    boundedInt(probe.width),
    boundedInt(probe.height),
    Number(probe.fps) || 0,
    cleanText(probe.sha256, 128),
    validation.ok === false ? 'failed' : 'valid',
    JSON.stringify(validation || {}),
    createdAt,
  );
  updateVideoRecord(videoId, {
    currentVersionId: result.lastInsertRowid,
    sourcePath: filePath,
    metadata: { media: probe },
  });
  return Number(result.lastInsertRowid);
}

export function recordPublication({ videoId, jobId = null, platformId, channelId = '', remoteId = '', url = '', status = 'published', scheduledAt = '', metadata = {} }) {
  if (!videoId) return null;
  const currentTime = nowIso();
  const publishedAt = status === 'published' ? currentTime : '';
  const result = db.prepare(`
    INSERT INTO video_publications (
      video_id, job_id, platform_id, channel_id, remote_id, url, status,
      scheduled_at, published_at, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    videoId, jobId || null, cleanText(platformId, 80), cleanText(channelId, 200),
    cleanText(remoteId, 500), cleanText(url, 4000), normalizeStatus(status, 'scheduled'),
    cleanText(scheduledAt, 80), publishedAt, JSON.stringify(metadata || {}), currentTime, currentTime,
  );
  updateVideoRecord(videoId, { status: status === 'published' ? 'published' : 'scheduled', publishedAt });
  return Number(result.lastInsertRowid);
}

export function recordMetricSnapshot(publicationId, metrics = {}, capturedAt = nowIso()) {
  const publication = db.prepare('SELECT id FROM video_publications WHERE id = ?').get(publicationId);
  if (!publication) throw new Error(`Publication not found: ${publicationId}`);
  const value = (key) => Math.max(0, Number(metrics[key]) || 0);
  const result = db.prepare(`
    INSERT INTO video_metric_snapshots (
      publication_id, captured_at, views, impressions, watch_time_seconds,
      average_view_duration_seconds, likes, comments, shares, subscribers_gained,
      clicks, conversions, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    publicationId, cleanText(capturedAt, 80), value('views'), value('impressions'),
    value('watchTimeSeconds'), value('averageViewDurationSeconds'), value('likes'),
    value('comments'), value('shares'), value('subscribersGained'), value('clicks'),
    value('conversions'), JSON.stringify(metrics || {}),
  );
  return Number(result.lastInsertRowid);
}

export function createAutomationBatch({ name, presetId = '', totalItems = 0, options = {} }) {
  const id = randomUUID();
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO automation_batches (
      id, name, preset_id, status, total_items, options_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)
  `).run(id, cleanText(name, 240) || `Batch ${createdAt.slice(0, 16)}`, cleanText(presetId, 100), boundedInt(totalItems, 0, 0, 100), JSON.stringify(options || {}), createdAt, createdAt);
  return { id, status: 'queued' };
}

export function addAutomationBatchItem(batchId, { jobId, videoId, ordinal }) {
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO automation_batch_items (
      batch_id, job_id, video_id, ordinal, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'queued', ?, ?)
  `).run(batchId, jobId, videoId, ordinal, createdAt, createdAt);
}

export function syncAutomationBatch(batchId) {
  if (!batchId) return null;
  db.prepare(`
    UPDATE automation_batch_items
    SET status = COALESCE((SELECT status FROM video_jobs WHERE id = automation_batch_items.job_id), status),
        updated_at = ?
    WHERE batch_id = ?
  `).run(nowIso(), batchId);
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END) AS canceled,
      SUM(CASE WHEN status IN ('queued', 'running', 'review') THEN 1 ELSE 0 END) AS active
    FROM automation_batch_items WHERE batch_id = ?
  `).get(batchId);
  const status = counts.active > 0
    ? 'running'
    : counts.failed > 0
      ? 'completed_with_errors'
      : counts.canceled === counts.total
        ? 'canceled'
        : counts.canceled > 0
          ? 'completed_with_cancellations'
          : 'completed';
  db.prepare(`
    UPDATE automation_batches
    SET status = ?, total_items = ?, completed_items = ?, failed_items = ?, updated_at = ?
    WHERE id = ?
  `).run(status, counts.total || 0, counts.completed || 0, counts.failed || 0, nowIso(), batchId);
  return { id: batchId, status, ...counts };
}

export function listAutomationBatches({ limit = 20 } = {}) {
  const rows = db.prepare(`
    SELECT b.*,
      SUM(CASE WHEN i.status IN ('queued', 'running', 'review') THEN 1 ELSE 0 END) AS active_items
    FROM automation_batches b
    LEFT JOIN automation_batch_items i ON i.batch_id = b.id
    GROUP BY b.id
    ORDER BY b.created_at DESC
    LIMIT ?
  `).all(boundedInt(limit, 20, 1, 100));
  const getItems = db.prepare(`
    SELECT i.*, vr.title, j.current_step, j.error
    FROM automation_batch_items i
    JOIN video_records vr ON vr.id = i.video_id
    JOIN video_jobs j ON j.id = i.job_id
    WHERE i.batch_id = ? ORDER BY i.ordinal ASC
  `);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    presetId: row.preset_id,
    status: row.status,
    totalItems: row.total_items,
    completedItems: row.completed_items,
    failedItems: row.failed_items,
    activeItems: row.active_items || 0,
    options: parseJson(row.options_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: getItems.all(row.id).map((item) => ({
      jobId: item.job_id,
      videoId: item.video_id,
      ordinal: item.ordinal,
      status: item.status,
      title: item.title,
      currentStep: item.current_step,
      error: item.error,
    })),
  }));
}

function publicAutomationSetting(row) {
  return {
    id: row.id,
    name: row.name,
    settings: parseJson(row.settings_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Reusable planner settings; deliberately never changes dispatched jobs. */
export function listAutomationSettings({ limit = 20 } = {}) {
  return db.prepare(`
    SELECT * FROM automation_settings
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(boundedInt(limit, 20, 1, 100)).map(publicAutomationSetting);
}

export function saveAutomationSettings({ id = '', name = '', settings = {} } = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Automation settings must be an object');
  }
  const serialized = JSON.stringify(settings);
  if (serialized.length > 100000) throw new Error('Automation settings are too large to save');
  const settingId = cleanText(id, 100) || randomUUID();
  const timestamp = nowIso();
  const existing = db.prepare('SELECT created_at FROM automation_settings WHERE id = ?').get(settingId);
  db.prepare(`
    INSERT INTO automation_settings (id, name, settings_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      settings_json = excluded.settings_json,
      updated_at = excluded.updated_at
  `).run(
    settingId,
    cleanText(name, 240) || `Automation settings ${timestamp.slice(0, 16)}`,
    serialized,
    existing?.created_at || timestamp,
    timestamp,
  );
  return publicAutomationSetting(db.prepare('SELECT * FROM automation_settings WHERE id = ?').get(settingId));
}

export function saveFaceSwapProof(proof = {}) {
  const id = cleanText(proof.id, 100) || randomUUID();
  const createdAt = cleanText(proof.createdAt, 80) || nowIso();
  db.prepare(`
    INSERT INTO face_swap_proofs (
      id, engine, engine_version, status, source_image_path, target_video_path,
      output_video_path, duration_ms, input_probe_json, output_probe_json,
      validation_json, error, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      engine = excluded.engine,
      engine_version = excluded.engine_version,
      status = excluded.status,
      output_video_path = excluded.output_video_path,
      duration_ms = excluded.duration_ms,
      input_probe_json = excluded.input_probe_json,
      output_probe_json = excluded.output_probe_json,
      validation_json = excluded.validation_json,
      error = excluded.error,
      completed_at = excluded.completed_at
  `).run(
    id, cleanText(proof.engine, 80) || 'facefusion', cleanText(proof.engineVersion, 80),
    cleanText(proof.status, 40) || 'running', cleanText(proof.sourceImagePath, 4000),
    cleanText(proof.targetVideoPath, 4000), cleanText(proof.outputVideoPath, 4000),
    boundedInt(proof.durationMs), JSON.stringify(proof.inputProbe || {}),
    JSON.stringify(proof.outputProbe || {}), JSON.stringify(proof.validation || {}),
    cleanText(proof.error, 4000), createdAt, cleanText(proof.completedAt, 80),
  );
  return id;
}

export function failRunningFaceSwapProofs(error = 'Proof run was interrupted') {
  const completedAt = nowIso();
  return db.prepare(`
    UPDATE face_swap_proofs
    SET status = 'failed', error = ?, completed_at = ?
    WHERE status = 'running'
  `).run(cleanText(error, 4000), completedAt).changes;
}

export function getLatestFaceSwapProof() {
  const row = db.prepare('SELECT * FROM face_swap_proofs ORDER BY created_at DESC LIMIT 1').get();
  if (!row) return null;
  return {
    id: row.id,
    engine: row.engine,
    engineVersion: row.engine_version,
    status: row.status,
    sourceImagePath: row.source_image_path,
    targetVideoPath: row.target_video_path,
    outputVideoPath: row.output_video_path,
    durationMs: row.duration_ms,
    inputProbe: parseJson(row.input_probe_json, {}),
    outputProbe: parseJson(row.output_probe_json, {}),
    validation: parseJson(row.validation_json, {}),
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function backfillOperationsCatalog() {
  const insertLegacy = db.prepare(`
    INSERT OR IGNORE INTO video_records (
      id, legacy_video_id, title, source_type, source_ref, source_url, status,
      scheduled_at, published_at, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'bilibili', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertJob = db.prepare(`
    INSERT OR IGNORE INTO video_records (
      id, legacy_video_id, title, source_type, source_ref, source_path, source_url,
      status, priority, preset_id, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const transaction = db.transaction(() => {
    for (const video of db.prepare('SELECT * FROM videos').all()) {
      const id = `legacy-${video.id}`;
      insertLegacy.run(
        id, video.id, video.english_name || video.chinese_name || `Video ${video.id}`,
        video.bilibili_url || '', video.bilibili_url || '', mapLegacyStatus(video.status),
        video.auto_upload_time || '', video.release_date || '', JSON.stringify({ tags: parseJson(video.tags, []) }),
        video.created_at || nowIso(), video.updated_at || video.created_at || nowIso(),
      );
    }
    for (const job of db.prepare("SELECT * FROM video_jobs WHERE video_record_id = '' OR video_record_id IS NULL").all()) {
      const id = job.video_row_id ? `legacy-${job.video_row_id}` : `job-${job.id}`;
      const options = parseJson(job.options_json, {});
      insertJob.run(
        id, job.video_row_id || null,
        cleanText(options?.metadata?.title || options?.metadata?.titleEn, 240) || titleFromSource(job.source_input),
        job.source_id, job.source_input,
        job.source_id === 'localFile' ? job.source_input : '',
        job.source_id === 'localFile' ? '' : job.source_input,
        mapJobStatus(job.status), job.priority || 0, cleanText(options.presetId, 100),
        JSON.stringify({ importedFromJob: job.id }), job.created_at, job.updated_at,
      );
      db.prepare('UPDATE video_jobs SET video_record_id = ? WHERE id = ?').run(id, job.id);
    }
  });
  transaction();
}

export function listVideoOperations({ status = '', query = '', limit = 50, offset = 0 } = {}) {
  backfillOperationsCatalog();
  const boundedLimit = boundedInt(limit, 50, 1, 100);
  const boundedOffset = boundedInt(offset, 0, 0, 1000000);
  const safeStatus = VIDEO_STATUSES.has(String(status)) ? String(status) : '';
  const search = `%${cleanText(query, 200).replace(/[%_]/g, '\\$&')}%`;
  const where = [
    safeStatus ? 'vr.status = @status' : '1 = 1',
    query ? "(vr.title LIKE @search ESCAPE '\\' OR vr.source_ref LIKE @search ESCAPE '\\' OR vr.campaign LIKE @search ESCAPE '\\')" : '1 = 1',
  ].join(' AND ');
  const rows = db.prepare(`
    WITH latest_job AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY video_record_id ORDER BY created_at DESC, id DESC) AS row_num
      FROM video_jobs WHERE video_record_id != ''
    ), latest_publication AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY published_at DESC, id DESC) AS row_num
      FROM video_publications
    ), latest_metrics AS (
      SELECT m.*, ROW_NUMBER() OVER (PARTITION BY publication_id ORDER BY captured_at DESC, id DESC) AS row_num
      FROM video_metric_snapshots m
    )
    SELECT vr.*,
      legacy.chinese_name AS legacy_source_title,
      legacy.chinese_description AS legacy_source_description,
      legacy.bilibili_url AS legacy_source_url,
      legacy.valid_upload AS legacy_source_valid,
      legacy.english_name AS legacy_delivery_title,
      legacy.english_description AS legacy_delivery_description,
      legacy.youtube_url AS legacy_delivery_url,
      legacy.release_date AS legacy_release_date,
      lj.id AS job_id, lj.status AS job_status, lj.current_step, lj.error AS job_error,
      lj.processor_ids_json, lj.uploader_id, lj.batch_id,
      vp.id AS publication_id, vp.platform_id, vp.url AS publication_url,
      ya.id AS youtube_authorization_id, ya.email_address AS youtube_account_email,
      ya.channel_id AS youtube_channel_id, ya.channel_title AS youtube_channel_title,
      vm.views, vm.impressions, vm.watch_time_seconds, vm.likes, vm.comments, vm.shares,
      vm.clicks, vm.conversions, vm.captured_at AS metrics_captured_at
    FROM video_records vr
    LEFT JOIN videos legacy ON legacy.id = vr.legacy_video_id
    LEFT JOIN latest_job lj ON lj.video_record_id = vr.id AND lj.row_num = 1
    LEFT JOIN latest_publication vp ON vp.video_id = vr.id AND vp.row_num = 1
    LEFT JOIN youtube_upload_bindings yub ON yub.publication_id = vp.id
    LEFT JOIN youtube_authorizations ya ON ya.id = yub.authorization_id
    LEFT JOIN latest_metrics vm ON vm.publication_id = vp.id AND vm.row_num = 1
    WHERE ${where}
    ORDER BY vr.priority DESC, vr.updated_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ status: safeStatus, search, limit: boundedLimit, offset: boundedOffset });
  const total = db.prepare(`SELECT COUNT(*) AS count FROM video_records vr WHERE ${where}`).get({ status: safeStatus, search }).count;
  return {
    total,
    limit: boundedLimit,
    offset: boundedOffset,
    videos: rows.map((row) => {
      const video = rowToVideo(row);
      const metadata = video.metadata || {};
      const content = {
        sourceTitle: cleanText(metadata.sourceTitle || row.legacy_source_title || video.title, 240),
        sourceDescription: cleanText(metadata.sourceDescription || row.legacy_source_description, 4000),
        sourceUrl: cleanText(metadata.sourceUrl || row.legacy_source_url || video.sourceUrl, 4000),
        sourceValid: cleanText(metadata.sourceValid || row.legacy_source_valid, 80),
        deliveryTitle: cleanText(metadata.deliveryTitle || metadata.titleEn || row.legacy_delivery_title || video.title, 240),
        deliveryDescription: cleanText(metadata.deliveryDescription || metadata.descriptionEn || row.legacy_delivery_description, 4000),
        deliveryUrl: cleanText(row.publication_url || metadata.deliveryUrl || row.legacy_delivery_url, 4000),
        releaseDate: cleanText(row.legacy_release_date || video.publishedAt, 80),
      };
      return {
      ...video,
      content,
      job: row.job_id ? {
        id: row.job_id,
        status: row.job_status,
        currentStep: row.current_step,
        error: row.job_error,
        processorIds: parseJson(row.processor_ids_json, []),
        uploaderId: row.uploader_id,
        batchId: row.batch_id,
      } : null,
      publication: row.publication_id ? {
        id: row.publication_id,
        platformId: row.platform_id,
        url: row.publication_url,
        youtubeAuthorization: row.youtube_authorization_id ? {
          id: row.youtube_authorization_id,
          emailAddress: row.youtube_account_email,
          channelId: row.youtube_channel_id,
          channelTitle: row.youtube_channel_title,
        } : null,
      } : null,
      metrics: {
        views: row.views || 0,
        impressions: row.impressions || 0,
        watchTimeSeconds: row.watch_time_seconds || 0,
        likes: row.likes || 0,
        comments: row.comments || 0,
        shares: row.shares || 0,
        clicks: row.clicks || 0,
        conversions: row.conversions || 0,
        capturedAt: row.metrics_captured_at || '',
      },
    };
    }),
  };
}

export function getOperationsOverview() {
  backfillOperationsCatalog();
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('queued', 'processing', 'review', 'scheduled') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN status IN ('review', 'failed') THEN 1 ELSE 0 END) AS needs_review,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published
    FROM video_records
  `).get();
  const jobCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS succeeded,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM video_jobs
  `).get();
  const attempts = (jobCounts.succeeded || 0) + (jobCounts.failed || 0);
  const successRate = attempts ? Math.round(((jobCounts.succeeded || 0) / attempts) * 100) : 100;
  const throughput = db.prepare(`
    WITH RECURSIVE days(day, offset) AS (
      SELECT date('now', '-6 days'), 0
      UNION ALL SELECT date(day, '+1 day'), offset + 1 FROM days WHERE offset < 6
    )
    SELECT days.day,
      SUM(CASE WHEN video_jobs.status = 'done' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN video_jobs.status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM days
    LEFT JOIN video_jobs ON date(video_jobs.updated_at) = days.day
    GROUP BY days.day ORDER BY days.day
  `).all();
  const nextUp = listVideoOperations({ limit: 8 }).videos
    .filter((video) => ['queued', 'processing', 'review', 'scheduled'].includes(video.status))
    .slice(0, 6);
  const recentVideos = listVideoOperations({ limit: 8 }).videos;
  const batches = db.prepare('SELECT * FROM automation_batches ORDER BY created_at DESC LIMIT 5').all().map((row) => ({
    id: row.id,
    name: row.name,
    presetId: row.preset_id,
    status: row.status,
    totalItems: row.total_items,
    completedItems: row.completed_items,
    failedItems: row.failed_items,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const mailCounts = db.prepare(`SELECT
    SUM(CASE WHEN acknowledged_at='' THEN 1 ELSE 0 END) AS unacknowledged,
    SUM(CASE WHEN acknowledged_at='' AND severity='critical' THEN 1 ELSE 0 END) AS critical
    FROM mail_ingest_events`).get();
  // Release layer: upload attempts that left the machine but never confirmed.
  const unconfirmedUploads = db.prepare("SELECT COUNT(*) AS n FROM upload_receipts WHERE state = 'sent'").get()?.n || 0;
  return {
    counts: {
      total: counts.total || 0,
      active: counts.active || 0,
      processing: counts.processing || 0,
      needsReview: counts.needs_review || 0,
      published: counts.published || 0,
      successRate,
      unacknowledgedMailEvents: mailCounts.unacknowledged || 0,
      criticalMailEvents: mailCounts.critical || 0,
      unconfirmedUploads,
    },
    throughput,
    recentVideos,
    nextUp,
    batches,
    faceSwapProof: getLatestFaceSwapProof(),
  };
}

export function getVideoAnalytics() {
  backfillOperationsCatalog();
  const latest = db.prepare(`
    WITH latest_metrics AS (
      SELECT m.*, ROW_NUMBER() OVER (PARTITION BY publication_id ORDER BY captured_at DESC, id DESC) AS row_num
      FROM video_metric_snapshots m
    )
    SELECT vr.id, vr.title, vr.campaign, p.id AS publication_id, p.platform_id, p.url, p.published_at,
      ya.id AS youtube_authorization_id, ya.email_address AS youtube_account_email,
      ya.channel_id AS youtube_channel_id, ya.channel_title AS youtube_channel_title,
      m.views, m.impressions, m.watch_time_seconds, m.average_view_duration_seconds,
      m.likes, m.comments, m.shares, m.subscribers_gained, m.clicks, m.conversions, m.captured_at
    FROM video_publications p
    JOIN video_records vr ON vr.id = p.video_id
    LEFT JOIN youtube_upload_bindings yub ON yub.publication_id = p.id
    LEFT JOIN youtube_authorizations ya ON ya.id = yub.authorization_id
    LEFT JOIN latest_metrics m ON m.publication_id = p.id AND m.row_num = 1
    WHERE p.status = 'published'
    ORDER BY COALESCE(m.views, 0) DESC, p.published_at DESC
  `).all();
  const totals = latest.reduce((sum, row) => {
    for (const key of ['views', 'impressions', 'watch_time_seconds', 'likes', 'comments', 'shares', 'clicks', 'conversions']) {
      sum[key] += Number(row[key]) || 0;
    }
    return sum;
  }, { views: 0, impressions: 0, watch_time_seconds: 0, likes: 0, comments: 0, shares: 0, clicks: 0, conversions: 0 });
  const engagement = totals.views ? ((totals.likes + totals.comments + totals.shares) / totals.views) * 100 : 0;
  const clickThrough = totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0;
  const trend = db.prepare(`
    WITH daily_latest AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY publication_id, date(captured_at)
        ORDER BY captured_at DESC, id DESC
      ) AS row_num
      FROM video_metric_snapshots
      WHERE captured_at >= datetime('now', '-13 days')
    )
    SELECT date(captured_at) AS day, SUM(views) AS views, SUM(impressions) AS impressions,
      SUM(likes + comments + shares) AS engagements
    FROM daily_latest
    WHERE row_num = 1
    GROUP BY date(captured_at)
    ORDER BY day ASC
  `).all();
  return {
    totals: {
      videos: latest.length,
      views: totals.views,
      impressions: totals.impressions,
      watchTimeSeconds: totals.watch_time_seconds,
      engagementRate: Number(engagement.toFixed(2)),
      clickThroughRate: Number(clickThrough.toFixed(2)),
      conversions: totals.conversions,
    },
    trend,
    videos: latest.map((row) => ({
      id: row.id,
      publicationId: row.publication_id,
      title: row.title,
      campaign: row.campaign,
      platformId: row.platform_id,
      url: row.url,
      youtubeAuthorization: row.youtube_authorization_id ? {
        id: row.youtube_authorization_id,
        emailAddress: row.youtube_account_email,
        channelId: row.youtube_channel_id,
        channelTitle: row.youtube_channel_title,
      } : null,
      publishedAt: row.published_at,
      views: row.views || 0,
      impressions: row.impressions || 0,
      watchTimeSeconds: row.watch_time_seconds || 0,
      averageViewDurationSeconds: row.average_view_duration_seconds || 0,
      likes: row.likes || 0,
      comments: row.comments || 0,
      shares: row.shares || 0,
      subscribersGained: row.subscribers_gained || 0,
      clicks: row.clicks || 0,
      conversions: row.conversions || 0,
      capturedAt: row.captured_at || '',
    })),
  };
}
