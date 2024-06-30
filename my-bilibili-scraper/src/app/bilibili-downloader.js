import React from 'react';
import axios from 'axios';

const parseHtml = async (html, type, url) => {
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15'
 try{
    const config = {
      headers: {
        'User-Agent': `${UA}`,
        cookie: `SESSDATA=34bf5597%2C1735222183%2C2f83b%2A61CjDAsnWWlBcTtwxeAhvRFgXvSZjO-g9qTqu1uuUgWPBDrUl9J_G2Ya8-xNVLXRFRf30SVmpCaHFzNVpPaVZIaTVLbTN4eFcxSERCVEU1WFJuVE83bEJVa1dDaG43OFVqOHFvOUd0M3JoT0k5WUpvZXJqU2xUcmFGVmVXTWtiRjNWaVN5SWdaM2N3IIEC`
      }
    };
    const body = await axios.get('https://www.bilibili.com/video/BV1wz4y1F7Vc', config);
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

  console.log(downLoadData)
  if (!downLoadData) throw new Error('parse bv error');
  downLoadData = JSON.parse(downLoadData[1]);
  acceptQuality = {
    accept_quality: downLoadData.data.accept_quality,
    video: downLoadData.data.dash.video,
    audio: downLoadData.data.dash.audio
  };
} catch (error) {
  acceptQuality = await getAcceptQuality(videoData.cid, videoData.bvid);
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
console.log(obj)
return obj;
} catch (error) {
throw new Error(error);
}
};

const VideoInput = () => {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15'
  const sses = '42e74d36%2C1734950611%2C1c25d%2A61CjDHJF62m-9BH_eDmCkxnpR2YIV0-rtAasnOU3KAAFEKK-1K6csAQJ-mYVK8MO-Xy4kSVkJNN3M3OGNxS1B0TjlUTllIekRFUmhIdWhxUnVreWxhN3l3SFlPUm1Ub29FZEhoOVBjWlk3RV8wM0NqOUZsRUN2V2NtSFpNaEk2SzQxMEhRcWlJdHN3IIEC'

  const HandleDownload = async () => {
    // Perform URL redirection check and parse HTML
    const videoUrl ='https://www.bilibili.com/video/BV1wz4y1F7Vc'
    try {
      const videoInfo = await parseHtml(videoUrl, 1, videoUrl); // Replace with actual HTML
      const config = {
        headers: {
          'User-Agent': `${UA}`,
          cookie: `SESSDATA=${sses};`
        },
        responseType: 'json'
      };
      const response = axios.get(
        `https://api.bilibili.com/x/player/playurl?cid=${1288630873}&bvid=${'BV1wz4y1F7Vc'}`,
        config
      );
      // console.log(response)
    } catch (error) {
      console.log(`解析错误：${error}`);
    }
  };

  return (
    <div>
      <HandleDownload />
    </div>
  );
};

export default VideoInput;