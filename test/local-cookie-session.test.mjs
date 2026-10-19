import assert from 'node:assert/strict';
import test from 'node:test';
import { GET, POST } from '../src/app/api/auth/session/route.js';
import { isOperator, localCookiePairingAllowed, operatorGuard } from '../src/lib/agent/auth.js';

const previous = Object.fromEntries(['VIDEO_BIND_HOST', 'VIDEO_LOCAL_COOKIE_AUTH', 'VIDEO_OPERATOR_TOKEN', 'VIDEO_AGENT_TOKEN'].map((key) => [key, process.env[key]]));
process.env.VIDEO_BIND_HOST = '127.0.0.1';
process.env.VIDEO_LOCAL_COOKIE_AUTH = '1';
process.env.VIDEO_OPERATOR_TOKEN = 'test-only-local-operator';
process.env.VIDEO_AGENT_TOKEN = 'test-only-agent';
test.after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const localRequest = (headers = {}, body = { action: 'pair-local' }) => new Request('http://127.0.0.1:4455/api/auth/session', {
  method: 'POST', headers: { host: '127.0.0.1:4455', origin: 'http://127.0.0.1:4455', ...headers }, body: JSON.stringify(body),
});

test('local browser pairs once to a private thirty-day cookie without transmitting the operator token', async () => {
  const status = await (await GET(new Request('http://127.0.0.1:4455/api/auth/session'))).json();
  assert.equal(status.required, false);
  assert.equal(status.localPairing, true);
  const response = await POST(localRequest());
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000/);
  assert.doesNotMatch(cookie, /test-only-local-operator/);
  assert.equal(isOperator(new Request('http://127.0.0.1:4455', { headers: { cookie: cookie.split(';')[0] } })), true);
  assert.equal(operatorGuard(new Request('http://127.0.0.1:4455/api/control', { method: 'POST', headers: { cookie, origin: 'http://evil.test' } })).status, 403);
});

test('saved tokens never require local users to sign in or obtain an operator cookie', async () => {
  const status = await (await GET(localRequest())).json();
  assert.equal(status.required, false);
  assert.equal(status.authenticated, false);
  assert.equal(operatorGuard(localRequest()), null);
  assert.equal(operatorGuard(new Request('http://127.0.0.1:4455/api/operations/channels')), null);
  assert.equal(operatorGuard(localRequest({ authorization: 'Bearer test-only-agent' })).status, 401);
});

test('agent bearers, foreign origins, and forwarded network clients cannot auto-pair', async () => {
  for (const headers of [
    { authorization: 'Bearer test-only-agent' },
    { origin: 'http://evil.test' },
    { 'x-forwarded-for': '192.168.1.20' },
    { 'x-forwarded-host': 'videops.example.com' },
    { host: 'videops.example.com', origin: 'http://videops.example.com' },
  ]) assert.equal((await POST(localRequest(headers))).status, 403);
});

test('network listeners never pair automatically, even with a spoofed localhost Host', async () => {
  const before = process.env.VIDEO_BIND_HOST;
  process.env.VIDEO_BIND_HOST = '0.0.0.0';
  try {
    assert.equal(localCookiePairingAllowed(localRequest()), false);
    assert.equal((await POST(localRequest())).status, 403);
    assert.equal((await POST(localRequest({}, { token: 'test-only-local-operator' }))).status, 200);
  } finally { process.env.VIDEO_BIND_HOST = before; }
});
