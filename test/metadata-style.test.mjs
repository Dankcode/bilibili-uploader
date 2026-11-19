import assert from 'node:assert/strict';
import test from 'node:test';
import db from '../src/lib/db/sqlite.js';
import { saveScrapedBilibiliVideos } from '../src/lib/video/scrapedCatalog.js';
import { createJob } from '../src/lib/pipeline/pipeline.js';
import { DEFAULT_METADATA_STYLE, applyMetadataStyleToVideo, getMetadataStyle, saveMetadataStyle } from '../src/lib/operations/metadataStyle.js';
import { executeOperation } from '../src/lib/agent/service.js';

const creator = '777';
const bvid = 'BV1style0001';

test('the metadata style starts as a suggestion and is saved, read and size-limited', () => {
  db.prepare("DELETE FROM app_settings WHERE key = 'metadata.style'").run();
  assert.deepEqual(getMetadataStyle(), { prompt: DEFAULT_METADATA_STYLE, updatedAt: '', isDefault: true });
  const saved = saveMetadataStyle('Title: "<Theme> ASMR: <hook>"\nDescription: one sentence, then the source link.');
  assert.equal(getMetadataStyle().prompt, saved.prompt);
  assert.equal(getMetadataStyle().isDefault, false);
  assert.throws(() => saveMetadataStyle('x'.repeat(6001)), /limited to 6000/);
});

test('every AI metadata generation carries the saved style', async () => {
  saveMetadataStyle('HOUSE-FORMAT-MARKER: titles start with "Delta Force ASMR:"');
  let prompt = '';
  const result = await applyMetadataStyleToVideo({
    creatorId: creator, bvid: 'BV0000000000', generate: async (input) => { prompt = input; throw new Error('stop'); },
  }).catch((error) => error);
  assert.match(result.message, /not found|stop/);
  saveScrapedBilibiliVideos(creator, [{ bvid, name: '［叽歪助眠］小蝶的背包', description: '含轻语', durationSeconds: 300 }]);
  db.prepare('UPDATE bilibili_scraped_videos SET delivery_title = ?, delivery_description = ?, delivery_tags_json = ? WHERE bvid = ?')
    .run("Vlinder's backpack", 'Old text.\n\nOriginal video (Bilibili): https://www.bilibili.com/video/' + bvid, JSON.stringify(['ASMR']), bvid);
  await applyMetadataStyleToVideo({ creatorId: creator, bvid, generate: async (input) => { prompt = input; throw new Error('stop'); } }).catch(() => {});
  assert.match(prompt.houseStyle, /HOUSE-FORMAT-MARKER/);
  assert.match(prompt.referenceMaterial, /Current English description:\nOld text\./);
  assert.match(prompt.referenceMaterial, /Bilibili link: https:\/\/www\.bilibili\.com\/video\/BV1style0001/);
  assert.deepEqual(prompt.generateFields, ['title', 'description', 'tags']);
});

test('applying the style rewrites the saved row and queued jobs that have not published', async () => {
  const job = createJob({ sourceId: 'bilibili', sourceInput: `https://www.bilibili.com/video/${bvid}`, processorIds: ['metadata'], uploaderId: '', options: { metadata: { title: 'Old', description: 'Old', tags: ['old'], generationFields: { title: true } } } });
  db.prepare("INSERT INTO video_assets (job_id, kind, file_path, meta_json, created_at) VALUES (?, 'metadata', '', ?, ?)").run(job.id, JSON.stringify({ titleEn: 'Old', descriptionEn: 'Old', tags: ['old'] }), new Date().toISOString());
  const after = { titleEn: "Delta Force ASMR: Vlinder's Backpack", descriptionEn: 'Vlinder looks through a backpack.\n\nOriginal video (Bilibili): https://www.bilibili.com/video/BV1style0001', tags: ['ASMR', 'Delta Force ASMR', 'Vlinder'] };
  const result = await applyMetadataStyleToVideo({ creatorId: creator, bvid, generate: async () => ({ metadata: after, provider: 'stub', model: 'stub' }) });
  assert.equal(result.after.title, after.titleEn);
  assert.equal(result.jobsUpdated, 1);
  const row = db.prepare('SELECT * FROM bilibili_scraped_videos WHERE bvid = ?').get(bvid);
  assert.equal(row.delivery_title, after.titleEn);
  assert.deepEqual(JSON.parse(row.delivery_tags_json), after.tags);
  const options = JSON.parse(db.prepare('SELECT options_json FROM video_jobs WHERE id = ?').get(job.id).options_json);
  assert.equal(options.metadata.description, after.descriptionEn);
  assert.deepEqual(options.metadata.generationFields, [], 'the rewritten text is used as written by the metadata step');
  const asset = JSON.parse(db.prepare("SELECT meta_json FROM video_assets WHERE job_id = ? AND kind = 'metadata'").get(job.id).meta_json);
  assert.equal(asset.titleEn, after.titleEn);
});

test('agents can read and save the style over MCP', async () => {
  const saved = await executeOperation('save_metadata_style', { prompt: 'Agent format', idempotencyKey: 'style-1' }, 'agent:test');
  assert.equal(saved.style.prompt, 'Agent format');
  assert.equal((await executeOperation('get_metadata_style', {}, 'agent:test')).style.prompt, 'Agent format');
});
