import { spawnSync } from 'node:child_process';
import path from 'node:path';

const directory = path.join(process.cwd(), '.venv-bilibili');
const python = process.platform === 'win32' ? 'python' : 'python3';
const commands = [
  [python, ['-m', 'venv', directory]],
  [path.join(directory, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3'), ['-m', 'pip', 'install', '-r', 'scripts/python/requirements-bilibili-cookies.txt']],
];
for (const [executable, args] of commands) {
  const result = spawnSync(executable, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error('Could not set up the local Bilibili cookie reader. Install Python 3.9+ and retry.');
    process.exit(1);
  }
}
console.log('Bilibili cookie reader is ready. Connect a profile URL in Video Ops.');
