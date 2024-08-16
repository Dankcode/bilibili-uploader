const { spawn } = require('child_process');

const path = require('path');

function runPythonScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const python = spawn('py', [scriptPath, ...args]);
    
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
        console.log(`Python script exited with code ${code}\nError: ${errorData}`);
      } else {
        try {
          // Assuming the Python script outputs JSON
          console.log(outputData)
          const result = outputData;
          resolve(result);
        } catch (error) {
          console.log(`Failed to parse Python script output: ${error.message}`);
        }
      }
    });
  });
}


export default async function UploadVideo(videoPath, title, description) {
  const scriptPath = path.join('../', 'youtube_video_and_thumbnail_uploader.py');
  
  try {
    console.log('startin pythno sscript')
    console.log('vid path' + videoPath + 'title' + title)
    const result = await runPythonScript(scriptPath, [videoPath, title, description]);
    console.log('Video uploaded successfully');
    console.log('Video ID:', result);
    return result.video_id;
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