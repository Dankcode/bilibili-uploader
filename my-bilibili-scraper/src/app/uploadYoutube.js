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
          // console.log(outputData)
          const result = outputData;
          resolve(result);
        } catch (error) {
          console.log(`Failed to parse Python script output: ${error.message}`);
        }
      }
    });
  });
}


export default async function UploadVideo(videoPath, title, description, tags, databaseId) {
  const scriptPath = path.join('../', 'youtube_video_and_thumbnail_uploader.py');
  try {
    console.log('Starting Python script');
    console.log('Video Path:', videoPath);
    console.log('Title:', title);
    console.log('database ID:', databaseId);
    // Run the Python script and wait for the result
    const result = await runPythonScript(scriptPath, [videoPath, title, description, tags, databaseId]);

    // Log success and extract video ID
    console.log('Video uploaded successfully');
    console.log('Video ID:', result.video_id);

    // Return the video ID from the Python script result
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