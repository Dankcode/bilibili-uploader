import React from 'react';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15';  // Replace with an appropriate User-Agent string
const sses = '9f784ee9%2C1734377924%2C0ff8c%2A61CjAvwvSgOxszyOfjYbvTWjkMk0oC8h3yScwMFS0keJvpp4fK5PHM5UY-puOXjqPHAfkSVkphYzNYVHFrSGFPb2ZNcmExZl9peVR5TzNRNzVVZVhCdUZFU1dmUEl1NG9nWDNlNG11R0g0ZkxfNzhTODJoZERRdnphY3FxSk9wRXdVQ0VzN1FvYi13IIEC'
function checkUrl(url) {
  const mapUrl = {
    'video/av': 'BV',
    'video/BV': 'BV',
    'play/ss': 'ss',
    'play/ep': 'ep',
  };

  for (const key in mapUrl) {
    if (url.includes(key)) {
      return mapUrl[key];
    }
  }

  return '';
}
function checkUrlRedirect(videoUrl) {
  const config = {
    headers: {
      'User-Agent': `${UA}`,
      cookie: `SESSDATA=${sses}`, // Assuming SESSDATA is a public environment variable
    },
  };
  try {
    const response = (videoUrl, config);
    const body = videoUrl
    const redirectUrls = config
    const url = redirectUrls[0] ? redirectUrls[0] : videoUrl

    return {
      body,
      url
    };
  } catch (error) {
    console.error('Error fetching URL:', error);
    return { body: null, url: videoUrl }; // Return original URL on error
  }
}

function parseHtml(html, type, url) {
  switch (type) {
    case 'BV':
      return parseBV(html, url);
    case 'ss':
      return parseSS(html);
    case 'ep':
      return parseEP(html, url);
    default:
      return null; // Return null for invalid type
  }
}
const parseBV = async (html, url) => {
  try {
    const videoInfo = html.match(/<\/script><script>window\.__INITIAL_STATE__=([\s\S]*?);\(function\(\)/);
    if (!videoInfo) throw new Error('parse bv error');

    const { videoData } = JSON.parse(videoInfo[1]);
    // 获取视频下载地址
    let acceptQuality = null;
    try {
      let downLoadData = html.match(/<script>window\.__playinfo__=([\s\S]*?)<\/script><script>window\.__INITIAL_STATE__=/);
      if (!downLoadData) throw new Error('parse bv error');
      downLoadData = JSON.parse(downLoadData[1]);
      acceptQuality = {
        accept_quality: downLoadData.data.accept_quality,
        video: downLoadData.data.dash.video,
        audio: downLoadData.data.dash.audio,
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
      duration: formatSeconed(videoData.duration),
      up: videoData.hasOwnProperty('staff') 
        ? videoData.staff.map(item => ({ name: item.name, mid: item.mid })) 
        : [{ name: videoData.owner.name, mid: videoData.owner.mid }],
      qualityOptions: acceptQuality.accept_quality.map(item => ({ label: qualityMap[item], value: item })),
      page: parseBVPageData(videoData, url),
      subtitle: [],
      video: acceptQuality.video ? acceptQuality.video.map(item => ({ id: item.id, cid: videoData.cid, url: item.baseUrl })) : [],
      audio: acceptQuality.audio ? acceptQuality.audio.map(item => ({ id: item.id, cid: videoData.cid, url: item.baseUrl })) : [],
      filePathList: [],
      fileDir: '',
      size: -1,
      downloadUrl: { video: '', audio: '' },
    };

    console.log('parserbv prob'+ obj);
    return obj;
  } catch (error) {
    throw new Error(error);
  }
};

const VideoDownloader = () => {


  const videoType = async () => {

    const videoUrl = 'https://www.bilibili.com/video/BV1CJ4m1u7';
    const videoType = checkUrl(videoUrl);

    // 检查登陆状态

    // 检查是否有重定向
    const { body, url } = checkUrlRedirect(videoUrl);
    console.log('bod here' + body +'vid type' + videoType + url)
    // 解析html
    try {
      const videoInfo = await parseHtml(body, videoType, url);
      console.log('its works' + videoInfo)
    } catch (error) {
        console.log(`解析错误：${error}`);
    }
  };
  return(
    <div>
      <button onClick={videoType()}></button>
    </div>
  )
};

export default VideoDownloader;