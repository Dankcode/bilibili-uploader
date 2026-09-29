import fs from 'node:fs';
import path from 'node:path';
import db from '../../db/sqlite.js';

export const id = 'library';

export function savedVideo(videoId) {
  const row = db.prepare(`SELECT r.*, v.file_path, v.duration_seconds, l.chinese_name, l.chinese_description, l.english_name, l.english_description, l.tags AS legacy_tags
    FROM video_records r LEFT JOIN video_versions v ON v.id=r.current_version_id
    LEFT JOIN videos l ON l.id=r.legacy_video_id WHERE r.id=?`).get(String(videoId));
  if (!row) throw new Error('Saved video not found');
  const metadata = JSON.parse(row.metadata_json || '{}');
  metadata.uploadMetadata ||= { titleEn: metadata.deliveryTitle || metadata.titleEn || row.english_name || '', descriptionEn: metadata.deliveryDescription || metadata.descriptionEn || row.english_description || '', tags: metadata.tags || (row.legacy_tags || '').split(',').map((t) => t.trim()).filter(Boolean) };
  return { row, metadata, filePath: row.file_path || row.source_path || '',
    title: metadata.sourceTitle || row.chinese_name || row.title,
    description: metadata.sourceDescription || row.chinese_description || metadata.description || '' };
}

export function resolveSavedFile(videoId) {
  const video = savedVideo(videoId);
  if (!path.isAbsolute(video.filePath) || !fs.existsSync(video.filePath) || !fs.statSync(video.filePath).isFile()) {
    throw new Error('This saved video has no readable local media. Download it before using the Library source.');
  }
  fs.accessSync(video.filePath, fs.constants.R_OK);
  return video;
}

export async function testConnection(_credentials, context = {}) {
  try { if (context.sourceInput) resolveSavedFile(context.sourceInput); return { ok: true, detail: 'Saved media from the operations database' }; }
  catch (error) { return { ok: false, error: error.message }; }
}
export async function resolveInput(videoId) { return { items: [{ videoId }] }; }
export async function download(item, _destDir, onProgress = () => {}) {
  const video = resolveSavedFile(item.videoId);
  onProgress(100, 'Using saved library media');
  return { filePath: video.filePath, meta: { ...video.metadata, title: video.title,
    sourceDescription: video.description, sourceUrl: video.row.source_url, platform: video.row.source_type } };
}
