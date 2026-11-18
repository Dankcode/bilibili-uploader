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
/**
 * Why this source may not be uploaded now, or null. `replaces` names one
 * existing YouTube upload (its video ID) that the operator is replacing with
 * a new version: that upload, and only it, stops counting as a duplicate.
 */
export function uploadBlocker(videoId, { excludeJobId = 0, includeActive = true, replaces = '' } = {}) {
  const video = savedVideo(videoId); const identities = keys(video.row);
  const related = db.prepare('SELECT id,source_url,source_ref,metadata_json FROM video_records').all()
    .filter((r) => r.id === videoId || keys(r).some((k) => identities.includes(k)));
  for (const row of related) {
    const publication = db.prepare("SELECT url,remote_id,job_id FROM video_publications WHERE video_id=? AND platform_id='youtube' AND status IN ('published','submitted','scheduled') AND (?=0 OR COALESCE(job_id,0)<>?) AND (?='' OR COALESCE(remote_id,'')<>?) LIMIT 1").get(row.id, excludeJobId, excludeJobId, replaces, replaces);
    if (publication) return { reason: 'already uploaded or submitted', videoId: row.id, url: publication.url, remoteId: publication.remote_id };
    const receipt = db.prepare("SELECT r.url,r.remote_id FROM upload_receipts r JOIN video_jobs j ON j.id=r.job_id WHERE j.video_record_id=? AND r.destination_id='youtube' AND r.state IN ('sent','confirmed') AND r.job_id<>? AND (?='' OR COALESCE(r.remote_id,'')<>?) LIMIT 1").get(row.id, excludeJobId, replaces, replaces);
    if (receipt) return { reason: 'an earlier upload receipt that needs reconciliation', videoId: row.id, url: receipt.url, remoteId: receipt.remote_id };
    if (includeActive) {
      const active = db.prepare("SELECT id FROM video_jobs WHERE video_record_id=? AND uploader_id='youtube' AND status IN ('queued','running','review') AND id<>? LIMIT 1").get(row.id, excludeJobId);
      if (active) return { reason: 'active workflow', videoId: row.id, jobId: active.id };
    }
  }
  for (const row of db.prepare("SELECT id,bilibili_url,youtube_url FROM videos WHERE youtube_url IS NOT NULL AND youtube_url<>''").all()) {
    if (excludeJobId && db.prepare('SELECT 1 FROM video_publications WHERE job_id=? AND url=?').get(excludeJobId, row.youtube_url)) continue;
    if (replaces && String(row.youtube_url).includes(replaces)) continue;
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
    if (input.replacesRemoteId) assertReplaceable(input.videoId, input.replacesRemoteId);
    const active = uploadBlocker(input.videoId, { replaces: input.replacesRemoteId || '' });
    if (active) throw new Error(`Video already has ${active.reason}`);
    const titleEn = naturalText(input.title || ''); const descriptionEn = naturalText(input.description || '');
    const tags = [...new Set((input.tags || []).map(naturalText).filter(Boolean))];
    if (!titleEn || titleEn.length > 100 || !descriptionEn || descriptionEn.length > 5000 || !tags.length || tags.join(',').length > 500) throw new Error('Provide a title (1–100), description (1–5000), and tags (up to 500 characters)');
    updateVideoRecord(input.videoId, { metadata: { uploadMetadata: { titleEn, descriptionEn, tags }, uploadGeneration: generationSettings(input) } });
    db.prepare('UPDATE video_records SET updated_at=? WHERE id=?').run(new Date(Math.max(Date.now(), Date.parse(v.row.updated_at) + 1)).toISOString(), input.videoId);
    return readSavedUpload(input.videoId);
  })();
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Check a replacement request: `remoteId` must be exactly the upload that
 * currently blocks this source. Returns the blocker it lifts, or throws.
 */
export function assertReplaceable(videoId, remoteId) {
  if (!YOUTUBE_ID.test(String(remoteId || ''))) throw new Error('replacesRemoteId must be a YouTube video ID');
  const blocker = uploadBlocker(videoId);
  if (!blocker) throw new Error('Nothing to replace: this source has no existing upload');
  if (blocker.remoteId !== remoteId) throw new Error(`This source is blocked by ${blocker.remoteId || blocker.reason}, not ${remoteId}`);
  const remaining = uploadBlocker(videoId, { replaces: remoteId });
  if (remaining) throw new Error(`Still blocked after replacing ${remoteId}: ${remaining.reason}${remaining.url ? ` (${remaining.url})` : ''}`);
  return blocker;
}

/**
 * After a replacement upload is published and verified, mark the old upload
 * as replaced (history kept, it stops counting as the live upload). Both
 * must be YouTube uploads of the same source; the new one must be published.
 */
export function markPublicationReplaced(oldRemoteId, newRemoteId) {
  if (!YOUTUBE_ID.test(String(oldRemoteId || '')) || !YOUTUBE_ID.test(String(newRemoteId || '')) || oldRemoteId === newRemoteId) throw new Error('Give two different YouTube video IDs');
  return db.transaction(() => {
    const old = db.prepare("SELECT * FROM video_publications WHERE platform_id='youtube' AND remote_id=?").get(oldRemoteId);
    const next = db.prepare("SELECT * FROM video_publications WHERE platform_id='youtube' AND remote_id=? AND status='published'").get(newRemoteId);
    if (!old) throw new Error(`No YouTube publication ${oldRemoteId}`);
    if (!next) throw new Error(`No published YouTube publication ${newRemoteId}`);
    if (old.status === 'replaced') throw new Error(`${oldRemoteId} is already marked replaced`);
    const record = (id) => db.prepare('SELECT id,source_url,source_ref,metadata_json FROM video_records WHERE id=?').get(id);
    const oldKeys = keys(record(old.video_id) || {}); const newKeys = keys(record(next.video_id) || {});
    if (!oldKeys.some((key) => newKeys.includes(key))) throw new Error('The two uploads are not of the same source');
    let meta = {}; try { meta = JSON.parse(old.metadata_json || '{}'); } catch { /* legacy */ }
    const now = new Date().toISOString();
    db.prepare("UPDATE video_publications SET status='replaced', metadata_json=?, updated_at=? WHERE id=?")
      .run(JSON.stringify({ ...meta, replacedBy: { remoteId: newRemoteId, url: next.url, videoId: next.video_id, at: now } }), now, old.id);
    return { replaced: { remoteId: oldRemoteId, videoId: old.video_id, url: old.url }, by: { remoteId: newRemoteId, videoId: next.video_id, url: next.url } };
  })();
}
