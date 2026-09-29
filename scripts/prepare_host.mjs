import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Run on the backend host. Never touches a database or changes the Mac connection.
export function prepareHost(directory) {
  const root = path.resolve(directory);
  if (/[\r\n"\\]/.test(root)) throw new Error('Unsupported configuration directory');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const runtimePath = path.join(root, 'runtime-settings.json');
  const envPath = path.join(root, 'server.env');
  for (const file of [runtimePath, envPath]) {
    if (fs.existsSync(file)) throw new Error(`Refusing to overwrite existing configuration: ${file}`);
  }
  const runtime = {
    connectionMode: 'server',
    sqlitePath: path.join(root, 'bilibili.db'),
    workerEnabled: false,
    workerPollSeconds: 5,
    schedulerPollSeconds: 60,
  };
  fs.writeFileSync(runtimePath, JSON.stringify(runtime, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  try {
    fs.writeFileSync(envPath, [
      'NODE_ENV=production',
      'PORT=4455',
      'VIDEO_BIND_HOST=127.0.0.1',
      `VIDEO_RUNTIME_SETTINGS_PATH="${runtimePath}"`,
      `VIDEO_SERVER_API_TOKEN=${randomBytes(32).toString('hex')}`,
      '',
    ].join('\n'), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    fs.unlinkSync(runtimePath);
    throw error;
  }
  return { runtimePath, envPath, workerEnabled: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) {
    console.error('Usage: node scripts/prepare_host.mjs /absolute/backend/config/directory');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(prepareHost(process.argv[2]), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
