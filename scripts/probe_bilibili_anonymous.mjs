/** Explicit anonymous smoke check: never calls session acquisition. */
import axios from 'axios';
import { queryBilibiliCli } from '../src/lib/video/bilibiliCli.js';
import { normalizeBilibiliInfo } from '../src/lib/video/bilibili.js';

const videoId = process.argv[2] || 'BV1xx411c7mD';
if (!/^BV[0-9A-Za-z]{10}$/.test(videoId)) throw new Error('Supply a BV ID');
const data = await queryBilibiliCli({ operation: 'streams', videoId, page: 1 });
if (!data) throw new Error('Run npm run setup:bilibili-cli first');
const info = normalizeBilibiliInfo(data.view, data.play, `https://www.bilibili.com/video/${videoId}`);
const bytes = {};
for (const [kind, url] of [['video', info.videoUrl], ['audio', info.audioUrl]]) {
  const response = await axios.get(url, {
    headers: { Referer: info.canonicalUrl, 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-1023' },
    responseType: 'stream', timeout: 20000,
  });
  let count = 0;
  try {
    for await (const chunk of response.data) {
      count += chunk.length;
      if (count >= 1024) break;
    }
  } finally { response.data.destroy(); }
  if (!count) throw new Error(`No ${kind} bytes received`);
  bytes[kind] = count;
}
console.log(JSON.stringify({ anonymous: true, bvid: info.bvid, quality: data.play.quality,
  videoStreams: data.play.dash.video.length, audioStreams: data.play.dash.audio.length, receivedBytes: bytes }));
