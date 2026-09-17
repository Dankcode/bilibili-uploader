import { spawn } from 'child_process';
import path from 'path';
import { normalizeUploadMethod } from '../youtube/uploadMethod.js';

const DEFAULT_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Errors the release layer may treat as "nothing left the machine": the
 * uploader refused before it could call videos.insert. Everything else leaves
 * the upload receipt 'sent' so the next attempt reconciles.
 */
const PRE_UPLOAD_ERROR = /OAuth channel mismatch|Missing OAuth client file|does not expose an owned YouTube channel|credential reference must be a simple local name|Upload options must be valid JSON/i;

function preUpload(error) {
  if (error && PRE_UPLOAD_ERROR.test(String(error.message || ''))) error.notSent = true;
  return error;
}

function parseUploadResult(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const urlLine = [...lines].reverse().find((line) => /^https?:\/\/\S+$/i.test(line));
  if (urlLine) return urlLine;
  const idLine = [...lines].reverse().find((line) => /^[A-Za-z0-9_-]{8,}$/.test(line));
  if (idLine) return idLine;
  return lines[lines.length - 1] || '';
}

/**
 * Run a Python helper. stdin is closed ('ignore'): an unattended worker has no
 * terminal, and a helper that reaches input() must fail at once instead of
 * blocking until the timeout.
 *
 * @param {number|{timeoutMs?: number, onLine?: (line: string) => void, keepOutputOnError?: boolean}} options
 */
export function runPythonScript(scriptPath, args = [], options = DEFAULT_UPLOAD_TIMEOUT_MS) {
  const settings = typeof options === 'number' ? { timeoutMs: options } : (options || {});
  const timeoutMs = Number(settings.timeoutMs) || DEFAULT_UPLOAD_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const safeArgs = args
      .filter((arg) => arg !== undefined && arg !== null)
      .map((arg) => String(arg));
    const python = spawn(process.env.PYTHON_BIN || 'python3', [scriptPath, ...safeArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    let outputData = '';
    let errorData = '';
    let pending = '';
    const timeout = setTimeout(() => {
      settled = true;
      python.kill('SIGTERM');
      setTimeout(() => {
        if (python.exitCode === null) python.kill('SIGKILL');
      }, 5000);
      reject(Object.assign(new Error(`Python helper timed out after ${Math.round(timeoutMs / 60000)} minutes`), { output: outputData }));
    }, timeoutMs);

    python.stdout.on('data', (data) => {
      const text = data.toString();
      outputData += text;
      if (typeof settings.onLine === 'function') {
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines) {
          try { settings.onLine(line); } catch { /* a progress callback must never kill the upload */ }
        }
      }
    });

    python.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    python.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (pending && typeof settings.onLine === 'function') {
        try { settings.onLine(pending); } catch { /* ignore */ }
      }
      if (code !== 0) {
        reject(Object.assign(new Error(`Python script exited with code ${code}\nError: ${errorData || outputData}`), { exitCode: code, output: outputData }));
      } else {
        resolve(outputData.trim());
      }
    });

    python.on('error', (error) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      // spawn itself failed (python3 missing) — nothing was sent anywhere.
      error.notSent = true;
      reject(error);
    });
  });
}

const STUDIO_RESULT = 'STUDIO_RESULT ';
const STUDIO_EVENT = 'STUDIO_EVENT ';

export function parseStudioLine(line) {
  const text = String(line || '').trim();
  for (const [prefix, kind] of [[STUDIO_RESULT, 'result'], [STUDIO_EVENT, 'event']]) {
    if (text.startsWith(prefix)) {
      try {
        return { kind, data: JSON.parse(text.slice(prefix.length)) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function lastStudioResult(output) {
  const lines = String(output || '').split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseStudioLine(lines[index]);
    if (parsed?.kind === 'result') return parsed.data;
  }
  return null;
}

/**
 * Turn the Studio helper's final result into the value or error the release
 * layer understands. `sent: false` → notSent (the receipt closes cleanly);
 * `deferrable` → the job waits instead of failing; anything else leaves the
 * receipt 'sent' for an operator to confirm in Publish ▸ Receipts.
 */
export function studioOutcome(result, fallbackError = null) {
  if (result?.ok && result.url) return result.url;
  const message = result?.error
    || `stopped without reporting a result${fallbackError?.message ? ` — ${fallbackError.message.slice(0, 1500)}` : ''}`;
  const error = new Error(`YouTube Studio (${result?.stage || 'unknown step'}): ${message}`);
  if (result && result.sent === false) error.notSent = true;
  if (result?.deferrable) {
    const hours = Math.max(1, Number(process.env.YOUTUBE_STUDIO_LIMIT_RETRY_HOURS) || 6);
    error.notSent = true;
    error.deferUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }
  if (result?.runDir) error.runDir = result.runDir;
  throw error;
}

export async function uploadWithStudio({ videoPath, title, description, tags, youtubeOptions = {}, onEvent = () => {} }) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'python', 'youtube_studio_vision_uploader.py');
  const payload = {
    videoPath,
    title,
    description,
    tags: Array.isArray(tags) ? tags : String(tags || '').split(/\s+/).filter(Boolean),
    privacyStatus: youtubeOptions.privacyStatus || 'private',
    madeForKids: Boolean(youtubeOptions.madeForKids),
  };
  const timeoutMs = Math.max(5, Number(process.env.YOUTUBE_STUDIO_TIMEOUT_MINUTES) || 120) * 60 * 1000;
  let output = '';
  try {
    output = await runPythonScript(scriptPath, ['--payload', JSON.stringify(payload)], {
      timeoutMs,
      onLine: (line) => {
        const parsed = parseStudioLine(line);
        if (parsed?.kind === 'event') onEvent(parsed.data);
      },
    });
  } catch (error) {
    if (error.notSent) throw error;
    // A timeout or crash with no result line: whether Studio got the file is
    // unknown, so the error is NOT marked notSent.
    return studioOutcome(lastStudioResult(error.output), error);
  }
  return studioOutcome(lastStudioResult(output));
}

export function normalizeYouTubeCredentialRef(value) {
  const credentialRef = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(credentialRef) || credentialRef.includes('..')) {
    throw Object.assign(new Error('YouTube credential reference must be a simple local name without paths'), { notSent: true });
  }
  return credentialRef;
}

export default async function UploadVideo(videoPath, title, description, tags, identity = {}) {
  const uploadMethod = normalizeUploadMethod(identity?.uploadMethod || '');
  if (uploadMethod === 'studio') {
    if (identity?.id) {
      throw Object.assign(new Error('Studio screen uploads publish to the channel the browser is signed in to; they cannot use an OAuth channel binding'), { notSent: true });
    }
    return uploadWithStudio({
      videoPath, title, description, tags, youtubeOptions: identity?.youtubeOptions || {}, onEvent: identity?.onStudioEvent,
    });
  }
  const scriptName = uploadMethod === 'pygui'
    ? 'youtube_pygui_uploader.py'
    : 'youtube_video_and_thumbnail_uploader.py';
  const scriptPath = path.join(process.cwd(), 'scripts', 'python', scriptName);
  const selectedAuthorization = identity && typeof identity === 'object' ? identity : null;
  const rawCredentialRef = selectedAuthorization?.credentialRef
    || selectedAuthorization?.channelRef
    || (typeof identity === 'string' ? identity : '')
    || process.env.YOUTUBE_CHANNEL_ID;
  const credentialRef = rawCredentialRef ? normalizeYouTubeCredentialRef(rawCredentialRef) : '';
  const clientRef = selectedAuthorization?.clientRef
    ? normalizeYouTubeCredentialRef(selectedAuthorization.clientRef)
    : credentialRef;

  if (uploadMethod === 'pygui' && selectedAuthorization?.id) {
    throw Object.assign(new Error('Account-bound uploads require the YouTube API OAuth uploader; guided PyGUI cannot verify the selected account'), { notSent: true });
  }
  if (uploadMethod !== 'pygui' && !credentialRef) {
    throw Object.assign(new Error('Missing YouTube OAuth credential reference. Register an authorized account or set YOUTUBE_CHANNEL_ID.'), { notSent: true });
  }

  try {
    console.log(`Starting Python ${uploadMethod} uploader`);
    console.log('Video Path:', videoPath);
    console.log('Title:', title);
    console.log('OAuth credential reference:', credentialRef || 'guided browser session');

    const uploadSettings = selectedAuthorization?.youtubeOptions || identity?.youtubeOptions || {};
    const args = uploadMethod === 'pygui'
      ? [videoPath, title, description, tags]
      : [videoPath, title, description, tags, credentialRef, selectedAuthorization?.channelId || '', clientRef, JSON.stringify(uploadSettings)];
    const result = await runPythonScript(scriptPath, args);
    const videoIdOrUrl = parseUploadResult(result);
    if (!videoIdOrUrl) throw new Error('Uploader completed without printing a video URL or ID');

    console.log('Video uploaded successfully');
    console.log('Video ID/URL:', videoIdOrUrl);

    return videoIdOrUrl;
  } catch (error) {
    console.error('Error uploading video:', error.message);
    throw preUpload(error);
  }
}

// Example usage
// uploadVideo('/path/to/video.mp4', 'My Awesome Video', 'This is a great video')
//   .then((videoId) => {
//     console.log('Uploaded video ID:', videoId);
//   })
//   .catch((error) => {
//     console.error('Upload failed:', error);
//   });
