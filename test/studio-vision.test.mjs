import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatchGeminiBatches } from '../src/lib/studio/vision/backends/gemini.js';
import {
  analyzeFrames, correctSegments, getVisionStatus, VISION_SKIPPED_MESSAGE,
} from '../src/lib/studio/vision/index.js';

test('vision correction reports the exact skip when no provider is configured', async () => {
  const environmentKeys = [
    'VISION_BACKEND',
    'GEMINI_API_KEY',
    'KIMI_API_KEY',
    'MOONSHOT_API_KEY',
  ];
  const originalEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  for (const key of environmentKeys) delete process.env[key];
  // The installed Codex CLI can be a valid provider independently of env vars.
  // Select the contract-only local adapter to explicitly exercise the no-provider path.
  process.env.VISION_BACKEND = 'local';
  try {
    assert.equal(getVisionStatus().configured, false);
    await assert.rejects(
      correctSegments([]),
      (error) => error.code === 'VISION_NOT_CONFIGURED' && error.message === VISION_SKIPPED_MESSAGE,
    );
  } finally {
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  }
});

test('Gemini-only configuration is reported as screenshot-context ready', () => {
  const environmentKeys = [
    'VISION_BACKEND',
    'GEMINI_API_KEY',
    'KIMI_API_KEY',
    'MOONSHOT_API_KEY',
  ];
  const originalEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  delete process.env.VISION_BACKEND;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  delete process.env.KIMI_API_KEY;
  delete process.env.MOONSHOT_API_KEY;
  try {
    const status = getVisionStatus();
    const geminiStatus = status.available.find((item) => item.id === 'gemini');
    assert.equal(status.configured, true);
    assert.equal(status.backend, 'gemini');
    assert.equal(status.model, 'gemini-2.0-flash');
    assert.equal(geminiStatus.configured, true);
    assert.equal(geminiStatus.contextCapable, true);
    assert.equal(geminiStatus.contextReady, true);
  } finally {
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  }
});

test('Gemini vision batches send saved JPEG bytes with their matching segment', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-vision-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const imagePath = path.join(directory, 'segment_0007_42870.jpg');
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0xff, 0xd9]);
  fs.writeFileSync(imagePath, image);
  const calls = [];
  const model = {
    async generateContent(parts) {
      calls.push(parts);
      return {
        response: {
          text: () => JSON.stringify({ corrections: [{ segIndex: 7, text: 'Corrected SMOC model name.' }] }),
        },
      };
    },
  };

  const corrected = await dispatchGeminiBatches([{
    segIndex: 7,
    timeMs: 42870,
    imagePath,
    mimeType: 'image/jpeg',
    text: 'Incorrect model name.',
  }], { model, batchSize: 1 });

  assert.equal(calls.length, 1);
  const imagePart = calls[0].find((part) => part.inlineData);
  assert.deepEqual(imagePart, {
    inlineData: { mimeType: 'image/jpeg', data: image.toString('base64') },
  });
  assert.match(calls[0][0].text, /Segment 7 at 42\.870s: Incorrect model name\./);
  assert.deepEqual(corrected, [{ segIndex: 7, text: 'Corrected SMOC model name.' }]);
});

test('Gemini vision drops provider output that does not change transcript text', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-vision-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const imagePath = path.join(directory, 'frame.jpg');
  fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const model = {
    async generateContent() {
      return { response: { text: () => '{"corrections":[{"segIndex":2,"text":"Already correct."}]}' } };
    },
  };

  const corrected = await dispatchGeminiBatches([{
    segIndex: 2,
    timeMs: 1000,
    imagePath,
    mimeType: 'image/jpeg',
    text: 'Already correct.',
  }], { model });

  assert.deepEqual(corrected, []);
});
