const { spawn } = require('child_process');

const path = require('path');

function runPythonScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const safeArgs = args
      .filter((arg) => arg !== undefined && arg !== null)
      .map((arg) => String(arg));
    const python = spawn('python3', [scriptPath, ...safeArgs]);
    
    let outputData = '';
    let errorData = '';

    python.stdout.on('data', (data) => {
      outputData += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python script exited with code ${code}\nError: ${errorData || outputData}`));
      } else {
        resolve(outputData.trim());
      }
    });
  });
}


export default async function UploadVideo(videoPath, title, description, tags, databaseId) {
  const uploadMethod = (process.env.YOUTUBE_UPLOAD_METHOD || 'api').toLowerCase();
  const scriptName = uploadMethod === 'pygui'
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

    const args = uploadMethod === 'pygui'
      ? [videoPath, title, description, tags]
      : [videoPath, title, description, tags, channelId];
    const result = await runPythonScript(scriptPath, args);
    const videoIdOrUrl = result.split(/\r?\n/).filter(Boolean).pop() || '';

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
