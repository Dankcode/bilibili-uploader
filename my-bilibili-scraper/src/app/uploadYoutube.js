const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;
const path = require('path');

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');

function authenticate() {
    return new Promise((resolve, reject) => {
        fs.readFile('./client_secret.json', (err, content) => {
          if (err) return console.log('Error loading client secret file:', err);
          authorize(JSON.parse(content).web);
        });
      });
}

function authorize(credentials) {
  return new Promise((resolve, reject) => {
    const client_secret = credentials.client_secret
    const client_id = credentials.client_id
    const redirect_uris = credentials.redirect_uris
    const oauth2Client = new OAuth2(client_id, client_secret, redirect_uris);

    fs.readFile(TOKEN_PATH, (err, token) => {
      if (err) {
        getNewToken(oauth2Client).then(resolve).catch(reject);
      } else {
        oauth2Client.credentials = JSON.parse(token);
        resolve(oauth2Client);
      }
    });
  });
}

function getNewToken(oauth2Client) {
  return new Promise((resolve, reject) => {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
      rl.close();
      oauth2Client.getToken(code, (err, token) => {
        if (err) return reject('Error while trying to retrieve access token', err);
        oauth2Client.credentials = token;
        storeToken(token);
        resolve(oauth2Client);
      });
    });
  });
}

function storeToken(token) {
  fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
    if (err) return console.warn(`Token not stored to ${TOKEN_PATH}`, err);
    console.log(`Token stored to ${TOKEN_PATH}`);
  });
}

function loadClient(auth) {
  return google.youtube({
    version: 'v3',
    auth: auth,
  });
}

const uploadVideo = async (videoPath, title, description) => {
  // Load the client secrets from the client_json file
  const clientSecrets = JSON.parse(fs.readFileSync('./client_secret.json', 'utf8'));

  // Load the authorized credentials from the token.pickle file
  const credentials = JSON.parse(fs.readFileSync('./token.json', 'utf8'));

    const client_secret = clientSecrets.client_secret
    const client_id = clientSecrets.client_id
    const redirect_uris = clientSecrets.redirect_uris
    const oauth2Client = new google.auth.OAuth2
    (
      client_id, 
      client_secret, 
      redirect_uris
    );
    fs.readFile(TOKEN_PATH, (err, token) => {
      if (err) {
        getNewToken(oauth2Client).then(resolve).catch(reject);
      } else {
        oauth2Client.credentials = JSON.parse(token);
      }
    });


  // Create a YouTube instance
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  // Prepare video metadata
  const metadata = {
    snippet: {
      title: title,
      description: description,
    },
    status: {
      privacyStatus: 'private' // Change to 'public' or 'unlisted' as needed
    }
  };

  // Create a readable stream for the video file
  const videoStream = fs.createReadStream(videoPath);

  try {
    const response = await youtube.videos.insert({
      part: ['snippet, status'],
      resource: metadata,
      media: {
        body: videoStream
      }
    });

    console.log('Video uploaded:', response.data.id);
    return response.data;
  } catch (error) {
    console.error('Error uploading video:', error);
    throw error;
  }
};
// Main function to export
async function uploadYoutubeVideo(filePath, title, description) {
    uploadVideo(filePath, title, description)
}
// return new Promise((resolve, reject) => {
//   fs.readFile('./client_secret.json', (err, content) => {
// const keys = JSON.parse(content);
// const key = keys.installed || keys.web;
// const payload = JSON.stringify({
//   type: 'authorized_user',
//   client_id: key.client_id,
//   client_secret: key.client_secret,
// });
// fs.writeFile(TOKEN_PATH, payload, (err, content) => {
//   console.log('contrent' + content)
//   return content
// });
// });
// });
export default uploadYoutubeVideo;