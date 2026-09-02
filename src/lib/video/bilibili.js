import axios from 'axios';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import Downloader from './downloader.js';
import { assertBilibiliUrl, guardRedirect, normalizeBilibiliVideoInput } from './bilibiliUrl.js';

const BILIBILI_ORIGIN = 'https://www.bilibili.com';
const BILIBILI_LOGIN_URL = 'https://passport.bilibili.com/login';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const VIEW_API_URL = 'https://api.bilibili.com/x/web-interface/view';
const NAV_API_URL = 'https://api.bilibili.com/x/web-interface/nav';
const PLAY_URL_API_URL = 'https://api.bilibili.com/x/player/wbi/playurl';
const WBI_MIXIN_KEY_INDEXES = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

let activeLogin = null;

export function bilibiliStoragePath(root = process.cwd()) {
  return path.join(root, 'config', 'storage.json');
}

function readStorageState(storagePath = bilibiliStoragePath()) {
  if (!fs.existsSync(storagePath)) return { cookies: [] };
  try {
    const state = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    return { ...state, cookies: Array.isArray(state?.cookies) ? state.cookies : [] };
  } catch {
    return { cookies: [] };
  }
}

function sessionCookie(cookies, now = Date.now()) {
  return cookies.find((cookie) => (
    cookie?.name === 'SESSDATA'
    && String(cookie.domain || '').replace(/^\./, '').endsWith('bilibili.com')
    && (Number(cookie.expires) <= 0 || Number(cookie.expires) * 1000 > now)
  )) || null;
}

/**
 * Returns only non-secret session state. The SESSDATA value remains confined to
 * the Playwright storage file and the downloader process.
 */
export function getBilibiliLoginStatus({ storagePath = bilibiliStoragePath(), now = Date.now() } = {}) {
  const cookie = sessionCookie(readStorageState(storagePath).cookies, now);
  if (cookie) {
    return {
      authenticated: true,
      waitingForLogin: false,
      persisted: true,
      expiresAt: Number(cookie.expires) > 0 ? new Date(Number(cookie.expires) * 1000).toISOString() : '',
      message: 'Bilibili Playwright session is ready for downloads.',
    };
  }
  if (activeLogin) {
    return {
      authenticated: false,
      waitingForLogin: true,
      persisted: false,
      expiresAt: '',
      message: 'Complete the Bilibili login in the Playwright browser window, then return here.',
    };
  }
  return {
    authenticated: false,
    waitingForLogin: false,
    persisted: false,
    expiresAt: '',
    message: 'Log in to Bilibili with the Playwright browser before starting a download.',
  };
}

async function persistActiveLoginIfReady() {
  if (!activeLogin) return getBilibiliLoginStatus();
  const cookie = sessionCookie(await activeLogin.context.cookies(BILIBILI_ORIGIN));
  if (!cookie) return getBilibiliLoginStatus();
  await activeLogin.context.storageState({ path: activeLogin.storagePath });
  try {
    fs.chmodSync(activeLogin.storagePath, 0o600);
  } catch {
    // Best effort only; storageState already persisted the authenticated session.
  }
  const { browser } = activeLogin;
  activeLogin = null;
  await browser.close();
  return getBilibiliLoginStatus();
}

/**
 * Opens a headed Playwright browser. The operator completes Bilibili login in
 * that window; polling refreshBilibiliLoginStatus() saves the resulting state.
 */
export async function startBilibiliLogin({ storagePath = bilibiliStoragePath() } = {}) {
  if (activeLogin) return getBilibiliLoginStatus();
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(fs.existsSync(storagePath) ? { storageState: storagePath } : {});
  activeLogin = { browser, context, storagePath };
  browser.on('disconnected', () => {
    if (activeLogin?.browser === browser) activeLogin = null;
  });
  try {
    const page = await context.newPage();
    await page.goto(BILIBILI_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return getBilibiliLoginStatus();
  } catch (error) {
    activeLogin = null;
    await browser.close();
    throw new Error(`Could not open Bilibili login: ${error.message}`);
  }
}

export async function refreshBilibiliLoginStatus() {
  return persistActiveLoginIfReady();
}

function getSessData({ storagePath = bilibiliStoragePath() } = {}) {
  const cookie = sessionCookie(readStorageState(storagePath).cookies);
  if (!cookie?.value) {
    throw new Error('Bilibili login required. In Connections, open Bilibili login and complete sign-in in the Playwright browser.');
  }
  return cookie.value;
}

function apiHeaders(sessData) {
  return {
    'User-Agent': USER_AGENT,
    Referer: `${BILIBILI_ORIGIN}/`,
    cookie: `SESSDATA=${sessData}`,
  };
}

function apiError(action, payload) {
  const code = payload?.code;
  const message = payload?.message || payload?.msg || 'unknown Bilibili API error';
  return new Error(`${action} failed${code === undefined ? '' : ` (code ${code})`}: ${message}`);
}

function streamUrl(stream) {
  return stream?.baseUrl || stream?.base_url || stream?.url || '';
}

function wbiKeyPart(url) {
  try {
    return new URL(String(url || '')).pathname.split('/').pop().split('.')[0] || '';
  } catch {
    return '';
  }
}

/**
 * Bilibili's WBI endpoint signs the sorted request parameters with a short-lived
 * key returned by /x/web-interface/nav. The returned object is safe to log: it
 * contains only public request fields and a derived signature, never SESSDATA.
 */
export function signWbiParams(params, imgUrl, subUrl, timestamp = Math.round(Date.now() / 1000)) {
  const lookup = `${wbiKeyPart(imgUrl)}${wbiKeyPart(subUrl)}`;
  const mixinKey = WBI_MIXIN_KEY_INDEXES.map((index) => lookup[index] || '').join('').slice(0, 32);
  if (mixinKey.length !== 32) throw new Error('Bilibili did not return usable WBI signing keys');

  const signed = { ...params, wts: timestamp };
  const query = Object.entries(signed)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => (
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value ?? '').replace(/[!'()*]/g, ''))}`
    ))
    .join('&');
  return { ...signed, w_rid: createHash('md5').update(`${query}${mixinKey}`).digest('hex') };
}

function requestedPage(url, pages) {
  const raw = new URL(url).searchParams.get('p');
  const pageNumber = raw ? Number(raw) : 1;
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error(`Bilibili page must be a positive integer, got: ${raw}`);
  }
  const selected = pages.find((page) => Number(page?.page) === pageNumber);
  if (!selected) throw new Error(`Bilibili video has no page ${pageNumber}`);
  return selected;
}

async function resolveCanonicalVideoUrl(bilibiliUrl) {
  const sourceUrl = assertBilibiliUrl(
    normalizeBilibiliVideoInput(bilibiliUrl),
    'Bilibili metadata request',
  );
  if (!sourceUrl.hostname.toLowerCase().endsWith('b23.tv')) return sourceUrl.toString();

  // Short-link expansion intentionally has no session cookie. The final URL is
  // host-checked before the authenticated API calls begin.
  const response = await axios.get(sourceUrl.toString(), {
    headers: { 'User-Agent': USER_AGENT, Referer: `${BILIBILI_ORIGIN}/` },
    timeout: 30_000,
    beforeRedirect: guardRedirect,
  });
  const finalUrl = response.request?.res?.responseUrl || response.config?.url || sourceUrl.toString();
  assertBilibiliUrl(finalUrl, 'Bilibili short-link redirect');
  return finalUrl;
}

/**
 * Resolves a BV/AV record, its selected page CID, and DASH streams using
 * Bilibili's public metadata and signed player APIs. This avoids scraping
 * page-embedded __playinfo__ markup, which is absent from short/share pages.
 *
 * SECURITY: this is the only request that carries SESSDATA, so the host is
 * checked here — before the header is built — and again on every redirect hop.
 * Callers must not be trusted to have validated the URL themselves.
 */
export async function parseBilibiliVideoInfo(bilibiliUrl, sessData) {
  try {
    const canonicalUrl = await resolveCanonicalVideoUrl(bilibiliUrl);
    const canonical = new URL(canonicalUrl);
    const videoId = canonical.pathname.split('/').filter(Boolean)[1] || '';
    const viewParams = /^av\d+$/i.test(videoId)
      ? { aid: videoId.slice(2) }
      : { bvid: videoId };
    const { data: viewPayload } = await axios.get(VIEW_API_URL, {
      params: viewParams,
      headers: apiHeaders(sessData),
      timeout: 30_000,
      beforeRedirect: guardRedirect,
    });
    if (viewPayload?.code !== 0 || !viewPayload?.data) throw apiError('Bilibili video metadata lookup', viewPayload);
    const videoData = viewPayload.data;
    const pages = Array.isArray(videoData.pages) && videoData.pages.length
      ? videoData.pages
      : [{ page: 1, cid: videoData.cid, part: videoData.title }];
    const page = requestedPage(canonicalUrl, pages);
    const bvid = String(videoData.bvid || '').trim();
    const cid = Number(page?.cid || videoData.cid);
    if (!bvid || !Number.isFinite(cid) || cid <= 0) throw new Error('Bilibili metadata did not include a BV ID and CID');
    const cleanCanonicalUrl = new URL(`/video/${bvid}`, BILIBILI_ORIGIN);
    if (Number(page?.page) > 1) cleanCanonicalUrl.searchParams.set('p', String(page.page));

    const { data: navPayload } = await axios.get(NAV_API_URL, {
      headers: apiHeaders(sessData),
      timeout: 30_000,
      beforeRedirect: guardRedirect,
    });
    const wbi = navPayload?.data?.wbi_img;
    const params = signWbiParams({ bvid, cid, qn: 80, fnval: 4048, fnver: 0, fourk: 1, platform: 'web' }, wbi?.img_url, wbi?.sub_url);
    const { data: playPayload } = await axios.get(PLAY_URL_API_URL, {
      params,
      headers: apiHeaders(sessData),
      timeout: 30_000,
      beforeRedirect: guardRedirect,
    });
    if (playPayload?.code !== 0 || !playPayload?.data) throw apiError('Bilibili stream lookup', playPayload);
    const dash = playPayload.data.dash;
    const videoUrl = (dash?.video || []).map(streamUrl).find(Boolean);
    const audioUrl = [...(dash?.audio || [])]
      .sort((left, right) => Number(right?.bandwidth || 0) - Number(left?.bandwidth || 0))
      .map(streamUrl)
      .find(Boolean);
    if (!videoUrl || !audioUrl) throw new Error('Bilibili did not provide DASH audio/video streams');
    return {
      title: page?.part || videoData.title || 'bilibili-video',
      durationSeconds: Number(page?.duration || videoData.duration || 0),
      uploader: String(videoData.owner?.name || ''),
      thumbnailUrl: String(videoData.pic || ''),
      videoUrl,
      audioUrl,
      canonicalUrl: cleanCanonicalUrl.toString(),
      bvid,
      aid: String(videoData.aid || ''),
      cid: String(cid),
    };
  } catch (error) {
    throw new Error(`Could not resolve Bilibili video: ${error.message}`);
  }
}

/** Read-only metadata preview used by the planner before it creates a job. */
export async function resolveBilibiliVideoPreview(bilibiliUrl, options = {}) {
  const info = await parseBilibiliVideoInfo(bilibiliUrl, getSessData({ storagePath: options.storagePath }));
  return {
    title: info.title,
    url: info.canonicalUrl || String(bilibiliUrl),
    durationSeconds: Number(info.durationSeconds) || 0,
    uploader: info.uploader || '',
    thumbnailUrl: info.thumbnailUrl || '',
    bvid: info.bvid || '',
  };
}

/**
 * Downloads a Bilibili video and reports what it actually was.
 *
 * Returns `{ filePath, title, canonicalUrl }`. The title is the one Bilibili
 * publishes, not a slug of whatever the operator pasted — without it a job
 * started from a URL is catalogued, and then published to YouTube, as
 * "https-bilibili.com-video-B2J2aDS".
 */
export async function processBilibiliUrl(videoName, bilibiliUrl, options = {}) {
  try {
    console.log(`Processing Bilibili URL: ${bilibiliUrl}`);
    const sessData = getSessData({ storagePath: options.storagePath });
    const info = await parseBilibiliVideoInfo(bilibiliUrl, sessData);
    console.log(`Starting Bilibili download: ${info.title} (as ${videoName})`);
    const filePath = await Downloader(videoName, info.canonicalUrl || bilibiliUrl, info.videoUrl, info.audioUrl, options);
    return { filePath, title: info.title, canonicalUrl: info.canonicalUrl || bilibiliUrl };
  } catch (error) {
    console.error('Bilibili Process Error:', error.message);
    throw error;
  }
}
