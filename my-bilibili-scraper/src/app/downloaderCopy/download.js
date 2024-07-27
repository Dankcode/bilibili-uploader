import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import stream from 'stream';
import { exec } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';



const pipeline = promisify(stream.pipeline);

function handleDeleteFile(setting, videoInfo) {
    // 删除原视频
    if (setting.isDelete) {
      const filePathList = videoInfo.filePathList;
      fs.removeSync(filePathList[2]);
      fs.removeSync(filePathList[3]);
    }
  }

const sleep = (timeoutMS) => new Promise((resolve) => setTimeout(resolve, timeoutMS));

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
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15'
// const videoURL = 'https://upos-sz-estgcos.bilivideo.com/upgcxcode/73/08/1288630873/1288630873-1-30077.m4s?e=ig8euxZM2rNcNbdlhoNvNC8BqJIzNbfqXBvEqxTEto8BTrNvN0GvT90W5JZMkX_YN0MvXg8gNEV4NC8xNEV4N03eN0B5tZlqNxTEto8BTrNvNeZVuJ10Kj_g2UB02J0mN0B5tZlqNCNEto8BTrNvNC7MTX502C8f2jmMQJ6mqF2fka1mqx6gqj0eN0B599M=&uipk=5&nbs=1&deadline=1720338723&gen=playurlv2&os=upos&oi=1961292555&trid=960d3cb59a0744d68fc3b62c8271b989u&mid=3546393887115629&platform=pc&og=cos&upsig=cbc69afa22d22b9d9a5d73f0f5d55618&uparams=e,uipk,nbs,deadline,gen,os,oi,trid,mid,platform,og&bvc=vod&nettype=0&orderid=0,3&buvid=&build=0&f=u_0_0&agrr=0&bw=56844&logo=80000000'
// const audioURL = 'https://upos-sz-estgoss.bilivideo.com/upgcxcode/73/08/1288630873/1288630873-1-30280.m4s?e=ig8euxZM2rNcNbdlhoNvNC8BqJIzNbfqXBvEqxTEto8BTrNvN0GvT90W5JZMkX_YN0MvXg8gNEV4NC8xNEV4N03eN0B5tZlqNxTEto8BTrNvNeZVuJ10Kj_g2UB02J0mN0B5tZlqNCNEto8BTrNvNC7MTX502C8f2jmMQJ6mqF2fka1mqx6gqj0eN0B599M=&uipk=5&nbs=1&deadline=1720338790&gen=playurlv2&os=upos&oi=1961292555&trid=e0f781fbbfc74ec28bb351c4ccec4fdfu&mid=3546393887115629&platform=pc&og=hw&upsig=2b351f46c77fd4107c167da33f852e72&uparams=e,uipk,nbs,deadline,gen,os,oi,trid,mid,platform,og&bvc=vod&nettype=0&orderid=0,3&buvid=&build=0&f=u_0_0&agrr=0&bw=14370&logo=80000000'
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
  // Download video
  try {
    const videoResponse = await axios.get(videoURL, downloadConfig);
    const writer = fs.createWriteStream(videoPath)

    videoResponse.data.pipe(writer);

    console.log({
      id: 'test',
      status: 0,
      progress: 100
    });

    console.log('Download completed successfully' );
  } catch (error) {
    console.error(`Download failed: ${error.message}`);
  }

  await sleep(500);

  // Download audio
  try {
    const audioResponse = await axios.get(audioURL, downloadConfig);

    const writer = fs.createWriteStream(audioPath)
    audioResponse.data.pipe(writer);
    console.log({
      id: 'test',
      status: 0,
      progress: 100
    });

    console.log('Download completed successfully' );
  } catch (error) {
    console.error(`Download failed: ${error.message}`);
  }

  await sleep(500);

  return mergeVideoAudio(videoPath, audioPath, outputPath)
}