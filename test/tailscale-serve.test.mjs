import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GET as sessionGET } from '../src/app/api/auth/session/route.js';
import { GET as settingsGET, POST as settingsPOST } from '../src/app/api/runtime/settings/route.js';
import { GET as jobsGET } from '../src/app/api/pipeline/jobs/route.js';

test('Tailscale Serve HTTPS/forwarded headers allow session, settings and jobs without app sign-in', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tailscale-serve-test-'));
  const names = ['VIDEO_RUNTIME_SETTINGS_PATH', 'VIDEO_ACCESS_MODE', 'VIDEO_BIND_HOST'];
  const previous = Object.fromEntries(names.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.VIDEO_RUNTIME_SETTINGS_PATH = path.join(root, 'runtime.json');
  process.env.VIDEO_ACCESS_MODE = 'tailscale';
  process.env.VIDEO_BIND_HOST = '127.0.0.1';
  const headers = { host: '127.0.0.1:4455', 'x-forwarded-host': 'backend.example.ts.net',
    'x-forwarded-proto': 'https', 'x-forwarded-for': '100.80.0.2', origin: 'https://backend.example.ts.net' };
  const session = await sessionGET(new Request('http://127.0.0.1:4455/api/auth/session', { headers }));
  assert.equal(session.status, 200);
  assert.equal((await session.json()).required, false);
  assert.equal(session.headers.get('set-cookie'), null);
  const saved = await settingsPOST(new Request('http://127.0.0.1:4455/api/runtime/settings', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'save', settings: { connectionMode: 'server', workerEnabled: false } }),
  }));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).settings.workerEnabled, false);
  const settings = await settingsGET(new Request('http://127.0.0.1:4455/api/runtime/settings', { headers }));
  assert.equal(settings.status, 200);
  assert.equal((await settings.json()).settings.workerEnabled, false);
  const jobs = await jobsGET(new Request('http://127.0.0.1:4455/api/pipeline/jobs', { headers }));
  assert.equal(jobs.status, 200);
  assert.ok(Array.isArray((await jobs.json()).jobs));
});
