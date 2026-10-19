import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { bilibiliBrowserCookies, bilibiliCookieBrowserDirectory, launchBilibiliCookieBrowser } from '../src/lib/video/bilibiliCookieBrowser.js';
import { connectBilibiliProfile, ensureBilibiliSession, getBilibiliLoginStatus, normalizeBilibiliConnectionUrl } from '../src/lib/video/bilibili.js';

const cookie = { name: 'SESSDATA', value: 'test-only-puppeteer-session', domain: '.bilibili.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'None' };
const temporary = (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-puppeteer-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test('Puppeteer cookie export includes only non-expired Bilibili cookies in storage-compatible form', () => {
  const result = bilibiliBrowserCookies([cookie,
    { ...cookie, domain: 'evilbilibili.com' }, { ...cookie, domain: '.bilibili.com.evil.test' },
    { ...cookie, domain: '.example.com' }, { ...cookie, expires: 1 },
  ]);
  assert.deepEqual(result, [cookie]);
});

test('Puppeteer uses a private app-owned Chrome profile and never exports foreign cookies or localStorage', async (t) => {
  const directory = path.join(temporary(t), 'profile');
  const browser = new EventEmitter(); let options; let closed = false;
  const page = { goto: async () => {} };
  browser.pages = async () => [page]; browser.newPage = async () => page;
  browser.defaultBrowserContext = () => ({ cookies: async () => [cookie, { ...cookie, domain: '.example.com' }] });
  browser.close = async () => { closed = true; browser.emit('disconnected'); };
  const context = await launchBilibiliCookieBrowser(directory, { headless: false, userAgent: 'test-agent' }, {
    launch: async (value) => { options = value; return browser; },
  });
  assert.equal(options.userDataDir, directory); assert.equal(options.headless, false);
  assert.ok(options.args.includes('--user-agent=test-agent'));
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.deepEqual(await context.storageState(), { cookies: [cookie], origins: [] });
  assert.equal((await context.pages())[0], page);
  let disconnected = false; context.on('close', () => { disconnected = true; });
  await context.close(); assert.equal(closed, true); assert.equal(disconnected, true);
});

test('Puppeteer launch errors do not expose local paths or raw diagnostics', async (t) => {
  await assert.rejects(launchBilibiliCookieBrowser(temporary(t), {}, { launch: async () => { throw new Error('private diagnostic with local account data'); } }), (error) => {
    assert.match(error.message, /Puppeteer browser/); assert.doesNotMatch(error.message, /private diagnostic/); return true;
  });
});

test('connection accepts profile/video links and rejects foreign, credential-bearing and custom-port URLs', () => {
  assert.equal(normalizeBilibiliConnectionUrl('https://space.bilibili.com/123456/upload/video'), 'https://space.bilibili.com/123456');
  assert.equal(normalizeBilibiliConnectionUrl('https://www.bilibili.com/video/BV1234567890'), 'https://www.bilibili.com/video/BV1234567890');
  for (const url of ['https://evil.test/video/BV1234567890', 'https://user:pass@www.bilibili.com/video/BV1234567890', 'https://www.bilibili.com:444/video/BV1234567890']) assert.throws(() => normalizeBilibiliConnectionUrl(url));
});

test('the supplied video URL is opened and its verified Puppeteer cookie is saved privately', async (t) => {
  const storagePath = path.join(temporary(t), 'storage.json');
  const context = new EventEmitter(); let navigated; let closed = false;
  context.pages = async () => [{ goto: async (url) => { navigated = url; } }];
  context.cookies = async () => [cookie]; context.storageState = async () => ({ cookies: [cookie], origins: [] });
  context.close = async () => { closed = true; context.emit('close'); };
  const status = await connectBilibiliProfile({ profileUrl: 'https://www.bilibili.com/video/BV1234567890', storagePath }, {
    verifySession: async (cookies) => cookies.length ? { accountId: '42', accountName: 'Test viewer' } : null,
    importCookies: async () => ({ sessions: [] }),
    launch: async (directory) => { assert.equal(directory, bilibiliCookieBrowserDirectory(storagePath)); return context; },
  });
  assert.equal(navigated, 'https://www.bilibili.com/video/BV1234567890');
  assert.equal(status.authenticated, true); assert.equal(status.verified, true); assert.equal(closed, true);
  assert.equal(fs.statSync(storagePath).mode & 0o777, 0o600);
  assert.equal(getBilibiliLoginStatus({ storagePath }).profileUrl, navigated);
  assert.doesNotMatch(JSON.stringify(status), /test-only-puppeteer-session/);
});

test('a worker recovers cookies from the existing Puppeteer profile using the source URL without opening a login window', async (t) => {
  const storagePath = path.join(temporary(t), 'storage.json');
  fs.mkdirSync(bilibiliCookieBrowserDirectory(storagePath));
  let navigated; let closed = false;
  const status = await ensureBilibiliSession({ storagePath, sourceUrl: 'https://space.bilibili.com/123456' }, {
    verifySession: async (cookies) => cookies.length ? { accountId: '42' } : null,
    importCookies: async () => ({ sessions: [] }),
    launch: async (_directory, options) => {
      assert.equal(options.headless, true);
      return { pages: async () => [{ goto: async (url) => { navigated = url; } }], cookies: async () => [cookie], close: async () => { closed = true; } };
    },
  });
  assert.deepEqual(status, { available: true, source: 'puppeteer' });
  assert.equal(navigated, 'https://space.bilibili.com/123456'); assert.equal(closed, true);
  assert.equal(getBilibiliLoginStatus({ storagePath }).authenticated, true);
});

test('no cookie is invented for a public URL with no signed-in browser session', async (t) => {
  const storagePath = path.join(temporary(t), 'storage.json');
  const status = await ensureBilibiliSession({ storagePath, sourceUrl: 'https://space.bilibili.com/123456' }, {
    verifySession: async () => null, importCookies: async () => ({ sessions: [] }),
    launch: async () => assert.fail('No existing app browser means no headless profile recovery'),
  });
  assert.deepEqual(status, { available: false, source: 'public' }); assert.equal(fs.existsSync(storagePath), false);
});
