import fs from 'fs';
import { queryBilibiliCli } from './bilibiliCli.js';
import { bilibiliStoragePath, ensureBilibiliSession, launchBilibiliBrowser, signWbiParams } from './bilibili.js';

const SPACE_HOST = 'space.bilibili.com';
const PAGE_SIZE = 30;
const NAV_API_URL = 'https://api.bilibili.com/x/web-interface/nav';
const SPACE_VIDEO_API_URL = 'https://api.bilibili.com/x/space/wbi/arc/search';
const BILIBILI_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function durationSeconds(value) {
  const parts = String(value || '').split(':').map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  return parts.reduce((total, part) => (total * 60) + part, 0);
}

export function normalizeBilibiliSpaceUrl(value) {
  const input = String(value || '').trim();
  const parsed = new URL(input);
  if (parsed.hostname.toLowerCase() !== SPACE_HOST) {
    throw new Error('Bilibili account URL must use space.bilibili.com');
  }
  const accountId = parsed.pathname.split('/').filter(Boolean)[0] || '';
  if (!/^\d{1,20}$/.test(accountId)) throw new Error('Bilibili account URL must contain a numeric account ID');
  return `https://${SPACE_HOST}/${accountId}/upload/video?tid=0&pn=1&keyword=&order=pubdate`;
}

export function bilibiliSpacePageUrl(value, pageNumber = 1) {
  const page = Number(pageNumber);
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error('Bilibili account page must be a positive page number');
  const pageUrl = new URL(normalizeBilibiliSpaceUrl(value));
  pageUrl.searchParams.set('pn', String(page));
  return pageUrl.toString();
}

function accountIdFromSpaceUrl(value) {
  return new URL(normalizeBilibiliSpaceUrl(value)).pathname.split('/').filter(Boolean)[0];
}

function spaceVideoUrl(bvid) {
  return `https://www.bilibili.com/video/${bvid}`;
}

/**
 * Converts the public account API response into the deliberately small shape
 * consumed by the source adapter. This is kept separate from Playwright so
 * changed Bilibili markup cannot silently corrupt a batch.
 */
export function parseBilibiliSpaceVideos(payload) {
  if (Number(payload?.code) !== 0) {
    throw new Error(`Bilibili public-video API returned ${payload?.code ?? 'an invalid response'}${payload?.message ? `: ${payload.message}` : ''}`);
  }
  const rows = Array.isArray(payload?.data?.list?.vlist) ? payload.data.list.vlist : [];
  const videos = rows.map((row) => {
    const bvid = String(row?.bvid || '').trim();
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return null;
    return {
      name: String(row?.title || '').trim() || 'Untitled Bilibili video',
      link: spaceVideoUrl(bvid),
      length: String(row?.length || '').trim(),
      bvid,
      durationSeconds: durationSeconds(row?.length),
      uploadedAt: Number(row?.created) > 0 ? new Date(Number(row.created) * 1000).toISOString() : '',
      description: String(row?.description || '').trim(),
      thumbnailUrl: String(row?.pic || '').trim(),
      uploader: String(row?.author || '').trim(),
    };
  }).filter(Boolean);
  return { videos, total: Math.max(0, Number(payload?.data?.page?.count) || 0) };
}

async function browserJson(page, resource) {
  return page.evaluate(async (url) => {
    const response = await fetch(url, {
      credentials: 'include',
      signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { code: response.status || -1, message: 'Bilibili returned a non-JSON response' };
    }
  }, resource);
}

async function wbiKeys(page) {
  const payload = await browserJson(page, NAV_API_URL);
  const wbi = payload?.data?.wbi_img;
  if (!wbi?.img_url || !wbi?.sub_url) throw new Error('Bilibili did not provide WBI signing keys');
  return wbi;
}

async function requestSpaceVideos(page, accountId, pageNumber, keys) {
  const params = signWbiParams({
    mid: accountId,
    pn: pageNumber,
    ps: PAGE_SIZE,
    order: 'pubdate',
    platform: 'web',
  }, keys.img_url, keys.sub_url);
  const url = new URL(SPACE_VIDEO_API_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return parseBilibiliSpaceVideos(await browserJson(page, url.toString()));
}

/** Agent scanning is explicitly paged; never silently report a capped scan as complete. */
export async function scanBilibiliCreatorPage(creatorUrl, pageNumber = 1) {
  const target = bilibiliSpacePageUrl(creatorUrl, pageNumber);
  const accountId = accountIdFromSpaceUrl(target);
  try {
    const result = await requestCliCreatorPage(accountId, Number(pageNumber));
    if (result) return result;
  } catch { /* Retry through the existing browser API and session fallback. */ }
  const browser = await launchBilibiliBrowser({ headless: true });
  try {
    const storagePath = bilibiliStoragePath();
    const context = await browser.newContext({ userAgent: BILIBILI_USER_AGENT });
    const page = await context.newPage();
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // No DOM fallback here: an ambiguous page must be an error, not "complete".
    let result;
    try {
      result = await requestSpaceVideos(page, accountId, pageNumber, await wbiKeys(page));
    } catch (error) {
      const session = await ensureBilibiliSession({ storagePath, sourceUrl: target });
      if (!session.available) throw error;
      await context.addCookies(JSON.parse(fs.readFileSync(storagePath, 'utf8')).cookies);
      result = await requestSpaceVideos(page, accountId, pageNumber, await wbiKeys(page));
    }
    if (!result.videos.length && (pageNumber - 1) * PAGE_SIZE < result.total) throw new Error('Bilibili returned an incomplete page; retry later');
    return { creatorId: accountId, videos: result.videos, total: result.total,
      nextPage: pageNumber * PAGE_SIZE < result.total ? pageNumber + 1 : null };
  } finally { await browser.close(); }
}

export async function requestCliCreatorPage(accountId, pageNumber, query = queryBilibiliCli) {
  const data = await query({ operation: 'creator-page', creatorId: accountId, page: pageNumber });
  if (!data) return null;
  if (!Array.isArray(data.list?.vlist) || !Number.isInteger(data.page?.count) || data.page.count < 0) {
    throw new Error('Bilibili CLI returned an incomplete creator page');
  }
  const result = parseBilibiliSpaceVideos({ code: 0, data });
  if (result.videos.length < Math.min(PAGE_SIZE, Math.max(0, result.total - (pageNumber - 1) * PAGE_SIZE))) {
    throw new Error('Bilibili CLI returned an incomplete creator page');
  }
  return { creatorId: accountId, ...result, nextPage: pageNumber * PAGE_SIZE < result.total ? pageNumber + 1 : null };
}

async function scrapeVideoCards(page) {
  await page.waitForSelector('a.cover, a[href*="/video/"], a[href*=".bilibili.com/video/"]', { timeout: 10_000 });
  return page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a.cover, a[href*="/video/"], a[href*=".bilibili.com/video/"]'));
    const seen = new Set();
    return anchors.map((anchor) => {
      const href = anchor.href || '';
      if (!/\/video\/(?:BV[a-zA-Z0-9]+|av\d+)/.test(href) || seen.has(href)) return null;
      seen.add(href);
      const card = anchor.closest('li, article, .video-card, .bili-video-card, .small-item') || anchor.parentElement;
      const title = card?.querySelector('a.title, .title, [title]')?.textContent?.trim()
        || anchor.getAttribute('title')?.trim()
        || 'Untitled Bilibili video';
      const length = card?.querySelector('span.length, .length, .bili-video-card__stats__duration')?.textContent?.trim() || '';
      return { name: title, link: href, length };
    }).filter(Boolean);
  });
}

/**
 * Scrapes an account's paginated public video list. The older uploader only
 * read the first space page; keep the browser session open and fetch up to the
 * requested cap so a creator URL can become a full, bounded batch.
 */
export default async function Scraper(pageUrl, { limit = 100 } = {}) {
  pageUrl = normalizeBilibiliSpaceUrl(pageUrl);
  const maximum = Math.max(1, Math.min(100, Number(limit) || 100));
  let browser;
  try {
    // Keep successful anonymous SDK scans entirely browser-free. If any page
    // fails, restart with the existing path rather than return a partial list.
    try {
      const videos = [];
      const seen = new Set();
      let pageNumber = 1;
      while (videos.length < maximum) {
        const result = await requestCliCreatorPage(accountIdFromSpaceUrl(pageUrl), pageNumber);
        if (!result) break;
        for (const video of result.videos) {
          if (!seen.has(video.bvid)) { seen.add(video.bvid); videos.push(video); }
        }
        if (!result.nextPage || videos.length >= maximum) return videos.slice(0, maximum);
        pageNumber = result.nextPage;
      }
    } catch { /* Browser scraping remains the fallback for blocked SDK calls. */ }
    browser = await launchBilibiliBrowser({ headless: true });
    const storagePath = bilibiliStoragePath();
    // Start with public browsing. Cookie discovery happens only when the API
    // refuses the anonymous request; no Connections setup blocks a first use.
    const context = await browser.newContext({
      userAgent: BILIBILI_USER_AGENT,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const allVideos = [];
    const seenLinks = new Set();
    const accountId = accountIdFromSpaceUrl(pageUrl);
    let apiKeys = null;
    let apiUnavailable = false;
    let cookieDiscoveryAttempted = false;

    for (let pageNumber = 1; allVideos.length < maximum; pageNumber += 1) {
      const target = bilibiliSpacePageUrl(pageUrl, pageNumber);
      console.log(`Scraping Bilibili account page ${pageNumber}: ${target}`);
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      let pageVideos = [];
      let totalVideos = 0;
      if (!apiUnavailable) {
        try {
          apiKeys = apiKeys || await wbiKeys(page);
          const response = await requestSpaceVideos(page, accountId, pageNumber, apiKeys);
          pageVideos = response.videos;
          totalVideos = response.total;
        } catch (apiError) {
          if (!cookieDiscoveryAttempted) {
            cookieDiscoveryAttempted = true;
            const session = await ensureBilibiliSession({ storagePath, sourceUrl: target });
            if (session.available) {
              await context.addCookies(JSON.parse(fs.readFileSync(storagePath, 'utf8')).cookies);
              apiKeys = await wbiKeys(page);
              try {
                const response = await requestSpaceVideos(page, accountId, pageNumber, apiKeys);
                pageVideos = response.videos;
                totalVideos = response.total;
              } catch { apiUnavailable = true; }
            } else { apiUnavailable = true; }
          } else { apiUnavailable = true; }
          // Bilibili occasionally blocks a WBI response despite a valid
          // browser session. Preserve the page-card fallback for that case.
          if (apiUnavailable) console.warn(`Bilibili public-video API unavailable: ${apiError.message}`);
        }
      }

      if (apiUnavailable) {
        try {
          pageVideos = await scrapeVideoCards(page);
        } catch {
          if (pageNumber === 1) {
            throw new Error('Bilibili returned no public video data after automatic cookie discovery. Check that the creator has public uploads; restricted pages require a signed-in Bilibili browser session.');
          }
          break;
        }
      }

      for (const video of pageVideos) {
        if (seenLinks.has(video.link)) continue;
        seenLinks.add(video.link);
        allVideos.push(video);
        if (allVideos.length >= maximum) break;
      }
      if (!pageVideos.length || pageVideos.length < PAGE_SIZE || (totalVideos > 0 && pageNumber * PAGE_SIZE >= totalVideos)) break;
    }

    console.log(`Found ${allVideos.length} public Bilibili videos.`);
    return allVideos;

  } catch (error) {
    console.error('Scraping Error:', error.message);
    throw new Error(`Failed to scrape Bilibili: ${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
}
