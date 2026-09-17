import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-layer-'));
process.env.VIDEO_SQLITE_PATH = path.join(directory, 'release.db');
process.env.YOUTUBE_CHANNEL_ID = 'release-test-only';
delete process.env.YOUTUBE_UPLOAD_METHOD;
delete process.env.YOUTUBE_DAILY_QUOTA_UNITS;
delete process.env.YOUTUBE_UPLOAD_UNITS;

const { default: db } = await import('../src/lib/db/sqlite.js');
const governor = await import('../src/lib/release/governor.js');
const receipts = await import('../src/lib/release/receipts.js');
const { releaseUpload } = await import('../src/lib/release/publish.js');
const service = await import('../src/lib/release/service.js');
const pipeline = await import('../src/lib/pipeline/pipeline.js');
const youtube = await import('../src/lib/pipeline/uploaders/youtube.js');

const video = path.join(directory, 'input.mp4');
fs.writeFileSync(video, 'not a real video, never uploaded');

test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

let nextJob = 1000;
function fakeJobStep() {
  nextJob += 1;
  return { job: { id: nextJob }, step: { id: nextJob * 10, attempt: 1 } };
}

function adapter(overrides = {}) {
  const calls = { upload: 0, reconcile: 0 };
  return {
    calls,
    upload: async (...args) => { calls.upload += 1; return overrides.upload ? overrides.upload(...args) : { remoteId: `vid${nextJob}abcd`, url: 'https://www.youtube.com/watch?v=x' }; },
    reconcile: overrides.reconcile === undefined ? undefined : async (...args) => { calls.reconcile += 1; return overrides.reconcile(...args); },
  };
}

function resetBudgets() {
  db.prepare('DELETE FROM destination_budgets').run();
}

// ------------------------------------------------------------------ governor

test('the YouTube quota day follows Pacific time, across both DST transitions', () => {
  assert.equal(governor.budgetDay('youtube', new Date('2026-09-16T05:00:00Z')), '2026-09-15');
  assert.equal(governor.nextResetAt('youtube', new Date('2026-09-16T12:00:00Z')), '2026-09-17T07:00:00.000Z');
  assert.equal(governor.nextResetAt('youtube', new Date('2026-11-01T06:30:00Z')), '2026-11-01T07:00:00.000Z');
  assert.equal(governor.nextResetAt('youtube', new Date('2026-11-01T08:30:00Z')), '2026-11-02T08:00:00.000Z');
  assert.equal(governor.nextResetAt('youtube', new Date('2026-11-01T12:00:00Z')), '2026-11-02T08:00:00.000Z');
  assert.equal(governor.nextResetAt('youtube', new Date('2026-03-08T12:00:00Z')), '2026-03-09T07:00:00.000Z');
});

test('six uploads fit in the default 10,000 units and the seventh is refused with its reset time', () => {
  resetBudgets();
  for (let index = 0; index < 6; index += 1) assert.equal(governor.reserve('youtube', 'client-a').ok, true);
  const seventh = governor.reserve('youtube', 'client-a');
  assert.equal(seventh.ok, false);
  assert.match(seventh.reason, /Resets 00:00 PT/);
  assert.equal(seventh.nextEligibleAt, governor.nextResetAt('youtube'));
  // A different OAuth client is a different Google Cloud project and budget.
  assert.equal(governor.reserve('youtube', 'client-b').ok, true);
  assert.equal(governor.getBudget('youtube', 'client-a').uploadsRemaining, 0);
});

test('unbudgeted methods still get a receipt but reserve no units, even with the budget spent', async () => {
  resetBudgets();
  governor.markExhausted('youtube', 'client-a');
  const { job, step } = fakeJobStep();
  const fake = adapter();
  const { receipt } = await releaseUpload({ job, step, destinationId: 'youtube', adapter: fake, filePath: video, uploadMeta: {}, accountRef: 'client-a', budgeted: false });
  assert.equal(fake.calls.upload, 1);
  assert.equal(receipt.state, 'confirmed');
  assert.equal(receipt.units, 0);
});

test('a Studio daily-limit refusal before any file is sent defers the job and closes the receipt', async () => {
  resetBudgets();
  const { job, step } = fakeJobStep();
  const deferUntil = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  const limited = adapter({ upload: async () => { throw Object.assign(new Error('YouTube Studio (open_studio): daily upload limit'), { notSent: true, deferUntil }); } });
  await assert.rejects(
    releaseUpload({ job, step, destinationId: 'youtube', adapter: limited, filePath: video, uploadMeta: {}, budgeted: false }),
    (error) => error.code === governor.DEFERRED_CODE && error.nextEligibleAt === deferUntil,
  );
  assert.equal(receipts.findOpenReceipts(job.id, step.id).length, 0);
});

// ------------------------------------------------------------ receipt handshake

test('a successful upload writes claimed → sent → confirmed and reserves units', async () => {
  resetBudgets();
  const { job, step } = fakeJobStep();
  const fake = adapter();
  const { receipt, reused } = await releaseUpload({ job, step, destinationId: 'youtube', adapter: fake, filePath: video, uploadMeta: {}, accountRef: 'client-a', title: 'T' });
  assert.equal(reused, false);
  assert.equal(receipt.state, 'confirmed');
  assert.ok(receipt.sentAt);
  assert.equal(receipt.units, 1601);
  assert.match(receipt.contentHash, /^s256-sampled:/);
  assert.equal(governor.getBudget('youtube', 'client-a').usedUnits, 1601);
});

test('a spent budget defers without leaving a receipt or calling the destination', async () => {
  resetBudgets();
  governor.markExhausted('youtube', 'client-a');
  const { job, step } = fakeJobStep();
  const fake = adapter();
  await assert.rejects(
    releaseUpload({ job, step, destinationId: 'youtube', adapter: fake, filePath: video, uploadMeta: {}, accountRef: 'client-a' }),
    (error) => error.code === governor.DEFERRED_CODE && Boolean(error.nextEligibleAt),
  );
  assert.equal(fake.calls.upload, 0);
  assert.equal(receipts.findOpenReceipts(job.id, step.id).length, 0);
});

test('a crash after sending leaves a detectable sent receipt that the retry reconciles instead of re-uploading', async () => {
  resetBudgets();
  const { job, step } = fakeJobStep();
  const crashing = adapter({ upload: async () => { throw new Error('socket hang up'); } });
  await assert.rejects(releaseUpload({ job, step, destinationId: 'youtube', adapter: crashing, filePath: video, uploadMeta: {}, accountRef: 'client-a', title: 'Crash' }), /socket hang up/);
  const [open] = receipts.findOpenReceipts(job.id, step.id);
  assert.equal(open.state, 'sent');
  assert.equal(open.remoteId, '');

  const retry = adapter({ reconcile: async () => ({ found: true, remoteId: 'foundVideo123', url: 'https://www.youtube.com/watch?v=foundVideo123' }) });
  const { receipt, reused } = await releaseUpload({ job, step, destinationId: 'youtube', adapter: retry, filePath: video, uploadMeta: {}, accountRef: 'client-a', title: 'Crash' });
  assert.equal(reused, true);
  assert.equal(retry.calls.upload, 0, 'reconciled uploads must not be sent twice');
  assert.equal(receipt.state, 'confirmed');
  assert.equal(receipt.resolvedBy, 'reconcile');
  assert.equal(governor.getBudget('youtube', 'client-a').usedUnits, 1601 + 2);
});

test('a reconcile that finds nothing abandons the receipt and uploads fresh under a new key', async () => {
  const { job, step } = fakeJobStep();
  const crashing = adapter({ upload: async () => { throw new Error('killed'); } });
  await assert.rejects(releaseUpload({ job, step, destinationId: 'youtube', adapter: crashing, filePath: video, uploadMeta: {}, accountRef: 'client-c' }));
  const retry = adapter({ reconcile: async () => ({ found: false }) });
  const { receipt } = await releaseUpload({ job, step, destinationId: 'youtube', adapter: retry, filePath: video, uploadMeta: {}, accountRef: 'client-c' });
  assert.equal(retry.calls.upload, 1);
  assert.equal(receipt.state, 'confirmed');
  assert.match(receipt.idempotencyKey, /:r1$/);
  const states = db.prepare('SELECT state FROM upload_receipts WHERE job_id = ? ORDER BY id').all(job.id).map((row) => row.state);
  assert.deepEqual(states, ['abandoned', 'confirmed']);
});

test('an adapter that cannot reconcile sends the receipt to an operator, and operator resolution unblocks the retry', async () => {
  const { job, step } = fakeJobStep();
  const crashing = adapter({ upload: async () => { throw new Error('killed'); } });
  await assert.rejects(releaseUpload({ job, step, destinationId: 'youtube', adapter: crashing, filePath: video, uploadMeta: {}, accountRef: 'client-d' }));
  const blind = adapter({ reconcile: async () => null });
  await assert.rejects(
    releaseUpload({ job, step, destinationId: 'youtube', adapter: blind, filePath: video, uploadMeta: {}, accountRef: 'client-d' }),
    /Resolve it in Publish/,
  );
  assert.equal(blind.calls.upload, 0);

  const [open] = receipts.findOpenReceipts(job.id, step.id);
  assert.throws(() => service.resolveReceipt(open.id, { action: 'confirm', url: 'not a url' }));
  const resolved = service.resolveReceipt(open.id, { action: 'confirm', url: 'https://youtu.be/operatorVid1' });
  assert.equal(resolved.state, 'confirmed');
  assert.equal(resolved.remoteId, 'operatorVid1');
  assert.throws(() => service.resolveReceipt(open.id, { action: 'abandon' }), /already confirmed/);

  const { reused, result } = await releaseUpload({ job, step, destinationId: 'youtube', adapter: blind, filePath: video, uploadMeta: {}, accountRef: 'client-d' });
  assert.equal(reused, true);
  assert.equal(result.remoteId, 'operatorVid1');
  assert.equal(blind.calls.upload, 0);
});

test('a destination quota refusal fails the receipt, saturates the ledger and defers', async () => {
  resetBudgets();
  const { job, step } = fakeJobStep();
  const refusing = adapter({ upload: async () => { throw new Error('HttpError 403 "quotaExceeded"'); } });
  await assert.rejects(
    releaseUpload({ job, step, destinationId: 'youtube', adapter: refusing, filePath: video, uploadMeta: {}, accountRef: 'client-e' }),
    (error) => error.code === governor.DEFERRED_CODE,
  );
  const row = db.prepare('SELECT state FROM upload_receipts WHERE job_id = ?').get(job.id);
  assert.equal(row.state, 'failed');
  assert.equal(governor.getBudget('youtube', 'client-e').remainingUnits, 0);
});

test('an error the adapter marks notSent fails the receipt so the retry does not reconcile', async () => {
  resetBudgets();
  const { job, step } = fakeJobStep();
  const refusing = adapter({ upload: async () => { throw Object.assign(new Error('OAuth channel mismatch'), { notSent: true }); } });
  await assert.rejects(releaseUpload({ job, step, destinationId: 'youtube', adapter: refusing, filePath: video, uploadMeta: {}, accountRef: 'client-f' }));
  assert.equal(receipts.findOpenReceipts(job.id, step.id).length, 0);
});

test('reconcile output parsing ignores auth chatter and rejects malformed ids', () => {
  assert.deepEqual(
    youtube.parseReconcileOutput('Loading OAuth credentials from JSON...\n{"found": true, "videoId": "abcDEF12345", "candidates": 1}\n'),
    { found: true, remoteId: 'abcDEF12345', url: 'https://www.youtube.com/watch?v=abcDEF12345', candidates: 1 },
  );
  assert.equal(youtube.parseReconcileOutput('{"found": false, "candidates": 0}').found, false);
  assert.throws(() => youtube.parseReconcileOutput('{"found": true, "videoId": "../x"}'), /invalid video id/);
  assert.throws(() => youtube.parseReconcileOutput('Traceback'), /did not print/);
});

// ---------------------------------------------------------------- pipeline

function queueUploadJobWithSourceDone() {
  const created = pipeline.createJob({ sourceId: 'localFile', sourceInput: video, processorIds: [], uploaderId: 'youtube', title: 'Release test' });
  const source = db.prepare("SELECT id FROM video_job_steps WHERE job_id = ? AND step LIKE 'source:%'").get(created.id);
  db.prepare("UPDATE video_job_steps SET status = 'ok', progress = 100 WHERE id = ?").run(source.id);
  db.prepare("INSERT INTO video_assets (job_id, kind, file_path, meta_json, created_at) VALUES (?, 'original', ?, '{}', ?)")
    .run(created.id, video, new Date().toISOString());
  return created;
}

test('the 7th upload of the day DEFERS to the reset instead of failing, without spending an attempt', async () => {
  resetBudgets();
  db.prepare("UPDATE video_jobs SET status = 'done' WHERE status IN ('queued', 'running')").run();
  for (let index = 0; index < 6; index += 1) assert.equal(governor.reserve('youtube', 'release-test-only').ok, true);
  const created = queueUploadJobWithSourceDone();

  await pipeline.runNextQueuedJob();

  const job = db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(created.id);
  const upload = db.prepare("SELECT * FROM video_job_steps WHERE job_id = ? AND step = 'uploader:youtube'").get(created.id);
  assert.equal(job.status, 'queued');
  assert.equal(job.error, '');
  assert.equal(job.scheduled_for, governor.nextResetAt('youtube'));
  assert.equal(upload.status, 'pending');
  assert.equal(upload.attempt, 1);
  assert.equal(upload.next_eligible_at, governor.nextResetAt('youtube'));
  assert.match(upload.defer_reason, /Resets 00:00 PT/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM upload_receipts WHERE job_id = ?').get(created.id).n, 0);

  // The dispatcher does not pick it up again before the reset.
  assert.equal(await pipeline.runNextQueuedJob(), null);

  const queue = service.getReleaseOverview().queue.find((item) => item.jobId === created.id);
  assert.equal(queue.held, true);
  const [listed] = pipeline.listJobs({ status: 'queued' }).filter((item) => item.id === created.id);
  assert.ok(listed.steps.find((step) => step.step === 'uploader:youtube').nextEligibleAt);
});

test('a job whose upload was already confirmed finishes on retry without uploading again', async () => {
  resetBudgets();
  db.prepare("UPDATE video_jobs SET status = 'done' WHERE status IN ('queued', 'running')").run();
  const created = queueUploadJobWithSourceDone();
  const upload = db.prepare("SELECT * FROM video_job_steps WHERE job_id = ? AND step = 'uploader:youtube'").get(created.id);
  // Simulate a worker that died after step 5 (receipt confirmed) but before step 6.
  const claimed = receipts.claimReceipt({ jobId: created.id, stepId: upload.id, attempt: 1, destinationId: 'youtube', accountRef: 'release-test-only', title: 'Release test' });
  receipts.markSent(claimed.id);
  receipts.markConfirmed(claimed.id, { remoteId: 'alreadyUp123', url: 'https://www.youtube.com/watch?v=alreadyUp123' });

  await pipeline.runNextQueuedJob();

  const job = db.prepare('SELECT status FROM video_jobs WHERE id = ?').get(created.id);
  assert.equal(job.status, 'done');
  const publications = db.prepare('SELECT remote_id FROM video_publications WHERE job_id = ?').all(created.id);
  assert.deepEqual(publications.map((row) => row.remote_id), ['alreadyUp123']);
  assert.equal(governor.getBudget('youtube', 'release-test-only').usedUnits, 0, 'no units spent re-using a confirmed upload');
});
