import { spawn } from 'child_process';
import path from 'path';

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const port = String(process.env.PORT || '4455');
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

launch('web control plane', process.execPath, [nextBin, mode, '-H', '0.0.0.0', '-p', port], {
  VIDEO_PROCESS_ROLE: 'frontend',
});
launch('pipeline worker', process.execPath, [
  '--experimental-default-type=module',
  '--import',
  path.join(process.cwd(), 'scripts', 'register_loader.mjs'),
  path.join(process.cwd(), 'scripts', 'server_worker.mjs'),
], {
  VIDEO_PROCESS_ROLE: 'worker',
});

console.log(`[Server] Web control plane and worker starting on port ${port}`);
