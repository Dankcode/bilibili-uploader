import fs from 'fs';
import path from 'path';
import UploadVideo from '../../video/uploader';
import { execFile } from 'child_process';
import { promisify } from 'util';

export const id = 'youtube';

export async function testConnection() {
  const uploadMethod = (process.env.YOUTUBE_UPLOAD_METHOD || 'api').toLowerCase();
  const scriptName = uploadMethod === 'gui' ? 'youtube_gui_uploader.py' : uploadMethod === 'pygui'
    ? 'youtube_pygui_uploader.py'
    : 'youtube_video_and_thumbnail_uploader.py';
  const scriptPath = path.join(process.cwd(), 'scripts', 'python', scriptName);
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `Missing uploader script: ${scriptName}` };
  }
  if (uploadMethod !== 'pygui' && !process.env.YOUTUBE_CHANNEL_ID) {
    return { ok: false, error: 'Set YOUTUBE_CHANNEL_ID or choose a channel before uploading' };
  }
  if (uploadMethod === 'gui') {
    try {
      await promisify(execFile)(process.env.YOUTUBE_PYTHON || 'python3', [
        path.join(process.cwd(), 'scripts/python/gui_references.py'), '--directory',
        process.env.YOUTUBE_GUI_REFERENCES || 'config/gui-references/youtube', 'validate',
      ], { timeout: 15000 });
    } catch (error) {
      return { ok: false, error: `GUI references are not ready: ${error.stderr || error.message}` };
    }
    return { ok: true, detail: 'References validated; live desktop upload still requires an unlocked macOS session' };
  }
  return { ok: true };
}

export async function upload(filePath, meta = {}, onProgress = () => {}) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Upload file not found: ${filePath}`);
  const title = meta.title || meta.titleEn || path.basename(filePath, path.extname(filePath));
  const description = meta.description || meta.descriptionEn || '';
  const method = (process.env.YOUTUBE_UPLOAD_METHOD || 'api').toLowerCase();
  const tags = Array.isArray(meta.tags) ? meta.tags.join(method === 'gui' ? ', ' : ' ') : (meta.tags || '');
  onProgress(10, 'Starting YouTube uploader');
  const url = await UploadVideo(filePath, title, description, tags, meta.channelId, meta);
  onProgress(100, 'Uploaded');
  return {
    remoteId: new URL(url).searchParams.get('v'),
    url,
    channelId: meta.channelId || process.env.YOUTUBE_CHANNEL_ID || '',
    privacyStatus: method === 'pygui' ? 'unknown' : 'private',
  };
}
