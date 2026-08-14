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
  return {
    ok: true,
    detail: uploadMethod === 'pygui'
      ? 'Guided YouTube Studio uploader is available'
      : 'YouTube API uploader is available; each job must select an OAuth authorization or environment default',
  };
}

export function normalizeYouTubeUploadResult(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Uploader completed without returning a YouTube video ID or URL');
  if (/^[A-Za-z0-9_-]{8,}$/.test(raw)) {
    return { remoteId: raw, url: `https://www.youtube.com/watch?v=${raw}` };
  }
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    let remoteId = '';
    if (host === 'youtu.be') remoteId = parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      remoteId = parsed.searchParams.get('v')
        || parsed.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/)?.[1]
        || '';
    }
    return { remoteId, url: parsed.toString() };
  } catch {
    throw new Error('Uploader returned an invalid YouTube video ID or URL');
  }
}

export async function upload(filePath, meta = {}, onProgress = () => {}) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Upload file not found: ${filePath}`);
  const title = meta.title || meta.titleEn || path.basename(filePath, path.extname(filePath));
  const description = meta.description || meta.descriptionEn || '';
  const tags = Array.isArray(meta.tags) ? meta.tags.join(' ') : (meta.tags || '');
  onProgress(10, 'Starting YouTube uploader');
  const authorization = meta.youtubeAuthorization || null;
  const uploadIdentity = authorization || meta.channelId || '';
  const rawResult = await UploadVideo(filePath, title, description, tags, uploadIdentity);
  const normalized = normalizeYouTubeUploadResult(rawResult);
  onProgress(100, 'Uploaded');
  return {
    ...normalized,
    authorizationId: authorization?.id || '',
    channelId: authorization?.channelId || meta.channelId || '',
    privacyStatus: meta.privacyStatus || 'private',
  };
}
