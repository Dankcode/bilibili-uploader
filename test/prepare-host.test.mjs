import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareHost } from '../scripts/prepare_host.mjs';

test('host preparation creates protected configuration without opening SQL or enabling delivery', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-host-'));
  try {
    const result = prepareHost(root);
    const runtime = JSON.parse(fs.readFileSync(result.runtimePath));
    assert.equal(runtime.workerEnabled, false);
    assert.equal(runtime.connectionMode, 'server');
    assert.equal(fs.existsSync(runtime.sqlitePath), false);
    assert.equal(fs.statSync(result.envPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(result.runtimePath).mode & 0o777, 0o600);
    const env = fs.readFileSync(result.envPath, 'utf8');
    assert.match(env, /VIDEO_BIND_HOST=127\.0\.0\.1/);
    assert.match(env, /VIDEO_SERVER_API_TOKEN=[a-f0-9]{64}\n/);
    assert.throws(() => prepareHost(root), /Refusing to overwrite/);
    assert.equal(fs.readFileSync(result.envPath, 'utf8'), env);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
