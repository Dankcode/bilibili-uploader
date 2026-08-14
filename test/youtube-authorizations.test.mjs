import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

await import('../scripts/register_loader.mjs');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-authorizations-'));
const previousDatabasePath = process.env.VIDEO_SQLITE_PATH;
process.env.VIDEO_SQLITE_PATH = path.join(directory, 'operations.db');

const authorizationStore = await import('../src/lib/youtube/authorizations.js');
const pipeline = await import('../src/lib/pipeline/pipeline.js');
const operationsStore = await import('../src/lib/operations/store.js');
const databaseModule = await import('../src/lib/db/sqlite.js');
const youtubeAdapter = await import('../src/lib/pipeline/uploaders/youtube.js');
const videoUploader = await import('../src/lib/video/uploader.js');

test.after(() => {
  databaseModule.closeDB();
  if (previousDatabasePath === undefined) delete process.env.VIDEO_SQLITE_PATH;
  else process.env.VIDEO_SQLITE_PATH = previousDatabasePath;
  fs.rmSync(directory, { recursive: true, force: true });
});

test('registers only non-secret OAuth references and rejects account credentials', () => {
  const authorization = authorizationStore.registerYouTubeAuthorization({
    emailAddress: 'Owner@Example.com',
    channelId: 'UC_test_channel_001',
    channelTitle: 'Test channel',
    credentialRef: 'youtube-test',
  });

  assert.equal(authorization.emailAddress, 'owner@example.com');
  assert.equal(authorization.channelId, 'UC_test_channel_001');
  assert.equal(authorization.credentialConfigured, true);
  assert.equal('credentialRef' in authorization, false);
  assert.throws(
    () => authorizationStore.registerYouTubeAuthorization({
      emailAddress: 'another@example.com',
      channelId: 'UC_test_channel_002',
      credentialRef: 'youtube-test-2',
      password: 'must-not-be-stored',
    }),
    /Passwords, cookies, SMS codes, and OAuth tokens are not accepted/,
  );
  assert.throws(
    () => authorizationStore.normalizeCredentialRef('../token'),
    /without paths/,
  );
});

test('immutably links a queued job, authorized account, publication, and video', () => {
  const authorization = authorizationStore.listYouTubeAuthorizations()[0];
  const job = pipeline.createJob({
    sourceId: 'localFile',
    sourceInput: '/tmp/not-executed-fixture.mp4',
    uploaderId: 'youtube',
    title: 'Authorization lineage fixture',
    options: {
      youtube: {
        authorizationId: authorization.id,
        privacyStatus: 'private',
      },
    },
  });
  const bound = authorizationStore.getJobYouTubeAuthorization(job.id, { requireUsable: true });
  assert.equal(bound.id, authorization.id);
  assert.equal(bound.credentialRef, 'youtube-test');

  const publicationId = operationsStore.recordPublication({
    videoId: job.videoRecordId,
    jobId: job.id,
    platformId: 'youtube',
    channelId: bound.channelId,
    remoteId: 'abcdefghijk',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    status: 'published',
  });
  authorizationStore.attachPublicationToYouTubeBinding(job.id, publicationId);

  const lineage = databaseModule.default.prepare(`
    SELECT vr.id AS video_id, vp.id AS publication_id, ya.id AS authorization_id,
           ya.email_address, ya.channel_id
    FROM youtube_upload_bindings yub
    JOIN video_jobs vj ON vj.id = yub.job_id
    JOIN video_records vr ON vr.id = vj.video_record_id
    JOIN video_publications vp ON vp.id = yub.publication_id
    JOIN youtube_authorizations ya ON ya.id = yub.authorization_id
    WHERE yub.job_id = ?
  `).get(job.id);
  assert.deepEqual(lineage, {
    video_id: job.videoRecordId,
    publication_id: publicationId,
    authorization_id: authorization.id,
    email_address: 'owner@example.com',
    channel_id: 'UC_test_channel_001',
  });
  assert.equal(authorizationStore.listYouTubeAuthorizations()[0].publicationCount, 1);

  const second = authorizationStore.registerYouTubeAuthorization({
    emailAddress: 'second@example.com',
    channelId: 'UC_test_channel_002',
    credentialRef: 'youtube-test-2',
  });
  assert.throws(
    () => authorizationStore.bindJobToYouTubeAuthorization(job.id, second.id),
    /cannot be rebound/,
  );
});

test('disabled authorizations cannot be selected for new jobs', () => {
  const authorization = authorizationStore.listYouTubeAuthorizations()
    .find((item) => item.emailAddress === 'second@example.com');
  authorizationStore.updateYouTubeAuthorization(authorization.id, { enabled: false });
  assert.throws(
    () => pipeline.createJob({
      sourceId: 'localFile',
      sourceInput: '/tmp/not-executed-disabled.mp4',
      uploaderId: 'youtube',
      options: { youtube: { authorizationId: authorization.id } },
    }),
    /not usable/,
  );
});

test('normalizes YouTube IDs and rejects path-shaped credential selectors', () => {
  assert.deepEqual(youtubeAdapter.normalizeYouTubeUploadResult('abcdefghijk'), {
    remoteId: 'abcdefghijk',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
  });
  assert.deepEqual(youtubeAdapter.normalizeYouTubeUploadResult('https://youtu.be/abcdefghijk'), {
    remoteId: 'abcdefghijk',
    url: 'https://youtu.be/abcdefghijk',
  });
  assert.equal(videoUploader.normalizeYouTubeCredentialRef('youtube-test'), 'youtube-test');
  assert.throws(() => videoUploader.normalizeYouTubeCredentialRef('../../secret'), /without paths/);
});
