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

test('video validation rejects half a second of extra video, a frame-rate change and lost audio, and records the comparison', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'media-timing-'));
  try {
    const make = (file, { seconds = 4, rate = 30, audio = true } = {}) => run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=320x240:r=${rate}:d=${seconds}`,
      ...(audio ? ['-f', 'lavfi', '-i', `sine=d=${seconds}`] : []), '-c:v', 'libx264', '-preset', 'ultrafast', ...(audio ? ['-c:a', 'aac', '-shortest'] : []), '-y', file]);
    const source = path.join(dir, 'source.mp4');
    await make(source);
    const sameAgain = path.join(dir, 'same.mp4'); await make(sameAgain);
    const longer = path.join(dir, 'longer.mp4'); await make(longer, { seconds: 4.5 });
    const faster = path.join(dir, 'faster.mp4'); await make(faster, { rate: 25 });
    const silent = path.join(dir, 'silent.mp4'); await make(silent, { audio: false });
    const opts = { expectedInputPath: source, preserveDuration: true, preserveDimensions: true };
    const ok = await validateVideoOutput(sameAgain, opts);
    assert.equal(ok.comparison.ok, true);
    assert.ok(ok.output.avgFps > 29.9 && ok.output.audio.codec === 'aac');
    await assert.rejects(validateVideoOutput(longer, opts), /durationPreserved.*duration 4\.\d+s -> 4\.5/);
    await assert.rejects(validateVideoOutput(faster, opts), /frameRatePreserved.*frame rate 30\.000 -> 25\.000/);
    await assert.rejects(validateVideoOutput(silent, opts), /audioPreserved.*audio track missing/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
