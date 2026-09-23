const { spawn } = require('child_process');

const path = require('path');
import { parseUploadResult } from './uploadResult';

const DEFAULT_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

function runPythonScript(scriptPath, args = [], timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const safeArgs = args
      .filter((arg) => arg !== undefined && arg !== null)
      .map((arg) => String(arg));
    const python = spawn(process.env.YOUTUBE_PYTHON || 'python3', [scriptPath, ...safeArgs]);
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      python.kill('SIGTERM');
      setTimeout(() => {
        if (python.exitCode === null && python.signalCode === null) python.kill('SIGKILL');
      }, 5000).unref();
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


export default async function UploadVideo(videoPath, title, description, tags, databaseId, options = {}) {
  const uploadMethod = (process.env.YOUTUBE_UPLOAD_METHOD || 'api').toLowerCase();
  if (!['api', 'pygui', 'gui'].includes(uploadMethod)) throw new Error(`Unknown YouTube upload method: ${uploadMethod}`);
  const scriptName = uploadMethod === 'gui' ? 'youtube_gui_uploader.py' : uploadMethod === 'pygui'
    ? 'youtube_pygui_uploader.py'
    : 'youtube_video_and_thumbnail_uploader.py';
  const scriptPath = path.join(process.cwd(), 'scripts', 'python', scriptName);
  const channelId = databaseId || process.env.YOUTUBE_CHANNEL_ID;

  if (uploadMethod !== 'pygui' && !channelId) {
    throw new Error('Missing YouTube channel id. Set YOUTUBE_CHANNEL_ID or pass databaseId.');
  }

  try {
    console.log(`Starting Python ${uploadMethod} uploader`);
    console.log('Video Path:', videoPath);
    console.log('Title:', title);
    console.log('database ID:', channelId);

    const args = uploadMethod === 'gui'
      ? [videoPath, title, description || '', tags || '', '--channel-id', channelId,
        '--privacy', options.privacyStatus || 'private']
      : uploadMethod === 'pygui'
      ? [videoPath, title, description, tags]
      : [videoPath, title, description, tags, channelId];
    const result = await runPythonScript(scriptPath, args);
    const videoIdOrUrl = parseUploadResult(result, { structured: uploadMethod === 'gui', channelId });
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
