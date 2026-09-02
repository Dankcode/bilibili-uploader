import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'media-retention-'));
const previousDatabasePath = process.env.VIDEO_SQLITE_PATH;
const previousWorkDirectory = process.env.VIDEO_WORK_DIR;
process.env.VIDEO_SQLITE_PATH = path.join(directory, 'retention.db');
process.env.VIDEO_WORK_DIR = path.join(directory, 'video-work');

const [{ default: db, closeDB }, retention] = await Promise.all([
  import('../src/lib/db/sqlite.js'),
  import('../src/lib/operations/mediaRetention.js'),
]);

test.after(() => {
  closeDB();
  if (previousDatabasePath === undefined) delete process.env.VIDEO_SQLITE_PATH;
  else process.env.VIDEO_SQLITE_PATH = previousDatabasePath;
  if (previousWorkDirectory === undefined) delete process.env.VIDEO_WORK_DIR;
  else process.env.VIDEO_WORK_DIR = previousWorkDirectory;
  fs.rmSync(directory, { recursive: true, force: true });
});

test('retention lists and removes only aged terminal media under video-work', () => {
  const root = process.env.VIDEO_WORK_DIR;
  const filePath = path.join(root, '1', 'final', 'old.mp4');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'test media');
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  fs.utimesSync(filePath, old, old);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO video_jobs (source_id, source_input, status, created_at, updated_at) VALUES ('localFile', ?, 'done', ?, ?)`)
    .run(filePath, now, now);
  const jobId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  db.prepare(`INSERT INTO video_assets (job_id, kind, file_path, meta_json, created_at) VALUES (?, 'original', ?, '{}', ?)`)
    .run(jobId, filePath, now);
  const assetId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

  const preview = retention.listLocalMediaRetentionCandidates({ retentionDays: 7 });
  assert.equal(preview.candidates.length, 1);
  assert.equal(preview.candidates[0].assetId, assetId);
  assert.equal(preview.candidates[0].reason, 'no uploader channel');

  const result = retention.deleteLocalMediaRetentionCandidates([assetId]);
  assert.equal(result.deleted.length, 1);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(retention.listLocalMediaRetentionCandidates({ retentionDays: 7 }).candidates.length, 0);
});
