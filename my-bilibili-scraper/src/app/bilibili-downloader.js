import React from 'react';
import axios from 'axios';
import Downloader from './downloaderCopy/download';
import { cookies } from 'next/headers';
const { chromium } = require('playwright');
const fs = require('fs');

async function getCookieSSES(bilibiliUrl) {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15'
  const config = {
    headers: {
      'User-Agent': `${UA}`,
      cookie: ''
    }
  };

  try {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
  
    // Load cookies and local storage from a file
    const storage = JSON.parse(fs.readFileSync('storage.json', 'utf8'));
    await context.addCookies(storage.cookies);
    await context.addInitScript(storage => {
      for (const [key, value] of Object.entries(storage)) {
        window.localStorage.setItem(key, value);
      }
    }, storage.localStorage);
  
    const page = await context.newPage();
  
    // Navigate to a page that requires login
    await page.goto(bilibiliUrl);
  
    const cookies = await context.cookies();
    const sess = cookies.find(cookie => cookie.name === 'SESSDATA')
    console.log('sses value' + sess.value);
  
    await page.waitForTimeout(5000); // Adjust this time as needed for your actions
    
    await browser.close();
    // if does not return a sess value, then rerun the login 
    return sess.value
  } catch(error) {
    console.log('Error', error);
  };
}
const parseHtml = async (html, sses) => {
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15'

 try{
    const config = {
      headers: {
        'User-Agent': `${UA}`,
        cookie: `SESSDATA=${sses}`
      }
    };
    const body = await axios.get(html, config);
    return parseBV(body.data, html)
  } catch (error) {
    console.log('dank err')
  }
};

const parseBV = async (html, url) => {
try {
const videoInfo = html.match(/<\/script><script>window\.__INITIAL_STATE__=([\s\S]*?);\(function\(\)/);
if (!videoInfo) throw new Error('parse bv error');
const { videoData } = JSON.parse(videoInfo[1]);

let acceptQuality = null;
try {
  let downLoadData = html.match(/<script>window\.__playinfo__=([\s\S]*?)<\/script><script>window\.__INITIAL_STATE__=/);

  if (!downLoadData) throw new Error('parse bv error');
  downLoadData = JSON.parse(downLoadData[1]);
  acceptQuality = {
    accept_quality: downLoadData.data.accept_quality,
    video: downLoadData.data.dash.video,
    audio: downLoadData.data.dash.audio
  };
} catch (error) {
  // acceptQuality = await getAcceptQuality(videoData.cid, videoData.bvid);
}

const obj = {
  id: '',
  title: videoData.title,
  url,
  bvid: videoData.bvid,
  cid: videoData.cid,
  cover: videoData.pic,
  createdTime: -1,
  quality: -1,
  view: videoData.stat.view,
  danmaku: videoData.stat.danmaku,
  reply: videoData.stat.reply,
  // duration: formatSecond(videoData.duration),
  up: videoData.hasOwnProperty('staff') ? videoData.staff.map(item => ({ name: item.name, mid: item.mid })) : [{ name: videoData.owner.name, mid: videoData.owner.mid }],
  // qualityOptions: acceptQuality.accept_quality.map(item => ({ label: qualityMap[item], value: item })),
  // page: parseBVPageData(videoData, url),
  subtitle: [],
  video: acceptQuality.video ? acceptQuality.video.map(item => ({ id: item.id, cid: videoData.cid, url: item.baseUrl })) : [],
  audio: acceptQuality.audio ? acceptQuality.audio.map(item => ({ id: item.id, cid: videoData.cid, url: item.baseUrl })) : [],
  filePathList: [],
  fileDir: '',
  size: -1,
  downloadUrl: { video: '', audio: '' }
};
return obj;
} catch (error) {
throw new Error(error);
}
};
const getDownloadUrl = async (cid, bvid, quality, sses, bfeId) => {
   const config = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15',
      cookie: `SESSDATA=${sses};bfe_id=${bfeId}`
    },
    responseType: 'json'
  };
  const response = await axios.get(
    `https://api.bilibili.com/x/player/playurl?cid=${cid}&bvid=${bvid}&qn=${quality}&type=&otype=json&fourk=1&fnver=0&fnval=80&session=68191c1dc3c75042c6f35fba895d65b0`,
    config
  );
  // saveResponseCookies(response.headers['set-cookie']);
  return {
    video: response.body.data.dash.video[0].baseUrl,
    audio: response.body.data.dash.audio[0].baseUrl
  };
  // return console.log(response.data.data.dash)
};
// const getBfeId = async () => {
//   const sses = '***REMOVED***-8R9xA-_YFd8qIkKKK6ckMB62m6xyns9cJ9rpr_FSQejq4ESVjBMbnNlQkQ2UllsQmxWT3QyenBSVjhjSm5nMTVRRFBwXzU3bFMxZkNtZEJ2dTdZV3JDbEFDVTBwQjJ1TlRlMndyeEFOOWhrVnNIU0xhNXNYenYzcHFnIIEC'
//   const bfeId = [
//    'buvid3=D3D7FDFE-602A-22C5-5B11-3F858DDBE8F606230infoc; path=/; expires=Thu, 01 Apr 2027 16:33:26 GMT; domain=.bilibili.com',
//    'b_nut=1720197206; path=/; expires=Sat, 05 Jul 2025 16:33:26 GMT; domain=.bilibili.com',
//    'innersign=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; domain=.bilibili.com'
//  ]
//   const config = {
//    headers: {
//      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15',
//      cookie: `SESSDATA=${sses};`
//    },
//    responseType: 'json'
//  };
//  const response = await axios.get(
//    'https://www.bilibili.com/video/BV1wz4y1F7Vc',
//    config
//  );
//  return console.log(response.headers)
// };

// Replace with your actual page ID or database ID
// const pageId = 'https://api.notion.com/v1/pages';
// const databaseId = '735b31852cca438595e68dfac53ed1d7';
const VideoInput = async (englishName, bilibiliUrl) => {
     // Perform URL redirection check and parse HTML
    // const videoUrl ='https://www.bilibili.com/video/BV1wz4y1F7Vc'
    // const bfeId = [
    //   'buvid3=D3D7FDFE-602A-22C5-5B11-3F858DDBE8F606230infoc; path=/; expires=Thu, 01 Apr 2027 16:33:26 GMT; domain=.bilibili.com',
    //   'b_nut=1720197206; path=/; expires=Sat, 05 Jul 2025 16:33:26 GMT; domain=.bilibili.com',
    //   'innersign=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; domain=.bilibili.com'
    // ]
    try {
      // const bfeId = getBfeId();
// highest quality require sses cookie
      const sses = await getCookieSSES(bilibiliUrl)
      const videoInfo = await parseHtml(bilibiliUrl, sses); 
      // getDownloadUrl(1288630873, 'BV1wz4y1F7Vc', 64)
      const videoUrl = videoInfo.video[0].url
      const audioUrl = videoInfo.audio[0].url
      console.log('video URL : '+ videoUrl)
      console.log('audio URL : '+ audioUrl)
      // const config = {
      //   headers: {
      //     'User-Agent': `${UA}`,
      //     cookie: `SESSDATA=${sses};bfe_id=${bfeId}`
      //   },
      //   responseType: 'json'
      // };
      // const response = axios.get(
      //   `https://api.bilibili.com/x/player/playurl?cid=${1288630873}&bvid=${'BV1wz4y1F7Vc'}&qn=127&type=&otype=json&fourk=1&fnver=0&fnval=80&session=68191c1dc3c75042c6f35fba895d65b0`,
      //   config
      // );
      // console.log((await response).headers)
      // getBfeId();
      return Downloader(englishName, bilibiliUrl, videoUrl, audioUrl);
      // return queryDatabase();
    } catch (error) {
      console.log(`解析错误：${error}`);
    }
};

export default VideoInput;