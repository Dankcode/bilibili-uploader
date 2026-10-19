import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolveAccessPolicy } from '../src/lib/security/access.js';
import { authRequired, operatorGuard, localCookiePairingAllowed } from '../src/lib/agent/auth.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'videops-access-'));
const keys = ['VIDEO_ACCESS_MODE', 'VIDEO_BIND_HOST', 'VIDEO_LOCAL_COOKIE_AUTH', 'VIDEO_OPERATOR_TOKEN', 'VIDEO_AGENT_TOKEN', 'VIDEO_SERVER_API_TOKEN', 'VIDEO_AGENT_CONFIG', 'VIDEO_RUNTIME_SETTINGS_PATH'];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
function reset() {
  for (const key of keys) delete process.env[key];
  process.env.VIDEO_AGENT_CONFIG = path.join(directory, 'no-agent.json');
  process.env.VIDEO_RUNTIME_SETTINGS_PATH = path.join(directory, 'no-settings.json');
}
test.after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  fs.rmSync(directory, { recursive: true, force: true });
});
const request = (method = 'GET', headers = {}, url = 'http://127.0.0.1:4455/api/pipeline/jobs') => new Request(url, { method, headers });

test('local-first policy rejects accidental network binds and shared mode without strong distinct tokens', () => {
  assert.deepEqual(resolveAccessPolicy({}), { mode: 'local', host: '127.0.0.1', localPairing: true });
  assert.throws(() => resolveAccessPolicy({ VIDEO_BIND_HOST: '0.0.0.0' }), /explicit/);
  assert.throws(() => resolveAccessPolicy({ VIDEO_ACCESS_MODE: 'typo' }), /local or shared/);
  assert.throws(() => resolveAccessPolicy({ VIDEO_ACCESS_MODE: 'shared' }), /32 characters/);
  assert.throws(() => resolveAccessPolicy({ VIDEO_ACCESS_MODE: 'shared' }, { operatorToken: 'short' }), /32 characters/);
  const token = 'test-only-shared-operator-token-123456789';
  assert.throws(() => resolveAccessPolicy({ VIDEO_ACCESS_MODE: 'shared' }, { operatorToken: token, agentToken: token }), /distinct/);
  assert.deepEqual(resolveAccessPolicy({ VIDEO_ACCESS_MODE: 'shared' }, { operatorToken: token }), { mode: 'shared', host: '0.0.0.0', localPairing: false });
});

test('credentialless local APIs still reject CSRF, forged Authorization, rebinding Host and forwarded callers', () => {
  reset();
  assert.equal(operatorGuard(request()), null);
  assert.equal(operatorGuard(request('POST', { origin: 'http://127.0.0.1:4455' })), null);
  for (const headers of [{}, { origin: 'http://evil.test' }, { origin: 'http://evil.test', authorization: 'Bearer arbitrary' }]) {
    assert.equal(operatorGuard(request('POST', headers)).status, 403);
  }
  for (const headers of [{ host: 'evil.test' }, { 'x-forwarded-for': '192.168.1.2' }, { 'x-forwarded-host': 'evil.test' }, { forwarded: 'host=evil.test' }]) {
    assert.equal(operatorGuard(request('GET', headers)).status, 403);
  }
  assert.equal(operatorGuard(request('GET', {}, 'http://evil.test/api/pipeline/jobs')).status, 403);
});

test('page sign-in is determined by runtime mode, never by saved tokens or local cookie settings', () => {
  reset();
  process.env.VIDEO_OPERATOR_TOKEN = 'test-only-saved-operator-token-123456789';
  process.env.VIDEO_AGENT_TOKEN = 'test-only-saved-agent-token';
  process.env.VIDEO_LOCAL_COOKIE_AUTH = '0';
  assert.equal(authRequired(), false);
  process.env.VIDEO_ACCESS_MODE = 'shared';
  assert.equal(authRequired(), true);
  process.env.VIDEO_ACCESS_MODE = 'local';
  assert.equal(authRequired(), false);
});

test('shared routes fail closed, authenticate operators, protect cookies and never auto-pair', () => {
  reset(); process.env.VIDEO_ACCESS_MODE = 'shared';
  assert.equal(operatorGuard(request()).status, 503);
  process.env.VIDEO_OPERATOR_TOKEN = 'test-only-shared-operator-token-123456789';
  process.env.VIDEO_AGENT_TOKEN = 'test-only-agent';
  process.env.VIDEO_LOCAL_COOKIE_AUTH = '1'; process.env.VIDEO_BIND_HOST = '127.0.0.1';
  assert.equal(localCookiePairingAllowed(request()), false);
  assert.equal(operatorGuard(request()).status, 401);
  assert.equal(operatorGuard(request('POST', { authorization: 'Bearer test-only-agent' })).status, 401);
  assert.equal(operatorGuard(request('POST', { authorization: `Bearer ${process.env.VIDEO_OPERATOR_TOKEN}` }, 'http://videops.example.test:4455/api/pipeline/jobs')), null);
});

test('launcher loads .env.local before enforcing access policy (without launching a worker)', () => {
  const cwd = fs.mkdtempSync(path.join(directory, 'launcher-'));
  fs.writeFileSync(path.join(cwd, '.env.local'), 'VIDEO_ACCESS_MODE=shared\nVIDEO_BIND_HOST=127.0.0.1\nVIDEO_OPERATOR_TOKEN=test-only-env-operator-token-123456789\n');
  const env = { ...process.env };
  for (const key of keys) delete env[key];
  delete env.__NEXT_PROCESSED_ENV;
  const result = spawnSync(process.execPath, [path.resolve('scripts/run_server.mjs'), 'start', '--web-only', '--check'], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const policy = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(policy.mode, 'shared'); assert.equal(policy.localPairing, false); assert.equal(policy.webOnly, true);
  assert.doesNotMatch(result.stdout, /test-only-env-operator-token/);
});

test('explicit local launch overrides an older device sharing setup without credentials', () => {
  const cwd = fs.mkdtempSync(path.join(directory, 'force-local-'));
  fs.writeFileSync(path.join(cwd, '.env.local'), 'VIDEO_ACCESS_MODE=shared\nVIDEO_BIND_HOST=0.0.0.0\nVIDEO_LOCAL_COOKIE_AUTH=1\n');
  const env = { ...process.env };
  for (const key of keys) delete env[key];
  delete env.__NEXT_PROCESSED_ENV;
  const result = spawnSync(process.execPath, [path.resolve('scripts/run_server.mjs'), 'start', '--local', '--web-only', '--check'], { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const policy = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(policy.mode, 'local'); assert.equal(policy.host, '127.0.0.1'); assert.equal(policy.localPairing, false);
  const conflict = spawnSync(process.execPath, [path.resolve('scripts/run_server.mjs'), 'start', '--local', '--shared', '--check'], { cwd, env, encoding: 'utf8' });
  assert.equal(conflict.status, 1); assert.match(conflict.stderr, /not both/);
});
