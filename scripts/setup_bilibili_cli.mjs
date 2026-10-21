import { spawnSync } from 'node:child_process';
import path from 'node:path';

const directory = path.join(process.cwd(), '.venv-bilibili-cli');
const python = path.join(directory, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
for (const args of [
  ['venv', directory, '--python', '3.12'],
  ['pip', 'install', '--python', python, '-r', 'scripts/python/requirements-bilibili-cli.txt'],
]) {
  const result = spawnSync('uv', args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error('Could not set up bilibili-cli. Install uv and Python 3.12, then retry.');
    process.exit(1);
  }
}
console.log('Anonymous Bilibili metadata, creator pages, and stream resolution are ready.');
