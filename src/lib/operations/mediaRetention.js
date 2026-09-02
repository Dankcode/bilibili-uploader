import fs from 'fs';
import path from 'path';
import db from '../db/sqlite.js';
import { getAppSetting, setAppSetting } from '../pipeline/presets.js';

const SETTING_KEY = 'local-media-retention';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULTS = { enabled: false, retentionDays: 7, lastRunAt: '' };
const MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);

function safeSettings() {
  const value = getAppSetting(SETTING_KEY, DEFAULTS) || {};
  return {
    enabled: Boolean(value.enabled),
    retentionDays: Math.max(1, Math.min(365, Number(value.retentionDays) || DEFAULTS.retentionDays)),
    lastRunAt: String(value.lastRunAt || ''),
  };
}

function mediaRoot() {
  return path.resolve(process.cwd(), process.env.VIDEO_WORK_DIR || 'video-work');
}

function isSafeMediaPath(filePath) {
  if (!filePath || !path.isAbsolute(filePath)) return false;
  const root = mediaRoot();
  const resolved = path.resolve(filePath);
  const relative = path.relative(root, resolved);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && MEDIA_EXTENSIONS.has(path.extname(resolved).toLowerCase());
}

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

/**
 * Only terminal assets inside the application's video-work directory are
 * eligible. Database history is retained; this policy only removes a local
 * byte-for-byte media file after the configured grace period.
 */
export function listLocalMediaRetentionCandidates({ retentionDays } = {}) {
  const settings = safeSettings();
  const days = Math.max(1, Math.min(365, Number(retentionDays) || settings.retentionDays));
  const cutoff = Date.now() - (days * DAY_MS);
  const rows = db.prepare(`
    SELECT a.id, a.job_id, a.file_path, a.meta_json, a.created_at,
      j.status AS job_status, j.uploader_id,
      b.authorization_id
    FROM video_assets a
    JOIN video_jobs j ON j.id = a.job_id
    LEFT JOIN youtube_upload_bindings b ON b.job_id = j.id
    WHERE j.status IN ('done', 'failed', 'canceled')
      AND a.file_path != ''
    ORDER BY a.created_at ASC, a.id ASC
  `).all();
  const seen = new Set();
  const candidates = [];
  for (const row of rows) {
    if (!isSafeMediaPath(row.file_path)) continue;
    const resolved = path.resolve(row.file_path);
    if (seen.has(resolved)) continue;
    let stats;
    try { stats = fs.lstatSync(resolved); } catch { continue; }
    if (!stats.isFile() || stats.isSymbolicLink() || stats.mtimeMs > cutoff) continue;
    seen.add(resolved);
    candidates.push({
      assetId: Number(row.id), jobId: Number(row.job_id), filePath: resolved,
      bytes: stats.size, modifiedAt: stats.mtime.toISOString(), jobStatus: row.job_status,
      reason: row.uploader_id !== 'youtube' || !row.authorization_id ? 'no uploader channel' : 'weekly retention',
      metadata: parseJson(row.meta_json, {}),
    });
  }
  return { retentionDays: days, cutoff: new Date(cutoff).toISOString(), candidates };
}

export function getLocalMediaRetentionSettings() {
  const settings = safeSettings();
  return { ...settings, preview: listLocalMediaRetentionCandidates({ retentionDays: settings.retentionDays }) };
}

export function updateLocalMediaRetentionSettings(patch = {}) {
  const current = safeSettings();
  const next = {
    ...current,
    enabled: patch.enabled === undefined ? current.enabled : Boolean(patch.enabled),
    retentionDays: patch.retentionDays === undefined ? current.retentionDays : Math.max(1, Math.min(365, Number(patch.retentionDays) || current.retentionDays)),
  };
  setAppSetting(SETTING_KEY, next);
  return getLocalMediaRetentionSettings();
}

export function deleteLocalMediaRetentionCandidates(assetIds = []) {
  const wanted = new Set((Array.isArray(assetIds) ? assetIds : []).map(Number).filter(Number.isInteger));
  if (!wanted.size) throw new Error('Select one or more reviewed local files to remove');
  const preview = listLocalMediaRetentionCandidates();
  const selected = preview.candidates.filter((candidate) => wanted.has(candidate.assetId));
  if (!selected.length) throw new Error('None of the selected files are currently eligible for cleanup');
  const deleted = [];
  const skipped = [];
  const mark = db.prepare('UPDATE video_assets SET meta_json = ? WHERE id = ?');
  const markRemoved = db.transaction(() => {
    for (const candidate of selected) {
      try {
        // Revalidate the resolved, in-workspace target immediately before unlink.
        if (!isSafeMediaPath(candidate.filePath)) throw new Error('Unsafe media path');
        const stats = fs.lstatSync(candidate.filePath);
        if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Not a regular media file');
        fs.unlinkSync(candidate.filePath);
        mark.run(JSON.stringify({ ...candidate.metadata, retention: { deletedAt: new Date().toISOString(), reason: candidate.reason } }), candidate.assetId);
        deleted.push(candidate);
      } catch (error) {
        skipped.push({ ...candidate, error: error.message });
      }
    }
  });
  markRemoved();
  return { deleted, skipped };
}

export function runDueLocalMediaCleanup() {
  const settings = safeSettings();
  if (!settings.enabled) return { ran: false, reason: 'disabled' };
  const lastRun = new Date(settings.lastRunAt || 0).getTime();
  if (Number.isFinite(lastRun) && Date.now() - lastRun < 7 * DAY_MS) return { ran: false, reason: 'not_due' };
  // Scheduled cleanup intentionally requires dashboard review. It records the
  // weekly scan, while deletion remains an explicit, audit-visible operation.
  const preview = listLocalMediaRetentionCandidates({ retentionDays: settings.retentionDays });
  setAppSetting(SETTING_KEY, { ...settings, lastRunAt: new Date().toISOString() });
  return { ran: true, candidateCount: preview.candidates.length };
}
