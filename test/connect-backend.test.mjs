import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('connection CLI saves only after authenticated backend verification, never prints tokens', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-connect-'));
  const runtime = path.join(root, 'runtime.json');
  const token = path.join(root, 'token');
  const mock = path.join(root, 'fetch.mjs');
  try {
    fs.writeFileSync(token, 'test-secret', { mode: 0o600 });
    fs.writeFileSync(mock, `
      import assert from 'node:assert/strict';
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://backend.test/api/server/runtime/ping');
        assert.equal(options.headers.authorization, 'Bearer test-secret');
        assert.equal(options.redirect, 'error');
        return Response.json({ok: true, service: 'video-automation-backend', runtime: {connectionMode: 'server'}}, {status: Number(process.env.MOCK_STATUS)});
      };
    `);
    const run = (status, save = false) => spawnSync(process.execPath, [
      '--import', mock, 'scripts/connect_backend.mjs', 'https://backend.test', token, ...(save ? ['--save'] : []),
    ], { encoding: 'utf8', env: { ...process.env, VIDEO_RUNTIME_SETTINGS_PATH: runtime, MOCK_STATUS: String(status) } });
    const denied = run(401, true);
    assert.equal(denied.status, 1);
    assert.equal(fs.existsSync(runtime), false);
    assert.equal(run(200).status, 0);
    assert.equal(fs.existsSync(runtime), false);
    const saved = run(200, true);
    assert.equal(saved.status, 0, saved.stderr);
    assert.equal(saved.stdout.includes('test-secret'), false);
    const settings = JSON.parse(fs.readFileSync(runtime));
    assert.equal(settings.connectionMode, 'remote');
    assert.equal(settings.workerEnabled, false);
    assert.equal(settings.remoteAuthToken, 'test-secret');
    const before = fs.readFileSync(runtime, 'utf8');
    assert.equal(run(401, true).status, 1);
    assert.equal(fs.readFileSync(runtime, 'utf8'), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
