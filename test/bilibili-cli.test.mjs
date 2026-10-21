import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import axios from 'axios';
import { queryBilibiliCli } from '../src/lib/video/bilibiliCli.js';
import { normalizeBilibiliInfo, parseBilibiliVideoInfo } from '../src/lib/video/bilibili.js';
import { requestCliCreatorPage } from '../src/lib/video/scraper.js';

const url = 'https://www.bilibili.com/video/BV1xx411c7mD?p=2';
const view = {
  bvid: 'BV1xx411c7mD', aid: 170001, title: 'Title', owner: { name: 'Creator' },
  pages: [{ page: 1, cid: 1, part: 'First' }, { page: 2, cid: 2, part: 'Second', duration: 42 }],
};
const play = { dash: {
  video: [
    { id: 16, baseUrl: 'https://cdn.example/360', codecs: 'avc1' },
    { id: 32, base_url: 'https://cdn.example/480-av1', codecs: 'av01' },
    { id: 32, baseUrl: 'https://cdn.example/480-avc', codecs: 'avc1' },
  ],
  audio: [{ bandwidth: 64, baseUrl: 'https://cdn.example/64' }, { bandwidth: 128, base_url: 'https://cdn.example/128' }],
} };

test('SDK resolves page-specific public DASH streams without sending a session', async () => {
  const info = await parseBilibiliVideoInfo(url, '', { queryCli: async (request) => {
    assert.deepEqual(request, { operation: 'streams', videoId: 'BV1xx411c7mD', page: 2 });
    return { view, play };
  } });
  assert.equal(info.title, 'Second');
  assert.equal(info.cid, '2');
  assert.equal(info.canonicalUrl, url);
  assert.equal(info.videoUrl, 'https://cdn.example/480-avc');
  assert.equal(info.audioUrl, 'https://cdn.example/128');
});

test('SDK previews require metadata only and work when streams are unavailable', async () => {
  const info = await parseBilibiliVideoInfo(url, '', { metadataOnly: true, queryCli: async (request) => {
    assert.equal(request.operation, 'metadata');
    return { view, play: null };
  } });
  assert.equal(info.durationSeconds, 42);
  assert.equal(info.videoUrl, undefined);
  assert.throws(() => normalizeBilibiliInfo(view, null, url), /DASH/);
  assert.throws(() => normalizeBilibiliInfo(view, play, `${url}0`), /no page 20/);
});

test('native public metadata works when the optional SDK fails, without nav or player calls', async (t) => {
  const calls = [];
  t.mock.method(axios, 'get', async (endpoint, config) => {
    calls.push(endpoint);
    assert.equal(config.headers.cookie, undefined);
    return { data: { code: 0, data: view } };
  });
  const info = await parseBilibiliVideoInfo(url, '', {
    metadataOnly: true, queryCli: async () => { throw new Error('SDK unavailable'); },
  });
  assert.equal(info.title, 'Second');
  assert.deepEqual(calls, ['https://api.bilibili.com/x/web-interface/view']);
});

test('authenticated native retries never pass cookies to the SDK', async (t) => {
  t.mock.method(axios, 'get', async (_endpoint, config) => {
    assert.equal(config.headers.cookie, 'SESSDATA=test-session');
    return { data: { code: 0, data: view } };
  });
  const info = await parseBilibiliVideoInfo(url, 'test-session', {
    metadataOnly: true, queryCli: async () => assert.fail('Authenticated requests must stay in native adapter'),
  });
  assert.equal(info.cid, '2');
});

test('creator page preserves totals and pagination and rejects incomplete responses', async () => {
  const data = { page: { count: 31 }, list: { vlist: [{ bvid: view.bvid, title: 'Last video', length: '00:42' }] } };
  const page = await requestCliCreatorPage('123', 2, async (request) => {
    assert.deepEqual(request, { operation: 'creator-page', creatorId: '123', page: 2 });
    return data;
  });
  assert.equal(page.total, 31);
  assert.equal(page.nextPage, null);
  assert.equal(page.videos[0].durationSeconds, 42);
  await assert.rejects(() => requestCliCreatorPage('123', 1, async () => data), /incomplete/);
  await assert.rejects(() => requestCliCreatorPage('123', 1, async () => ({})), /incomplete/);
});

test('bridge sends JSON over stdin and sanitizes subprocess errors', async () => {
  const request = { operation: 'metadata', videoId: view.bvid, page: 1 };
  let input = '';
  const execute = (python, args, options, done) => {
    assert.equal(python, process.execPath);
    assert.match(args[0], /bilibili_cli_bridge.py$/);
    assert.equal(options.timeout, 65000);
    const stdin = new PassThrough();
    stdin.on('data', (chunk) => { input += chunk; });
    stdin.on('finish', () => done(null, JSON.stringify({ ok: true, data: { view } })));
    return { stdin };
  };
  assert.deepEqual(await queryBilibiliCli(request, { python: process.execPath, execute }), { view });
  assert.deepEqual(JSON.parse(input), request);
  assert.equal(await queryBilibiliCli(request, { python: '/nonexistent/bili-python' }), null);
  await assert.rejects(() => queryBilibiliCli(request, {
    python: process.execPath, execute: (_python, _args, _options, done) => {
      queueMicrotask(() => done(new Error('private subprocess details')));
      return { stdin: new PassThrough() };
    },
  }), (error) => !error.message.includes('private subprocess details'));
});
