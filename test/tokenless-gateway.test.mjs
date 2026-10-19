import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GET as controlGET, POST as controlPOST } from '../src/app/api/control/[...path]/route.js';
import { GET as gatewayGET } from '../src/app/api/server/[...path]/route.js';
import { writeRuntimeSettings } from '../src/lib/runtime/settings.js';

test('control and backend gateways stream token-free requests through the configured listener', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenless-gateway-'));
  const keys = ['VIDEO_RUNTIME_SETTINGS_PATH', 'VIDEO_BIND_HOST', 'VIDEO_OPERATOR_TOKEN', 'PORT'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.VIDEO_RUNTIME_SETTINGS_PATH = path.join(root, 'runtime.json');
    process.env.VIDEO_BIND_HOST = '100.80.0.7';
    process.env.VIDEO_OPERATOR_TOKEN = 'obsolete-operator-token';
    process.env.PORT = '4455';
    writeRuntimeSettings({ connectionMode: 'server' });
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), headers: options.headers, method: options.method,
        body: options.body ? await new Response(options.body).text() : '' });
      return new Response('media-range', { status: 206, headers: { 'content-range': 'bytes 0-10/100', 'content-type': 'video/mp4' } });
    };
    const context = { params: Promise.resolve({ path: ['studio', 'media', '12'] }) };
    const response = await controlGET(new Request('http://frontend.test/api/control/studio/media/12?download=1', {
      headers: { Range: 'bytes=0-10', Authorization: 'Bearer unused', Cookie: 'videops_operator=unused' },
    }), context);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 0-10/100');
    assert.equal(await response.text(), 'media-range');
    assert.equal(requests[0].url, 'http://100.80.0.7:4455/api/studio/media/12?download=1');
    assert.equal(requests[0].headers.get('range'), 'bytes=0-10');
    assert.equal(requests[0].headers.get('authorization'), null);
    assert.equal(requests[0].headers.get('cookie'), null);
    await gatewayGET(new Request('http://100.80.0.7:4455/api/server/studio/media/12'), context);
    assert.equal(requests[1].headers.get('authorization'), null);
    assert.equal(requests[1].url, 'http://100.80.0.7:4455/api/studio/media/12');
    writeRuntimeSettings({ connectionMode: 'remote', remoteUrl: 'http://100.80.0.8:4455' });
    await controlPOST(new Request('http://frontend.test/api/control/operations/library-upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"videoIds":["12"]}',
    }), { params: Promise.resolve({ path: ['operations', 'library-upload'] }) });
    assert.equal(requests[2].url, 'http://100.80.0.8:4455/api/server/operations/library-upload');
    assert.equal(requests[2].headers.get('authorization'), null);
    assert.equal(requests[2].headers.get('content-type'), 'application/json');
    assert.equal(requests[2].body, '{"videoIds":["12"]}');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
