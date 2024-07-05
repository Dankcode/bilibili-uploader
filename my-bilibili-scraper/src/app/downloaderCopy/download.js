import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import stream from 'stream';
import { exec } from 'child_process';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15'

const pipeline = promisify(stream.pipeline);

const sleep = (timeoutMS) => new Promise((resolve) => setTimeout(resolve, timeoutMS));

const mergeVideoAudio = async (videoPath, audioPath, outputPath) => {
  return new Promise((resolve, reject) => {
    const command = `ffmpeg -i ${videoPath} -i ${audioPath} -c:v copy -c:a aac ${outputPath}`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout ? stdout : stderr);
      }
    });
  });
};

export default async function Downloader(req, res) {
const videoURL = 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/73/08/1288630873/1288630873-1-30080.m4s?e=ig8euxZM2rNcNbdlhoNvNC8BqJIzNbfqXBvEqxTEto8BTrNvN0GvT90W5JZMkX_YN0MvXg8gNEV4NC8xNEV4N03eN0B5tZlqNxTEto8BTrNvNeZVuJ10Kj_g2UB02J0mN0B5tZlqNCNEto8BTrNvNC7MTX502C8f2jmMQJ6mqF2fka1mqx6gqj0eN0B599M=&uipk=5&nbs=1&deadline=1720206813&gen=playurlv2&os=cosbv&oi=0&trid=991a9ddcf3114d13bf11736befab560eu&mid=3546393887115629&platform=pc&og=cos&upsig=0e9edd060150025ae6a5d5e0b5f20286&uparams=e,uipk,nbs,deadline,gen,os,oi,trid,mid,platform,og&bvc=vod&nettype=0&orderid=0,3&buvid=&build=0&f=u_0_0&agrr=0&bw=121144&logo=80000000'
const audioURL = 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/73/08/1288630873/1288630873-1-30077.m4s?e=ig8euxZM2rNcNbdlhoNvNC8BqJIzNbfqXBvEqxTEto8BTrNvN0GvT90W5JZMkX_YN0MvXg8gNEV4NC8xNEV4N03eN0B5tZlqNxTEto8BTrNvNeZVuJ10Kj_g2UB02J0mN0B5tZlqNCNEto8BTrNvNC7MTX502C8f2jmMQJ6mqF2fka1mqx6gqj0eN0B599M=&uipk=5&nbs=1&deadline=1720206961&gen=playurlv2&os=cosbv&oi=0&trid=16d56f6eeb414ed6960db615a9ded33cu&mid=3546393887115629&platform=pc&og=cos&upsig=fa38023cd14841bde24f13151275cf94&uparams=e,uipk,nbs,deadline,gen,os,oi,trid,mid,platform,og&bvc=vod&nettype=0&orderid=0,3&buvid=&build=0&f=u_0_0&agrr=0&bw=56844&logo=80000000' 
const downloadConfig = {
    headers: {
      'User-Agent': `${UA}`,
      referer: 'https://www.bilibili.com/video/BV1wz4y1F7Vc'
    },
  };

  // Define paths for saving video and audio
  const downloadsFolder = path.join(os.homedir(), 'Downloads');
  const videoPath = path.join(downloadsFolder, `test_video.mp4`);
  const audioPath = path.join(downloadsFolder, `test_audio.m4a`);
  const outputPath = path.join(downloadsFolder, `test.mp4`);

  // Dummy event object to simulate Electron's event system
  const event = {
    reply: (channel, data) => {
      console.log(channel, data);
    }
  };

  // Download video
  try {
    const videoResponse = await axios.get(videoURL, downloadConfig);
console.log('bvurh' + videoResponse.headers)
    const totalLength = videoResponse.headers['content-length'];
    let downloadedLength = 0;

    await pipeline(
      videoResponse.data
        .on('data', (chunk) => {
          downloadedLength += chunk.length;
          const nowTime = +new Date();

          clearTimeout(videoTimer);
          if (!videoLastTime || nowTime - videoLastTime > 1000) {
            console.log({
              id: 'test',
              status: 1,
              progress: Math.round((downloadedLength / totalLength) * 100 * 0.75)
            });
            videoLastTime = nowTime;
          } else {
            videoTimer = setTimeout(() => {
              console.log({
                id: 'test',
                status: 1,
                progress: Math.round((downloadedLength / totalLength) * 100 * 0.75)
              });
            }, 200);
          }
        })
        .on('error', (error) => {
          console.error(`Video download failed: test ${error.message}`);
          console.log({
            id: 'test',
            status: 5,
            progress: 100
          });
        }),
      fs.createWriteStream(videoPath)
    );

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

    const totalLength = audioResponse.headers['content-length'];
    let downloadedLength = 0;

    await pipeline(
      audioResponse.data
        .on('data', (chunk) => {
          downloadedLength += chunk.length;
          const nowTime = +new Date();

          clearTimeout(audioTimer);
          if (!audioLastTime || nowTime - audioLastTime > 1000) {
            console.log({
              id: 'test',
              status: 2,
              progress: Math.round((downloadedLength / totalLength) * 100 * 0.22 + 75)
            });
            audioLastTime = nowTime;
          } else {
            audioTimer = setTimeout(() => {
              console.log({
                id: 'test',
                status: 2,
                progress: Math.round((downloadedLength / totalLength) * 100 * 0.22 + 75)
              });
            }, 200);
          }
        })
        .on('error', (error) => {
          console.error(`Audio download failed: test ${error.message}`);
          console.log({
            id: 'test',
            status: 5,
            progress: 100
          });
        }),
      fs.createWriteStream(audioPath)
    );

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

  // Merge video and audio using ffmpeg
  mergeVideoAudio(videoPath, audioPath, outputPath)
    .then(() => {
      console.info(`Video and audio merged successfully: ${'test'}`);
      event.reply('download-video-status', {
        id: 'test',
        status: 0,
        progress: 100
      });

      // Cleanup: delete video and audio files after merging
      fs.unlinkSync(videoPath);
      fs.unlinkSync(audioPath);
    })
    .catch((error) => {
      console.error(`Merging video and audio failed: ${'test'} ${error.message}`);
      event.reply('download-video-status', {
        id: 'test',
        status: 5,
        progress: 100
      });
    });

}