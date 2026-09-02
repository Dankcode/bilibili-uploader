import db from '../db/sqlite.js';

function nowIso() { return new Date().toISOString(); }
function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }

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

function rowToScrapedVideo(row) {
  return {
    id: Number(row.id), creatorId: row.creator_id, bvid: row.bvid, url: row.source_url,
    title: row.delivery_title || row.source_title,
    description: row.delivery_description || row.source_description,
    sourceTitle: row.source_title, sourceDescription: row.source_description,
    durationSeconds: Number(row.duration_seconds) || 0, uploadedAt: row.uploaded_at || '',
    thumbnailUrl: row.thumbnail_url || '', uploader: row.uploader_name || '',
    selected: Boolean(row.selected_for_upload), lastScrapedAt: row.last_scraped_at,
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
      selected_for_upload, delivery_title, delivery_description,
      last_scraped_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
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
      upsert.run(
        creator, bvid, `https://www.bilibili.com/video/${bvid}`, title, description,
        Math.max(0, Math.floor(Number(video?.durationSeconds) || 0)), clean(video?.uploadedAt, 80),
        clean(video?.thumbnailUrl, 4000), clean(video?.uploader, 240),
        title, description, timestamp, timestamp, timestamp,
      );
    }
  });
  save();
  return listScrapedBilibiliVideos({ creatorId: creator, limit: 100 }).videos;
}

export function listScrapedBilibiliVideos({ creatorId: rawCreatorId = '', query = '', limit = 100 } = {}) {
  const creator = rawCreatorId ? creatorId(rawCreatorId) : '';
  const search = `%${clean(query, 200).replace(/[%_]/g, '\\$&')}%`;
  const rows = db.prepare(`
    SELECT * FROM bilibili_scraped_videos
    WHERE (? = '' OR creator_id = ?)
      AND (? = '' OR source_title LIKE ? ESCAPE '\\' OR delivery_title LIKE ? ESCAPE '\\' OR bvid LIKE ? ESCAPE '\\')
    ORDER BY uploaded_at DESC, updated_at DESC
    LIMIT ?
  `).all(creator, creator, clean(query, 200), search, search, search, Math.max(1, Math.min(100, Number(limit) || 100)));
  return { videos: rows.map(rowToScrapedVideo) };
}

export function updateScrapedBilibiliVideo({ creatorId: rawCreatorId, bvid: rawBvid, selected, title, description } = {}) {
  const creator = creatorId(rawCreatorId);
  const bvid = clean(rawBvid, 20);
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error('A valid Bilibili BV ID is required');
  const existing = db.prepare('SELECT * FROM bilibili_scraped_videos WHERE creator_id = ? AND bvid = ?').get(creator, bvid);
  if (!existing) throw new Error('Scraped Bilibili video was not found');
  db.prepare(`
    UPDATE bilibili_scraped_videos
    SET selected_for_upload = ?, delivery_title = ?, delivery_description = ?, updated_at = ?
    WHERE creator_id = ? AND bvid = ?
  `).run(
    selected === undefined ? existing.selected_for_upload : (selected ? 1 : 0),
    title === undefined ? existing.delivery_title : clean(title, 240),
    description === undefined ? existing.delivery_description : clean(description, 4000),
    nowIso(), creator, bvid,
  );
  return rowToScrapedVideo(db.prepare('SELECT * FROM bilibili_scraped_videos WHERE creator_id = ? AND bvid = ?').get(creator, bvid));
}
