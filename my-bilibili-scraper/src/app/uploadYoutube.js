import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { promisify } from 'util';

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// Helper to read/write files with Promises
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);

// Exponential backoff retry function
async function retryOperation(operation, delay, retries) {
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error) {
      console.log(`Retry ${i + 1}/${retries} failed. Retrying in ${delay}ms...`);
      await new Promise(res => setTimeout(res, delay));
      delay *= 2;
    }
  }
  throw new Error(`Operation failed after ${retries} retries`);
}

// Authenticate and get OAuth2 client
async function authenticate() {
  let credentials;
  try {
    const tokenContent = await readFileAsync(TOKEN_PATH, 'utf8');
    credentials = JSON.parse(tokenContent);
  } catch (error) {
    console.log('Token not found, fetching new tokens...');
    const { client_secret, client_id, redirect_uris } = JSON.parse(await readFileAsync(CREDENTIALS_PATH, 'utf8')).installed;
    const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    console.log('Authorize this app by visiting this URL:', authUrl);
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const code = await new Promise(resolve => rl.question('Enter the code from that page here: ', resolve));
    rl.close();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    await writeFileAsync(TOKEN_PATH, JSON.stringify(tokens));
    return oAuth2Client;
  }

  const { client_secret, client_id, redirect_uris } = JSON.parse(await readFileAsync(CREDENTIALS_PATH, 'utf8')).installed;
  const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);
  oAuth2Client.setCredentials(credentials);
  return oAuth2Client;
}

// Upload video to YouTube
async function uploadVideo(auth, videoPath, details) {
  const youtube = google.youtube({ version: 'v3', auth });
  const videoMetadata = {
    snippet: {
      title: details.title,
      description: details.desc,
      categoryId: '22',
    },
    status: {
      privacyStatus: 'private',
    },
  };

  const media = {
    body: fs.createReadStream(videoPath),
  };

  const request = youtube.videos.insert({
    part: 'snippet,status',
    requestBody: videoMetadata,
    media,
  });

  const response = await retryOperation(() => request, 1000, 10);
  return response.data;
}

// Upload thumbnail to YouTube
async function uploadThumbnail(auth, videoId, thumbnailPath) {
  const youtube = google.youtube({ version: 'v3', auth });

  const media = {
    body: fs.createReadStream(thumbnailPath),
  };

  const request = youtube.thumbnails.set({
    videoId,
    media,
  });

  const response = await retryOperation(() => request, 1000, 10);
  return response.data;
}

// Read uploaded videos from a file
async function getUploadedVideos() {
  const filePath = path.join(process.cwd(), 'uploaded_videos.txt');
  try {
    const fileContent = await readFileAsync(filePath, 'utf8');
    return new Set(fileContent.split('\n').filter(Boolean));
  } catch (error) {
    return new Set();
  }
}

// Save uploaded video to a file
async function saveUploadedVideo(fileName) {
  const filePath = path.join(process.cwd(), 'uploaded_videos.txt');
  await writeFileAsync(filePath, `${fileName}\n`, { flag: 'a' });
}

// API handler
export default async function uploadYoutubeVideo() {
  try {
    const setOfVideosUploaded = await getUploadedVideos();
    const videoDir = path.join(process.cwd(), 'compilation_vids');
    const files = fs.readdirSync(videoDir);
    const uploadedVideoUrls = [];

    for (const file of files) {
      if (setOfVideosUploaded.has(file)) {
        continue;
      }

      const wholePath = path.join(videoDir, file);
      const name = path.parse(file).name;
      const details = {
        desc: `${name.replace(/_/g, ' ')} best of in 2022`,
        title: name.replace(/_/g, ' '),
      };

      const auth = await authenticate();
      const videoDetails = await uploadVideo(auth, wholePath, details);
      const videoId = videoDetails.id;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      uploadedVideoUrls.push(videoUrl);

      const thumbnailPath = path.join(process.cwd(), 'final_thumbnails', `${name}.png`);
      await uploadThumbnail(auth, videoId, thumbnailPath);
      await saveUploadedVideo(file);
      if (uploadedVideoUrls.length > 0) {
        console.log(uploadedVideoUrls[0])
        return uploadedVideoUrls[0]
      }
      console.log('One video cycle completed');
    }

    console.log('All videos processed successfully.', uploadedVideoUrls )
  } catch (error) {
    console.error('Error processing videos:', error);
  }
}