import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import db from '../src/lib/db/sqlite.js';
import { ensureVideoRecord, recordPublication } from '../src/lib/operations/store.js';
import { queueLibraryUploads } from '../src/lib/operations/libraryUpload.js';
import { download } from '../src/lib/pipeline/sources/library.js';
import { cleanGeneratedMetadata } from '../src/lib/ai/editorial.js';
import { resolveUploadTitle } from '../src/lib/pipeline/uploaders/youtube.js';
import { studioOutcome } from '../src/lib/video/uploader.js';
import { saveYouTubePost, approveYouTubePost, claimYouTubePost, recordYouTubePost, getYouTubePost } from '../src/lib/youtube/posts.js';
import { executeOperation } from '../src/lib/agent/service.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-flow-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
function video(sourceType = 'bilibili') {
  const file = path.join(dir, `${randomUUID()}.mp4`); fs.writeFileSync(file, 'test');
  return ensureVideoRecord({ sourceType, sourcePath: file, title: 'Source title', metadata: { sourceDescription: 'A quiet rain recording.' } });
}

test('saved media queues on its existing record without a download and preserves source context', async () => {
  const saved = video('tiktok');
  const batch = queueLibraryUploads({ videoIds: [saved.id], reviewMetadata: false });
  const job = db.prepare('SELECT * FROM video_jobs WHERE id=?').get(batch.jobs[0].id);
  assert.equal(job.source_id, 'library'); assert.equal(job.video_record_id, saved.id);
  const options = JSON.parse(job.options_json);
  assert.equal(options.metadata.reviewMetadata, false);
  assert.equal(options.youtube.uploadMethod, 'studio');
  const source = await download({ videoId: saved.id });
  assert.equal(source.filePath, saved.sourcePath); assert.equal(source.meta.platform, 'tiktok');
  assert.equal(source.meta.sourceDescription, 'A quiet rain recording.');
  assert.throws(() => queueLibraryUploads({ videoIds: [saved.id] }), /active workflow/);
});

test('library batch rolls back fully if one item already has a delivery', () => {
  const a = video(); const b = video();
  recordPublication({ videoId: b.id, platformId: 'youtube', status: 'submitted', remoteId: 'abcdefghijkl' });
  const count = db.prepare('SELECT COUNT(*) AS n FROM video_jobs').get().n;
  assert.throws(() => queueLibraryUploads({ videoIds: [a.id, b.id] }), /already has/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_jobs').get().n, count);
});

test('generated metadata has no em dashes and reaches the upload title', () => {
  const meta = cleanGeneratedMetadata({ titleEn: 'Quiet rain — a slow evening', descriptionEn: 'Listen — settle in.', tags: ['rain—sounds', 'rain—sounds'] });
  assert.ok(!JSON.stringify(meta).includes('—'));
  assert.equal(meta.tags.length, 1);
  assert.equal(resolveUploadTitle('/tmp/a.mp4', { title: 'Original Chinese title', ...meta }), meta.titleEn);
  assert.equal(studioOutcome({ ok: true, url: 'https://youtu.be/AbCdEfGhIjK', deliveryStatus: 'submitted' }).deliveryStatus, 'submitted');
});

const channel = 'UC6hpd-_yLeKs-SZc4BzDzzQ';
test('GUI posts require approval, a versioned single claim, and a real post receipt', async () => {
  let post = saveYouTubePost({ channelId: channel, text: 'Quiet rain — what helps you unwind?' });
  assert.ok(!post.text.includes('—'));
  assert.throws(() => claimYouTubePost(post.id, post.updatedAt, 'agent'), /not approved/);
  assert.throws(() => approveYouTubePost(post.id, 'stale'), /changed/);
  post = approveYouTubePost(post.id, post.updatedAt);
  const input = { postId: post.id, ifMatch: post.updatedAt, idempotencyKey: randomUUID() };
  const claimed = await executeOperation('claim_youtube_post', input, 'agent');
  assert.equal(claimed.status, 'posting');
  assert.deepEqual(await executeOperation('claim_youtube_post', input, 'agent'), claimed);
  assert.throws(() => claimYouTubePost(post.id, claimed.updatedAt, 'other'), /not approved/);
  assert.throws(() => recordYouTubePost(post.id, claimed.updatedAt, { url: 'https://youtube.com/post/abc' }, 'other'), /does not hold/);
  assert.throws(() => recordYouTubePost(post.id, claimed.updatedAt, { url: 'https://evil.example/post/abc' }, 'agent'), /saved YouTube post/);
  const done = recordYouTubePost(post.id, claimed.updatedAt, { url: 'https://www.youtube.com/post/UgkxTest', screenshot: '/tmp/proof.png' }, 'agent');
  assert.equal(done.status, 'posted'); assert.equal(getYouTubePost(post.id).url, done.url);
});

test('SQL metadata and personality flow through MCP to review-gated GUI jobs', async () => {
  const saved = video();
  const first = await executeOperation('get_saved_upload', { videoId: saved.id }, 'agent');
  const args = { videoId: saved.id, ifMatch: first.updatedAt, title: 'Rain at the window', description: 'A quiet evening with rain.', tags: ['rain sounds'], personality: 'Warm, understated storyteller', context: 'Write for people winding down. Avoid hype.', idempotencyKey: randomUUID() };
  const edited = await executeOperation('save_upload_metadata', args, 'agent');
  assert.equal(edited.metadata.titleEn, args.title);
  assert.deepEqual(await executeOperation('save_upload_metadata', args, 'agent'), edited);
  const queued = await executeOperation('queue_saved_uploads', { videoIds: [saved.id], metadataMode: 'saved', idempotencyKey: randomUUID() }, 'agent');
  const job = db.prepare('SELECT * FROM video_jobs WHERE id=?').get(queued.batch.jobs[0].id);
  const options = JSON.parse(job.options_json);
  assert.equal(job.source_input, saved.id);
  assert.equal(job.agent_principal, 'agent');
  assert.equal(options.metadata.reviewMetadata, true);
  assert.equal(options.metadata.title, args.title);
  assert.equal(options.metadata.style, args.personality);
  assert.equal(options.metadata.copyPrompt, args.context);
  assert.deepEqual(options.metadata.generationFields, []);
  assert.equal(options.youtube.uploadMethod, 'studio');
});

test('canonical source URL blocks duplicate rows and atomic duplicate batches', () => {
  const a = video(); const b = video();
  db.prepare('UPDATE video_records SET source_url=? WHERE id=?').run('https://www.bilibili.com/video/BV1hP2qBMEij?vd_source=abc', a.id);
  db.prepare('UPDATE video_records SET source_url=? WHERE id=?').run('https://m.bilibili.com/video/BV1hP2qBMEij/?spm_id_from=333', b.id);
  assert.throws(() => queueLibraryUploads({ videoIds: [a.id, b.id] }), /same source/);
  recordPublication({ videoId: a.id, platformId: 'youtube', remoteId: 'abcdef12345', url: 'https://youtu.be/abcdef12345', status: 'submitted' });
  assert.throws(() => queueLibraryUploads({ videoIds: [b.id] }), /already.*uploaded/);
});

test('a later publication is detected again before worker delivery and saved edits reject stale versions', async () => {
  const { uploadBlocker, saveUploadMetadata } = await import('../src/lib/operations/uploadCatalog.js');
  const a = video(); const b = video();
  const url = 'https://www.bilibili.com/video/BV1Aa2Bb3Cc4';
  db.prepare('UPDATE video_records SET source_url=? WHERE id IN (?,?)').run(url, a.id, b.id);
  const first = db.prepare('SELECT updated_at FROM video_records WHERE id=?').get(a.id);
  const edit = { videoId: a.id, ifMatch: first.updated_at, title: 'Quiet rain', description: 'Rain beside the window.', tags: ['rain'] };
  saveUploadMetadata(edit);
  assert.throws(() => saveUploadMetadata(edit), /changed/);
  const batch = queueLibraryUploads({ videoIds: [a.id], metadataMode: 'saved' });
  recordPublication({ videoId: b.id, platformId: 'youtube', remoteId: 'LaterVideo1', url: 'https://youtu.be/LaterVideo1', status: 'submitted' });
  assert.equal(uploadBlocker(a.id, { excludeJobId: batch.jobs[0].id, includeActive: false }).url, 'https://youtu.be/LaterVideo1');
});
