import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-guards-'));
process.env.VIDEO_SQLITE_PATH = path.join(directory, 'guards.db');
delete process.env.YOUTUBE_CHANNEL_ID;
delete process.env.YOUTUBE_UPLOAD_METHOD;

const pipeline = await import('../src/lib/pipeline/pipeline.js');
const diagnostics = await import('../src/lib/pipeline/diagnostics.js');
const localFile = await import('../src/lib/pipeline/sources/localFile.js');
const youtubeUploader = await import('../src/lib/pipeline/uploaders/youtube.js');
const authorizations = await import('../src/lib/youtube/authorizations.js');

const realVideo = path.join(directory, 'input.mp4');
fs.writeFileSync(realVideo, 'not a real video, never executed');
const missingVideo = path.join(directory, 'nope.mp4');
const emptyVideo = path.join(directory, 'empty.mp4');
fs.writeFileSync(emptyVideo, '');

// testConnection resolves the client-secret file relative to process.cwd().
const CREDENTIAL_REF = 'guards-test-only';
const clientSecretPath = path.join(process.cwd(), `${CREDENTIAL_REF}_client_secret.json`);

test.after(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(clientSecretPath, { force: true });
});

// ---------------------------------------------------------------- local source

test('a local source path is validated when the job is queued, not when it runs', () => {
  assert.throws(
    () => pipeline.createJob({ sourceId: 'localFile', sourceInput: missingVideo, processorIds: [], uploaderId: '' }),
    /Local source file not found/,
  );
  assert.throws(
    () => pipeline.createJob({ sourceId: 'localFile', sourceInput: emptyVideo, processorIds: [], uploaderId: '' }),
    /empty/,
  );
  assert.throws(
    () => pipeline.createJob({ sourceId: 'localFile', sourceInput: 'relative/path.mp4', processorIds: [], uploaderId: '' }),
    /absolute path/,
  );

  const job = pipeline.createJob({ sourceId: 'localFile', sourceInput: realVideo, processorIds: [], uploaderId: '' });
  assert.equal(job.status, 'queued');
});

test('the local source check reports on the path the job will actually use', async () => {
  assert.equal((await localFile.testConnection({}, { sourceInput: realVideo })).ok, true);

  const missing = await localFile.testConnection({}, { sourceInput: missingVideo });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not found/);

  // With no path in context it still answers for the adapter itself.
  assert.equal((await localFile.testConnection({}, {})).ok, true);
});

// ------------------------------------------------------------- youtube upload

test('the YouTube uploader is not "ready" while no account is authorized', async () => {
  const result = await youtubeUploader.testConnection({}, {});
  assert.equal(result.ok, false, 'a missing credential must not report ready');
  assert.match(result.error, /No authorized YouTube account/);
});

test('a YouTube job cannot be queued until an explicit channel is selected', () => {
  assert.throws(
    () => pipeline.createJob({
      sourceId: 'localFile', sourceInput: realVideo, processorIds: [], uploaderId: 'youtube',
    }),
    /Choose an authorized YouTube channel/,
  );
});

test('the run preflight refuses the chain instead of reporting it ready', async () => {
  const preflight = await diagnostics.runPreflight({
    sourceId: 'localFile',
    sourceInput: realVideo,
    processorIds: ['sceneCut'],
    uploaderId: 'youtube',
  });
  assert.equal(preflight.ready, false, 'preflight must not green-light an impossible upload');
  const uploaderRow = preflight.steps.find((step) => step.id === 'youtube');
  assert.equal(uploaderRow.status, 'fail');
  assert.match(uploaderRow.detail, /No authorized YouTube account/);
});

test('an authorized job binds only to the channel explicitly selected for it', async () => {
  fs.writeFileSync(clientSecretPath, JSON.stringify({ installed: { client_id: 'test-only' } }));
  const authorization = authorizations.registerYouTubeAuthorization({
    emailAddress: 'operator@example.com',
    channelId: 'UC_guards_channel_01',
    channelTitle: 'Guards Test Channel',
    credentialRef: CREDENTIAL_REF,
  });

  const ready = await youtubeUploader.testConnection({}, { authorizationId: authorization.id });
  assert.equal(ready.ok, true);
  assert.match(ready.detail, /Guards Test Channel/);

  const job = pipeline.createJob({
    sourceId: 'localFile', sourceInput: realVideo, processorIds: [], uploaderId: 'youtube', youtubeAuthorizationId: authorization.id,
  });
  const bound = authorizations.getJobYouTubeAuthorization(job.id, { requireUsable: true });
  assert.equal(bound.id, authorization.id, 'the single authorized account should be bound to the job');
});

test('a queued workflow can be edited before any step begins without changing channel lineage', () => {
  const authorization = authorizations.listYouTubeAuthorizations()[0];
  const job = pipeline.createJob({
    sourceId: 'localFile', sourceInput: realVideo, processorIds: [], uploaderId: 'youtube',
    youtubeAuthorizationId: authorization.id, scheduledFor: '2099-01-01T00:00:00.000Z',
  });
  const updated = pipeline.updateQueuedJob(job.id, {
    processorIds: ['sceneCut'], uploaderId: 'youtube', youtubeAuthorizationId: authorization.id,
    priority: 12, scheduledFor: '2099-01-02T00:00:00.000Z',
  });
  assert.equal(updated.status, 'queued');
  const stored = pipeline.listJobs({ limit: 100 }).find((item) => item.id === job.id);
  assert.deepEqual(stored.processorIds, ['sceneCut']);
  assert.equal(stored.priority, 12);
  assert.equal(stored.youtubeAuthorization.id, authorization.id);
});

test('a missing client-secret file is reported rather than assumed present', async () => {
  const authorization = authorizations.listYouTubeAuthorizations()[0];
  fs.rmSync(clientSecretPath, { force: true });
  const result = await youtubeUploader.testConnection({}, { authorizationId: authorization.id });
  assert.equal(result.ok, false);
  assert.match(result.error, /client_secret\.json/);
  fs.writeFileSync(clientSecretPath, JSON.stringify({ installed: { client_id: 'test-only' } }));
});

// -------------------------------------------------------------------- cancel

test('cancel reports the status a job actually has', () => {
  const job = pipeline.createJob({ sourceId: 'localFile', sourceInput: realVideo, processorIds: [], uploaderId: '' });

  const first = pipeline.cancelJob(job.id);
  assert.equal(first.status, 'canceled');
  assert.notEqual(first.alreadyFinished, true);

  // Cancelling again must not claim a transition is in progress.
  const second = pipeline.cancelJob(job.id);
  assert.equal(second.status, 'canceled', 'a finished job must not report "canceling"');
  assert.equal(second.alreadyFinished, true);
});

// --------------------------------------------------------------- diagnostics

test('a diagnostics check that throws is attributed to that check', async () => {
  const checks = await diagnostics.runDiagnostics();
  const anonymous = checks.filter((check) => check.id === 'unknown');
  assert.deepEqual(anonymous, [], 'no check may report itself as "unknown"');
  for (const check of checks) {
    assert.ok(check.id && check.label, 'every row must name the check it came from');
    assert.ok(['ok', 'warn', 'fail'].includes(check.status));
  }
});

// ------------------------------------------------------- bilibili at queue time

test('a Bilibili job is refused at queue time when the URL is not Bilibili', () => {
  for (const bad of ['https://evil.example.com/x', 'http://127.0.0.1:8899/steal', '../../etc/passwd', 'not-a-video']) {
    assert.throws(
      () => pipeline.createJob({ sourceId: 'bilibili', sourceInput: bad, processorIds: [], uploaderId: '' }),
      /not a Bilibili host|Not a Bilibili video/,
      `"${bad}" must be refused before the job is stored`,
    );
  }

  // Valid inputs still queue: a video id, a canonical URL, and a space page.
  for (const good of [
    'BV1xx411c7mD',
    'https://www.bilibili.com/video/BV1xx411c7mD',
    'https://space.bilibili.com/123456',
  ]) {
    const job = pipeline.createJob({ sourceId: 'bilibili', sourceInput: good, processorIds: [], uploaderId: '' });
    assert.equal(job.status, 'queued', `"${good}" should queue`);
    pipeline.cancelJob(job.id);
  }
});
