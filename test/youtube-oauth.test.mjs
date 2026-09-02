import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultYouTubeTokenRef, getYouTubeClientStatus, normalizeExpectedGoogleEmail, saveYouTubeClientSecret, youtubeClientSecretPath, youtubeTokenPath } from '../src/lib/youtube/oauth.js';

test('YouTube OAuth client files are constrained to a simple local credential reference', () => {
  assert.equal(
    youtubeClientSecretPath('youtube-ops', '/private/tmp/video-ops-test'),
    '/private/tmp/video-ops-test/youtube-ops_client_secret.json',
  );
  assert.throws(() => youtubeClientSecretPath('../outside', '/private/tmp/video-ops-test'), /simple local credential name/);
  assert.equal(
    youtubeTokenPath('youtube-ops', '/private/tmp/video-ops-test'),
    '/private/tmp/video-ops-test/youtube-ops_token.json',
  );
});

test('expected Google login emails are normalized and validated before OAuth starts', () => {
  assert.equal(normalizeExpectedGoogleEmail(' LXU4354@gmail.com '), 'you@example.com');
  assert.equal(normalizeExpectedGoogleEmail(''), '');
  assert.throws(() => normalizeExpectedGoogleEmail('not-an-email'), /valid email address/);
});

test('one-click OAuth names saved tokens from the confirmed channel, not an email or secret', () => {
  assert.equal(defaultYouTubeTokenRef('UC1234567890'), 'youtube-UC1234567890');
  assert.throws(() => defaultYouTubeTokenRef('../outside'), /valid YouTube channel ID/);
});

test('Google local client configuration is stored locally and reported without secrets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-client-'));
  const desktopClient = JSON.stringify({
    installed: {
      client_id: 'client-id.apps.googleusercontent.com',
      client_secret: 'not-returned-to-browser',
      redirect_uris: ['http://localhost'],
    },
  });
  try {
    assert.deepEqual(saveYouTubeClientSecret(desktopClient, 'youtube', root), { configured: true, clientRef: 'youtube', flow: 'local-app' });
    assert.deepEqual(getYouTubeClientStatus('youtube', root), { configured: true, clientRef: 'youtube', flow: 'local-app' });
    assert.equal(fs.readFileSync(youtubeClientSecretPath('youtube', root), 'utf8'), desktopClient);
    const webClient = JSON.stringify({
      web: {
        client_id: 'client-id.apps.googleusercontent.com',
        client_secret: 'not-returned-to-browser',
        redirect_uris: ['http://localhost:4455/'],
      },
    });
    assert.deepEqual(saveYouTubeClientSecret(webClient, 'youtube-web', root), { configured: true, clientRef: 'youtube-web', flow: 'web-server' });
    assert.deepEqual(getYouTubeClientStatus('youtube-web', root), { configured: true, clientRef: 'youtube-web', flow: 'web-server' });
    assert.throws(() => saveYouTubeClientSecret('{"web":{}}', 'youtube-invalid', root), /client ID or client secret/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
