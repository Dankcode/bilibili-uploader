import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

/**
 * Merges video and audio files using ffmpeg.
 */
const mergeVideoAudio = async (videoPath, audioPath, outputPath) => {
  try {
    if (!ffmpegPath) throw new Error('Bundled FFmpeg binary is unavailable');
    const { stdout, stderr } = await execFileAsync(ffmpegPath, [
      '-i', videoPath,
      '-i', audioPath,
      '-c', 'copy',
      '-movflags', 'frag_keyframe+empty_moov',
      '-f', 'mp4',
      outputPath,
    ]);
    return stdout || stderr;
  } catch (error) {
    throw new Error(`FFmpeg merge failed: ${error.message}`);
  }
};

/**
 * Downloads a file from a URL to a specified path with retries.
 */
async function downloadFile(url, destPath, config, type, maxRetries = 3) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      const response = await axios.get(url, config);
      const writer = fs.createWriteStream(destPath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      console.log(`${type} download completed: ${destPath}`);
      return true;
    } catch (error) {
      retries++;
      console.error(`${type} download attempt ${retries} failed: ${error.message}`);
      if (retries >= maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

/**
 * Core Downloader function to fetch video/audio and merge them.
 */
export default async function Downloader(videoName, referer, videoURL, audioURL, options = {}) {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  
  const config = {
    headers: {
      'User-Agent': UA,
      referer: referer,
    },
    responseType: 'stream',
  };

  const mixFolder = options.mixFolder || path.join(process.cwd(), 'VideoAudioMix');
  const finalFolder = options.finalFolder || path.join(process.cwd(), 'Videos');
  
  if (!fs.existsSync(mixFolder)) fs.mkdirSync(mixFolder, { recursive: true });
  if (!fs.existsSync(finalFolder)) fs.mkdirSync(finalFolder, { recursive: true });

  const videoPath = path.join(mixFolder, `${videoName}.mp4`);
  const audioPath = path.join(mixFolder, `${videoName}.m4a`);
  const outputFileName = options.outputFileName || `${videoName}.mp4`;
  const outputPath = path.join(finalFolder, outputFileName);

  await downloadFile(videoURL, videoPath, config, 'Video');
  await downloadFile(audioURL, audioPath, config, 'Audio');

  console.log('Merging video and audio...');
  await mergeVideoAudio(videoPath, audioPath, outputPath);
  return outputPath;
}
