import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mergeContextTracks } from '../src/lib/studio/context.js';
import { proposeTranscriptRepairs } from '../src/lib/context/ocr/repair.js';
import { validateProcessorChain } from '../src/lib/pipeline/registry.js';
import { analyzeFramesWithFallback } from '../src/lib/context/vision/index.js';

test('context processor ordering rejects reversed and missing dependencies', () => {
  assert.equal(validateProcessorChain(['voiceover', 'videoContext']).ok, false);
  assert.equal(validateProcessorChain(['ocrContext']).ok, false);
  assert.equal(validateProcessorChain(['videoContext', 'ocrContext', 'voiceover']).ok, true);
});

test('OCR repairs preserve every segment identity and timing', () => {
  const segments = [{ index: 1, start: 0, end: 2, text: 'The EGFR mutation is present.' }];
  const result = proposeTranscriptRepairs(segments, [{ start: 0.2, end: 1.8, text: 'The EGFR mutation is present.', confidence: 0.99 }]);
  assert.deepEqual(result.correctedSegments.map(({ index, start, end }) => ({ index, start, end })), [{ index: 1, start: 0, end: 2 }]);
});

test('OCR context merges exact visible text while retaining vision topic', () => {
  const contexts = mergeContextTracks([{
    id: 'frame-0001', captureTime: 10, windowStart: 5, windowEnd: 15,
    topic: 'EGFR pathway overview', summary: 'A diagram', visibleText: ['approximate'], entities: ['EGFR'],
  }], [{ id: 'ocr-0001', start: 8, end: 12, text: 'EGFR L858R', confidence: 0.99 }]);
  assert.equal(contexts[0].topic, 'EGFR pathway overview');
  assert.deepEqual(contexts[0].visibleText, ['EGFR L858R']);
});

test('vision fallback records a failed provider and uses the next provider', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-chain-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const imagePath = path.join(directory, 'frame.jpg');
  fs.writeFileSync(imagePath, Buffer.from([1]));
  const batch = [{ frameId: 'frame-0001', imagePath }];
  const result = await analyzeFramesWithFallback(batch, {
    chain: ['first', 'second'],
    backends: {
      first: { id: 'first', async analyzeFrames() { throw new Error('quota'); } },
      second: { id: 'second', async analyzeFrames() { return { contexts: [{ frameId: 'frame-0001' }], provider: 'Second', model: 'test', promptVersion: 'test.v1' }; } },
    },
  });
  assert.equal(result.fallbackUsed, 'second');
  assert.deepEqual(result.attempts.map((item) => item.ok), [false, true]);
});
