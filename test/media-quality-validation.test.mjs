import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { validateVideoOutput } from '../src/lib/media/validation.js';

const run = promisify(execFile);

test('video validation accepts full-resolution edits and rejects downscaled output', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'media-quality-'));
  try {
    const source = path.join(dir, 'source.mp4');
    const sameSize = path.join(dir, 'same-size.mp4');
    const downscaled = path.join(dir, 'downscaled.mp4');
    for (const [file, size, color] of [[source, '1920x1080', 'blue'], [sameSize, '1920x1080', 'red'], [downscaled, '854x480', 'red']]) {
      await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=${color}:s=${size}:r=5`, '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', file]);
    }
    const opts = { expectedInputPath: source, preserveDuration: true, preserveDimensions: true };
    const result = await validateVideoOutput(sameSize, opts);
    assert.equal(result.output.width, 1920);
    assert.equal(result.output.height, 1080);
    await assert.rejects(validateVideoOutput(downscaled, opts), /dimensionsPreserved/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
