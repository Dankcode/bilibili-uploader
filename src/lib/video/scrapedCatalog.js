import db from '../db/sqlite.js';
import { generateMetadataDraft, normalizeGenerationFields } from '../pipeline/processors/metadata.js';

const YOUTUBE_UNVERIFIED_DURATION_SECONDS = 15 * 60;

function nowIso() { return new Date().toISOString(); }
function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function normalizeScheduleDays(value) {
  if (value === undefined) return undefined;
  const items = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(items)) throw new Error('Schedule days must be an array of weekday numbers');
  const normalized = items.map(Number);
  if (normalized.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error('Schedule days must contain weekday numbers from 0 to 6');
  }
  return [...new Set(normalized)].sort();
}

function normalizeScheduledFor(value) {
  if (value === undefined) return undefined;
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Scheduled upload date must be a valid date and time');
  return date.toISOString();
}

function normalizeYouTubeOptions(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('YouTube options must be an object');
  const allowed = ['privacyStatus', 'categoryId', 'defaultLanguage', 'license', 'madeForKids', 'embeddable', 'notifySubscribers'];
  return Object.fromEntries(Object.entries(value).filter(([key]) => allowed.includes(key)));
}

function normalizeTags(value) {
  if (value === undefined) return undefined;
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  return [...new Set(source.map((tag) => clean(tag, 80)).filter(Boolean))].slice(0, 20);
}

function normalizeGenerationFieldMap(value) {
  if (value === undefined) return undefined;
  const selected = new Set(normalizeGenerationFields(value));
  return Object.fromEntries(['title', 'description', 'tags'].map((field) => [field, selected.has(field)]));
}

function normalizeProvider(value) {
  if (value === undefined || value === '') return undefined;
  const provider = clean(value, 40).toLowerCase();
  if (!['codex', 'kimi', 'gemini'].includes(provider)) throw new Error('AI provider must be codex, kimi, or gemini');
  return provider;
}

function creatorId(value) {
  const id = clean(value, 20);
  if (!/^\d{1,20}$/.test(id)) throw new Error('A numeric Bilibili creator ID is required');
  return id;
}

function bvidFromVideo(video) {
  const direct = clean(video?.bvid, 20);
  if (/^BV[0-9A-Za-z]{10}$/.test(direct)) return direct;
  const match = clean(video?.link || video?.url, 4000).match(/\/video\/(BV[0-9A-Za-z]{10})/);
  if (!match) throw new Error('Scraped Bilibili video is missing a valid BV ID');
  return match[1];
}

const DELIVERY_STATE_RANK = {
  uploaded: 6, completed: 5, processing: 4, review: 4, queued: 3,
  scheduled: 3, failed: 2, canceled: 2, draft: 1, available: 0,
};

function bvidKey(...values) {
  for (const value of values) {
    const match = String(value || '').match(/BV[0-9A-Za-z]{10}/i);
    if (match) return match[0].toLowerCase();
  }
  return '';
}

function normalizeDeliveryState(status, uploaded = false) {
  if (uploaded || String(status || '').toLowerCase() === 'published') return 'uploaded';
  const value = String(status || '').toLowerCase();
  if (value === 'done') return 'completed';
  return ['completed', 'processing', 'review', 'queued', 'scheduled', 'failed', 'canceled', 'draft'].includes(value)
    ? value
    : 'available';
}

function addDeliveryMatch(matches, bvid, candidate) {
  const key = bvidKey(bvid);
  if (!key) return;
  const current = matches.get(key);
  const candidateRank = DELIVERY_STATE_RANK[candidate.deliveryState] || 0;
  const currentRank = DELIVERY_STATE_RANK[current?.deliveryState] || 0;
  if (!current || candidateRank > currentRank || (candidateRank === currentRank && candidate.updatedAt > current.updatedAt)) {
    matches.set(key, candidate);
  }
}

/**
 * The publication record is the source of truth for an uploaded video. The
 * small legacy query preserves that same protection for uploads recorded before
 * the operations catalog existed.
 */
function deliveryMatchesFor(rows) {
  const wanted = new Set(rows.map((row) => bvidKey(row.bvid)).filter(Boolean));
  if (!wanted.size) return new Map();
  const matches = new Map();
  const operationRows = db.prepare(`
    SELECT vr.id, vr.status, vr.source_ref, vr.source_url, vr.published_at, vr.updated_at,
      publication.status AS publication_status, publication.url AS publication_url,
      publication.published_at AS publication_published_at
    FROM video_records vr
    LEFT JOIN video_publications publication
      ON publication.video_id = vr.id AND publication.status = 'published'
    WHERE lower(vr.source_type) = 'bilibili'
  `).all();
  for (const row of operationRows) {
    const key = bvidKey(row.source_ref, row.source_url);
    if (!wanted.has(key)) continue;
    const uploaded = row.publication_status === 'published' || row.status === 'published';
    addDeliveryMatch(matches, key, {
      deliveryState: normalizeDeliveryState(row.status, uploaded),
      isUploaded: uploaded,
      isCompleted: uploaded || row.status === 'completed' || row.status === 'done',
      matchedVideoId: row.id,
      uploadedAt: row.publication_published_at || row.published_at || '',
      uploadedUrl: row.publication_url || '',
      updatedAt: row.publication_published_at || row.updated_at || '',
    });
  }
  const legacyRows = db.prepare(`
    SELECT id, status, bilibili_url, youtube_url, release_date, updated_at
    FROM videos WHERE trim(bilibili_url) != ''
  `).all();
  for (const row of legacyRows) {
    const key = bvidKey(row.bilibili_url);
    if (!wanted.has(key)) continue;
    const uploaded = Boolean(String(row.youtube_url || '').trim());
    addDeliveryMatch(matches, key, {
      deliveryState: normalizeDeliveryState(row.status, uploaded),
      isUploaded: uploaded,
      isCompleted: uploaded || String(row.status || '').toLowerCase() === 'done',
      matchedVideoId: `legacy-${row.id}`,
      uploadedAt: uploaded ? row.release_date || row.updated_at || '' : '',
      uploadedUrl: uploaded ? row.youtube_url : '',
      updatedAt: row.updated_at || '',
    });
  }
  return matches;
}

function rowToScrapedVideo(row, delivery = {}) {
  const durationSeconds = Number(row.duration_seconds) || 0;
  const isLongVideo = durationSeconds > YOUTUBE_UNVERIFIED_DURATION_SECONDS;
  return {
    id: Number(row.id), creatorId: row.creator_id, bvid: row.bvid, url: row.source_url,
    title: row.delivery_title || row.source_title,
    description: row.delivery_description || row.source_description,
    sourceTitle: row.source_title, sourceDescription: row.source_description,
    durationSeconds, isLongVideo, longVideoEnabled: !isLongVideo || Boolean(row.long_video_enabled), uploadedAt: row.uploaded_at || '',
    thumbnailUrl: row.thumbnail_url || '', uploader: row.uploader_name || '',
    selected: Boolean(row.selected_for_upload) && (!isLongVideo || Boolean(row.long_video_enabled)), lastScrapedAt: row.last_scraped_at,
    scheduledFor: row.scheduled_for || '',
    scheduleDays: normalizeScheduleDays(row.schedule_days_json) || [],
    copyPrompt: row.copy_prompt || '',
    tags: normalizeTags(parseJson(row.delivery_tags_json, [])) || [],
    generationFields: normalizeGenerationFieldMap(parseJson(row.generation_fields_json, ['title', 'description', 'tags'])) || { title: true, description: true, tags: true },
    aiPreview: parseJson(row.ai_preview_json, null),
    aiPreviewedAt: row.ai_previewed_at || '',
    youtubeOptions: parseJson(row.youtube_options_json, {}),
    deliveryState: delivery.deliveryState || 'available',
    isUploaded: Boolean(delivery.isUploaded),
    isCompleted: Boolean(delivery.isCompleted),
    matchedVideoId: delivery.matchedVideoId || '',
    deliveryUploadedAt: delivery.uploadedAt || '',
    uploadedUrl: delivery.uploadedUrl || '',
  };
}

/** Upsert scraper facts while retaining operator selection and delivery edits. */
export function saveScrapedBilibiliVideos(rawCreatorId, videos = []) {
  const creator = creatorId(rawCreatorId);
  const timestamp = nowIso();
  const upsert = db.prepare(`
    INSERT INTO bilibili_scraped_videos (
      creator_id, bvid, source_url, source_title, source_description,
      duration_seconds, uploaded_at, thumbnail_url, uploader_name,
      selected_for_upload, long_video_enabled, delivery_title, delivery_description,
      last_scraped_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(creator_id, bvid) DO UPDATE SET
      source_url = excluded.source_url,
      source_title = excluded.source_title,
      source_description = excluded.source_description,
      duration_seconds = excluded.duration_seconds,
      uploaded_at = excluded.uploaded_at,
      thumbnail_url = excluded.thumbnail_url,
      uploader_name = excluded.uploader_name,
      last_scraped_at = excluded.last_scraped_at,
      updated_at = excluded.updated_at
  `);
  const save = db.transaction(() => {
    for (const video of videos.slice(0, 100)) {
      const bvid = bvidFromVideo(video);
      const title = clean(video?.name || video?.title, 240) || bvid;
      const description = clean(video?.description, 4000);
      const durationSeconds = Math.max(0, Math.floor(Number(video?.durationSeconds) || 0));
      const canAutoQueue = durationSeconds <= YOUTUBE_UNVERIFIED_DURATION_SECONDS;
      upsert.run(
        creator, bvid, `https://www.bilibili.com/video/${bvid}`, title, description,
        durationSeconds, clean(video?.uploadedAt, 80),
        clean(video?.thumbnailUrl, 4000), clean(video?.uploader, 240),
        canAutoQueue ? 1 : 0, canAutoQueue ? 1 : 0, title, description, timestamp, timestamp, timestamp,
      );
    }
  });
  save();
  return listScrapedBilibiliVideos({ creatorId: creator, limit: 100 }).videos;
}

export function listScrapedBilibiliVideos({ creatorId: rawCreatorId = '', query = '', limit = 100, includeUploaded = false } = {}) {
  const creator = rawCreatorId ? creatorId(rawCreatorId) : '';
  const search = `%${clean(query, 200).replace(/[%_]/g, '\\$&')}%`;
  const rows = db.prepare(`
    SELECT * FROM bilibili_scraped_videos
    WHERE (? = '' OR creator_id = ?)
      AND (? = '' OR source_title LIKE ? ESCAPE '\\' OR delivery_title LIKE ? ESCAPE '\\' OR bvid LIKE ? ESCAPE '\\')
    ORDER BY uploaded_at DESC, updated_at DESC
    LIMIT ?
  `).all(creator, creator, clean(query, 200), search, search, search, Math.max(1, Math.min(100, Number(limit) || 100)));
  const matches = deliveryMatchesFor(rows);
  const videos = rows.map((row) => rowToScrapedVideo(row, matches.get(bvidKey(row.bvid))));
  const hiddenUploaded = videos.filter((video) => video.isUploaded).length;
  const stateCounts = videos.reduce((counts, video) => {
    counts[video.deliveryState] = (counts[video.deliveryState] || 0) + 1;
    return counts;
  }, {});
  return {
    videos: includeUploaded ? videos : videos.filter((video) => !video.isUploaded),
    loadedCount: videos.length,
    hiddenUploaded: includeUploaded ? 0 : hiddenUploaded,
    stateCounts,
  };
}

export function updateScrapedBilibiliVideo({
  creatorId: rawCreatorId, bvid: rawBvid, selected, title, description,
  scheduledFor, scheduleDays, copyPrompt, tags, generationFields, youtubeOptions, longVideoEnabled,
} = {}) {
  const creator = creatorId(rawCreatorId);
  const bvid = clean(rawBvid, 20);
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error('A valid Bilibili BV ID is required');
  const existing = db.prepare('SELECT * FROM bilibili_scraped_videos WHERE creator_id = ? AND bvid = ?').get(creator, bvid);
  if (!existing) throw new Error('Scraped Bilibili video was not found');
  const nextScheduleDays = normalizeScheduleDays(scheduleDays);
  const nextScheduledFor = normalizeScheduledFor(scheduledFor);
  const nextYouTubeOptions = normalizeYouTubeOptions(youtubeOptions);
  const nextTags = normalizeTags(tags);
  const nextGenerationFields = normalizeGenerationFieldMap(generationFields);
  const isLongVideo = Number(existing.duration_seconds) > YOUTUBE_UNVERIFIED_DURATION_SECONDS;
  const nextLongVideoEnabled = !isLongVideo || (longVideoEnabled === undefined ? Boolean(existing.long_video_enabled) : Boolean(longVideoEnabled));
  const nextSelected = selected === undefined ? Boolean(existing.selected_for_upload) : Boolean(selected);
  db.prepare(`
    UPDATE bilibili_scraped_videos
    SET selected_for_upload = ?, delivery_title = ?, delivery_description = ?,
        scheduled_for = ?, schedule_days_json = ?, copy_prompt = ?, delivery_tags_json = ?, generation_fields_json = ?,
        youtube_options_json = ?, long_video_enabled = ?, updated_at = ?
    WHERE creator_id = ? AND bvid = ?
  `).run(
    nextSelected && nextLongVideoEnabled ? 1 : 0,
    title === undefined ? existing.delivery_title : clean(title, 240),
    description === undefined ? existing.delivery_description : clean(description, 4000),
    nextScheduledFor === undefined ? existing.scheduled_for : nextScheduledFor,
    nextScheduleDays === undefined ? existing.schedule_days_json : JSON.stringify(nextScheduleDays),
    copyPrompt === undefined ? existing.copy_prompt : clean(copyPrompt, 4000),
    nextTags === undefined ? existing.delivery_tags_json : JSON.stringify(nextTags),
    nextGenerationFields === undefined ? existing.generation_fields_json : JSON.stringify(nextGenerationFields),
    nextYouTubeOptions === undefined ? existing.youtube_options_json : JSON.stringify(nextYouTubeOptions),
    nextLongVideoEnabled ? 1 : 0,
    nowIso(), creator, bvid,
  );
  const updated = db.prepare('SELECT * FROM bilibili_scraped_videos WHERE creator_id = ? AND bvid = ?').get(creator, bvid);
  return rowToScrapedVideo(updated, deliveryMatchesFor([updated]).get(bvidKey(updated.bvid)));
}

/**
 * Generate a non-dispatching title/description/tags preview for one saved
 * source. The result is retained on the source row so a reload does not hide
 * the test run, and the same endpoint can be called by Codex or another agent.
 */
export async function previewScrapedBilibiliMetadata({
  creatorId: rawCreatorId, bvid: rawBvid, copyPrompt, generationFields, provider,
} = {}) {
  const creator = creatorId(rawCreatorId);
  const bvid = clean(rawBvid, 20);
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error('A valid Bilibili BV ID is required');
  const row = db.prepare('SELECT * FROM bilibili_scraped_videos WHERE creator_id = ? AND bvid = ?').get(creator, bvid);
  if (!row) throw new Error('Scraped Bilibili video was not found');
  const video = rowToScrapedVideo(row);
  const fields = normalizeGenerationFieldMap(generationFields) || video.generationFields;
  const nextCopyPrompt = copyPrompt === undefined ? video.copyPrompt : clean(copyPrompt, 4000);
  const result = await generateMetadataDraft({
    sourceTitle: video.sourceTitle,
    referenceMaterial: video.sourceDescription || video.sourceTitle,
    copyPrompt: nextCopyPrompt,
    generateFields: fields,
    existingMetadata: { title: video.title, description: video.description, tags: video.tags },
    provider: normalizeProvider(provider),
  });
  const preview = {
    title: result.metadata.titleEn,
    description: result.metadata.descriptionEn,
    tags: result.metadata.tags,
    generationFields: fields,
    provider: result.provider,
    model: result.model,
    generatedAt: nowIso(),
  };
  db.prepare(`
    UPDATE bilibili_scraped_videos
    SET copy_prompt = ?, generation_fields_json = ?, ai_preview_json = ?, ai_previewed_at = ?, updated_at = ?
    WHERE creator_id = ? AND bvid = ?
  `).run(nextCopyPrompt, JSON.stringify(fields), JSON.stringify(preview), preview.generatedAt, preview.generatedAt, creator, bvid);
  const updated = db.prepare('SELECT * FROM bilibili_scraped_videos WHERE creator_id = ? AND bvid = ?').get(creator, bvid);
  return rowToScrapedVideo(updated, deliveryMatchesFor([updated]).get(bvidKey(updated.bvid)));
}
