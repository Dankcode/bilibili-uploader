import fs from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import Ajv from 'ajv';
import db from '../db/sqlite.js';
import { operations } from './contract.js';
import { bridgeConfig, equalSecret } from './auth.js';
import { createJobBatch, validateJobInput, retryJob, cancelJob } from '../pipeline/pipeline.js';
import { SOURCES, PROCESSORS, UPLOADERS } from '../pipeline/registry.js';
import { listConnections } from '../pipeline/connections.js';
import { getUsageSummary } from '../pipeline/usage.js';
import { listYouTubeAuthorizations, getJobYouTubeAuthorization, publicYouTubeAuthorization } from '../youtube/authorizations.js';
import { getSavedCreatorVideo, pageSavedCreatorVideos, saveScrapedBilibiliVideos, updateScrapedBilibiliVideo } from '../video/scrapedCatalog.js';
import { normalizeBilibiliSpaceUrl, scanBilibiliCreatorPage } from '../video/scraper.js';

export class AgentError extends Error {
  constructor(code, message, status = 400, details) { super(message); Object.assign(this, { code, status, details }); }
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
  nextAction: row.status === 'review' ? (row.current_step === 'review:metadata' && !db.prepare("SELECT id FROM video_assets WHERE job_id = ? AND kind = 'metadata' AND meta_json LIKE '%agentDraftedAt%' LIMIT 1").get(row.id) ? 'propose_metadata' : 'human_review') : row.status === 'failed' ? 'get_job' : 'wait',
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
    youtubeQuotaRemaining: null, quotaNote: 'YouTube remaining quota is not measured locally. Planning reports upload count, not a guaranteed quota reservation.', humanApprovalRequired: true };
}
function context(id) {
  const job = requireJob(id);
  const record = db.prepare('SELECT title, context_summary_json FROM video_records WHERE id = ?').get(job.video_record_id);
  const bvid = job.source_input.match(/BV[0-9A-Za-z]{10}/)?.[0];
  const source = bvid ? db.prepare('SELECT creator_id, source_title, source_description, duration_seconds FROM bilibili_scraped_videos WHERE bvid = ? LIMIT 1').get(bvid) : null;
  const assets = db.prepare("SELECT kind, meta_json FROM video_assets WHERE job_id = ? AND kind IN ('videoContext', 'ocrContext', 'metadata') ORDER BY id").all(id);
  const fields = ['transcriptMd', 'contextMd', 'segments', 'correctedSegments', 'onscreenSpans', 'glossary', 'duration', 'titleEn', 'descriptionEn', 'tags'];
  const evidence = assets.map((asset) => { const meta = parse(asset.meta_json); return { kind: asset.kind,
    ...Object.fromEntries(fields.filter((field) => meta[field] !== undefined).map((field) => [field, meta[field]])) }; });
  const previousTitles = source ? db.prepare(`SELECT DISTINCT v.title FROM video_records v JOIN video_publications p ON p.video_id = v.id
    JOIN bilibili_scraped_videos s ON v.source_url = s.source_url OR v.source_ref = s.source_url
    WHERE s.creator_id = ? AND p.status = 'published' ORDER BY p.published_at DESC LIMIT 25`).all(source.creator_id).map((row) => row.title) : [];
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
  const secret = bridgeConfig().operatorToken;
  if (!secret) throw new AgentError('PRECONDITION_FAILED', 'Configure separate operator and agent tokens before planning', 409);
  const payload = Buffer.from(JSON.stringify(plan)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
function readPlan(token, principal) {
  const [payload, signature, extra] = token.split('.');
  const expected = createHmac('sha256', bridgeConfig().operatorToken).update(payload || '').digest('base64url');
  if (extra || !equalSecret(signature, expected)) throw new AgentError('INVALID_INPUT', 'Invalid plan token');
  const plan = parse(Buffer.from(payload, 'base64url').toString());
  if (plan.principal !== principal || plan.expiresAt < Date.now()) throw new AgentError('PRECONDITION_FAILED', 'Plan expired or belongs to another principal; plan again', 409);
  return plan;
}
function planBatch(input, principal) {
  const readiness = preconditions();
  const uploaderId = input.uploaderId ?? 'youtube';
  let authorizationId = input.youtubeAuthorizationId || '';
  if (uploaderId === 'youtube' && !authorizationId) {
    if (readiness.channels.length > 1) throw new AgentError('NEEDS_CHOICE', 'Choose a YouTube authorization', 409, { options: readiness.channels.map(({ id, channelTitle, channelId }) => ({ id, channelTitle, channelId })) });
    authorizationId = readiness.channels[0]?.id || '';
  }
  const start = input.startAt ? Date.parse(input.startAt) : Date.now();
  if (!Number.isFinite(start)) throw new AgentError('INVALID_INPUT', 'startAt must be an ISO date');
  const processorIds = input.processorIds || ['metadata'];
  const blockers = []; const versions = []; const items = [];
  if (uploaderId === 'youtube' && !authorizationId) blockers.push({ code: 'PRECONDITION_FAILED', message: 'No usable YouTube channel; configure one in Connections' });
  if (readiness.disk.availableBytes !== null && readiness.disk.availableBytes < 1024 * 1024 * 1024) blockers.push({ code: 'PRECONDITION_FAILED', message: 'Less than 1 GiB of free disk space' });
  input.bvids.forEach((bvid, index) => {
    const video = savedVideo(input.creatorId, bvid);
    versions.push({ bvid, updatedAt: video.updatedAt });
    const blocker = publicationBlocker(video);
    if (blocker) blockers.push({ bvid, code: 'PRECONDITION_FAILED', message: blocker });
    const item = { sourceId: 'bilibili', sourceInput: video.url, sourceDurationSeconds: video.durationSeconds, title: video.title,
      processorIds, uploaderId, youtubeAuthorizationId: authorizationId,
      scheduledFor: new Date(start + index * (input.everyDays || 1) * 86400000).toISOString(), agentPrincipal: principal,
      options: { metadata: { reviewMetadata: true, title: video.title, description: video.description, tags: video.tags,
        sourceTitle: video.sourceTitle, sourceDescription: video.sourceDescription, sourceUrl: video.url, creatorId: input.creatorId, bvid,
        generationFields: video.generationFields, copyPrompt: video.copyPrompt }, youtube: video.youtubeOptions } };
    items.push(item);
    try { validateJobInput(item); } catch (error) { blockers.push({ bvid, code: 'PRECONDITION_FAILED', message: sanitize(error.message) }); }
  });
  const batch = { name: input.name || `Agent batch · ${input.creatorId}`, items };
  const plan = { principal, expiresAt: Date.now() + 15 * 60000, creatorId: input.creatorId, versions, batch };
  return { batch, blockers, uploadCount: uploaderId ? items.length : 0, youtubeQuotaCost: null, youtubeQuotaRemaining: readiness.youtubeQuotaRemaining,
    expiresAt: new Date(plan.expiresAt).toISOString(), humanApprovalRequired: Boolean(uploaderId), planToken: blockers.length ? null : signPlan(plan) };
}

function mutate(name, input, principal) {
  if (name === 'queue_batch') {
    const plan = readPlan(input.planToken, principal);
    for (const version of plan.versions) {
      const video = savedVideo(plan.creatorId, version.bvid, version.updatedAt);
      const blocker = publicationBlocker(video);
      if (blocker) throw new AgentError('PRECONDITION_FAILED', `${version.bvid}: ${blocker}`, 409);
    }
    // Revalidate live channel authorization and pipeline IDs; the signed payload is exact.
    for (const item of plan.batch.items) validateJobInput(item);
    return { batch: createJobBatch(plan.batch), nextAction: 'wait_for_human_review' };
  }
  if (name === 'select_creator_videos') {
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
  const job = requireJob(input.jobId, input.ifMatch);
  if (name === 'propose_metadata') {
    if (job.status !== 'review' || job.current_step !== 'review:metadata') throw new AgentError('PRECONDITION_FAILED', 'Job is not waiting for metadata review', 409);
    const asset = db.prepare("SELECT * FROM video_assets WHERE job_id = ? AND kind = 'metadata' ORDER BY id DESC LIMIT 1").get(job.id);
    if (!asset) throw new AgentError('PRECONDITION_FAILED', 'Metadata asset is not ready', 409);
    if (!input.title.trim() || !input.description.trim() || input.tags.some((tag) => !tag.trim()) || input.tags.join(',').length > 500) throw new AgentError('INVALID_INPUT', 'Nonempty title, description and tags (at most 500 characters total) are required');
    db.prepare('UPDATE video_assets SET meta_json = ? WHERE id = ?').run(JSON.stringify({ ...parse(asset.meta_json), titleEn: input.title.trim(), descriptionEn: input.description.trim(), tags: input.tags.map((tag) => tag.trim()),
      metadataReviewRequired: true, metadataApprovedAt: '', agentDraftedAt: timestamp(), agentDraftedBy: principal }), asset.id);
    db.prepare("UPDATE video_jobs SET metadata_approved_by = '', updated_at = ? WHERE id = ?").run(timestamp(job.updated_at), job.id);
  } else if (name === 'retry_job') {
    if (db.prepare("SELECT id FROM video_publications WHERE job_id = ? AND status = 'published' LIMIT 1").get(job.id)) throw new AgentError('PRECONDITION_FAILED', 'This job already published a video; an operator must investigate before retrying', 409);
    // Retrying an old operator-created upload is also an agent write. Adopt the
    // review constraint before it can resume past a previously successful step.
    if (job.uploader_id && !job.agent_principal) {
      const processors = parse(job.processor_ids_json, []);
      if (!processors.includes('metadata')) throw new AgentError('PRECONDITION_FAILED', 'This legacy upload has no metadata review gate; an operator must retry it', 409);
      const options = parse(job.options_json);
      options.metadata = { ...options.metadata, reviewMetadata: true };
      db.prepare("UPDATE video_jobs SET agent_principal = ?, metadata_approved_by = '', options_json = ? WHERE id = ?").run(principal, JSON.stringify(options), job.id);
    }
    try { retryJob(job.id); } catch (error) { throw new AgentError('PRECONDITION_FAILED', error.message, 409); }
  } else if (name === 'cancel_job') cancelJob(job.id);
  if (name !== 'propose_metadata') db.prepare('UPDATE video_jobs SET updated_at = ? WHERE id = ?').run(timestamp(job.updated_at), job.id);
  return getJob(job.id);
}

export async function executeOperation(name, input, principal, { scanner = scanBilibiliCreatorPage } = {}) {
  const op = operations.find((item) => item.name === name);
  if (!op) throw new AgentError('NOT_FOUND', 'Unknown agent operation', 404);
  const validate = validators.get(name);
  if (!validate(input)) throw new AgentError('INVALID_INPUT', 'Invalid operation arguments', 400, validate.errors);
  if (op.annotations.readOnlyHint) {
    if (name === 'get_job') return sanitize(getJob(input.jobId));
    if (name === 'get_video_context') return context(input.jobId);
    if (name === 'check_preconditions') return sanitize(preconditions());
    if (name === 'plan_batch') return planBatch(input, principal);
    if (name === 'list_creator_videos') return pageSavedCreatorVideos(input);
    const limit = input.limit || 25; const cursor = Number(input.cursor || 0);
    if (name === 'list_work') {
      const states = { needs_metadata: "status = 'review' AND current_step = 'review:metadata'", in_review: "status = 'review'", failed: "status = 'failed'", scheduled: "status = 'queued' AND scheduled_for != ''", running: "status = 'running'" };
      const rows = db.prepare(`SELECT * FROM video_jobs WHERE id > ? AND ${states[input.state] || '1 = 1'} ORDER BY id LIMIT ?`).all(cursor, limit + 1);
      return { items: rows.slice(0, limit).map(jobProjection), nextCursor: rows.length > limit ? String(rows[limit - 1].id) : null };
    }
    const query = `%${(input.query || '').replace(/[\\%_]/g, '\\$&')}%`;
    const rows = db.prepare(`SELECT v.id, v.title, v.source_type AS sourceId, v.source_ref AS sourceRef, v.status, v.updated_at AS updatedAt,
      EXISTS(SELECT 1 FROM video_publications p WHERE p.video_id = v.id AND p.status = 'published') AS isUploaded
      FROM video_records v WHERE v.title LIKE ? ESCAPE '\\' OR v.source_ref LIKE ? ESCAPE '\\' ORDER BY v.id LIMIT ? OFFSET ?`).all(query, query, limit + 1, cursor);
    return { items: rows.slice(0, limit).map((row) => ({ ...row, isUploaded: Boolean(row.isUploaded || row.status === 'published') })), nextCursor: rows.length > limit ? String(cursor + limit) : null };
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
      const result = mutate(name, input, principal);
      db.prepare('INSERT INTO agent_idempotency (principal, key, tool, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(principal, key, name, digest, JSON.stringify(result), timestamp());
      audit(principal, name, input, result); return result;
    }).immediate();
  } catch (error) { audit(principal, name, input, { error: { code: error.code || 'PRECONDITION_FAILED', message: error.message } }); throw error; }
}

export function readAgentResource(uri) {
  if (uri === 'videops://health') return sanitize(preconditions());
  if (uri === 'videops://manifest') {
    const project = ({ id, label, inputKinds, optionFields }) => ({ id, label, inputKinds, optionFields: optionFields || [] });
    return { sources: SOURCES.map(project), processors: PROCESSORS.map(project), uploaders: UPLOADERS.map(project), humanApprovalRequired: true };
  }
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
