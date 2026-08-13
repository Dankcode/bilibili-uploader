import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import ffmpegPath from 'ffmpeg-static';
import { validateVideoOutput } from '../src/lib/media/validation.js';
import { process as cutScenes } from '../src/lib/pipeline/processors/sceneCut.js';
import { resolveCreds } from '../src/lib/pipeline/processors/faceFusion.js';

const execFileAsync = promisify(execFile);

test('scene editor cuts multiple clips and normalizes a vertical MP4', { timeout: 120000 }, async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-edit-test-'));
  const inputPath = path.join(workDir, 'input.mp4');
  try {
    await execFileAsync(ffmpegPath, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      inputPath,
    ], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });

    const result = await cutScenes(inputPath, {
      clips: [{ start: 0, end: 0.5 }, { start: 1, end: 1.5 }],
      aspectRatio: '9:16',
      encodingPreset: 'ultrafast',
      crf: 28,
    });
    const validation = await validateVideoOutput(result.outputPath, { expectedInputPath: inputPath });
    assert.equal(validation.output.width, 720);
    assert.equal(validation.output.height, 1280);
    assert.match(validation.output.format, /mp4|mov/);
    assert.ok(validation.output.durationSeconds >= 0.8 && validation.output.durationSeconds <= 1.2);
    assert.notEqual(validation.input?.sha256, validation.output.sha256);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('FaceFusion credentials default to safe automatic provider selection', () => {
  const defaults = resolveCreds({ facefusionDir: '/tmp/facefusion-test' });
  assert.equal(defaults.executionProviders, 'auto');
  assert.equal(defaults.pythonBin, 'python3');
  const configured = resolveCreds({
    facefusionDir: '/tmp/facefusion-test',
    pythonBin: '/custom/python',
    executionProviders: 'cpu',
    sourcePaths: '/tmp/source.jpg',
  });
  assert.equal(configured.pythonBin, '/custom/python');
  assert.equal(configured.executionProviders, 'cpu');
  assert.equal(configured.sourcePaths, '/tmp/source.jpg');
});
