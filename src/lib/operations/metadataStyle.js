// The saved metadata style: one prompt (a small "skill") that every AI-written
// title, description and tag list follows, editable from the Automation
// catalog's "Metadata style" menu. Applying it rewrites the saved English
// metadata of each listed video, and of its queued jobs that have not
// uploaded yet, so the whole list ends up in one consistent format.
import db from '../db/sqlite.js';
import { getAppSetting, setAppSetting } from '../pipeline/presets.js';
import { generateMetadataDraft } from '../pipeline/processors/metadata.js';

export const METADATA_STYLE_KEY = 'metadata.style';
export const MAX_STYLE_LENGTH = 6000;

export const DEFAULT_METADATA_STYLE = `Title
- "<Theme> ASMR: <what happens, in plain English>", under 70 characters when possible (100 max).
- Natural English only: no Chinese, no emoji, no clickbait capitals. Use the glossary names (e.g. 小蝶/蝶 = Vlinder, 阿萨拉 = Ahsarah, 大红 = red-tier loot).
- Multi-part videos end with "(Part 1)", "(Part 2)".

Description (in this order, separated by one blank line)
1. One or two short sentences: what the viewer hears and sees (triggers, roleplay), warm and calm.
2. "On-screen text has been translated into English." (keep when the video has translated on-screen text)
3. "Original video (Bilibili): <source link>" — keep the exact link already in the description.
4. The creator credit / fan-made disclaimer paragraph already in the description, unchanged.

Tags
- 8 to 12 tags: the creator's base tags first (e.g. ASMR, <Theme> ASMR, character, character ASMR, creator name, <Theme>, sleep ASMR, roleplay ASMR), then 2 to 4 specific triggers from this video.`;

export function getMetadataStyle() {
  const saved = getAppSetting(METADATA_STYLE_KEY, null);
  return {
    prompt: typeof saved?.prompt === 'string' ? saved.prompt : DEFAULT_METADATA_STYLE,
    updatedAt: saved?.updatedAt || '',
    isDefault: !saved,
  };
}

export function saveMetadataStyle(prompt) {
  const text = String(prompt ?? '').replace(/\r/g, '').trim();
  if (text.length > MAX_STYLE_LENGTH) throw Object.assign(new Error(`The metadata style is limited to ${MAX_STYLE_LENGTH} characters.`), { status: 400 });
  const value = { prompt: text, updatedAt: new Date().toISOString() };
  setAppSetting(METADATA_STYLE_KEY, value);
  return { ...value, isDefault: false };
}

function parse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Rewrite one saved video's title, description and tags in the saved style.
 * The current English metadata is passed as reference so facts, links and
 * the disclaimer survive; only the format changes. Queued jobs for the same
 * source that have not uploaded yet get the new text too.
 */
export async function applyMetadataStyleToVideo({ creatorId, bvid, prompt, provider, generate = generateMetadataDraft } = {}) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(String(bvid || ''))) throw Object.assign(new Error('A valid Bilibili BV ID is required'), { status: 400 });
  const row = db.prepare('SELECT * FROM bilibili_scraped_videos WHERE creator_id = ? AND bvid = ?').get(String(creatorId || ''), String(bvid));
  if (!row) throw Object.assign(new Error('Saved Bilibili video was not found'), { status: 404 });
  const style = prompt === undefined ? getMetadataStyle().prompt : String(prompt || '').trim();
  const current = { title: row.delivery_title || '', description: row.delivery_description || '', tags: parse(row.delivery_tags_json, []) };
  const sourceUrl = row.source_url || `https://www.bilibili.com/video/${row.bvid}`;
  const reference = [
    `Bilibili title: ${row.source_title || ''}`,
    row.source_description ? `Bilibili description: ${row.source_description}` : '',
    `Bilibili link: ${sourceUrl}`,
    current.title ? `Current English title: ${current.title}` : '',
    current.description ? `Current English description:\n${current.description}` : '',
    current.tags.length ? `Current tags: ${current.tags.join(', ')}` : '',
  ].filter(Boolean).join('\n\n');
  const result = await generate({
    sourceTitle: row.source_title || current.title,
    referenceMaterial: reference,
    houseStyle: style,
    copyPrompt: [row.copy_prompt, 'Rewrite the current English metadata in the house style. Keep its facts, the source link and the disclaimer; change the format, not the meaning.'].filter(Boolean).join('\n'),
    generateFields: ['title', 'description', 'tags'],
    existingMetadata: current,
    provider,
  });
  const next = { title: result.metadata.titleEn, description: result.metadata.descriptionEn, tags: result.metadata.tags };
  const now = new Date().toISOString();
  const jobsUpdated = db.transaction(() => {
    db.prepare(`
      UPDATE bilibili_scraped_videos
      SET delivery_title = ?, delivery_description = ?, delivery_tags_json = ?, generation_fields_json = ?, updated_at = ?
      WHERE creator_id = ? AND bvid = ?
    `).run(next.title, next.description, JSON.stringify(next.tags), JSON.stringify({ title: false, description: false, tags: false }), now, row.creator_id, row.bvid);
    // Queued or paused jobs that have not published: carry the new text into
    // their metadata options and any metadata asset waiting to be uploaded.
    let count = 0;
    const jobs = db.prepare(`
      SELECT j.* FROM video_jobs j
      WHERE j.status IN ('queued', 'review', 'failed') AND j.source_input LIKE ?
        AND NOT EXISTS (SELECT 1 FROM video_publications p WHERE p.job_id = j.id)
    `).all(`%${row.bvid}%`);
    for (const job of jobs) {
      const options = parse(job.options_json, {});
      options.metadata = { ...(options.metadata || {}), title: next.title, description: next.description, tags: next.tags, generationFields: [] };
      db.prepare('UPDATE video_jobs SET options_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(options), now, job.id);
      const asset = db.prepare("SELECT id, meta_json FROM video_assets WHERE job_id = ? AND kind = 'metadata' ORDER BY id DESC LIMIT 1").get(job.id);
      if (asset) db.prepare('UPDATE video_assets SET meta_json = ? WHERE id = ?').run(JSON.stringify({ ...parse(asset.meta_json, {}), titleEn: next.title, descriptionEn: next.description, tags: next.tags, metadataStyleAppliedAt: now }), asset.id);
      if (job.video_record_id) {
        const record = db.prepare('SELECT metadata_json FROM video_records WHERE id = ?').get(job.video_record_id);
        const metadata = parse(record?.metadata_json, {});
        metadata.uploadMetadata = { titleEn: next.title, descriptionEn: next.description, tags: next.tags };
        db.prepare('UPDATE video_records SET metadata_json = ?, title = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(metadata), next.title, now, job.video_record_id);
      }
      count += 1;
    }
    return count;
  })();
  return { creatorId: row.creator_id, bvid: row.bvid, before: current, after: next, provider: result.provider, model: result.model, jobsUpdated };
}
