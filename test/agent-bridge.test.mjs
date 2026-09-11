import assert from 'node:assert/strict';
import test from 'node:test';
import db from '../src/lib/db/sqlite.js';
import { operations, openApiDocument } from '../src/lib/agent/contract.js';
import { executeOperation, readAgentResource, listAgentActions } from '../src/lib/agent/service.js';
import { operatorGuard, operatorSession, isOperator, internalApiBase, sameOrigin } from '../src/lib/agent/auth.js';
import { POST as sessionPOST } from '../src/app/api/auth/session/route.js';
import { saveScrapedBilibiliVideos, getSavedCreatorVideo } from '../src/lib/video/scrapedCatalog.js';
import { createJob, validateJobInput, approveMetadata, runNextQueuedJob, bulkJobAction } from '../src/lib/pipeline/pipeline.js';
import { GET as agentGET, POST as agentPOST } from '../src/app/api/agent/v1/[...path]/route.js';
import { POST as legacyPOST } from '../src/app/api/pipeline/jobs/route.js';
import { POST as runtimePOST } from '../src/app/api/runtime/settings/route.js';
import { registerYouTubeAuthorization } from '../src/lib/youtube/authorizations.js';

process.env.VIDEO_AGENT_TOKEN = 'test-agent-token-never-operator';
process.env.VIDEO_OPERATOR_TOKEN = 'test-operator-token-never-agent';
const principal = 'agent:test';
const call = (name, input) => executeOperation(name, input, principal);
const bv = (n) => `BV${String(n).padStart(10, '0')}`;
function seed(creator, n = 1) {
  saveScrapedBilibiliVideos(creator, Array.from({ length: n }, (_, index) => ({ bvid: bv(Number(creator) * 100 + index), name: `Title ${index}`, description: 'Description', durationSeconds: 40 })));
  return Array.from({ length: n }, (_, index) => getSavedCreatorVideo(creator, bv(Number(creator) * 100 + index)));
}
function fixtureJob(status = 'review', uploaderId = '') {
  const job = createJob({ sourceId: 'bilibili', sourceInput: `https://www.bilibili.com/video/${bv(999)}`, processorIds: ['metadata'], uploaderId: '' });
  db.prepare("UPDATE video_jobs SET status = ?, current_step = 'review:metadata', uploader_id = ?, agent_principal = ? WHERE id = ?").run(status, uploaderId, principal, job.id);
  db.prepare("INSERT INTO video_assets (job_id, kind, file_path, meta_json, created_at) VALUES (?, 'metadata', '', ?, ?)").run(job.id, JSON.stringify({ titleEn: 'Old', descriptionEn: 'Old description', tags: ['old'] }), new Date().toISOString());
  return job.id;
}

test('one shared contract has thirteen tools, matching REST/OpenAPI, and no approval/SQL/delete capability', () => {
  assert.equal(operations.length, 13);
  const spec = openApiDocument();
  for (const op of operations) assert.equal(spec.paths[op.path][op.method.toLowerCase()].operationId, op.name);
  assert.ok(!operations.some((op) => /approve|sql|delete|runtime/.test(op.name)));
});

test('agent cannot call operator routes or acquire operator session; Host cannot repoint internal proxy', async () => {
  const request = new Request('http://localhost:4455/api/pipeline/jobs', { method: 'POST', headers: { Authorization: `Bearer ${process.env.VIDEO_AGENT_TOKEN}`, Origin: 'http://localhost:4455', 'x-video-ops-local': '1' }, body: JSON.stringify({ action: 'approveMetadata', jobId: 1 }) });
  assert.equal(operatorGuard(request).status, 401);
  assert.equal((await legacyPOST(request)).status, 401);
  assert.equal(isOperator(request), false);
  const session = operatorSession(process.env.VIDEO_OPERATOR_TOKEN);
  assert.equal(isOperator(new Request('http://localhost:4455', { headers: { cookie: `videops_operator=${session}` } })), true);
  assert.equal(operatorGuard(new Request('http://localhost:4455', { method: 'POST', headers: { cookie: `videops_operator=${session}`, Origin: 'https://evil.invalid' } })).status, 403);
  assert.match(internalApiBase(), /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(sameOrigin(new Request('http://localhost:4455', { headers: { host: '127.0.0.1:4455', origin: 'http://127.0.0.1:4455' } })), true);
  const sessionResponse = await sessionPOST(new Request('http://localhost:4455/api/auth/session', { method: 'POST', headers: { Origin: 'http://localhost:4455' }, body: JSON.stringify({ token: process.env.VIDEO_OPERATOR_TOKEN }) }));
  assert.equal(sessionResponse.status, 200); assert.match(sessionResponse.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const missingOrigin = await runtimePOST(new Request('http://localhost:4455/api/runtime/settings', { method: 'POST', headers: { Authorization: `Bearer ${process.env.VIDEO_OPERATOR_TOKEN}`, 'Content-Type': 'application/json' }, body: '{"action":"save"}' }));
  assert.equal(missingOrigin.status, 400);
  assert.match(JSON.stringify(await missingOrigin.json()), /Origin/);
});

test('agent REST validates bearer, typed input, and refuses guessed approval endpoints', async () => {
  assert.equal((await agentGET(new Request('http://localhost:4455/api/agent/v1/work'), { params: { path: ['work'] } })).status, 401);
  const headers = { Authorization: `Bearer ${process.env.VIDEO_AGENT_TOKEN}` };
  const invalid = await agentGET(new Request('http://localhost:4455/api/agent/v1/work?limit=26', { headers }), { params: { path: ['work'] } });
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.code, 'INVALID_INPUT');
  const absent = await agentPOST(new Request('http://localhost:4455/api/agent/v1/approve-metadata', { method: 'POST', headers }), { params: { path: ['approve-metadata'] } });
  assert.equal(absent.status, 404);
});

test('agent upload validation requires metadata and forcibly enables human review without mutating caller options', () => {
  assert.throws(() => validateJobInput({ sourceId: 'bilibili', sourceInput: bv(1), processorIds: [], uploaderId: 'youtube', agentPrincipal: principal }), /require.*metadata/);
  // A no-uploader job remains compatible, and unknown processors still fail validation.
  const options = { metadata: { reviewMetadata: false } };
  const input = validateJobInput({ sourceId: 'bilibili', sourceInput: `https://www.bilibili.com/video/${bv(1)}`, processorIds: ['metadata'], agentPrincipal: principal, options });
  assert.equal(input.agentPrincipal, principal); assert.equal(options.metadata.reviewMetadata, false);
  const channel = registerYouTubeAuthorization({ emailAddress: 'agent-test@example.test', channelId: 'UC1234567890123456789012', credentialRef: 'agent-test-fixture' });
  const publish = validateJobInput({ ...input, uploaderId: 'youtube', youtubeAuthorizationId: channel.id, options });
  assert.equal(publish.options.metadata.reviewMetadata, true);
  assert.equal(options.metadata.reviewMetadata, false);
  assert.throws(() => validateJobInput({ ...publish, processorIds: ['metadata', 'sceneCut'] }), /final processor/);
});

test('plan is read-only, queue is atomic/idempotent, and stale or already-active sources are rejected', async () => {
  const videos = seed('101', 2);
  const before = db.prepare('SELECT total_changes() AS n').get().n;
  const plan = await call('plan_batch', { creatorId: '101', bvids: videos.map((video) => video.bvid), uploaderId: '', startAt: '2030-01-01T10:00:00Z', everyDays: 2 });
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before);
  assert.deepEqual(plan.blockers, []); assert.ok(plan.planToken);
  assert.equal(plan.batch.items[1].scheduledFor, '2030-01-03T10:00:00.000Z');
  const result = await call('queue_batch', { planToken: plan.planToken, idempotencyKey: 'queue-one' });
  assert.equal(result.batch.jobs.length, 2);
  assert.deepEqual(await call('queue_batch', { planToken: plan.planToken, idempotencyKey: 'queue-one' }), result);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_jobs WHERE batch_id = ?').get(result.batch.id).n, 2);
  assert.equal(db.prepare('SELECT agent_principal FROM video_jobs WHERE id = ?').get(result.batch.jobs[0].id).agent_principal, principal);
  await assert.rejects(call('queue_batch', { planToken: plan.planToken, idempotencyKey: 'queue-two' }), (error) => error.code === 'PRECONDITION_FAILED');
  await assert.rejects(call('queue_batch', { planToken: `${plan.planToken}x`, idempotencyKey: 'queue-one' }), (error) => error.code === 'STALE_WRITE');
  const [video] = seed('102');
  const stale = await call('plan_batch', { creatorId: '102', bvids: [video.bvid], uploaderId: '' });
  db.prepare("UPDATE bilibili_scraped_videos SET updated_at = 'changed' WHERE creator_id = '102'").run();
  await assert.rejects(call('queue_batch', { planToken: stale.planToken, idempotencyKey: 'stale-queue' }), (error) => error.code === 'STALE_WRITE');
});

test('creator lists paginate at 25 and atomically reject stale bulk selection without partial updates', async () => {
  const videos = seed('103', 30);
  const first = await call('list_creator_videos', { creatorId: '103' });
  const second = await call('list_creator_videos', { creatorId: '103', cursor: first.nextCursor });
  assert.equal(first.items.length, 25); assert.equal(second.items.length, 5); assert.equal(second.nextCursor, null);
  await assert.rejects(call('select_creator_videos', { creatorId: '103', idempotencyKey: 'stale-select', videos: [
    { bvid: videos[0].bvid, selected: false, ifMatch: videos[0].updatedAt }, { bvid: videos[1].bvid, selected: false, ifMatch: 'stale' },
  ] }), (error) => error.code === 'STALE_WRITE');
  assert.equal(getSavedCreatorVideo('103', videos[0].bvid).selected, true);
  const result = await call('select_creator_videos', { creatorId: '103', idempotencyKey: 'select-good', videos: [{ bvid: videos[0].bvid, selected: false, ifMatch: videos[0].updatedAt }] });
  assert.equal(result.items[0].selected, false); assert.notEqual(result.items[0].updatedAt, videos[0].updatedAt);
});

test('draft metadata remains in review, is audited, rejects stale writes, and only operator approval resumes', async () => {
  const id = fixtureJob();
  const job = await call('get_job', { jobId: id });
  const args = { jobId: id, ifMatch: job.updatedAt, idempotencyKey: 'metadata-one', title: 'A new title', description: 'New description', tags: ['video'] };
  const result = await call('propose_metadata', args);
  assert.equal(result.status, 'review'); assert.equal(result.nextAction, 'human_review');
  assert.deepEqual(await call('propose_metadata', args), result);
  await assert.rejects(call('propose_metadata', { ...args, idempotencyKey: 'metadata-stale' }), (error) => error.code === 'STALE_WRITE');
  assert.throws(() => approveMetadata(id, {}, principal), /human operator/);
  assert.equal(approveMetadata(id).status, 'queued');
  assert.equal(db.prepare('SELECT metadata_approved_by FROM video_jobs WHERE id = ?').get(id).metadata_approved_by, 'operator');
  assert.ok(listAgentActions().items.some((action) => action.tool === 'human_approve_metadata'));
  db.prepare("UPDATE video_jobs SET status = 'done' WHERE id = ?").run(id);
});

test('worker cannot skip the human gate even when metadata step already succeeded', async () => {
  const id = fixtureJob('queued', 'youtube');
  db.prepare("UPDATE video_job_steps SET status = 'ok' WHERE job_id = ?").run(id);
  db.prepare("INSERT INTO video_job_steps (job_id, step) VALUES (?, 'uploader:youtube')").run(id);
  db.prepare("UPDATE video_jobs SET scheduled_for = '', priority = 100 WHERE id = ?").run(id);
  await runNextQueuedJob();
  assert.equal(db.prepare('SELECT status FROM video_jobs WHERE id = ?').get(id).status, 'review');
  assert.equal(db.prepare("SELECT status FROM video_job_steps WHERE job_id = ? AND step = 'uploader:youtube'").get(id).status, 'pending');
});

test('retry enforces max attempts for canceled jobs, cancel persists worker signal, and bulk APIs never truncate', async () => {
  const id = fixtureJob('canceled');
  db.prepare('UPDATE video_jobs SET max_attempts = 2 WHERE id = ?').run(id);
  db.prepare("UPDATE video_job_steps SET status = 'skipped' WHERE job_id = ?").run(id);
  let job = await call('get_job', { jobId: id });
  await call('retry_job', { jobId: id, ifMatch: job.updatedAt, idempotencyKey: 'retry-once' });
  db.prepare("UPDATE video_jobs SET status = 'canceled' WHERE id = ?").run(id);
  job = await call('get_job', { jobId: id });
  await assert.rejects(call('retry_job', { jobId: id, ifMatch: job.updatedAt, idempotencyKey: 'retry-twice' }), /Maximum retry/);
  db.prepare("UPDATE video_jobs SET status = 'running' WHERE id = ?").run(id);
  job = await call('get_job', { jobId: id });
  const canceled = await call('cancel_job', { jobId: id, ifMatch: job.updatedAt, idempotencyKey: 'cancel-running' });
  assert.equal(canceled.status, 'running'); assert.equal(canceled.cancellationRequested, true);
  assert.throws(() => bulkJobAction('cancel', Array.from({ length: 101 }, (_, index) => index + 1)), /at most 100/);
});

test('scan pages reuse a creator/day result, persist SQL, and do not run a scan twice', async () => {
  let scans = 0;
  const scanner = async () => { scans += 1; return { creatorId: '104', videos: [{ bvid: bv(10400), name: 'Scanned' }], total: 31, nextPage: 2 }; };
  const args = { creatorUrl: 'https://space.bilibili.com/104', idempotencyKey: 'scan-a' };
  const first = await executeOperation('scan_creator', args, principal, { scanner });
  const repeat = await executeOperation('scan_creator', { ...args, idempotencyKey: 'scan-b' }, principal, { scanner });
  assert.equal(scans, 1); assert.deepEqual(first, repeat); assert.equal(first.nextPage, 2);
  assert.equal(getSavedCreatorVideo('104', bv(10400)).sourceTitle, 'Scanned');
  await assert.rejects(executeOperation('scan_creator', { ...args, page: 2 }, principal, { scanner }), (error) => error.code === 'STALE_WRITE');
});

test('published source rows are omitted from loading and blocked from a plan', async () => {
  const [video] = seed('105');
  const job = createJob({ sourceId: 'bilibili', sourceInput: video.url });
  db.prepare("UPDATE video_records SET status = 'published' WHERE id = ?").run(job.videoRecordId);
  db.prepare("UPDATE video_jobs SET status = 'done' WHERE id = ?").run(job.id);
  assert.equal((await call('list_creator_videos', { creatorId: '105' })).items.length, 0);
  assert.equal((await call('list_creator_videos', { creatorId: '105', includeUploaded: true })).items[0].isUploaded, true);
  const plan = await call('plan_batch', { creatorId: '105', bvids: [video.bvid], uploaderId: '' });
  assert.equal(plan.planToken, null); assert.ok(plan.blockers.some((blocker) => /uploaded/.test(blocker.message)));
});

test('ambiguous channels return typed choices and legacy retries cannot bypass the review gate', async () => {
  registerYouTubeAuthorization({ emailAddress: 'agent-two@example.test', channelId: 'UC2234567890123456789012', credentialRef: 'agent-test-fixture-two' });
  const [video] = seed('106');
  await assert.rejects(call('plan_batch', { creatorId: '106', bvids: [video.bvid] }), (error) => error.code === 'NEEDS_CHOICE' && error.details.options.length === 2);
  const id = fixtureJob('failed', 'youtube');
  db.prepare("UPDATE video_jobs SET agent_principal = '', processor_ids_json = '[]' WHERE id = ?").run(id);
  const job = await call('get_job', { jobId: id });
  await assert.rejects(call('retry_job', { jobId: id, ifMatch: job.updatedAt, idempotencyKey: 'legacy-retry' }), /no metadata review gate/);
  assert.equal(db.prepare('SELECT status FROM video_jobs WHERE id = ?').get(id).status, 'failed');
});

test('list tools omit logs and credential values; explicit log resource redacts bearer secrets', async () => {
  const id = fixtureJob('failed');
  db.prepare('UPDATE video_job_steps SET log = ? WHERE job_id = ?').run(`Authorization: Bearer ${process.env.VIDEO_AGENT_TOKEN}`, id);
  const work = await call('list_work', { state: 'failed' });
  assert.ok(work.items.length <= 25); assert.ok(!JSON.stringify(work).includes('Bearer'));
  const log = readAgentResource(`videops://job/${id}/log`);
  assert.ok(log.log.includes('[redacted]')); assert.ok(!log.log.includes(process.env.VIDEO_AGENT_TOKEN));
  await assert.rejects(call('list_work', { limit: 100 }), (error) => error.code === 'INVALID_INPUT');
});
