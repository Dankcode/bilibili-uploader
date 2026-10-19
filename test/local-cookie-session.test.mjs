import assert from 'node:assert/strict';
import test from 'node:test';
import { GET, POST } from '../src/app/api/auth/session/route.js';
import { authRequired, localCookiePairingAllowed, operatorGuard } from '../src/lib/agent/auth.js';

test('legacy session endpoints never require login or issue operator cookies', async () => {
  for (const handler of [GET, POST]) {
    const response = await handler(new Request('http://100.80.0.7:4455/api/auth/session', { method: handler === POST ? 'POST' : 'GET' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { required: false, authenticated: true, localPairing: false });
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('network and MCP callers do not need operator credentials, cookies or Origin headers', () => {
  assert.equal(authRequired(), false);
  for (const headers of [{}, { authorization: 'Bearer old-agent-token' }, { forwarded: 'for=100.80.0.8', host: 'video-host.tailnet.ts.net' }]) {
    const request = new Request('http://100.80.0.7:4455/api/pipeline/jobs', { method: 'POST', headers });
    assert.equal(operatorGuard(request), null);
    assert.equal(localCookiePairingAllowed(request), false);
  }
});
