import fs from 'fs';
import path from 'path';
import UploadVideo, { normalizeYouTubeCredentialRef, runPythonScript } from '../../video/uploader';
import { getYouTubeAuthorization, listYouTubeAuthorizations } from '../../youtube/authorizations.js';
import { youtubeClientSecretPath } from '../../youtube/oauth.js';
import {
  methodIsBudgeted, normalizeUploadMethod, resolveUploadMethod, studioCalibrationStatus, studioScriptPath,
} from '../../youtube/uploadMethod.js';

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
  let uploadMethod;
  try {
    uploadMethod = normalizeUploadMethod(context.uploadMethod || '');
  } catch (error) {
    return { ok: false, error: error.message };
  }

  // Studio screen automation: ready means the script is present AND every
  // required screen template has been captured on this machine. Whether the
  // browser is signed in is only knowable at upload time; the uploader pauses
  // for a person when it is not.
  if (uploadMethod === 'studio') {
    if (!fs.existsSync(studioScriptPath())) return { ok: false, error: 'Missing uploader script: youtube_studio_vision_uploader.py' };
    const status = studioCalibrationStatus();
    if (!status.ok) {
      return {
        ok: false,
        error: status.error || `Studio screen templates not captured: ${status.missingRequired.join(', ')}. Run ${status.calibrateCommand} on the upload machine.`,
      };
    }
    return {
      ok: true,
      detail: `Studio screen uploader calibrated (${status.ready.length} templates)${status.channelCheck ? ', channel check on' : ', no channel check — capture channel_badge'}`,
    };
  }

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

/** The exact title upload() sends — receipts record it so reconcile can match. */
export function resolveUploadTitle(filePath, meta = {}) {
  return meta.title || meta.titleEn || path.basename(String(filePath || ''), path.extname(String(filePath || '')));
}

/** Only Data API uploads spend quota; Studio and guided uploads do not. */
export function isBudgeted(meta = {}) {
  return methodIsBudgeted(resolveUploadMethod(meta));
}

/** The quota account for this upload: the OAuth client (Google Cloud project). */
export function budgetAccountRef(meta = {}) {
  const authorization = meta.youtubeAuthorization || null;
  return String(authorization?.clientRef || authorization?.credentialRef || meta.channelId || globalThis.process?.env?.YOUTUBE_CHANNEL_ID || 'default');
}

export async function upload(filePath, meta = {}, onProgress = () => {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw Object.assign(new Error(`Upload file not found: ${filePath}`), { notSent: true });
  }
  const title = resolveUploadTitle(filePath, meta);
  const description = meta.description || meta.descriptionEn || '';
  const tags = Array.isArray(meta.tags) ? meta.tags.join(' ') : (meta.tags || '');
  const uploadMethod = resolveUploadMethod(meta);
  onProgress(10, uploadMethod === 'studio' ? 'Starting YouTube Studio screen uploader' : 'Starting YouTube uploader');
  const authorization = meta.youtubeAuthorization || null;
  // Studio takes tags as a list (multi-word tags survive); the API script takes a string.
  const uploadTags = uploadMethod === 'studio' && Array.isArray(meta.tags) ? meta.tags : tags;
  const rawResult = await UploadVideo(filePath, title, description, uploadTags, {
    ...(authorization || {}),
    ...(!authorization && meta.channelId ? { channelRef: meta.channelId } : {}),
    uploadMethod,
    onStudioEvent: (studioEvent) => {
      if (studioEvent?.type === 'needs_human') {
        onProgress(Math.max(10, Number(studioEvent.percent) || 12), 'Needs you: finish signing in or verifying in the browser on the upload machine');
      } else if (studioEvent?.type === 'progress') {
        onProgress(Math.min(99, Math.max(10, Number(studioEvent.percent) || 10)), studioEvent.note || studioEvent.stage || 'Uploading in Studio');
      }
    },
    youtubeOptions: {
      privacyStatus: meta.privacyStatus || 'private',
      categoryId: meta.categoryId || '',
      defaultLanguage: meta.defaultLanguage || '',
      license: meta.license || '',
      madeForKids: Boolean(meta.madeForKids),
      embeddable: meta.embeddable !== false,
      notifySubscribers: Boolean(meta.notifySubscribers),
    },
  });
  const normalized = normalizeYouTubeUploadResult(rawResult);
  onProgress(100, 'Uploaded');
  return {
    ...normalized,
    authorizationId: authorization?.id || '',
    channelId: authorization?.channelId || meta.channelId || '',
    privacyStatus: meta.privacyStatus || 'private',
    uploadMethod,
  };
}

const RECONCILE_TIMEOUT_MS = 2 * 60 * 1000;

export function parseReconcileOutput(output) {
  const line = String(output || '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).reverse()
    .find((entry) => entry.startsWith('{') && entry.endsWith('}'));
  if (!line) throw new Error('Reconcile lookup did not print a result');
  const parsed = JSON.parse(line);
  if (!parsed.found) return { found: false, candidates: Number(parsed.candidates) || 0 };
  const videoId = String(parsed.videoId || '');
  if (!/^[A-Za-z0-9_-]{8,}$/.test(videoId)) throw new Error('Reconcile lookup returned an invalid video id');
  return { found: true, remoteId: videoId, url: `https://www.youtube.com/watch?v=${videoId}`, candidates: Number(parsed.candidates) || 1 };
}

/**
 * Release-layer reconcile: was an unconfirmed ('sent') upload actually created?
 * Looks for the receipt's title among the channel's newest uploads published
 * after the receipt was sent — 2 quota units, instead of 1,600 for a duplicate.
 *
 * Returns null when this upload method cannot look (the guided Studio uploader
 * has no API credential), which sends the receipt to an operator.
 */
export async function reconcile(receipt, meta = {}) {
  // Studio and guided uploads have no API credential to look with; an
  // unconfirmed one goes to an operator in Publish ▸ Receipts.
  if (resolveUploadMethod(meta) !== 'api') return null;
  const authorization = meta.youtubeAuthorization || null;
  const rawCredentialRef = authorization?.credentialRef || meta.channelId || globalThis.process?.env?.YOUTUBE_CHANNEL_ID;
  if (!rawCredentialRef) return null;
  const credentialRef = normalizeYouTubeCredentialRef(rawCredentialRef);
  const clientRef = authorization?.clientRef ? normalizeYouTubeCredentialRef(authorization.clientRef) : credentialRef;
  const title = receipt.title || meta.title || meta.titleEn || '';
  if (!title) return null;
  const scriptPath = path.join(process.cwd(), 'scripts', 'python', 'youtube_reconcile_upload.py');
  const output = await runPythonScript(scriptPath, [
    credentialRef, authorization?.channelId || receipt.channelId || '', clientRef, title, receipt.sentAt || receipt.createdAt || '',
  ], RECONCILE_TIMEOUT_MS);
  return parseReconcileOutput(output);
}
