import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scraped-planning-'));
const previousDatabasePath = process.env.VIDEO_SQLITE_PATH;
process.env.VIDEO_SQLITE_PATH = path.join(directory, 'catalog.db');

const catalog = await import('../src/lib/video/scrapedCatalog.js');
const database = await import('../src/lib/db/sqlite.js');
const operations = await import('../src/lib/operations/store.js');

test.after(() => {
  database.closeDB();
  if (previousDatabasePath === undefined) delete process.env.VIDEO_SQLITE_PATH;
  else process.env.VIDEO_SQLITE_PATH = previousDatabasePath;
  fs.rmSync(directory, { recursive: true, force: true });
});

test('persists per-video scheduling and AI copy instructions without changing scraped facts', () => {
  catalog.saveScrapedBilibiliVideos('123456', [{
    bvid: 'BV1xx411c7mD', title: 'Original source title', description: 'Original source description',
    durationSeconds: 61, uploadedAt: '2026-09-01T00:00:00.000Z',
  }]);
  const video = catalog.updateScrapedBilibiliVideo({
    creatorId: '123456', bvid: 'BV1xx411c7mD', selected: true,
    scheduledFor: '2026-09-08T09:00:00+08:00', scheduleDays: [5, 1, 1],
    copyPrompt: 'Write for curious Xiaoyu viewers; make tags automatic.',
    tags: ['calm', 'ASMR', 'calm'],
    generationFields: { title: false, description: true, tags: true },
    youtubeOptions: { privacyStatus: 'private', defaultLanguage: 'en', ignored: 'not stored' },
  });

  assert.equal(video.sourceTitle, 'Original source title');
  assert.equal(video.scheduledFor, '2026-09-08T01:00:00.000Z');
  assert.deepEqual(video.scheduleDays, [1, 5]);
  assert.match(video.copyPrompt, /Xiaoyu/);
  assert.deepEqual(video.tags, ['calm', 'ASMR']);
  assert.deepEqual(video.generationFields, { title: false, description: true, tags: true });
  assert.deepEqual(video.youtubeOptions, { privacyStatus: 'private', defaultLanguage: 'en' });
});

test('rejects invalid scheduling inputs', () => {
  assert.throws(() => catalog.updateScrapedBilibiliVideo({
    creatorId: '123456', bvid: 'BV1xx411c7mD', scheduledFor: 'not a date',
  }), /valid date/);
  assert.throws(() => catalog.updateScrapedBilibiliVideo({
    creatorId: '123456', bvid: 'BV1xx411c7mD', scheduleDays: ['Thursday'],
  }), /weekday numbers/);
});

test('requires an explicit long-video opt-in before a scraped source can be selected', () => {
  const creatorId = '112233';
  const bvid = 'BV1yy411c7mD';
  const [video] = catalog.saveScrapedBilibiliVideos(creatorId, [{
    bvid, title: 'Long source', durationSeconds: 15 * 60 + 1,
  }]);

  assert.equal(video.isLongVideo, true);
  assert.equal(video.longVideoEnabled, false);
  assert.equal(video.selected, false);

  const enabled = catalog.updateScrapedBilibiliVideo({ creatorId, bvid, longVideoEnabled: true, selected: true });
  assert.equal(enabled.longVideoEnabled, true);
  assert.equal(enabled.selected, true);

  const disabled = catalog.updateScrapedBilibiliVideo({ creatorId, bvid, longVideoEnabled: false, selected: true });
  assert.equal(disabled.longVideoEnabled, false);
  assert.equal(disabled.selected, false);
});

test('compares scraped BV IDs with SQL delivery history and omits uploaded videos by default', () => {
  const creatorId = '654321';
  const uploadedBvid = 'BV1aa411c7mD';
  const completedBvid = 'BV1bb411c7mD';
  const queuedBvid = 'BV1cc411c7mD';
  catalog.saveScrapedBilibiliVideos(creatorId, [
    { bvid: uploadedBvid, title: 'Already uploaded', uploadedAt: '2026-09-01T00:00:00.000Z' },
    { bvid: completedBvid, title: 'Completed locally' },
    { bvid: queuedBvid, title: 'Queued source' },
  ]);

  const uploaded = operations.ensureVideoRecord({
    id: 'uploaded-source', title: 'Uploaded source', sourceType: 'bilibili',
    sourceRef: `https://www.bilibili.com/video/${uploadedBvid}`, status: 'completed',
  });
  operations.recordPublication({
    videoId: uploaded.id, platformId: 'youtube', status: 'published',
    url: 'https://www.youtube.com/watch?v=already-uploaded', remoteId: 'alreadyupload',
  });
  operations.ensureVideoRecord({
    id: 'completed-source', title: 'Completed source', sourceType: 'bilibili',
    sourceRef: `https://www.bilibili.com/video/${completedBvid}`, status: 'completed',
  });
  operations.ensureVideoRecord({
    id: 'queued-source', title: 'Queued source', sourceType: 'bilibili',
    sourceRef: `https://www.bilibili.com/video/${queuedBvid}`, status: 'queued',
  });

  const current = catalog.listScrapedBilibiliVideos({ creatorId });
  assert.equal(current.loadedCount, 3);
  assert.equal(current.hiddenUploaded, 1);
  assert.equal(current.videos.some((video) => video.bvid === uploadedBvid), false);
  assert.equal(current.videos.find((video) => video.bvid === completedBvid)?.deliveryState, 'completed');
  assert.equal(current.videos.find((video) => video.bvid === queuedBvid)?.deliveryState, 'queued');

  const all = catalog.listScrapedBilibiliVideos({ creatorId, includeUploaded: true });
  const uploadedRow = all.videos.find((video) => video.bvid === uploadedBvid);
  assert.equal(uploadedRow?.deliveryState, 'uploaded');
  assert.equal(uploadedRow?.isUploaded, true);
  assert.equal(uploadedRow?.uploadedAt, '2026-09-01T00:00:00.000Z');
  assert.ok(uploadedRow?.deliveryUploadedAt);
  assert.equal(uploadedRow?.uploadedUrl, 'https://www.youtube.com/watch?v=already-uploaded');
});
