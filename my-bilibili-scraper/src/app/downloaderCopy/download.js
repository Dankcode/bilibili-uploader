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
        .input(videoPath)
        .input(audioPath)
        .audioCodec('copy')
        .videoCodec('copy')
        .on('start', (cmd) => {
          console.log(`开始转码：${cmd}`);
        })
        .on('end', () => {
          resolve('end');
        })
        .on('error', (err) => {
          reject(err);
        })
        .save(out);
    });
  };

export default async function Downloader(req, res) {
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15'
const videoURL = 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/73/08/1288630873/1288630873-1-30077.m4s?e=ig8euxZM2rNcNbdlhoNvNC8BqJIzNbfqXBvEqxTEto8BTrNvN0GvT90W5JZMkX_YN0MvXg8gNEV4NC8xNEV4N03eN0B5tZlqNxTEto8BTrNvNeZVuJ10Kj_g2UB02J0mN0B5tZlqNCNEto8BTrNvNC7MTX502C8f2jmMQJ6mqF2fka1mqx6gqj0eN0B599M=&uipk=5&nbs=1&deadline=1720285412&gen=playurlv2&os=cosbv&oi=0&trid=8ec6e5149ad4495e9f52f0fa37f679ebu&mid=3546393887115629&platform=pc&og=cos&upsig=95f7f7720f4968f48c52e0d4c126ccf1&uparams=e,uipk,nbs,deadline,gen,os,oi,trid,mid,platform,og&bvc=vod&nettype=0&orderid=0,3&buvid=&build=0&f=u_0_0&agrr=0&bw=56844&logo=80000000'
const audioURL = 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/73/08/1288630873/1288630873-1-30077.m4s?e=ig8euxZM2rNcNbdlhoNvNC8BqJIzNbfqXBvEqxTEto8BTrNvN0GvT90W5JZMkX_YN0MvXg8gNEV4NC8xNEV4N03eN0B5tZlqNxTEto8BTrNvNeZVuJ10Kj_g2UB02J0mN0B5tZlqNCNEto8BTrNvNC7MTX502C8f2jmMQJ6mqF2fka1mqx6gqj0eN0B599M=&uipk=5&nbs=1&deadline=1720285459&gen=playurlv2&os=cosbv&oi=0&trid=88d9894155e14c4395ac4d625939cfedu&mid=3546393887115629&platform=pc&og=cos&upsig=26257ae6be841c3f7977782a5a292e67&uparams=e,uipk,nbs,deadline,gen,os,oi,trid,mid,platform,og&bvc=vod&nettype=0&orderid=0,3&buvid=&build=0&f=u_0_0&agrr=0&bw=56844&logo=80000000'
const downloadConfig = {
    headers: {
      'User-Agent': `${UA}`,
      referer: 'https://www.bilibili.com/video/BV1wz4y1F7Vc',
    },
    responseType: 'stream',
  };

  // Define paths for saving video and audio
  const downloadsFolder = path.join(os.homedir(), 'Downloads');
  const videoPath = path.join(downloadsFolder, `test_video1.mp4`);
  const audioPath = path.join(downloadsFolder, `test_audio1.m4a`);
  const outputPath = path.join(downloadsFolder, `test1.mp4`);
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