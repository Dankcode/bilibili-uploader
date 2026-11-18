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

test('a stream-copied cut with hidden pre-roll packets passes when the frames shown are identical', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'media-preroll-'));
  try {
    const long = path.join(dir, 'long.mp4');
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=8', '-f', 'lavfi', '-i', 'sine=d=8', '-c:v', 'libx264', '-g', '60', '-bf', '2', '-c:a', 'aac', '-shortest', '-y', long]);
    // Cut between keyframes with stream copy: the clip keeps discard-flagged packets before its start.
    const clip = path.join(dir, 'clip.mp4');
    await run(ffmpeg, ['-v', 'error', '-ss', '2.5', '-i', long, '-t', '4', '-c', 'copy', '-y', clip]);
    // Re-encode what plays.
    const edited = path.join(dir, 'edited.mp4');
    await run(ffmpeg, ['-v', 'error', '-i', clip, '-c:v', 'libx264', '-preset', 'ultrafast', '-fps_mode', 'passthrough', '-c:a', 'copy', '-y', edited]);
    const result = await validateVideoOutput(edited, { expectedInputPath: clip, preserveDuration: true, preserveDimensions: true });
    assert.equal(result.comparison.ok, true);
    if (result.comparison.decodedFrames) {
      // The nominal durations differed, so the frame check ran and found the same frames.
      assert.equal(result.comparison.decodedFrames.input, result.comparison.decodedFrames.output);
      assert.match(result.comparison.note, /decode to \d+ frames/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
