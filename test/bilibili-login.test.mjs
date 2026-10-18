import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { connectBilibiliProfile, ensureBilibiliSession, getBilibiliLoginStatus, normalizeBilibiliProfileUrl, refreshBilibiliLoginStatus, signWbiParams, withAutomaticBilibiliSession } from '../src/lib/video/bilibili.js';
import { EventEmitter } from 'node:events';

function writeStorage(directory, cookies) {
  const storagePath = path.join(directory, 'storage.json');
  fs.writeFileSync(storagePath, JSON.stringify({ cookies, origins: [] }));
  return storagePath;
}

test('Bilibili login status accepts a valid Playwright SESSDATA session without exposing its value', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bilibili-login-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storagePath = writeStorage(directory, [{
    name: 'SESSDATA',
    value: 'never-return-this-secret',
    domain: '.bilibili.com',
    path: '/',
    expires: 2_000_000_000,
  }]);

  const status = getBilibiliLoginStatus({ storagePath, now: 1_000_000_000_000 });

  assert.equal(status.authenticated, true);
  assert.equal(status.persisted, true);
  assert.equal(status.waitingForLogin, false);
  assert.doesNotMatch(JSON.stringify(status), /never-return-this-secret/);
});

test('Bilibili login status rejects expired or missing sessions', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bilibili-login-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storagePath = writeStorage(directory, [{
    name: 'SESSDATA',
    value: 'expired-session',
    domain: '.bilibili.com',
    path: '/',
    expires: 1,
  }]);

  const status = getBilibiliLoginStatus({ storagePath, now: 1_000_000_000_000 });

  assert.equal(status.authenticated, false);
  assert.equal(status.persisted, false);
  assert.match(status.message, /No setup required/);
});

test('cookie look-alike domains and empty cookie values do not authenticate', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bilibili-domain-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const cookie of [
    { name: 'SESSDATA', value: 'test-fixture', domain: 'evilbilibili.com', expires: -1 },
    { name: 'SESSDATA', value: '', domain: '.bilibili.com', expires: -1 },
  ]) {
    assert.equal(getBilibiliLoginStatus({ storagePath: writeStorage(directory, [cookie]) }).authenticated, false);
  }
});

test('profile URLs reject foreign hosts and normalize the supplied creator URL', () => {
  assert.equal(normalizeBilibiliProfileUrl('http://space.bilibili.com/33633128/upload/video?x=1'), 'https://space.bilibili.com/33633128');
  for (const value of ['https://space.bilibili.com.evil.test/33633128', 'https://example.com/1', 'https://user:pass@space.bilibili.com/1', 'https://space.bilibili.com:444/1', 'file:///33633128', 'https://space.bilibili.com/abc']) {
    assert.throws(() => normalizeBilibiliProfileUrl(value));
  }
});

const testCookie = { name: 'SESSDATA', value: 'test-only-bilibili-session', domain: '.bilibili.com', path: '/', expires: -1 };

test('a connected profile reuses a verified saved cookie without opening a login window', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bilibili-connect-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storagePath = writeStorage(directory, [testCookie]);
  const status = await connectBilibiliProfile({ profileUrl: 'https://space.bilibili.com/33633128', storagePath }, {
    verifySession: async () => ({ accountId: '42', accountName: 'Test viewer' }),
    importCookies: async () => assert.fail('A working saved cookie must not read Chrome'),
    launch: async () => assert.fail('A working saved cookie must not open a window'),
  });
  assert.equal(status.verified, true);
  assert.equal(status.profileUrl, 'https://space.bilibili.com/33633128');
  assert.equal(status.accountId, '42'); // Viewer identity is separate from source creator ID.
  assert.doesNotMatch(JSON.stringify(status), /test-only-bilibili-session/);
  assert.equal(fs.statSync(storagePath).mode & 0o777, 0o600);
  assert.equal(getBilibiliLoginStatus({ storagePath }).profileUrl, status.profileUrl);
});

test('a new installation captures a verified Chrome cookie lazily without a login form', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bilibili-auto-cookie-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storagePath = path.join(directory, 'storage.json');
  const status = await ensureBilibiliSession({ storagePath }, {
    importCookies: async () => ({ sessions: [{ cookies: [testCookie] }] }),
    verifySession: async () => ({ accountId: '42', accountName: 'Test viewer' }),
  });
  assert.deepEqual(status, { available: true, source: 'chrome' });
  assert.equal(getBilibiliLoginStatus({ storagePath }).authenticated, true);
  assert.equal(fs.statSync(storagePath).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(status), /test-only-bilibili-session/);
});

test('public videos need no saved cookie or credential discovery', async () => {
  const value = await withAutomaticBilibiliSession(async (cookie) => {
    assert.equal(cookie, '');
    return 'public video';
  }, {}, { acquireSession: async () => assert.fail('Public success must not require a session') });
  assert.equal(value, 'public video');
});

test('a blocked public source retries once with the automatically gathered cookie', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bilibili-auto-retry-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storagePath = path.join(directory, 'storage.json');
  let attempts = 0;
  const value = await withAutomaticBilibiliSession(async (cookie) => {
    attempts += 1;
    if (!cookie) throw new Error('Bilibili session required');
    assert.equal(cookie, testCookie.value);
    return 'restricted video';
  }, { storagePath }, { acquireSession: async () => {
    writeStorage(directory, [testCookie]);
    return { available: true };
  } });
  assert.equal(value, 'restricted video');
  assert.equal(attempts, 2);
});

test('optional profile connection captures the cookie after a one-time browser sign-in', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bilibili-browser-capture-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storagePath = path.join(directory, 'storage.json');
  let cookies = [];
  let navigated = '';
  const browserContext = new EventEmitter();
  browserContext.pages = () => [{ goto: async (url) => { navigated = url; } }];
  browserContext.cookies = async () => cookies;
  browserContext.storageState = async () => ({ cookies, origins: [] });
  browserContext.close = async () => browserContext.emit('close');
  context.after(() => browserContext.close());
  const waiting = await connectBilibiliProfile({ profileUrl: 'https://space.bilibili.com/33633128', storagePath }, {
    verifySession: async (items) => items.length ? { accountId: '42', accountName: 'Test viewer' } : null,
    importCookies: async () => ({ sessions: [] }),
    launch: async () => browserContext,
  });
  assert.equal(waiting.waitingForLogin, true);
  assert.equal(navigated, 'https://space.bilibili.com/33633128');
  assert.equal(fs.existsSync(storagePath), false);
  cookies = [testCookie];
  const captured = await refreshBilibiliLoginStatus();
  assert.equal(captured.authenticated, true);
  assert.equal(captured.verified, true);
  assert.equal(getBilibiliLoginStatus({ storagePath }).authenticated, true);
});

test('WBI stream request signing produces a stable signature from public nav keys', () => {
  const signed = signWbiParams(
    { bvid: 'BV1Rd8B6VEQx', cid: 31586547521, fnval: 4048 },
    'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
    'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
    1_700_000_000,
  );

  assert.equal(signed.wts, 1_700_000_000);
  assert.match(signed.w_rid, /^[a-f0-9]{32}$/);
  assert.equal(signed.bvid, 'BV1Rd8B6VEQx');
});
