import axios from 'axios';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import Downloader from './downloader.js';
import { assertBilibiliUrl, guardRedirect, normalizeBilibiliVideoInput } from './bilibiliUrl.js';
import { readChromeBilibiliCookies } from './browserCookies.js';
import { bilibiliCookieBrowserDirectory, launchBilibiliCookieBrowser } from './bilibiliCookieBrowser.js';

const BILIBILI_ORIGIN = 'https://www.bilibili.com';
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

// Next.js route bundles share the same pending browser and capture operation.
const loginRuntime = globalThis[Symbol.for('videops.bilibili.session')] ||= { active: null, pending: null };

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
    && typeof cookie.value === 'string' && cookie.value.trim()
    && /(^|\.)bilibili\.com$/i.test(String(cookie.domain || '').replace(/^\./, ''))
    && (Number(cookie.expires) <= 0 || Number(cookie.expires) * 1000 > now)
  )) || null;
}

export function normalizeBilibiliProfileUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Enter a Bilibili profile URL such as https://space.bilibili.com/123456.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'space.bilibili.com' || url.port || url.username || url.password || !/^\/\d{1,20}(?:\/|$)/.test(url.pathname)) {
    throw new Error('Use a profile URL on space.bilibili.com with a numeric creator ID.');
  }
  return `https://space.bilibili.com/${url.pathname.split('/')[1]}`;
}

export function normalizeBilibiliConnectionUrl(value) {
  const input = String(value || '').trim();
  try {
    if (new URL(input).hostname === 'space.bilibili.com') return normalizeBilibiliProfileUrl(input);
  } catch { /* The common validator below returns a safe input error. */ }
  const url = new URL(normalizeBilibiliVideoInput(input));
  if (url.username || url.password || url.port) throw new Error('Use a Bilibili profile or video URL without credentials or a custom port.');
  return url.toString();
}

function connectionDetails(storagePath) {
  try {
    const saved = JSON.parse(fs.readFileSync(`${storagePath}.connection.json`, 'utf8'));
    return { profileUrl: normalizeBilibiliConnectionUrl(saved.profileUrl), accountId: String(saved.accountId || ''), accountName: String(saved.accountName || ''), verifiedAt: String(saved.verifiedAt || '') };
  } catch { return { profileUrl: '', accountId: '', accountName: '', verifiedAt: '' }; }
}

function writePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function verifyBilibiliCookies(cookies) {
  const cookie = sessionCookie(cookies);
  if (!cookie) return null;
  let payload;
  try {
    ({ data: payload } = await axios.get(NAV_API_URL, {
      headers: apiHeaders(cookie.value), timeout: 15_000, beforeRedirect: guardRedirect,
    }));
  } catch {
    // Axios errors contain the authenticated headers; never propagate them.
    throw new Error('Could not verify the Bilibili session. Check the network and try again.');
  }
  if (Number(payload?.code) === -101 || payload?.data?.isLogin === false) return null;
  if (Number(payload?.code) !== 0 || payload?.data?.isLogin !== true) throw new Error('Bilibili did not confirm the session. Try again after its access check clears.');
  return { accountId: String(payload.data.mid || ''), accountName: String(payload.data.uname || '') };
}

function saveConnectedSession(storagePath, state, profileUrl, identity) {
  writePrivateJson(storagePath, { cookies: state.cookies || [], origins: state.origins || [] });
  writePrivateJson(`${storagePath}.connection.json`, { profileUrl, ...identity, verifiedAt: new Date().toISOString() });
  return { ...getBilibiliLoginStatus({ storagePath }), verified: true, message: `Saved Bilibili cookie connected${identity.accountName ? ` as ${identity.accountName}` : ''}. The profile URL is ready to use.` };
}

/**
 * Returns only non-secret session state. The SESSDATA value remains confined to
 * the private cookie file and the downloader process.
 */
export function getBilibiliLoginStatus({ storagePath = bilibiliStoragePath(), now = Date.now() } = {}) {
  const details = connectionDetails(storagePath);
  if (loginRuntime.active?.storagePath === storagePath) {
    return {
      ...details, profileUrl: loginRuntime.active.profileUrl,
      authenticated: false, waitingForLogin: true, persisted: false, expiresAt: '',
      message: 'The Bilibili link is open in Puppeteer. Sign in once in that browser if needed; Video Ops will capture and save SESSDATA automatically. The public link itself does not contain a login cookie.',
    };
  }
  const cookie = sessionCookie(readStorageState(storagePath).cookies, now);
  if (cookie) {
    return {
      ...details, authenticated: true,
      waitingForLogin: false,
      persisted: true,
      expiresAt: Number(cookie.expires) > 0 ? new Date(Number(cookie.expires) * 1000).toISOString() : '',
      message: 'Saved Bilibili cookie is available. Sources start with public access and use cookies automatically when needed.',
    };
  }
  return {
    ...details, authenticated: false,
    waitingForLogin: false,
    persisted: false,
    expiresAt: '',
    message: 'No setup required. Use a Bilibili URL to start; Video Ops gathers available browser cookies automatically if the source needs them.',
  };
}

async function persistActiveLoginIfReady() {
  const active = loginRuntime.active;
  if (!active) return getBilibiliLoginStatus();
  if (active.capture) return active.capture;
  active.capture = (async () => {
    const cookies = await active.context.cookies(BILIBILI_ORIGIN);
    const cookie = sessionCookie(cookies);
    if (!cookie || cookie.value === active.rejectedCookie) return getBilibiliLoginStatus({ storagePath: active.storagePath });
    const identity = await active.verifySession(cookies);
    if (!identity) {
      active.rejectedCookie = cookie.value;
      return getBilibiliLoginStatus({ storagePath: active.storagePath });
    }
    const state = await active.context.storageState();
    clearInterval(active.timer);
    loginRuntime.active = null;
    const status = saveConnectedSession(active.storagePath, state, active.profileUrl, identity);
    await active.context.close();
    return status;
  })();
  try { return await active.capture; } finally { active.capture = null; }
}

/**
 * A public profile identifies the source creator, never its session secret.
 * Reuse and verify saved cookies first. Only an absent/expired session opens
 * the requested profile in an app-owned persistent browser for one-time login.
 */
export async function connectBilibiliProfile({ profileUrl, storagePath = bilibiliStoragePath() } = {}, {
  verifySession = verifyBilibiliCookies,
  importCookies = readChromeBilibiliCookies,
  launch = launchBilibiliCookieBrowser,
} = {}) {
  const normalizedUrl = normalizeBilibiliConnectionUrl(profileUrl);
  if (loginRuntime.pending) {
    await loginRuntime.pending;
    return connectBilibiliProfile({ profileUrl: normalizedUrl, storagePath }, { verifySession, importCookies, launch });
  }
  if (loginRuntime.active) return getBilibiliLoginStatus({ storagePath: loginRuntime.active.storagePath });
  loginRuntime.pending = (async () => {
    const state = readStorageState(storagePath);
    const identity = await verifySession(state.cookies);
    if (identity) return saveConnectedSession(storagePath, state, normalizedUrl, identity);
    const imported = await importCookies();
    for (const session of imported.sessions || []) {
      if (!sessionCookie(session.cookies || [])) continue;
      const importedIdentity = await verifySession(session.cookies);
      if (importedIdentity) return saveConnectedSession(storagePath, { cookies: session.cookies, origins: [] }, normalizedUrl, importedIdentity);
    }
    const directory = bilibiliCookieBrowserDirectory(storagePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const context = await launch(directory, { headless: false, userAgent: USER_AGENT });
    const active = { context, storagePath, profileUrl: normalizedUrl, verifySession, capture: null, timer: null };
    loginRuntime.active = active;
    context.on('close', () => {
      clearInterval(active.timer);
      if (loginRuntime.active === active) loginRuntime.active = null;
    });
    try {
      const page = (await context.pages())[0] || await context.newPage();
      await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const status = await persistActiveLoginIfReady();
      if (loginRuntime.active === active) {
        active.timer = setInterval(() => { persistActiveLoginIfReady().catch(() => {}); }, 2500);
        active.timer.unref?.();
      }
      return status;
    } catch {
      loginRuntime.active = null;
      await context.close();
      throw new Error('Could not open the Bilibili profile browser on this backend. Connect from a machine with a desktop session.');
    }
  })();
  try { return await loginRuntime.pending; } finally { loginRuntime.pending = null; }
}

export async function startBilibiliLogin({ profileUrl, storagePath = bilibiliStoragePath() } = {}) {
  return connectBilibiliProfile({ profileUrl: profileUrl || connectionDetails(storagePath).profileUrl, storagePath });
}

export async function refreshBilibiliLoginStatus() {
  return persistActiveLoginIfReady();
}

/** Lazy acquisition for scraping/downloads: never opens an interactive window. */
export async function ensureBilibiliSession({ storagePath = bilibiliStoragePath(), sourceUrl } = {}, {
  verifySession = verifyBilibiliCookies, importCookies = readChromeBilibiliCookies,
  launch = launchBilibiliCookieBrowser,
} = {}) {
  // Validate before any saved credential is used for a caller-supplied URL.
  const target = sourceUrl ? normalizeBilibiliConnectionUrl(sourceUrl) : '';
  const state = readStorageState(storagePath);
  const existing = sessionCookie(state.cookies);
  if (existing && await verifySession(state.cookies)) return { available: true, source: 'saved' };
  const imported = await importCookies();
  for (const session of imported.sessions || []) {
    if (!sessionCookie(session.cookies || [])) continue;
    if (!await verifySession(session.cookies)) continue;
    writePrivateJson(storagePath, { cookies: session.cookies, origins: [] });
    return { available: true, source: 'chrome' };
  }
  // Recover a still-signed-in app browser when the exported cookie file is
  // absent/expired. A worker never opens a new interactive login window.
  if (target && fs.existsSync(bilibiliCookieBrowserDirectory(storagePath))) {
    if (loginRuntime.active?.storagePath === storagePath) {
      const status = await persistActiveLoginIfReady();
      if (status.authenticated && status.verified) return { available: true, source: 'puppeteer' };
      return { available: false, source: 'public' };
    }
    let context;
    try {
      context = await launch(bilibiliCookieBrowserDirectory(storagePath), { headless: true, userAgent: USER_AGENT });
      const page = (await context.pages())[0] || await context.newPage();
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const cookies = await context.cookies();
      if (sessionCookie(cookies) && await verifySession(cookies)) {
        writePrivateJson(storagePath, { cookies, origins: [] });
        return { available: true, source: 'puppeteer' };
      }
    } catch { /* The normal public-first failure explains how to sign in. */ }
    finally { if (context) await context.close().catch(() => {}); }
  }
  return { available: false, source: 'public' };
}

/** Public videos work immediately; restricted responses trigger cookie discovery. */
export async function withAutomaticBilibiliSession(operation, options = {}, {
  acquireSession = ensureBilibiliSession,
} = {}) {
  try { return await operation(''); } catch (publicError) {
    const session = await acquireSession(options);
    if (!session.available) throw new Error(`${publicError.message} No signed-in Bilibili cookie was found automatically. Public sources need no setup; restricted sources need an existing Bilibili browser sign-in.`);
    const cookie = sessionCookie(readStorageState(options.storagePath).cookies);
    return operation(cookie?.value || '');
  }
}

export async function launchBilibiliBrowser(options = {}) {
  try { return await chromium.launch(options); } catch (error) {
    if (!/Executable doesn't exist/.test(String(error.message))) throw error;
    return chromium.launch({ ...options, channel: 'chrome' });
  }
}

function apiHeaders(sessData) {
  return {
    'User-Agent': USER_AGENT,
    Referer: `${BILIBILI_ORIGIN}/`,
    ...(sessData ? { cookie: `SESSDATA=${sessData}` } : {}),
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
      description: String(videoData.desc || ''),
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
  const safeUrl = normalizeBilibiliVideoInput(bilibiliUrl);
  const info = await withAutomaticBilibiliSession((session) => parseBilibiliVideoInfo(safeUrl, session), { ...options, sourceUrl: safeUrl });
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
    const safeUrl = normalizeBilibiliVideoInput(bilibiliUrl);
    const info = await withAutomaticBilibiliSession((session) => parseBilibiliVideoInfo(safeUrl, session), { ...options, sourceUrl: safeUrl });
    console.log(`Starting Bilibili download: ${info.title} (as ${videoName})`);
    const filePath = await Downloader(videoName, info.canonicalUrl || bilibiliUrl, info.videoUrl, info.audioUrl, options);
    return { filePath, title: info.title, description: info.description, canonicalUrl: info.canonicalUrl || bilibiliUrl };
  } catch (error) {
    console.error('Bilibili Process Error:', error.message);
    throw error;
  }
}
