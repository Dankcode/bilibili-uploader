import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-events-'));
const previousDb = process.env.VIDEO_SQLITE_PATH;
const previousKey = process.env.STUDIO_SECRET_KEY;
process.env.VIDEO_SQLITE_PATH = path.join(directory, 'mail.db');
process.env.STUDIO_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');

const { default: db, closeDB } = await import('../src/lib/db/sqlite.js');
const mail = await import('../src/lib/mail/store.js');
const { emitMailEvent } = await import('../src/lib/mail/events.js');
const secrets = await import('../src/lib/security/secrets.js');

test.after(() => {
  closeDB();
  if (previousDb === undefined) delete process.env.VIDEO_SQLITE_PATH; else process.env.VIDEO_SQLITE_PATH = previousDb;
  if (previousKey === undefined) delete process.env.STUDIO_SECRET_KEY; else process.env.STUDIO_SECRET_KEY = previousKey;
  fs.rmSync(directory, { recursive: true, force: true });
});

test('mail refresh tokens are encrypted and never returned by public account reads', () => {
  const account = mail.registerMailAccount({ emailAddress: 'operator@example.com', refreshToken: 'refresh-token-value', labelPrefix: 'Studio' });
  const stored = db.prepare('SELECT credential_ref FROM mail_accounts WHERE id=?').get(account.id);
  assert.match(stored.credential_ref, /^enc:v1:/);
  assert.doesNotMatch(stored.credential_ref, /refresh-token-value/);
  assert.equal('refreshToken' in account, false);
  assert.equal(mail.getMailAccount(account.id, { includeCredential: true }).refreshToken, 'refresh-token-value');
  assert.equal(secrets.decryptSecret(secrets.encryptSecret('round-trip')), 'round-trip');
});

test('mail events are idempotent and remain outside the job transaction', () => {
  const account = mail.listMailAccounts()[0];
  mail.setMailAccountEnabled(account.id, true);
  assert.equal(emitMailEvent({ videoId: 'video-a', jobId: 9, eventKind: 'job.failed', stepId: '2', payload: { detail: 'fixture failure' } }), 1);
  assert.equal(emitMailEvent({ videoId: 'video-a', jobId: 9, eventKind: 'job.failed', stepId: '2', payload: { detail: 'fixture failure' } }), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM mail_outbox').get().count, 1);
});
