const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

export default async function uploadYouTubeVideo(filePath, title, description) {
  try {
    console.log('Starting upload process...');

    // Load client secrets from a local file.
    const content = fs.readFileSync(path.join('./', 'client_secret.json'));
    const credentials = JSON.parse(content);

    const { client_secret, client_id, redirect_uris } = credentials;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris);

    // Load previously stored token
    const token = fs.readFileSync(path.join('./', 'token.pickle'));
    oAuth2Client.setCredentials(token);

    const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });

    const fileSize = fs.statSync(filePath).size;
    const res = await youtube.videos.insert(
      {
        part: 'snippet,status',
        notifySubscribers: false,
        requestBody: {
          snippet: {
            title,
            description,
          },
          status: {
            privacyStatus: 'private',
          },
        },
        media: {
          body: fs.createReadStream(filePath),
        },
      },
      {
        onUploadProgress: (evt) => {
          const progress = (evt.bytesRead / fileSize) * 100;
          console.log(`${progress.toFixed(2)}% complete`);
        },
      }
    );

    console.log('Upload complete! Video ID:', res.data.id);
    return res.data.id;
  } catch (error) {
    console.error('Error uploading video:', error);
    throw error;
  }
}

// Example usage
// const videoFilePath = './Videos/test.mp4';
// const videoTitle = 'test';
// const videoDescription = 'This is a description of my awesome video.';

// uploadYouTubeVideo(videoFilePath, videoTitle, videoDescription)
//   .then((videoId) => {
//     console.log('Video uploaded successfully. Video ID:', videoId);
//   })
//   .catch((error) => {
//     console.error('Failed to upload video:', error);
//   });