import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSourcePreview } from '../src/lib/pipeline/sourceResolve.js';

test('source resolve returns real preview metadata without creating a pipeline job', async () => {
  let resolveCalls = 0;
  let previewCalls = 0;
  const source = {
    async resolveInput(input) {
      resolveCalls += 1;
      assert.equal(input, 'b23.tv/B2J2aDS');
      return { items: [{ title: 'url-slug', url: 'https://www.bilibili.com/video/BV1example' }] };
    },
    async resolvePreview() {
      previewCalls += 1;
      return {
        title: 'Gentle Doctor Piercing Your Ears',
        url: 'https://www.bilibili.com/video/BV1example',
        durationSeconds: 1139,
        uploader: 'Rheaye',
        thumbnailUrl: 'https://i0.hdslb.com/example.jpg',
      };
    },
  };
  const items = await resolveSourcePreview(source, 'b23.tv/B2J2aDS');
  assert.equal(resolveCalls, 1);
  assert.equal(previewCalls, 1);
  assert.deepEqual(items, [{
    title: 'Gentle Doctor Piercing Your Ears',
    url: 'https://www.bilibili.com/video/BV1example',
    durationSeconds: 1139,
    uploader: 'Rheaye',
    thumbnailUrl: 'https://i0.hdslb.com/example.jpg',
  }]);
});
