import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('importing SQLite never opens state; the first legacy query still initializes it', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'videops-lazy-db-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dbPath = path.join(directory, 'test.db');
  const moduleUrl = pathToFileURL(path.resolve('src/lib/db/sqlite.js')).href;
  const storeUrl = pathToFileURL(path.resolve('src/lib/operations/store.js')).href;
  const result = spawnSync(process.execPath, ['--import', path.resolve('scripts/register_loader.mjs'), '--input-type=module', '-e', `
    import fs from 'node:fs';
    const { getVideos, closeDB } = await import(${JSON.stringify(moduleUrl)});
    await import(${JSON.stringify(storeUrl)});
    if (fs.existsSync(process.env.VIDEO_SQLITE_PATH)) throw new Error('Import opened the database');
    if (getVideos().length !== 0) throw new Error('Unexpected fixture state');
    if (!fs.existsSync(process.env.VIDEO_SQLITE_PATH)) throw new Error('Query did not open the database');
    closeDB();
  `], { env: { ...process.env, VIDEO_SQLITE_PATH: dbPath }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
