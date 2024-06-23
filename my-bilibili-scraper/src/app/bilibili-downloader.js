'use client'
import React from 'react';
import axios from 'axios';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15';  // Replace with an appropriate User-Agent string
const sses = '9f784ee9%2C1734377924%2C0ff8c%2A61CjAvwvSgOxszyOfjYbvTWjkMk0oC8h3yScwMFS0keJvpp4fK5PHM5UY-puOXjqPHAfkSVkphYzNYVHFrSGFPb2ZNcmExZl9peVR5TzNRNzVVZVhCdUZFU1dmUEl1NG9nWDNlNG11R0g0ZkxfNzhTODJoZERRdnphY3FxSk9wRXdVQ0VzN1FvYi13IIEC'

const getDownloadUrl = async (cid, bvid, quality) => {
  const SESSDATA = sses
  const bfeId = ''
  const config = {
    headers: {
      'User-Agent': `${UA}`,
      // bfe_id必须要加
      cookie: `SESSDATA=${SESSDATA};bfe_id=${bfeId}`
    },
    responseType: 'json'
  }
  const dankData = await axios.get(
    `https://api.bilibili.com/x/player/playurl?cid=${cid}&bvid=${bvid}&qn=${quality}&type=&otype=json&fourk=1&fnver=0&fnval=80&session=68191c1dc3c75042c6f35fba895d65b0`,
    config
  )
  // 保存返回的cookies
  return console.log(dankData)
}

const VideoDownloader = () => {
  const videoType = async () => {

    const videoUrl = 'https://www.bilibili.com/video/BV1CJ4m1u7';
    // 解析html
    try {
      const response = await axios.get('https://api.bilibili.com/x/player/pagelist?bvid=BV1kb4y1A7Lj');
      const gotData = (response.data);
      console.log(gotData.data[0].cid)
      return getDownloadUrl(gotData.data[0].cid, 'BV1CJ4m1u7', -1)
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