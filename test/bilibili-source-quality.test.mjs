import test from 'node:test';
import assert from 'node:assert/strict';
import { describeStreamSelection, normalizeBilibiliInfo, withPreferredBilibiliSession } from '../src/lib/video/bilibili.js';
import { describeSourceMatch, describeSourceSelection } from '../src/lib/media/quality.js';

const view = { bvid: 'BV1sN4A6DEoX', cid: 43261235048, title: 'Vlinder', pages: [{ page: 1, cid: 43261235048 }] };
const stream = (id, width, height, codecs, bandwidth) => ({ id, width, height, codecs, bandwidth, frameRate: '29.889', baseUrl: `https://upos.example/${id}-${codecs}.m4s` });
const play = {
  accept_quality: [116, 80, 64, 32, 16], accept_description: ['1080P 60帧', '1080P 高清', '720P 准高清', '480P 标清', '360P 流畅'],
  dash: {
    video: [stream(80, 1080, 1920, 'hev1.1.6.L150.90', 600000), stream(80, 1080, 1920, 'avc1.640033', 1381161), stream(64, 720, 1280, 'avc1.640033', 900000), stream(32, 480, 852, 'avc1.640033', 309115)],
    audio: [{ id: 30280, bandwidth: 132000, codecs: 'mp4a.40.2', baseUrl: 'https://upos.example/a.m4s' }],
  },
};

test('the highest offered quality is picked (AVC within it) and the offer is recorded', () => {
  const info = normalizeBilibiliInfo(view, play, 'https://www.bilibili.com/video/BV1sN4A6DEoX');
  assert.match(info.videoUrl, /80-avc1/);
  assert.deepEqual(info.streamSelection.selected, { qualityId: 80, width: 1080, height: 1920, codecs: 'avc1.640033', frameRate: '29.889', bandwidth: 1381161 });
  assert.equal(info.streamSelection.highestOffered, true);
  assert.deepEqual(info.streamSelection.unavailableQualities, [{ qualityId: 116, label: '1080P 60帧' }]);
  assert.deepEqual(info.streamSelection.offeredQualities.map((q) => q.qualityId), [80, 64, 32]);
});

test('downloads use the verified saved session first and fall back to public access', async () => {
  const seen = [];
  const operation = async (sessData) => { seen.push(sessData); return { title: 't' }; };
  const storage = { storagePath: '/nonexistent' };
  const publicOnly = await withPreferredBilibiliSession(operation, storage, { acquireSession: async () => ({ available: false }) });
  assert.equal(publicOnly.session, 'public');
  assert.deepEqual(seen, ['']);
  // A session that is "available" but whose cookie cannot be read still falls back, and says so.
  const unreadable = await withPreferredBilibiliSession(operation, storage, { acquireSession: async () => ({ available: true }) });
  assert.equal(unreadable.session, 'public');
});

test('source and edit descriptions state what was measured, not more', () => {
  const selection = describeStreamSelection(play, play.dash.video[1], play.dash.audio[0], play.dash.video);
  assert.equal(describeSourceSelection({ ...selection, session: 'signed-in' }),
    'Bilibili quality 80 (1080P 高清) · 1080 × 1920 · avc1.640033 · signed-in session · highest quality offered · listed but not offered: 1080P 60帧');
  assert.match(describeSourceSelection({ ...selection, session: 'public' }), /public access — a signed-in session may be offered more/);
  assert.match(describeSourceMatch({ comparison: { ok: true, durationDeltaSeconds: 0, durationToleranceSeconds: 0.1 } }), /matches source/);
  assert.match(describeSourceMatch({ comparison: { ok: false, differences: ['dimensions 1080x1920 -> 480x852'] } }), /differs from source: dimensions/);
});
