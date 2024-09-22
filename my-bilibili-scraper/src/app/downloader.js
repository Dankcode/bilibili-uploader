import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import stream from 'stream';
import { exec } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';



// const pipeline = promisify(stream.pipeline);

// function handleDeleteFile(setting, videoInfo) {
//     // 删除原视频
//     if (setting.isDelete) {
//       const filePathList = videoInfo.filePathList;
//       fs.removeSync(filePathList[2]);
//       fs.removeSync(filePathList[3]);
//     }
//   }

// const sleep = (timeoutMS) => new Promise((resolve) => setTimeout(resolve, timeoutMS));

// const mergeVideoAudio = async (videoPath, audioPath, outputPath) => {
//   return new Promise((resolve, reject) => {
//     const command = `ffmpeg -i ${videoPath} -i ${audioPath} -c:v copy -c:a aac ${outputPath}`;
//     exec(command, (error, stdout, stderr) => {
//       if (error) {
//         reject(error);
//       } else {
//         resolve(stdout ? stdout : stderr);
//       }
//     });
//   });
// };
const mergeVideoAudio = (videoPath, audioPath, out) => {
    return new Promise((resolve, reject) => {
      ffmpeg()
      const command = `ffmpeg -i ${videoPath} -i ${audioPath} -c copy -movflags frag_keyframe+empty_moov -f mp4 ${out}`;
      exec(command, (error, stdout, stderr) => {
              if (error) {
        reject(error);
      } else {
        resolve(stdout ? stdout : stderr);
      }
    });
    });
  };

  export default async function Downloader(videoName, bilibiliUrl, videoURL, audioURL) {
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15';
    const maxRetries = 3; // Max number of retries
    const retryDelay = 2000; // Delay between retries in milliseconds
  
    const downloadConfig = {
      headers: {
        'User-Agent': `${UA}`,
        referer: bilibiliUrl,
      },
      responseType: 'stream',
    };
  
    // Define paths for saving video and audio
    const downloadsFolder = path.join(process.cwd(), 'VideoAudioMix');
    const MergedFolder = path.join(process.cwd(), 'Videos');
    const videoPath = path.join(downloadsFolder, `${videoName}.mp4`);
    const audioPath = path.join(downloadsFolder, `${videoName}.m4a`);
    const outputPath = path.join(MergedFolder, `${videoName}.mp4`);
  
    // Function to retry download with a failsafe
    async function retryDownload(url, path, type) {
      let retries = 0;
      while (retries < maxRetries) {
        try {
          const response = await axios.get(url, downloadConfig);
          const writer = fs.createWriteStream(path);
          response.data.pipe(writer);
  
          await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
          });
  
          console.log(`${type} Download completed successfully`);
          return true; // Download succeeded
        } catch (error) {
          retries++;
          console.error(`${type} Download failed: ${error.message}. Retry attempt ${retries}`);
          if (retries < maxRetries) {
            await sleep(retryDelay); // Wait before retrying
          } else {
            console.error(`${type} Download failed after ${maxRetries} attempts.`);
            return false; // Download failed after max retries
          }
        }
      }
    }
  
    // Download video with retry
    const videoDownloaded = await retryDownload(videoURL, videoPath, 'Video');
    if (!videoDownloaded) {
      console.error('Failed to download video after multiple attempts. Aborting.');
      return; // Abort if video download fails after retries
    }
  
    await sleep(500); // Optional small delay between downloads
  
    // Download audio with retry
    const audioDownloaded = await retryDownload(audioURL, audioPath, 'Audio');
    if (!audioDownloaded) {
      console.error('Failed to download audio after multiple attempts. Aborting.');
      return; // Abort if audio download fails after retries
    }
  
    await sleep(500);
  
    // Merge video and audio
    return mergeVideoAudio(videoPath, audioPath, outputPath);
  }
  
  // Utility function to pause execution for a specified duration
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }