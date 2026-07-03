import fs from 'fs';
import path from 'path';
import UploadVideo from '../../video/uploader';

export const id = 'youtube';

export async function testConnection() {
  const uploadMethod = (process.env.YOUTUBE_UPLOAD_METHOD || 'api').toLowerCase();
  const scriptName = uploadMethod === 'pygui'
    ? 'youtube_pygui_uploader.py'
    : 'youtube_video_and_thumbnail_uploader.py';
  const scriptPath = path.join(process.cwd(), 'scripts', 'python', scriptName);
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `Missing uploader script: ${scriptName}` };
  }
  if (uploadMethod !== 'pygui' && !process.env.YOUTUBE_CHANNEL_ID) {
    return { ok: false, error: 'Set YOUTUBE_CHANNEL_ID or choose a channel before uploading' };
  }
  return { ok: true };
}

export async function upload(filePath, meta = {}, onProgress = () => {}) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Upload file not found: ${filePath}`);
  const title = meta.title || meta.titleEn || path.basename(filePath, path.extname(filePath));
  const description = meta.description || meta.descriptionEn || '';
  const tags = Array.isArray(meta.tags) ? meta.tags.join(' ') : (meta.tags || '');
  onProgress(10, 'Starting YouTube uploader');
  const url = await UploadVideo(filePath, title, description, tags, meta.channelId);
  onProgress(100, 'Uploaded');
  return {
    remoteId: url,
    url,
    privacyStatus: meta.privacyStatus || 'private',
  };
}
