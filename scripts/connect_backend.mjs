import fs from 'node:fs';
import { normalizeRemoteUrl, writeRuntimeSettings } from '../src/lib/runtime/settings.js';

const [url, ...options] = process.argv.slice(2);
const tokenFile = options.find((value) => value !== '--save');
const action = options.includes('--save') ? '--save' : '';
try {
  if (!url || options.length > (tokenFile ? 2 : 1)) {
    throw new Error('Usage: node scripts/connect_backend.mjs http://backend.ts.net:4455 [legacy-token-file] [--save]');
  }
  const remoteUrl = normalizeRemoteUrl(url);
  const remoteAuthToken = tokenFile ? fs.readFileSync(tokenFile, 'utf8').trim() : '';
  const response = await fetch(`${remoteUrl}/api/server/runtime/ping`, {
    headers: remoteAuthToken ? { authorization: `Bearer ${remoteAuthToken}` } : {},
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Backend connection failed: HTTP ${response.status}`);
  const result = await response.json();
  if (result.service !== 'video-automation-backend' || result.ok !== true || result.runtime?.connectionMode === 'remote') {
    throw new Error('Target is not a database-owning Video Operations backend');
  }
  if (action === '--save') {
    writeRuntimeSettings({ connectionMode: 'remote', remoteTransport: 'tailscale', remoteUrl, remoteAuthToken, workerEnabled: false });
  }
  console.log(JSON.stringify({ ok: true, backend: remoteUrl, saved: action === '--save', workerOnline: Boolean(result.worker?.online) }));
} catch (error) {
  // Do not print remote response bodies or request headers containing secrets.
  console.error(error.message);
  process.exitCode = 1;
}
