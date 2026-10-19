import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

export function bilibiliCookieBrowserDirectory(storagePath) {
  // Keep the previous Playwright profile intact; Chrome owns this profile.
  return path.join(path.dirname(storagePath), 'bilibili-puppeteer');
}

export function bilibiliBrowserCookies(cookies, now = Date.now()) {
  return cookies.filter((cookie) => (
    /(^|\.)bilibili\.com$/i.test(String(cookie.domain || '').replace(/^\./, ''))
    && (Number(cookie.expires) <= 0 || Number(cookie.expires) * 1000 > now)
  )).map((cookie) => ({
    name: cookie.name, value: cookie.value, domain: cookie.domain,
    path: cookie.path || '/', expires: Number(cookie.expires) || -1,
    httpOnly: Boolean(cookie.httpOnly), secure: Boolean(cookie.secure),
    sameSite: ['Strict', 'Lax', 'None'].includes(cookie.sameSite) ? cookie.sameSite : 'Lax',
  }));
}

/** Cookie-only facade: never exports Chrome localStorage or foreign cookies. */
export async function launchBilibiliCookieBrowser(directory, { headless = false, userAgent } = {}, {
  launch = (options) => puppeteer.launch(options),
} = {}) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let browser;
  try {
    browser = await launch({
      userDataDir: directory, headless, defaultViewport: null,
      // Use Chrome already installed on the backend; no browser download.
      ...(process.env.BILIBILI_CHROME_PATH ? { executablePath: process.env.BILIBILI_CHROME_PATH } : { channel: 'chrome' }),
      ...(userAgent ? { args: [`--user-agent=${userAgent}`] } : {}),
    });
  } catch {
    throw new Error('Could not open the Bilibili Puppeteer browser. Install Chrome (or set BILIBILI_CHROME_PATH), close its other app-owned window, and try again.');
  }
  const context = browser.defaultBrowserContext();
  const cookies = async () => bilibiliBrowserCookies(await context.cookies());
  return {
    pages: () => browser.pages(), newPage: () => browser.newPage(),
    cookies, storageState: async () => ({ cookies: await cookies(), origins: [] }),
    close: () => browser.close(),
    on: (event, handler) => browser.on(event === 'close' ? 'disconnected' : event, handler),
  };
}
