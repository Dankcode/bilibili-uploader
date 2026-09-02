import fs from 'fs';
import path from 'path';
import Scraper, { normalizeBilibiliSpaceUrl } from '../../video/scraper.js';
import { getBilibiliLoginStatus, processBilibiliUrl, resolveBilibiliVideoPreview } from '../../video/bilibili.js';
import { assertBilibiliUrl, normalizeBilibiliVideoInput } from '../../video/bilibiliUrl.js';
import { saveScrapedBilibiliVideos } from '../../video/scrapedCatalog.js';

export const id = 'bilibili';

function safeName(value) {
  return String(value || 'bilibili-video')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'bilibili-video';
}

function isSpacePage(value) {
  try {
    return new URL(value).hostname.toLowerCase() === 'space.bilibili.com';
  } catch {
    return false;
  }
}

export function normalizeBilibiliAccountInput(value) {
  const input = String(value || '').trim();
  if (/^\d{1,20}$/.test(input)) return normalizeBilibiliSpaceUrl(`https://space.bilibili.com/${input}`);
  return normalizeBilibiliSpaceUrl(input);
}

function creatorIdFromInput(value) {
  const input = String(value || '').trim();
  if (/^\d{1,20}$/.test(input)) return input;
  return new URL(normalizeBilibiliAccountInput(input)).pathname.split('/').filter(Boolean)[0];
}

export async function testConnection() {
  const status = getBilibiliLoginStatus();
  return status.authenticated
    ? { ok: true, detail: status.message }
    : { ok: false, error: status.message };
}

/**
 * Turns operator input into downloadable items.
 *
 * SECURITY: everything returned here eventually reaches a request that carries
 * the stored SESSDATA cookie, so nothing leaves this function unvalidated —
 * neither the operator's input nor the links scraped off a space page.
 */
export async function resolveInput(urlOrId) {
  const input = String(urlOrId || '').trim();
  if (!input) throw new Error('Bilibili input is required');

  if (/^\d{1,20}$/.test(input) || (/^https?:\/\//i.test(input) && isSpacePage(input))) {
    const spaceUrl = normalizeBilibiliAccountInput(input);
    assertBilibiliUrl(spaceUrl, 'Bilibili space');
    const videos = await Scraper(spaceUrl, { limit: 100 });
    const creatorId = creatorIdFromInput(input);
    const saved = saveScrapedBilibiliVideos(creatorId, videos);
    const items = [];
    for (const video of saved) {
      // A scraped page is untrusted input: drop any link that is not a Bilibili video.
      try {
        items.push({
          title: video.title, description: video.description, url: normalizeBilibiliVideoInput(video.url),
          durationSeconds: video.durationSeconds, uploadedAt: video.uploadedAt, thumbnailUrl: video.thumbnailUrl,
          uploader: video.uploader, creatorId: video.creatorId, bvid: video.bvid, selected: video.selected, scraped: true,
        });
      } catch {
        // Skip ads and external embeds rather than failing the whole batch.
      }
    }
    if (!items.length) throw new Error('No Bilibili videos found on that space page');
    return { items };
  }

  return { items: [{ title: safeName(input), url: normalizeBilibiliVideoInput(input) }] };
}

export async function resolvePreview(item) {
  if (!item?.url) throw new Error('Bilibili item url is required');
  if (item.scraped) {
    return {
      title: item.title, url: item.url, durationSeconds: Number(item.durationSeconds) || 0,
      uploader: item.uploader || '', thumbnailUrl: item.thumbnailUrl || '', description: item.description || '',
      uploadedAt: item.uploadedAt || '', creatorId: item.creatorId || '', bvid: item.bvid || '', selected: item.selected !== false, scraped: true,
    };
  }
  return resolveBilibiliVideoPreview(item.url);
}

/**
 * Turns a download result into the source adapter's `{ filePath, meta }`.
 *
 * The title matters more than it looks. `item.title` is `safeName()` applied to
 * whatever the operator pasted, so for a URL it is a slug like
 * "https-bilibili.com-video-B2J2aDS" — which is what the catalog row, and then
 * the YouTube video, would be named. Bilibili's own published title is
 * available from the metadata fetch, so it wins whenever we have it.
 *
 * Accepts both the current `{ filePath, title }` shape and the bare path string
 * older callers returned.
 */
export function describeDownload(downloaded, item = {}, baseName = 'bilibili-video') {
  const isBarePath = typeof downloaded === 'string';
  const filePath = isBarePath ? downloaded : downloaded?.filePath;
  if (!filePath) throw new Error('Bilibili download did not return a file path');
  const publishedTitle = isBarePath ? '' : String(downloaded?.title || '').trim();

  return {
    filePath,
    meta: {
      title: publishedTitle || item.title || baseName,
      sourceTitle: publishedTitle,
      sourceUrl: item.url || '',
      platform: 'bilibili',
    },
  };
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
  const downloaded = await processBilibiliUrl(baseName, item.url, {
    mixFolder,
    finalFolder,
    outputFileName: `${baseName}.mp4`,
  });
  onProgress(100, 'Downloaded');
  return describeDownload(downloaded, item, baseName);
}
