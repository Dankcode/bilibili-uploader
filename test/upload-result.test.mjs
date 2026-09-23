import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUploadResult } from '../src/lib/video/uploadResult.js';

test('logs or arbitrary URLs cannot masquerade as a successful upload', () => {
  for (const value of ['Upload successful', 'https://example.com/video', 'abcdefghijklm', '']) {
    assert.throws(() => parseUploadResult(value), /valid YouTube/);
  }
  assert.equal(parseUploadResult('progress\nX-FMCmi8wkU'), 'https://www.youtube.com/watch?v=X-FMCmi8wkU');
});

test('GUI receipt requires the expected channel, private setting and matching ID', () => {
  const result = { ok: true, method: 'gui', privacyStatus: 'private', channelId: 'expected',
    remoteId: 'X-FMCmi8wkU', url: 'https://www.youtube.com/watch?v=X-FMCmi8wkU' };
  const options = { structured: true, channelId: 'expected' };
  assert.equal(parseUploadResult(JSON.stringify(result), options), result.url);
  for (const patch of [{ok:false}, {channelId:'wrong'}, {privacyStatus:'public'}, {remoteId:'other'}, {method:'api'}]) {
    assert.throws(() => parseUploadResult(JSON.stringify({...result,...patch}), options), /receipt/);
  }
  assert.throws(() => parseUploadResult(result.url, options), /receipt/);
});
