import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolveAccessPolicy } from '../src/lib/security/access.js';
import { authRequired, operatorGuard } from '../src/lib/agent/auth.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'videops-access-'));
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
const keys = ['VIDEO_ACCESS_MODE', 'VIDEO_BIND_HOST', 'VIDEO_LOCAL_COOKIE_AUTH', 'VIDEO_OPERATOR_TOKEN', 'VIDEO_AGENT_TOKEN', 'VIDEO_SERVER_API_TOKEN', 'VIDEO_AGENT_CONFIG', 'VIDEO_RUNTIME_SETTINGS_PATH', 'TAILSCALE_BIN'];
function environment() {
  const env = { ...process.env };
  for (const key of keys) delete env[key];
  delete env.__NEXT_PROCESSED_ENV;
  return env;
}
function launch(cwd, args = [], env = environment()) {
  return spawnSync(process.execPath, [path.resolve('scripts/run_server.mjs'), 'start', '--web-only', '--check', ...args], { cwd, env, encoding: 'utf8' });
}

test('listener defaults to loopback while explicit network modes need no app credentials', () => {
  assert.deepEqual(resolveAccessPolicy({}), { mode: 'local', host: '127.0.0.1', localPairing: false });
  assert.throws(() => resolveAccessPolicy({ VIDEO_BIND_HOST: '0.0.0.0' }), /explicit/);
  assert.throws(() => resolveAccessPolicy({ VIDEO_ACCESS_MODE: 'typo' }), /local, shared or tailscale/);
  assert.deepEqual(resolveAccessPolicy({ VIDEO_ACCESS_MODE: 'shared' }), { mode: 'shared', host: '0.0.0.0', localPairing: false });
  assert.equal(resolveAccessPolicy({ VIDEO_ACCESS_MODE: 'tailscale', VIDEO_BIND_HOST: '100.80.0.7' }).host, '100.80.0.7');
});

test('no runtime mode, saved token or forwarded header re-enables the app login gate', () => {
  const previous = process.env.VIDEO_ACCESS_MODE;
  try {
    for (const mode of ['local', 'shared', 'tailscale']) {
      process.env.VIDEO_ACCESS_MODE = mode;
      assert.equal(authRequired(), false);
      assert.equal(operatorGuard(new Request('http://100.80.0.7:4455/api/pipeline/jobs', { method: 'POST' })), null);
    }
  } finally { if (previous === undefined) delete process.env.VIDEO_ACCESS_MODE; else process.env.VIDEO_ACCESS_MODE = previous; }
});

test('launcher reads the environment but explicit local launch overrides old sharing configuration', () => {
  const cwd = fs.mkdtempSync(path.join(directory, 'local-'));
  fs.writeFileSync(path.join(cwd, '.env.local'), 'VIDEO_ACCESS_MODE=shared\nVIDEO_BIND_HOST=0.0.0.0\n');
  const network = launch(cwd);
  assert.equal(network.status, 0, network.stderr);
  assert.equal(JSON.parse(network.stdout.trim().split('\n').at(-1)).mode, 'shared');
  const result = launch(cwd, ['--local']);
  assert.equal(result.status, 0, result.stderr);
  const policy = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(policy.mode, 'local'); assert.equal(policy.host, '127.0.0.1'); assert.equal(policy.localPairing, false);
  assert.equal(launch(cwd, ['--local', '--shared']).status, 1);
});

test('Tailscale launcher discovers its bind address with no tokens or approval setup', () => {
  const cwd = fs.mkdtempSync(path.join(directory, 'tailnet-'));
  const cli = path.join(cwd, 'tailscale');
  fs.writeFileSync(cli, '#!' + process.execPath + '\nconsole.log("100.80.0.7");\n', { mode: 0o700 });
  const result = launch(cwd, ['--tailscale'], { ...environment(), TAILSCALE_BIN: cli });
  assert.equal(result.status, 0, result.stderr);
  const policy = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(policy.mode, 'tailscale'); assert.equal(policy.host, '100.80.0.7');
  assert.equal(policy.localPairing, false);
});
