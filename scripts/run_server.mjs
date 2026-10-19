import { spawn } from 'child_process';
import path from 'path';
import nextEnv from '@next/env';
import { resolveAccessPolicy } from '../src/lib/security/access.js';

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
// Next and the worker must receive the same local environment configuration.
nextEnv.loadEnvConfig(process.cwd(), mode === 'dev');
if (process.argv.includes('--local') && process.argv.includes('--shared')) {
  console.error('[Server] Choose either --local or --shared, not both.'); process.exit(1);
}
if (process.argv.includes('--local')) {
  // An explicit local launch must not inherit an old device's sharing config.
  process.env.VIDEO_ACCESS_MODE = 'local';
  process.env.VIDEO_BIND_HOST = '127.0.0.1';
  process.env.VIDEO_LOCAL_COOKIE_AUTH = '0';
}
if (process.argv.includes('--shared')) process.env.VIDEO_ACCESS_MODE = 'shared';
const { bridgeConfig } = await import('../src/lib/agent/auth.js');
let policy;
try { policy = resolveAccessPolicy(process.env, bridgeConfig()); }
catch (error) { console.error(`[Server] ${error.message}`); process.exit(1); }
const port = String(process.env.PORT || '4455');
const host = policy.host;
const webOnly = process.argv.includes('--web-only');
process.env.VIDEO_ACCESS_MODE = policy.mode;
process.env.VIDEO_BIND_HOST = host;
process.env.VIDEO_LOCAL_COOKIE_AUTH = policy.localPairing ? '1' : '0';
if (process.argv.includes('--check')) { console.log(JSON.stringify({ ...policy, port, webOnly })); process.exit(0); }
const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
const children = [];
let stopping = false;

function launch(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[Server] ${label} stopped (${signal || code || 0}); shutting down the runtime`);
    stop(signal || 'SIGTERM', code || 1);
  });
  children.push(child);
  return child;
}

function stop(signal = 'SIGTERM', exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGKILL');
    }
    process.exit(exitCode);
  }, 5000).unref();
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

launch('web control plane', process.execPath, [nextBin, mode, '-H', host, '-p', port], {
  VIDEO_PROCESS_ROLE: 'frontend',
  VIDEO_BIND_HOST: host,
  VIDEO_LOCAL_COOKIE_AUTH: process.env.VIDEO_LOCAL_COOKIE_AUTH,
});
if (!webOnly) launch('pipeline worker', process.execPath, [
  '--import',
  path.join(process.cwd(), 'scripts', 'register_loader.mjs'),
  path.join(process.cwd(), 'scripts', 'server_worker.mjs'),
], {
  VIDEO_PROCESS_ROLE: 'worker',
});

console.log(`[Server] ${policy.mode} web control plane${webOnly ? '' : ' and worker'} starting on ${host}:${port}`);
