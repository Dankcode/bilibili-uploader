import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const settingsModule = await import('../src/lib/runtime/settings.js');

test('normalizes local runtime settings and bounds worker intervals', () => {
  const settings = settingsModule.normalizeRuntimeSettings({
    connectionMode: 'local',
    sqlitePath: '/tmp/video-ops.db',
    workerPollSeconds: 0,
    schedulerPollSeconds: 99999,
  });

  assert.equal(settings.connectionMode, 'local');
  assert.equal(settings.sqlitePath, '/tmp/video-ops.db');
  assert.equal(settings.workerPollSeconds, 1);
  assert.equal(settings.schedulerPollSeconds, 3600);
});

test('normalizes Tailscale host input into an HTTP backend URL', () => {
  assert.equal(
    settingsModule.normalizeRemoteUrl('100.90.80.70:4455/'),
    'http://100.90.80.70:4455',
  );
  assert.throws(
    () => settingsModule.normalizeRemoteUrl('file:///tmp/database'),
    /http:\/\/ or https:\/\//,
  );
});

test('persists bootstrap settings without exposing access tokens', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-runtime-'));
  const settingsPath = path.join(directory, 'runtime.json');
  const previousPath = process.env.VIDEO_RUNTIME_SETTINGS_PATH;
  process.env.VIDEO_RUNTIME_SETTINGS_PATH = settingsPath;
  try {
    const saved = settingsModule.writeRuntimeSettings({
      connectionMode: 'remote',
      remoteUrl: 'https://video-host.example.test',
      remoteAuthToken: 'remote-secret',
      serverApiToken: 'server-secret',
    });
    const stored = settingsModule.readRuntimeSettings();
    const publicSettings = settingsModule.publicRuntimeSettings(stored);

    assert.equal(saved.remoteAuthToken, 'remote-secret');
    assert.equal(stored.serverApiToken, 'server-secret');
    assert.equal(publicSettings.hasRemoteAuthToken, true);
    assert.equal(publicSettings.hasServerApiToken, true);
    assert.equal('remoteAuthToken' in publicSettings, false);
    assert.equal('serverApiToken' in publicSettings, false);
    assert.equal(fs.statSync(settingsPath).mode & 0o777, 0o600);
  } finally {
    if (previousPath === undefined) delete process.env.VIDEO_RUNTIME_SETTINGS_PATH;
    else process.env.VIDEO_RUNTIME_SETTINGS_PATH = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
