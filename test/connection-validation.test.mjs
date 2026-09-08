import assert from 'node:assert/strict';
import test from 'node:test';

const {
  listConnections, probeService, recordOutcome, saveConnection, validateCredentials,
} = await import('../src/lib/pipeline/connections.js');
const { runDiagnostics } = await import('../src/lib/pipeline/diagnostics.js');

test('connection fields reject malformed values before they are saved or tested', () => {
  const badUrl = validateCredentials('douyin', { sidecarUrl: '127.0.0.1:8756' });
  assert.equal(badUrl.valid, false);
  assert.match(badUrl.issues.sidecarUrl, /complete HTTP URL/i);

  const badKey = validateCredentials('metadata', { kimiApiKey: 'AIza-not-a-kimi-key' });
  assert.equal(badKey.valid, false);
  assert.match(badKey.issues.kimiApiKey, /Kimi keys start/i);
});

test('connection fields accept a usable sidecar URL without requiring optional credentials', () => {
  const result = validateCredentials('douyin', { sidecarUrl: 'http://127.0.0.1:8756' });
  assert.equal(result.valid, true);
});

test('recordOutcome is the shared writer for service health', () => {
  recordOutcome('douyin', { error: 'Token has been expired' });
  const connection = listConnections().find((row) => row.serviceId === 'douyin');
  assert.equal(connection.status, 'failed');
  assert.equal(connection.authState, 'expired');
  assert.match(connection.lastError, /expired/i);
  assert.ok(connection.checkedAt);
});

test('saving new credentials clears a previous auth verdict and check time', () => {
  saveConnection('douyin', { sidecarUrl: 'http://127.0.0.1:8756' });
  recordOutcome('douyin', { error: '401 unauthorized' });
  const failed = listConnections().find((row) => row.serviceId === 'douyin');
  assert.equal(failed.authState, 'expired');
  assert.ok(failed.checkedAt);

  saveConnection('douyin', { sidecarUrl: 'http://127.0.0.1:8757' });
  const saved = listConnections().find((row) => row.serviceId === 'douyin');
  assert.equal(saved.status, 'untested');
  assert.equal(saved.authState, 'unknown');
  assert.equal(saved.checkedAt, '');
});

test('adapter probes and Diagnostics share the persisted connection outcome', async () => {
  await probeService('localFile');
  const connection = listConnections().find((row) => row.serviceId === 'localFile');
  const checks = await runDiagnostics();
  const diagnostic = checks.find((row) => row.id === 'localFile');

  assert.equal(connection.status, 'ok');
  assert.equal(connection.authState, 'valid');
  assert.ok(connection.checkedAt);
  assert.equal(diagnostic.status, 'ok');
  assert.equal(diagnostic.authState, connection.authState);
  assert.equal(diagnostic.checkedAt, connection.checkedAt);
});
