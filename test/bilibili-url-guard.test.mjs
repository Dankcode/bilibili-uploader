import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assertBilibiliUrl,
  guardRedirect,
  isAllowedBilibiliHost,
  normalizeBilibiliVideoInput,
} from '../src/lib/video/bilibiliUrl.js';
import { parseBilibiliVideoInfo } from '../src/lib/video/bilibili.js';
import { describeDownload, normalizeBilibiliAccountInput, resolveInput } from '../src/lib/pipeline/sources/bilibili.js';
import { bilibiliSpacePageUrl, parseBilibiliSpaceVideos } from '../src/lib/video/scraper.js';
import { listScrapedBilibiliVideos, saveScrapedBilibiliVideos, updateScrapedBilibiliVideo } from '../src/lib/video/scrapedCatalog.js';

test('only real Bilibili hosts are allowed to receive the session cookie', () => {
  for (const host of ['bilibili.com', 'www.bilibili.com', 'space.bilibili.com', 'api.bilibili.com', 'b23.tv']) {
    assert.equal(isAllowedBilibiliHost(host), true, `${host} should be allowed`);
  }
  for (const host of [
    'evil.example.com',
    'bilibili.com.evil.test',   // suffix look-alike
    'notbilibili.com',
    'bilibili.com.br',
    '127.0.0.1',
    '',
  ]) {
    assert.equal(isAllowedBilibiliHost(host), false, `${host} must be rejected`);
  }
});

test('operator input is normalized to a canonical Bilibili video URL', () => {
  assert.equal(normalizeBilibiliVideoInput('BV1xx411c7mD'), 'https://www.bilibili.com/video/BV1xx411c7mD');
  assert.equal(normalizeBilibiliVideoInput('av170001'), 'https://www.bilibili.com/video/av170001');
  assert.equal(normalizeBilibiliVideoInput('170001'), 'https://www.bilibili.com/video/av170001');
  assert.equal(
    normalizeBilibiliVideoInput('https://www.bilibili.com/video/BV1xx411c7mD?p=2'),
    'https://www.bilibili.com/video/BV1xx411c7mD?p=2',
  );
  assert.equal(
    normalizeBilibiliVideoInput('https://bilibili.com/video/B2J2aDS'),
    'https://b23.tv/B2J2aDS',
  );
  assert.equal(normalizeBilibiliVideoInput('B2J2aDS'), 'https://b23.tv/B2J2aDS');
});

test('input that is not a Bilibili video is refused before any request', () => {
  for (const bad of [
    'https://evil.example.com/x',            // foreign host
    'http://127.0.0.1:8899/steal',           // loopback exfiltration target
    '../../etc/passwd',                      // path traversal into /video/
    'not-a-video',                           // free text
    'file:///etc/passwd',                    // non-http scheme
    '',
  ]) {
    assert.throws(
      () => normalizeBilibiliVideoInput(bad),
      /required|Not a Bilibili video|refused|valid URL/,
      `"${bad}" must be rejected`,
    );
  }
});

test('resolveInput refuses a foreign URL instead of producing an item for it', async () => {
  await assert.rejects(() => resolveInput('https://evil.example.com/x'), /not a Bilibili host/);
  await assert.rejects(() => resolveInput('../../etc/passwd'), /Not a Bilibili video/);

  const resolved = await resolveInput('BV1xx411c7mD');
  assert.equal(resolved.items.length, 1);
  assert.equal(resolved.items[0].url, 'https://www.bilibili.com/video/BV1xx411c7mD');
});

test('Bilibili creator account IDs normalize to the paginated public-video endpoint', () => {
  assert.equal(
    normalizeBilibiliAccountInput('49748554'),
    'https://space.bilibili.com/49748554/upload/video?tid=0&pn=1&keyword=&order=pubdate',
  );
  assert.equal(
    bilibiliSpacePageUrl('https://space.bilibili.com/49748554', 3),
    'https://space.bilibili.com/49748554/upload/video?tid=0&pn=3&keyword=&order=pubdate',
  );
  assert.throws(() => normalizeBilibiliAccountInput('https://space.bilibili.com/not-an-id'), /numeric account ID/);
});

test('Bilibili account API results become canonical video records without DOM-card assumptions', () => {
  const result = parseBilibiliSpaceVideos({
    code: 0,
    data: {
      page: { count: 31 },
      list: { vlist: [
        { bvid: 'BV1xx411c7mD', title: 'Public upload', length: '12:34', created: 1704067200, description: 'Source description' },
        { bvid: 'not-a-video', title: 'Ignore this item', length: '00:01' },
      ] },
    },
  });
  assert.equal(result.total, 31);
  assert.deepEqual(result.videos, [{
    name: 'Public upload',
    link: 'https://www.bilibili.com/video/BV1xx411c7mD',
    length: '12:34',
    bvid: 'BV1xx411c7mD',
    durationSeconds: 754,
    uploadedAt: '2024-01-01T00:00:00.000Z',
    description: 'Source description',
    thumbnailUrl: '',
    uploader: '',
  }]);
  assert.throws(() => parseBilibiliSpaceVideos({ code: -403, message: 'access denied' }), /-403/);
});

test('scraped Bilibili videos retain delivery edits and selection after a metadata refresh', () => {
  const creatorId = '987654321';
  const source = [{
    bvid: 'BV1xx411c7mD', name: 'Original source title', link: 'https://www.bilibili.com/video/BV1xx411c7mD',
    description: 'Original source description', durationSeconds: 754, uploadedAt: '2024-01-01T00:00:00.000Z',
  }];
  const first = saveScrapedBilibiliVideos(creatorId, source);
  assert.equal(first[0].selected, true);
  updateScrapedBilibiliVideo({ creatorId, bvid: 'BV1xx411c7mD', selected: false, title: 'Edited delivery title', description: 'Edited delivery description' });
  const refreshed = saveScrapedBilibiliVideos(creatorId, [{ ...source[0], name: 'Updated scraped source title' }]);
  assert.equal(refreshed[0].selected, false);
  assert.equal(refreshed[0].title, 'Edited delivery title');
  assert.equal(refreshed[0].description, 'Edited delivery description');
  assert.equal(listScrapedBilibiliVideos({ creatorId }).videos[0].sourceTitle, 'Updated scraped source title');
});

test('a redirect off a Bilibili host is refused mid-flight', () => {
  assert.doesNotThrow(() => guardRedirect({ hostname: 'www.bilibili.com' }));
  assert.throws(() => guardRedirect({ hostname: 'evil.example.com' }), /non-Bilibili host/);
  assert.throws(() => guardRedirect({}), /non-Bilibili host/);
});

/**
 * The original defect, reproduced: point a "Bilibili" job at a listener we
 * control and assert it never receives the cookie. Before the fix this server
 * logged `cookie: SESSDATA=...`.
 */
test('a non-Bilibili host receives no request at all, let alone the cookie', async () => {
  const received = [];
  const server = http.createServer((request, response) => {
    received.push(request.headers);
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<html>not bilibili</html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-guard-'));
  const storagePath = path.join(storageDir, 'storage.json');
  fs.writeFileSync(storagePath, JSON.stringify({
    cookies: [{ name: 'SESSDATA', value: 'TEST-ONLY-NOT-A-REAL-SESSION', domain: '.bilibili.com', path: '/', expires: -1 }],
    origins: [],
  }));

  try {
    await assert.rejects(
      () => parseBilibiliVideoInfo(`http://127.0.0.1:${port}/steal`, 'TEST-ONLY-NOT-A-REAL-SESSION'),
      /not a Bilibili host/,
    );
    assert.deepEqual(received, [], 'the foreign host must not be contacted at all');
  } finally {
    server.close();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
});

/**
 * The catalog title must be the title Bilibili publishes, not a slug of the
 * pasted URL. Before this, the job that downloaded BV1Rd8B6VEQx was catalogued
 * — and would have been uploaded to YouTube — as
 * "https-bilibili.com-video-B2J2aDS".
 */
test('the download reports the published title, not a slug of the input', async () => {
  const resolved = await resolveInput('https://www.bilibili.com/video/BV1Rd8B6VEQx');
  const item = resolved.items[0];
  assert.match(item.title, /^https-/, 'resolveInput still slugifies a pasted URL');

  const described = describeDownload(
    { filePath: '/tmp/downloaded.mp4', title: 'ASMR | 温柔医生给你打耳洞' },
    item,
    'fallback-name',
  );
  assert.equal(described.filePath, '/tmp/downloaded.mp4');
  assert.equal(described.meta.title, 'ASMR | 温柔医生给你打耳洞');
  assert.ok(!/^https-/.test(described.meta.title), 'the slug must not survive into the catalog title');
  assert.equal(described.meta.sourceUrl, 'https://www.bilibili.com/video/BV1Rd8B6VEQx');
});

test('describeDownload still accepts the older bare-path return', () => {
  const described = describeDownload(
    '/tmp/legacy.mp4',
    { title: 'pasted-slug', url: 'https://www.bilibili.com/video/BV1xx411c7mD' },
    'fallback',
  );
  assert.equal(described.filePath, '/tmp/legacy.mp4');
  assert.equal(described.meta.title, 'pasted-slug', 'with no published title it falls back to the item title');
  assert.equal(described.meta.sourceTitle, '');
});

test('describeDownload refuses a result with no file path', () => {
  assert.throws(() => describeDownload({ title: 'x' }, {}, 'fallback'), /did not return a file path/);
  assert.throws(() => describeDownload(null, {}, 'fallback'), /did not return a file path/);
});
