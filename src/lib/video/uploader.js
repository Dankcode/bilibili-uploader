import { spawn } from 'child_process';
import path from 'path';

const DEFAULT_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

function parseUploadResult(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const urlLine = [...lines].reverse().find((line) => /^https?:\/\/\S+$/i.test(line));
  if (urlLine) return urlLine;
  const idLine = [...lines].reverse().find((line) => /^[A-Za-z0-9_-]{8,}$/.test(line));
  if (idLine) return idLine;
  return lines[lines.length - 1] || '';
}

function runPythonScript(scriptPath, args = [], timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const safeArgs = args
      .filter((arg) => arg !== undefined && arg !== null)
      .map((arg) => String(arg));
    const python = spawn('python3', [scriptPath, ...safeArgs]);
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      python.kill('SIGTERM');
      setTimeout(() => {
        if (!python.killed) python.kill('SIGKILL');
      }, 5000);
      reject(new Error(`Python uploader timed out after ${Math.round(timeoutMs / 60000)} minutes`));
    }, timeoutMs);
    
    let outputData = '';
    let errorData = '';

    python.stdout.on('data', (data) => {
      outputData += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    python.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new Error(`Python script exited with code ${code}\nError: ${errorData || outputData}`));
      } else {
        resolve(outputData.trim());
      }
    });

    python.on('error', (error) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export function normalizeYouTubeCredentialRef(value) {
  const credentialRef = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(credentialRef) || credentialRef.includes('..')) {
    throw new Error('YouTube credential reference must be a simple local name without paths');
  }
  return credentialRef;
}

export default async function UploadVideo(videoPath, title, description, tags, identity = {}) {
  const uploadMethod = (process.env.YOUTUBE_UPLOAD_METHOD || 'api').toLowerCase();
  const scriptName = uploadMethod === 'pygui'
    ? 'youtube_pygui_uploader.py'
    : 'youtube_video_and_thumbnail_uploader.py';
  const scriptPath = path.join(process.cwd(), 'scripts', 'python', scriptName);
  const selectedAuthorization = identity && typeof identity === 'object' ? identity : null;
  const rawCredentialRef = selectedAuthorization?.credentialRef || identity || process.env.YOUTUBE_CHANNEL_ID;
  const credentialRef = rawCredentialRef ? normalizeYouTubeCredentialRef(rawCredentialRef) : '';

  if (uploadMethod === 'pygui' && selectedAuthorization?.id) {
    throw new Error('Account-bound uploads require the YouTube API OAuth uploader; guided PyGUI cannot verify the selected account');
  }
  if (uploadMethod !== 'pygui' && !credentialRef) {
    throw new Error('Missing YouTube OAuth credential reference. Register an authorized account or set YOUTUBE_CHANNEL_ID.');
  }

  try {
    console.log(`Starting Python ${uploadMethod} uploader`);
    console.log('Video Path:', videoPath);
    console.log('Title:', title);
    console.log('OAuth credential reference:', credentialRef || 'guided browser session');

    const args = uploadMethod === 'pygui'
      ? [videoPath, title, description, tags]
      : [videoPath, title, description, tags, credentialRef, selectedAuthorization?.channelId || ''];
    const result = await runPythonScript(scriptPath, args);
    const videoIdOrUrl = parseUploadResult(result);
    if (!videoIdOrUrl) throw new Error('Uploader completed without printing a video URL or ID');

    console.log('Video uploaded successfully');
    console.log('Video ID/URL:', videoIdOrUrl);

    return videoIdOrUrl;
  } catch (error) {
    console.error('Error uploading video:', error.message);
    throw error;
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
