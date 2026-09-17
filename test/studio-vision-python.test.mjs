/**
 * Runs the Python unit tests for the image-driven Studio uploader
 * (scripts/python/tests/test_studio_vision.py) when OpenCV and NumPy are
 * installed; skips otherwise so a Node-only checkout still passes.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const python = process.env.PYTHON_TEST_BIN || 'python3';
const probe = spawnSync(python, ['-c', 'import cv2, numpy'], { stdio: 'ignore' });

test('Studio vision uploader Python suite', { skip: probe.status !== 0 && 'python3 with opencv-python and numpy is not installed', timeout: 240_000 }, () => {
  const run = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'scripts/python/tests'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 230_000,
  });
  assert.equal(run.status, 0, `${run.stderr.split('\n').filter((line) => !line.startsWith('STUDIO_')).slice(-40).join('\n')}`);
});
