import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDimensions, formatMediaSize, versionLabel } from '../src/lib/media/quality.js';
import { ensureVideoRecord, recordVideoVersion, getVideoProcessGraph } from '../src/lib/operations/store.js';

test('process view retains measured source and current edited video quality', () => {
  const video = ensureVideoRecord({ title: 'Portrait video', sourceType: 'bilibili' });
  const original = recordVideoVersion({ videoId: video.id, kind: 'original', filePath: '/tmp/source.mp4', probe: { width: 480, height: 852, fps: 30, bytes: 1024 ** 2, durationSeconds: 10, codec: 'h264' }, validation: { ok: true, output: { codec: 'h264' } } });
  const edited = recordVideoVersion({ videoId: video.id, kind: 'sam3_inpaint', filePath: '/tmp/edited.mp4', probe: { width: 480, height: 852, fps: 30, bytes: 2 * 1024 ** 2, durationSeconds: 10 }, validation: { ok: true } });
  const result = getVideoProcessGraph(video.id);
  assert.equal(result.video.currentVersionId, edited);
  assert.deepEqual(result.versions.map((v) => v.id), [edited, original]);
  assert.equal(describeDimensions(result.versions[1].width, result.versions[1].height), '480 × 852 · 480p');
  assert.equal(result.versions[0].bytes, 2 * 1024 ** 2);
  assert.equal(versionLabel(result.versions[0].kind), 'SAM3 mask and inpainting');
});

test('missing dimensions and sizes are described without claiming a quality', () => {
  assert.equal(describeDimensions(0, 0), 'Resolution unavailable');
  assert.equal(formatMediaSize(null), '');
  assert.equal(describeDimensions(1920, 1080), '1920 × 1080 · 1080p');
});
