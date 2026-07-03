import fs from 'fs';
import path from 'path';
import Scraper from '../../video/scraper';
import { processBilibiliUrl } from '../../video/bilibili';

export const id = 'bilibili';

function safeName(value) {
  return String(value || 'bilibili-video')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'bilibili-video';
}

export async function testConnection() {
  return { ok: true, detail: 'Bilibili adapter is available' };
}

export async function resolveInput(urlOrId) {
  const input = String(urlOrId || '').trim();
  if (!input) throw new Error('Bilibili input is required');
  if (input.includes('space.bilibili.com')) {
    const videos = await Scraper(input);
    return {
      items: (videos || []).map((video) => ({
        title: video.name,
        url: video.link,
      })),
    };
  }
  const url = /^https?:\/\//i.test(input) ? input : `https://www.bilibili.com/video/${input}`;
  return { items: [{ title: safeName(input), url }] };
}

export async function download(item, destDir, onProgress = () => {}) {
  if (!item?.url) throw new Error('Bilibili item url is required');
  fs.mkdirSync(destDir, { recursive: true });
  const mixFolder = path.join(destDir, 'mix');
  const finalFolder = path.join(destDir, 'final');
  fs.mkdirSync(mixFolder, { recursive: true });
  fs.mkdirSync(finalFolder, { recursive: true });

  onProgress(10, 'Resolving Bilibili streams');
  const baseName = safeName(item.title || 'bilibili-video');
  const filePath = await processBilibiliUrl(baseName, item.url, {
    mixFolder,
    finalFolder,
    outputFileName: `${baseName}.mp4`,
  });
  onProgress(100, 'Downloaded');
  return {
    filePath,
    meta: {
      title: item.title || baseName,
      sourceUrl: item.url,
      platform: 'bilibili',
    },
  };
}
