import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getBilibiliLoginStatus, signWbiParams } from '../src/lib/video/bilibili.js';

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
  assert.match(status.message, /Log in to Bilibili/);
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
