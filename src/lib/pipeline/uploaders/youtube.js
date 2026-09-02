import fs from 'fs';
import path from 'path';
import UploadVideo from '../../video/uploader';
import { getYouTubeAuthorization, listYouTubeAuthorizations } from '../../youtube/authorizations.js';
import { youtubeClientSecretPath } from '../../youtube/oauth.js';

export const id = 'youtube';

/**
 * Readiness for a real upload — not merely "the script is on disk".
 *
 * The previous version returned ok as long as the Python file existed, so the
 * planner reported the whole chain "ready" with zero authorized accounts. The
 * source and processors then burned real ffmpeg work before the final step
 * failed with "Missing YouTube OAuth credential reference". A preflight whose
 * entire purpose is to prevent that must check the credential, not the script.
 *
 * @param {object} credentials  connection credentials (unused today, kept for the adapter contract)
 * @param {{authorizationId?: string}} context  the authorization this job would use, when known
 */
export async function testConnection(credentials = {}, context = {}) {
  const uploadMethod = (globalThis.process?.env?.YOUTUBE_UPLOAD_METHOD || 'api').toLowerCase();
  const scriptName = uploadMethod === 'pygui'
    ? 'youtube_pygui_uploader.py'
    : 'youtube_video_and_thumbnail_uploader.py';
  const scriptPath = path.join(process.cwd(), 'scripts', 'python', scriptName);
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `Missing uploader script: ${scriptName}` };
  }

  // The guided desktop uploader authenticates by hand in a browser window, so
  // there is no stored credential to verify.
  if (uploadMethod === 'pygui') {
    return { ok: true, detail: 'Guided YouTube Studio uploader is available' };
  }

  // A specific authorization was chosen — verify that exact one.
  const authorizationId = String(context.authorizationId || '').trim();
  if (authorizationId) {
    try {
      const authorization = getYouTubeAuthorization(authorizationId, { requireUsable: true });
      const secretPath = youtubeClientSecretPath(authorization.clientRef);
      if (!fs.existsSync(secretPath)) {
        return {
          ok: false,
          error: `Missing local OAuth client file ${path.basename(secretPath)} for ${authorization.channelTitle || authorization.emailAddress}.`,
        };
      }
      return { ok: true, detail: `Will publish as ${authorization.channelTitle || authorization.emailAddress}` };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  // No authorization chosen yet — the job can still be valid if a usable one
  // exists to pick, or if the environment names a default channel.
  const usable = listYouTubeAuthorizations().filter((authorization) => (
    authorization.enabled && authorization.credentialConfigured
  ));
  if (usable.length) {
    return {
      ok: true,
      detail: `${usable.length} authorized account(s) available; select one per job`,
    };
  }
  if (globalThis.process?.env?.YOUTUBE_CHANNEL_ID) {
    return { ok: true, detail: 'Using YOUTUBE_CHANNEL_ID from the environment' };
  }
  return {
    ok: false,
    error: 'No authorized YouTube account. Select “Connect Google account” in the Publish to panel or Connections ▸ Sign in for automated delivery, or set YOUTUBE_CHANNEL_ID.',
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
