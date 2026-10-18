import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import db from '../src/lib/db/sqlite.js';
import { getCredentials, listConnections, saveConnection } from '../src/lib/pipeline/connections.js';

test('every service refuses new plaintext secrets without an encryption key', (t) => {
  const previous = process.env.STUDIO_SECRET_KEY;
  delete process.env.STUDIO_SECRET_KEY;
  t.after(() => { if (previous === undefined) delete process.env.STUDIO_SECRET_KEY; else process.env.STUDIO_SECRET_KEY = previous; });
  assert.throws(() => saveConnection('metadata', { openaiApiKey: 'test-only-openai-key' }), /STUDIO_SECRET_KEY/);
  assert.equal(db.prepare('SELECT * FROM service_connections WHERE service_id = ?').get('metadata'), undefined);
});

test('connection keys are encrypted, round-trip, and never appear in public settings', (t) => {
  const previous = process.env.STUDIO_SECRET_KEY;
  process.env.STUDIO_SECRET_KEY = randomBytes(32).toString('base64');
  t.after(() => { if (previous === undefined) delete process.env.STUDIO_SECRET_KEY; else process.env.STUDIO_SECRET_KEY = previous; });
  const secret = 'test-only-openai-key';
  saveConnection('metadata', { provider: 'openai', openaiApiKey: secret });
  const stored = db.prepare('SELECT credentials_json FROM service_connections WHERE service_id = ?').get('metadata').credentials_json;
  assert.match(stored, /enc:v1:/);
  assert.ok(!stored.includes(secret));
  assert.equal(getCredentials('metadata').openaiApiKey, secret);
  const publicSettings = JSON.stringify(listConnections());
  assert.ok(!publicSettings.includes(secret));
  assert.ok(!publicSettings.includes('enc:v1:'));
});
