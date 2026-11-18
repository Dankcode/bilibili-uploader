import fs from 'node:fs';
import { markPublicationReplaced, readSavedUpload, saveUploadMetadata } from '../operations/uploadCatalog.js';
import { deleteVideoRecord, updateVideoRecord, listCategoryTitleContexts, saveCategoryTitleContext } from '../operations/store.js';
import { withVersion } from './concurrency.js';
import { queueLibraryUploads } from '../operations/libraryUpload.js';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import Ajv from 'ajv';
import db from '../db/sqlite.js';
import { operations } from './contract.js';
import { bridgeConfig, equalSecret } from './auth.js';
import { approveCorrections, approveMetadata, createJobBatch, validateJobInput, retryJob, cancelJob, listAgentRequests, submitAgentTranslation } from '../pipeline/pipeline.js';
import { SOURCES, PROCESSORS, UPLOADERS, validateProcessorChain } from '../pipeline/registry.js';
import { getPreset, savePreset } from '../pipeline/presets.js';
import { listConnections } from '../pipeline/connections.js';
import { getUsageSummary } from '../pipeline/usage.js';
import { listYouTubeAuthorizations, getJobYouTubeAuthorization, publicYouTubeAuthorization } from '../youtube/authorizations.js';
import { getSavedCreatorVideo, pageSavedCreatorVideos, saveScrapedBilibiliVideos, updateScrapedBilibiliVideo } from '../video/scrapedCatalog.js';
import { normalizeBilibiliSpaceUrl, scanBilibiliCreatorPage } from '../video/scraper.js';
import { listYouTubePosts, getYouTubePost, saveYouTubePost, claimYouTubePost, recordYouTubePost } from '../youtube/posts.js';
import { naturalText } from '../ai/editorial.js';
import { methodNeedsAuthorization, normalizeUploadMethod } from '../youtube/uploadMethod.js';

export class AgentError extends Error {
  constructor(code, message, status = 400, details) { super(message); Object.assign(this, { code, status, details }); }
}
const CODES = { 400: 'INVALID_INPUT', 404: 'NOT_FOUND', 409: 'STALE_WRITE', 413: 'INVALID_INPUT', 503: 'RETRYABLE' };
// Domain modules (store, posts, uploads, pipeline) throw plain Errors whose
// messages are written for the owner. Pass them through with a typed code so an
// MCP client can tell "fix your input" from "reload" from "retry later".
// Database/driver errors stay generic so SQL never reaches a tool result.
export function toAgentError(error) {
  if (error instanceof AgentError) return error;
  if (/^SQLITE_/.test(String(error?.code || '')) || error?.name === 'SqliteError' || error instanceof TypeError || error instanceof ReferenceError) {
    console.error('[Agent bridge]', error);
    return new AgentError('PRECONDITION_FAILED', 'Operation could not be completed; inspect the server log and recheck preconditions', 409);
  }
  const message = String(error?.message || 'Operation failed');
  const status = Number(error?.status) || (/not found/i.test(message) ? 404 : /changed|reload/i.test(message) ? 409 : 409);
  const code = typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code
    : status === 409 && !/changed|reload/i.test(message) ? 'PRECONDITION_FAILED' : CODES[status] || 'PRECONDITION_FAILED';
  return new AgentError(code, sanitize(message), status);
}
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map(operations.map((op) => [op.name, ajv.compile(op.inputSchema)]));
const parse = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };
const timestamp = (previous = '') => new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/token|secret|password|cookie|credential|apiKey|file_path/i.test(key)).map(([key, item]) => [key, sanitize(item)]));
  if (typeof value !== 'string') return value;
  let result = value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|SESSDATA)\s*[=:]\s*)[^\s,;"']+/gi, '$1[redacted]');
  for (const token of Object.values(bridgeConfig()).filter(Boolean)) result = result.split(token).join('[redacted]');
  return result;
}
function audit(principal, tool, input, result) {
  db.prepare('INSERT INTO agent_actions (principal, tool, arguments_json, result_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(principal, tool, JSON.stringify(sanitize(input)), JSON.stringify(sanitize(result)), timestamp());
}
export function listAgentActions(cursor = '0') {
  const rows = db.prepare('SELECT * FROM agent_actions WHERE (? = 0 OR id < ?) ORDER BY id DESC LIMIT 26').all(Number(cursor), Number(cursor));
  return { items: rows.slice(0, 25).map((row) => ({ id: row.id, principal: row.principal, tool: row.tool,
    arguments: parse(row.arguments_json), result: parse(row.result_json), createdAt: row.created_at })), nextCursor: rows.length > 25 ? String(rows[24].id) : null };
}
function requireJob(id, ifMatch) {
  const row = db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(id);
  if (!row) throw new AgentError('NOT_FOUND', 'Job not found', 404);
  if (ifMatch !== undefined && row.updated_at !== ifMatch) throw new AgentError('STALE_WRITE', 'Job changed; reload get_job before editing', 409, { updatedAt: row.updated_at });
  return row;
}
const jobProjection = (row) => ({ id: row.id, sourceId: row.source_id, sourceInput: row.source_input, status: row.status,
  currentStep: row.current_step, error: sanitize(row.error || ''), scheduledFor: row.scheduled_for, updatedAt: row.updated_at,
  nextAction: row.status === 'review' ? (row.current_step === 'review:metadata' ? 'propose_metadata' : 'retry_job') : row.status === 'failed' ? 'get_job' : 'wait',
  consoleUrl: row.video_record_id ? `/videos/${encodeURIComponent(row.video_record_id)}` : '/?view=library' });
function getJob(id) {
  const row = requireJob(id);
  return { ...jobProjection(row), processorIds: parse(row.processor_ids_json, []), uploaderId: row.uploader_id,
    maxAttempts: row.max_attempts, agentPrincipal: row.agent_principal, approvedBy: row.metadata_approved_by,
    cancellationRequested: Boolean(row.cancel_requested),
    channel: publicYouTubeAuthorization(getJobYouTubeAuthorization(id)),
    steps: db.prepare('SELECT id, step, attempt, status, progress, progress_note, started_at, finished_at FROM video_job_steps WHERE job_id = ? ORDER BY id').all(id),
    assets: db.prepare('SELECT id, kind, created_at FROM video_assets WHERE job_id = ? ORDER BY id').all(id) };
}
function preconditions() {
  let disk = { availableBytes: null };
  try { const stat = fs.statfsSync(process.cwd()); disk = { availableBytes: stat.bavail * stat.bsize }; } catch { /* unknown, not zero */ }
  return { checkedAt: timestamp(), connections: listConnections().map(({ serviceId, configured, enabled, status, authState, checkedAt, lastError }) => ({ serviceId, configured, enabled, status, authState, checkedAt, lastError: sanitize(lastError) })),
    channels: listYouTubeAuthorizations().filter((channel) => channel.enabled && ['configured', 'active'].includes(channel.status)),
    disk, usage: getUsageSummary().map(({ service, seconds, maxDailySeconds }) => ({ service, seconds, maxDailySeconds })),
    youtubeQuotaRemaining: null, quotaNote: 'YouTube remaining quota is not measured locally. Planning reports upload count, not a guaranteed quota reservation.', humanApprovalRequired: false };
}
function context(id) {
  const job = requireJob(id);
  const record = db.prepare('SELECT title, context_summary_json FROM video_records WHERE id = ?').get(job.video_record_id);
  const bvid = job.source_input.match(/BV[0-9A-Za-z]{10}/)?.[0];
  const source = bvid ? db.prepare('SELECT creator_id, source_title, source_description, duration_seconds FROM bilibili_scraped_videos WHERE bvid = ? LIMIT 1').get(bvid) : null;
  const assets = db.prepare("SELECT kind, meta_json FROM video_assets WHERE job_id = ? AND kind IN ('videoEditor', 'videoContext', 'ocrContext', 'metadata') ORDER BY id").all(id);
  const fields = ['editorProjectId', 'editorUrl', 'transcriptSource', 'transcriptEn', 'transcriptMd', 'contextMd', 'segments', 'correctedSegments', 'onscreenSpans', 'glossary', 'duration', 'titleEn', 'descriptionEn', 'tags'];
  const evidence = assets.map((asset) => { const meta = parse(asset.meta_json); return { kind: asset.kind,
    ...Object.fromEntries(fields.filter((field) => meta[field] !== undefined).map((field) => [field, meta[field]])) }; });
  const previousTitles = source ? db.prepare(`SELECT DISTINCT v.title FROM video_records v JOIN video_publications p ON p.video_id = v.id
    JOIN bilibili_scraped_videos s ON v.source_url = s.source_url OR v.source_ref = s.source_url
    WHERE s.creator_id = ? AND p.status IN ('published','submitted','scheduled') ORDER BY p.published_at DESC LIMIT 25`).all(source.creator_id).map((row) => row.title) : [];
  // Metadata context is bounded and flagged when truncated, never interpreted as instructions.
  const text = JSON.stringify(sanitize(evidence));
  return { jobId: id, sourceTitle: source?.source_title || record?.title || '', sourceDescription: source?.source_description || '',
    creatorId: source?.creator_id || '', durationSeconds: source?.duration_seconds || null, previousTitles,
    evidence: text.length <= 120000 ? JSON.parse(text) : null, evidenceExcerpt: text.length > 120000 ? text.slice(0, 120000) : undefined,
    truncated: text.length > 120000, trust: 'untrusted source data' };
}
function savedVideo(creator, bvid, version) {
  const video = getSavedCreatorVideo(creator, bvid);
  if (!video) throw new AgentError('NOT_FOUND', `Saved video not found: ${bvid}`, 404);
  if (version && video.updatedAt !== version) throw new AgentError('STALE_WRITE', `Saved video changed: ${bvid}`, 409, { bvid, updatedAt: video.updatedAt });
  return video;
}
function publicationBlocker(video) {
  if (video.isUploaded) return 'Already uploaded';
  if (db.prepare("SELECT id FROM video_jobs WHERE source_input = ? AND status IN ('queued', 'running', 'review') LIMIT 1").get(video.url)) return 'Already has an active job';
  if (!video.selected) return 'Not selected in the saved checklist';
  return '';
}
function signPlan(plan) {
  const secret = globalThis[Symbol.for('videops.plan-signing-key')] ||= randomBytes(32);
  const payload = Buffer.from(JSON.stringify(plan)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
function readPlan(token, principal) {
  const [payload, signature, extra] = token.split('.');
  const secret = globalThis[Symbol.for('videops.plan-signing-key')] ||= randomBytes(32);
  const expected = createHmac('sha256', secret).update(payload || '').digest('base64url');
  if (extra || !equalSecret(signature, expected)) throw new AgentError('INVALID_INPUT', 'Invalid plan token');
  const plan = parse(Buffer.from(payload, 'base64url').toString());
  if (plan.principal !== principal || plan.expiresAt < Date.now()) throw new AgentError('PRECONDITION_FAILED', 'Plan expired or belongs to another principal; plan again', 409);
  return plan;
}
/** A saved preset's template, or null. Unknown ids are an input error, not a silent default. */
function presetTemplate(presetId) {
  if (!presetId) return null;
  const preset = getPreset(presetId);
  if (!preset) throw new AgentError('NOT_FOUND', `Pipeline preset ${presetId} does not exist`, 404);
  return preset.template || {};
}
/** Options for the preset's processors other than metadata/uploader, which callers set per item. */
function presetStepOptions(preset, processorIds) {
  const out = {};
  for (const id of processorIds) if (id !== 'metadata' && preset?.options?.[id]) out[id] = preset.options[id];
  return out;
}
function planBatch(input, principal) {
  const readiness = preconditions();
  const uploaderId = input.uploaderId ?? 'youtube';
  let authorizationId = input.youtubeAuthorizationId || '';
  const preset = presetTemplate(input.presetId);
  // The upload account comes with the job, not from a forced choice: the
  // preset's method wins; with no OAuth channel at all, uploads go through
  // YouTube Studio as the account signed in on the upload machine.
  const presetYouTube = preset?.options?.youtube || {};
  const uploadMethod = normalizeUploadMethod(input.uploadMethod || presetYouTube.uploadMethod || (readiness.channels.length || authorizationId ? '' : 'studio'));
  const needsChannel = methodNeedsAuthorization(uploadMethod);
  if (!needsChannel) authorizationId = '';
  if (uploaderId === 'youtube' && needsChannel && !authorizationId) {
    if (readiness.channels.length > 1) throw new AgentError('NEEDS_CHOICE', 'Choose a YouTube authorization', 409, { options: readiness.channels.map(({ id, channelTitle, channelId }) => ({ id, channelTitle, channelId })) });
    authorizationId = readiness.channels[0]?.id || '';
  }
  const start = input.startAt ? Date.parse(input.startAt) : Date.now();
  if (!Number.isFinite(start)) throw new AgentError('INVALID_INPUT', 'startAt must be an ISO date');
  const processorIds = input.processorIds || preset?.processorIds || ['metadata'];
  const blockers = []; const versions = []; const items = [];
  if (uploaderId === 'youtube' && needsChannel && !authorizationId) blockers.push({ code: 'PRECONDITION_FAILED', message: 'No usable YouTube channel; configure one in Connections' });
  if (readiness.disk.availableBytes !== null && readiness.disk.availableBytes < 1024 * 1024 * 1024) blockers.push({ code: 'PRECONDITION_FAILED', message: 'Less than 1 GiB of free disk space' });
  input.bvids.forEach((bvid, index) => {
    const video = savedVideo(input.creatorId, bvid);
    versions.push({ bvid, updatedAt: video.updatedAt });
    const blocker = publicationBlocker(video);
    if (blocker) blockers.push({ bvid, code: 'PRECONDITION_FAILED', message: blocker });
    const item = { sourceId: 'bilibili', sourceInput: video.url, sourceDurationSeconds: video.durationSeconds, title: video.title,
      processorIds, uploaderId, youtubeAuthorizationId: authorizationId,
      scheduledFor: new Date(start + index * (input.spacingMinutes !== undefined ? input.spacingMinutes * 60000 : (input.everyDays || 1) * 86400000)).toISOString(), agentPrincipal: principal,
      options: { ...presetStepOptions(preset, processorIds), metadata: { ...(preset?.options?.metadata || {}), reviewMetadata: false, title: video.title, description: video.description, tags: video.tags,
        sourceTitle: video.sourceTitle, sourceDescription: video.sourceDescription, sourceUrl: video.url, creatorId: input.creatorId, bvid,
        // Saved English title/description/tags are used as written; only missing
        // fields are left for the metadata step to generate.
        generationFields: ['title', 'description', 'tags'].filter((field) => !(Array.isArray(video[field]) ? video[field].length : String(video[field] || '').trim())), copyPrompt: video.copyPrompt }, youtube: { ...presetYouTube, ...(video.youtubeOptions || {}), uploadMethod } } };
    items.push(item);
    try { validateJobInput(item); } catch (error) { blockers.push({ bvid, code: 'PRECONDITION_FAILED', message: sanitize(error.message) }); }
  });
  const batch = { name: input.name || `Agent batch · ${input.creatorId}`, items };
  const plan = { principal, expiresAt: Date.now() + 15 * 60000, creatorId: input.creatorId, versions, batch };
  return { batch, blockers, uploadCount: uploaderId ? items.length : 0, youtubeQuotaCost: null, youtubeQuotaRemaining: readiness.youtubeQuotaRemaining,
    expiresAt: new Date(plan.expiresAt).toISOString(), humanApprovalRequired: false, planToken: blockers.length ? null : signPlan(plan) };
}

// ---------------------------------------------------------------------------
// Tool handlers. One entry per operation in contract.js, keyed by tool name.
// To add an MCP tool: declare it in contract.js, then add its handler here.
// Read handlers run outside a transaction; write handlers run inside the
// idempotent, audited transaction in executeOperation and must be synchronous.
// ---------------------------------------------------------------------------
function listWork(input) {
  const limit = input.limit || 25; const cursor = Number(input.cursor || 0);
  const states = { needs_metadata: "status = 'review' AND current_step = 'review:metadata'", in_review: "status = 'review'", failed: "status = 'failed'", scheduled: "status = 'queued' AND scheduled_for != ''", running: "status = 'running'" };
  const rows = db.prepare(`SELECT * FROM video_jobs WHERE id > ? AND ${states[input.state] || '1 = 1'} AND NOT EXISTS (SELECT 1 FROM video_records v WHERE v.id = video_jobs.video_record_id AND v.deleted_at != '') ORDER BY id LIMIT ?`).all(cursor, limit + 1);
  return { items: rows.slice(0, limit).map(jobProjection), nextCursor: rows.length > limit ? String(rows[limit - 1].id) : null };
}
function searchCatalog(input) {
  const limit = input.limit || 25; const cursor = Number(input.cursor || 0);
  const query = `%${(input.query || '').replace(/[\\%_]/g, '\\$&')}%`;
  const rows = db.prepare(`SELECT v.id, v.title, v.source_type AS sourceId, v.source_ref AS sourceRef, v.status, v.updated_at AS updatedAt,
    EXISTS(SELECT 1 FROM video_publications p WHERE p.video_id = v.id AND p.status IN ('published','submitted','scheduled')) AS isUploaded
    FROM video_records v WHERE v.deleted_at = '' AND (v.title LIKE ? ESCAPE '\\' OR v.source_ref LIKE ? ESCAPE '\\') ORDER BY v.id LIMIT ? OFFSET ?`).all(query, query, limit + 1, cursor);
  return { items: rows.slice(0, limit).map((row) => ({ ...row, isUploaded: Boolean(row.isUploaded || ['published', 'submitted', 'scheduled'].includes(row.status)) })), nextCursor: rows.length > limit ? String(cursor + limit) : null };
}

const readHandlers = {
  get_saved_upload: (input) => readSavedUpload(input.videoId),
  list_youtube_posts: (input) => ({ posts: listYouTubePosts(input.status || '') }),
  get_youtube_post: (input) => getYouTubePost(input.postId),
  list_work: listWork,
  get_job: (input) => sanitize(getJob(input.jobId)),
  get_video_context: (input) => context(input.jobId),
  check_preconditions: () => sanitize(preconditions()),
  search_catalog: searchCatalog,
  list_creator_videos: (input) => pageSavedCreatorVideos(input),
  plan_batch: (input, principal) => planBatch(input, principal),
  list_agent_requests: () => ({ requests: listAgentRequests(), nextAction: 'get_agent_request' }),
  get_agent_request: (input) => {
    const request = listAgentRequests({ includeBody: true }).find((item) => item.jobId === Number(input.jobId));
    if (!request) throw new AgentError('NOT_FOUND', 'That job is not waiting for the agent', 404);
    return { ...request, nextAction: 'submit_translation' };
  },
  get_job_captions: (input) => jobCaptions(input.jobId),
};

function jobCaptions(jobId) {
  const asset = db.prepare("SELECT * FROM video_assets WHERE job_id = ? AND kind = 'captions' ORDER BY id DESC LIMIT 1").get(jobId);
  const meta = parse(asset?.meta_json);
  const srt = asset?.file_path && fs.existsSync(asset.file_path) ? fs.readFileSync(asset.file_path, 'utf8') : '';
  const publications = db.prepare("SELECT remote_id, url, status FROM video_publications WHERE video_id = (SELECT video_record_id FROM video_jobs WHERE id = ?) ORDER BY id DESC").all(jobId);
  return { jobId: Number(jobId), language: meta.language || '', cues: meta.cues || 0, uploaded: meta.uploaded || null, srt, publications };
}

// Picks only the editable catalog fields the Library console exposes.
const RECORD_FIELDS = ['title', 'campaign', 'language', 'priority', 'scheduledAt'];
function updateRecord(input) {
  const patch = Object.fromEntries(RECORD_FIELDS.filter((field) => input[field] !== undefined).map((field) => [field, input[field]]));
  if (!Object.keys(patch).length) throw new AgentError('INVALID_INPUT', `Provide at least one of: ${RECORD_FIELDS.join(', ')}`);
  const before = db.prepare("SELECT updated_at FROM video_records WHERE id = ? AND deleted_at = ''").get(input.videoId);
  if (!before) throw new AgentError('NOT_FOUND', 'Video record not found', 404);
  return withVersion('video_records', 'id = ?', [input.videoId], input.ifMatch, () => {
    updateVideoRecord(input.videoId, patch);
    // Guarantee a new version even when two edits land in the same millisecond.
    const updatedAt = timestamp(before.updated_at);
    db.prepare('UPDATE video_records SET updated_at = ? WHERE id = ?').run(updatedAt, input.videoId);
    const row = db.prepare('SELECT id, title, campaign, language, priority, scheduled_at, status FROM video_records WHERE id = ?').get(input.videoId);
    return { videoId: row.id, title: row.title, campaign: row.campaign, language: row.language, priority: row.priority, scheduledAt: row.scheduled_at, status: row.status, updatedAt };
  });
}
function selectCreatorVideos(input) {
  if (new Set(input.videos.map((video) => video.bvid)).size !== input.videos.length) throw new AgentError('INVALID_INPUT', 'Duplicate BV IDs in selection');
  for (const row of input.videos) {
    const video = savedVideo(input.creatorId, row.bvid, row.ifMatch);
    if (row.selected && (video.isUploaded || !video.longVideoEnabled)) throw new AgentError('PRECONDITION_FAILED', `${row.bvid}: uploaded or long-video selection is disabled`, 409);
  }
  const items = input.videos.map((row) => {
    const video = updateScrapedBilibiliVideo({ creatorId: input.creatorId, bvid: row.bvid, selected: row.selected });
    const updatedAt = timestamp(row.ifMatch);
    db.prepare('UPDATE bilibili_scraped_videos SET updated_at = ? WHERE creator_id = ? AND bvid = ?').run(updatedAt, input.creatorId, row.bvid);
    return { bvid: video.bvid, selected: video.selected, updatedAt };
  });
  return { changed: items.length, items };
}
function queueBatch(input, principal) {
  const plan = readPlan(input.planToken, principal);
  for (const version of plan.versions) {
    const video = savedVideo(plan.creatorId, version.bvid, version.updatedAt);
    const blocker = publicationBlocker(video);
    if (blocker) throw new AgentError('PRECONDITION_FAILED', `${version.bvid}: ${blocker}`, 409);
  }
  // Revalidate live channel authorization and pipeline IDs; the signed payload is exact.
  for (const item of plan.batch.items) validateJobInput(item);
  return { batch: createJobBatch(plan.batch), nextAction: 'wait' };
}
// Job writes share the version check and the updated_at bump.
function jobWrite(action) {
  return (input, principal) => {
    const job = requireJob(input.jobId, input.ifMatch);
    action(job, input, principal);
    db.prepare('UPDATE video_jobs SET updated_at = ? WHERE id = ?').run(timestamp(job.updated_at), job.id);
    return getJob(job.id);
  };
}
function proposeMetadata(job, raw, principal) {
  const input = { ...raw, title: naturalText(raw.title), description: naturalText(raw.description), tags: raw.tags.map(naturalText) };
  if (job.status !== 'review' || job.current_step !== 'review:metadata') throw new AgentError('PRECONDITION_FAILED', 'Job is not waiting for metadata review', 409);
  const asset = db.prepare("SELECT * FROM video_assets WHERE job_id = ? AND kind = 'metadata' ORDER BY id DESC LIMIT 1").get(job.id);
  if (!asset) throw new AgentError('PRECONDITION_FAILED', 'Metadata asset is not ready', 409);
  if (!input.title.trim() || !input.description.trim() || input.tags.some((tag) => !tag.trim()) || input.tags.join(',').length > 500) throw new AgentError('INVALID_INPUT', 'Nonempty title, description and tags (at most 500 characters total) are required');
  db.prepare('UPDATE video_assets SET meta_json = ? WHERE id = ?').run(JSON.stringify({ ...parse(asset.meta_json), titleEn: input.title.trim(), descriptionEn: input.description.trim(), tags: input.tags.map((tag) => tag.trim()),
    metadataReviewRequired: false, agentDraftedAt: timestamp(), agentDraftedBy: principal }), asset.id);
  approveMetadata(job.id, {}, principal);
}
function retry(job, input, principal) {
  if (db.prepare("SELECT id FROM video_publications WHERE job_id = ? AND status = 'published' LIMIT 1").get(job.id)) throw new AgentError('PRECONDITION_FAILED', 'This job already published a video; an operator must investigate before retrying', 409);
  if (job.uploader_id) {
    const options = parse(job.options_json);
    options.metadata = { ...options.metadata, reviewMetadata: false };
    db.prepare('UPDATE video_jobs SET agent_principal = ?, options_json = ? WHERE id = ?').run(principal, JSON.stringify(options), job.id);
  }
  if (job.status === 'review' && job.current_step === 'review:metadata') approveMetadata(job.id, {}, principal);
  else if (job.status === 'review' && job.current_step === 'review:corrections') approveCorrections(job.id);
  else retryJob(job.id);
}

const writeHandlers = {
  save_upload_metadata: (input) => saveUploadMetadata(input),
  queue_saved_uploads: (input, principal) => {
    const preset = presetTemplate(input.presetId);
    const processorIds = preset?.processorIds || ['metadata'];
    return { batch: queueLibraryUploads({ ...input, uploadMethod: 'studio', processorIds, processorOptions: presetStepOptions(preset, processorIds) }, { principal }), nextAction: 'wait' };
  },
  mark_publication_replaced: (input) => sanitize(markPublicationReplaced(input.remoteId, input.replacementRemoteId)),
  save_pipeline_preset: (input) => {
    const processorIds = input.processorIds.map(String);
    const chain = validateProcessorChain(processorIds);
    const problems = Array.isArray(chain) ? chain : chain?.errors || [];
    if (problems.length) throw new AgentError('INVALID_INPUT', problems.join(' '));
    const saved = savePreset({ id: input.presetId, name: input.name, template: { processorIds, uploaderId: input.uploaderId ?? 'youtube', options: input.options || {} } });
    return { preset: sanitize(saved) };
  },
  save_youtube_post: (input) => saveYouTubePost({ id: input.postId, ifMatch: input.ifMatch, channelId: input.channelId, text: input.text, scheduledFor: input.scheduledFor, videoId: input.videoId }),
  claim_youtube_post: (input, principal) => claimYouTubePost(input.postId, input.ifMatch, principal),
  record_youtube_post: (input, principal) => recordYouTubePost(input.postId, input.ifMatch, input, principal),
  save_title_context: (input) => saveCategoryTitleContext(input.categoryId, input.context),
  delete_video_record: (input) => deleteVideoRecord(input.videoId, input.ifMatch),
  update_video_record: updateRecord,
  select_creator_videos: selectCreatorVideos,
  queue_batch: queueBatch,
  propose_metadata: jobWrite(proposeMetadata),
  retry_job: jobWrite(retry),
  submit_translation: (input, principal) => submitAgentTranslation(input.jobId, input.srt, principal),
  cancel_job: jobWrite((job) => cancelJob(job.id)),
  // scan_creator awaits the network, so executeOperation handles it separately.
};

// Fail at import time, not at call time, if contract.js and the handlers drift.
for (const op of operations) {
  const isRead = op.name in readHandlers; const isWrite = op.name in writeHandlers || op.name === 'scan_creator';
  if (isRead === isWrite || isRead !== op.annotations.readOnlyHint) throw new Error(`Agent operation ${op.name} needs exactly one ${op.annotations.readOnlyHint ? 'read' : 'write'} handler`);
}

export async function executeOperation(name, input, principal, { scanner = scanBilibiliCreatorPage } = {}) {
  const op = operations.find((item) => item.name === name);
  if (!op) throw new AgentError('NOT_FOUND', 'Unknown agent operation', 404);
  const validate = validators.get(name);
  if (!validate(input)) throw new AgentError('INVALID_INPUT', 'Invalid operation arguments', 400, validate.errors);
  if (op.annotations.readOnlyHint) {
    try { return readHandlers[name](input, principal); } catch (error) { throw toAgentError(error); }
  }
  let effectiveInput = input;
  const key = `request:${input.idempotencyKey}`;
  let scanKey = '';
  if (name === 'scan_creator') {
    let normalized;
    try { normalized = normalizeBilibiliSpaceUrl(input.creatorUrl); }
    catch { throw new AgentError('INVALID_INPUT', 'Use a space.bilibili.com URL with a numeric creator ID'); }
    const creator = new URL(normalized).pathname.split('/')[1];
    effectiveInput = { creatorUrl: normalized, page: input.page || 1 };
    scanKey = `scan:${creator}:${timestamp().slice(0, 10)}:${effectiveInput.page}`;
  }
  const digest = hash({ name, ...effectiveInput, idempotencyKey: undefined });
  function existingResult(lookupKey = key) {
    const existing = db.prepare('SELECT * FROM agent_idempotency WHERE principal = ? AND key = ?').get(principal, lookupKey);
    if (!existing) return null;
    if (existing.tool !== name || existing.request_hash !== digest) throw new AgentError('STALE_WRITE', 'Idempotency key already used for different arguments', 409);
    if (!existing.response_json) {
      if (name === 'scan_creator' && Date.now() - Date.parse(existing.created_at) > 5 * 60000) {
        db.prepare('DELETE FROM agent_idempotency WHERE principal = ? AND key = ? AND response_json IS NULL').run(principal, lookupKey);
        return null;
      }
      throw new AgentError('RETRYABLE', 'This scan is still running. Retry with the same key; interrupted scan reservations expire after five minutes.', 503);
    }
    return { replay: parse(existing.response_json) };
  }
  try {
    if (name === 'scan_creator') {
      const replay = db.transaction(() => {
        const existing = existingResult(); if (existing) return existing;
        const dayResult = existingResult(scanKey);
        if (dayResult) {
          db.prepare('INSERT INTO agent_idempotency (principal, key, tool, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(principal, key, name, digest, JSON.stringify(dayResult.replay), timestamp());
          return dayResult;
        }
        db.prepare('INSERT INTO agent_idempotency (principal, key, tool, request_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(principal, key, name, digest, timestamp());
        db.prepare('INSERT INTO agent_idempotency (principal, key, tool, request_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(principal, scanKey, name, digest, timestamp());
      }).immediate();
      if (replay) return replay.replay;
      let scanned;
      try { scanned = await scanner(effectiveInput.creatorUrl, effectiveInput.page); }
      catch (error) {
        db.prepare('DELETE FROM agent_idempotency WHERE principal = ? AND key = ? AND response_json IS NULL').run(principal, key);
        db.prepare('DELETE FROM agent_idempotency WHERE principal = ? AND key = ? AND response_json IS NULL').run(principal, scanKey);
        throw new AgentError('RETRYABLE', sanitize(error.message), 503);
      }
      return db.transaction(() => {
        saveScrapedBilibiliVideos(scanned.creatorId, scanned.videos);
        const result = { creatorId: scanned.creatorId, saved: scanned.videos.length, total: scanned.total, nextPage: scanned.nextPage, nextAction: scanned.nextPage ? 'scan_creator' : 'list_creator_videos' };
        db.prepare('UPDATE agent_idempotency SET response_json = ? WHERE principal = ? AND key = ?').run(JSON.stringify(result), principal, key);
        db.prepare('UPDATE agent_idempotency SET response_json = ? WHERE principal = ? AND key = ?').run(JSON.stringify(result), principal, scanKey);
        audit(principal, name, effectiveInput, result); return result;
      }).immediate();
    }
    return db.transaction(() => {
      const existing = existingResult(); if (existing) return existing.replay;
      const result = writeHandlers[name](input, principal);
      db.prepare('INSERT INTO agent_idempotency (principal, key, tool, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(principal, key, name, digest, JSON.stringify(result), timestamp());
      audit(principal, name, input, result); return result;
    }).immediate();
  } catch (failure) {
    const error = toAgentError(failure);
    audit(principal, name, input, { error: { code: error.code, message: error.message } }); throw error;
  }
}

export function readAgentResource(uri) {
  if (uri === 'videops://health') return sanitize(preconditions());
  if (uri === 'videops://manifest') {
    const project = ({ id, label, inputKinds, optionFields }) => ({ id, label, inputKinds, optionFields: optionFields || [] });
    return { sources: SOURCES.map(project), processors: PROCESSORS.map(project), uploaders: UPLOADERS.map(project), humanApprovalRequired: false };
  }
  if (uri === 'videops://title-contexts') return { contexts: listCategoryTitleContexts(), note: 'Keys are Bilibili category IDs; "default" applies to all other categories.' };
  if (uri === 'videops://presets') return db.prepare('SELECT id, name, template_json, updated_at FROM pipeline_presets ORDER BY name').all().map((row) => ({ id: row.id, name: row.name, template: sanitize(parse(row.template_json)), updatedAt: row.updated_at }));
  const match = uri.match(/^videops:\/\/job\/(\d+)\/log$/);
  if (match) {
    requireJob(Number(match[1]));
    const rows = db.prepare('SELECT step, log FROM video_job_steps WHERE job_id = ? ORDER BY id').all(Number(match[1]));
    const log = sanitize(rows.map((row) => `${row.step}\n${row.log || ''}`).join('\n'));
    return { jobId: Number(match[1]), log: log.slice(-65536), truncated: log.length > 65536 };
  }
  throw new AgentError('NOT_FOUND', 'Unknown resource', 404);
}
