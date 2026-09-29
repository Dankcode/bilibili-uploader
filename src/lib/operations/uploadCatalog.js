import db from '../db/sqlite.js';
import { savedVideo } from '../pipeline/sources/library.js';
import { updateVideoRecord } from './store.js';
import { naturalText } from '../ai/editorial.js';

// Compare stable source identities, ignoring share tracking and host aliases.
export function sourceIdentity(value) {
  const input = String(value || '').trim();
  if (/^BV[\da-zA-Z]{10}$/.test(input)) return `bilibili:${input}:1`;
  try {
    const u = new URL(input); const host = u.hostname.toLowerCase();
    if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
      const match = u.pathname.match(/^\/video\/(BV[\da-zA-Z]{10}|av\d+)\/?$/);
      if (match) return `bilibili:${match[1]}:${Number(u.searchParams.get('p')) || 1}`;
    }
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
      const match = u.pathname.match(/\/video\/(\d+)/); if (match) return `tiktok:${match[1]}`;
    }
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    u.hash = ''; for (const key of [...u.searchParams.keys()]) if (/^(utm_|spm|vd_source|share_|is_story)/.test(key)) u.searchParams.delete(key);
    u.searchParams.sort(); return u.toString().replace(/\/$/, '');
  } catch { return ''; }
}
function keys(row) {
  let meta = {}; try { meta = JSON.parse(row.metadata_json || '{}'); } catch { /* legacy row */ }
  return [row.source_url, row.source_ref, meta.sourceUrl, meta.canonicalUrl].map(sourceIdentity).filter(Boolean);
}
export function uploadBlocker(videoId, { excludeJobId = 0, includeActive = true } = {}) {
  const video = savedVideo(videoId); const identities = keys(video.row);
  const related = db.prepare('SELECT id,source_url,source_ref,metadata_json FROM video_records').all()
    .filter((r) => r.id === videoId || keys(r).some((k) => identities.includes(k)));
  for (const row of related) {
    const publication = db.prepare("SELECT url,remote_id,job_id FROM video_publications WHERE video_id=? AND platform_id='youtube' AND status IN ('published','submitted','scheduled') AND (?=0 OR COALESCE(job_id,0)<>?) LIMIT 1").get(row.id, excludeJobId, excludeJobId);
    if (publication) return { reason: 'already uploaded or submitted', videoId: row.id, url: publication.url, remoteId: publication.remote_id };
    const receipt = db.prepare("SELECT r.url,r.remote_id FROM upload_receipts r JOIN video_jobs j ON j.id=r.job_id WHERE j.video_record_id=? AND r.destination_id='youtube' AND r.state IN ('sent','confirmed') AND r.job_id<>? LIMIT 1").get(row.id, excludeJobId);
    if (receipt) return { reason: 'an earlier upload receipt that needs reconciliation', videoId: row.id, url: receipt.url, remoteId: receipt.remote_id };
    if (includeActive) {
      const active = db.prepare("SELECT id FROM video_jobs WHERE video_record_id=? AND uploader_id='youtube' AND status IN ('queued','running','review') AND id<>? LIMIT 1").get(row.id, excludeJobId);
      if (active) return { reason: 'active workflow', videoId: row.id, jobId: active.id };
    }
  }
  for (const row of db.prepare("SELECT id,bilibili_url,youtube_url FROM videos WHERE youtube_url IS NOT NULL AND youtube_url<>''").all()) {
    if (excludeJobId && db.prepare('SELECT 1 FROM video_publications WHERE job_id=? AND url=?').get(excludeJobId, row.youtube_url)) continue;
    if (identities.includes(sourceIdentity(row.bilibili_url))) return { reason: 'already uploaded', legacyVideoId: row.id, url: row.youtube_url };
  }
  return null;
}
export function readSavedUpload(videoId) {
  const v = savedVideo(videoId);
  return { videoId, updatedAt: v.row.updated_at, title: v.title, sourceUrl: v.row.source_url || v.row.source_ref,
    hasSavedMedia: Boolean(v.filePath), metadata: v.metadata.uploadMetadata || {}, generation: v.metadata.uploadGeneration || {}, blocker: uploadBlocker(videoId) };
}
export function generationSettings(input = {}) {
  const personality = String(input.personality || 'natural').trim();
  const context = String(input.context || '').trim();
  if (personality.length > 1000 || context.length > 5000) throw new Error('Personality or context is too long');
  return { personality, context };
}
export function saveUploadMetadata(input) {
  return db.transaction(() => {
    const v = savedVideo(input.videoId);
    if (v.row.updated_at !== input.ifMatch) throw new Error('Saved video changed; reload before editing');
    const active = uploadBlocker(input.videoId);
    if (active) throw new Error(`Video already has ${active.reason}`);
    const titleEn = naturalText(input.title || ''); const descriptionEn = naturalText(input.description || '');
    const tags = [...new Set((input.tags || []).map(naturalText).filter(Boolean))];
    if (!titleEn || titleEn.length > 100 || !descriptionEn || descriptionEn.length > 5000 || !tags.length || tags.join(',').length > 500) throw new Error('Provide a title (1–100), description (1–5000), and tags (up to 500 characters)');
    updateVideoRecord(input.videoId, { metadata: { uploadMetadata: { titleEn, descriptionEn, tags }, uploadGeneration: generationSettings(input) } });
    db.prepare('UPDATE video_records SET updated_at=? WHERE id=?').run(new Date(Math.max(Date.now(), Date.parse(v.row.updated_at) + 1)).toISOString(), input.videoId);
    return readSavedUpload(input.videoId);
  })();
}
