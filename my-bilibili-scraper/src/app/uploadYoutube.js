const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const TOKEN_PATH = 'youtube-nodejs-quickstart.json';

function authenticate(selectedAccountFile) {
  return new Promise((resolve, reject) => {
    const data = require(selectedAccountFile);
      if (err) return reject('Error loading client secret file:', err);
      authorize(data.client_secret, data.client_id, data.redirect_uris[0]);
  });
}

function authorize(client_secret, client_id, redirect_uris) {
    console.log(client_id)
  return new Promise((resolve, reject) => {
    const oauth2Client = new OAuth2( client_secret, client_id, redirect_uris );

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

function uploadVideo(youtube, filePath, title, description) {
  console.log('Uploading video...');
  return youtube.videos.insert({
    part: 'snippet,status',
    requestBody: {
      snippet: {
        title: title,
        description: description,
      },
      status: {
        privacyStatus: 'private',
      },
    },
    media: {
      body: fs.createReadStream(filePath),
    },
  }).then((response) => {
    console.log('Upload successful');
    console.log('Video ID:', response.data.id);
    return `https://www.youtube.com/watch?v=${response.data.id}`;
  }).catch((err) => {
    console.error('Error uploading video:', err);
    throw err;
  });
}

// Main function to export
async function uploadYouTubeVideo(filePath, title, description, selectedAccountFile) {
  return await authenticate(selectedAccountFile)
    .then((auth) => loadClient(auth))
    .then((youtube) => uploadVideo(youtube, filePath, title, description))
    .catch((err) => {
      console.error('Failed to upload video:', err);
      throw err;
    });
}

export default uploadYouTubeVideo;