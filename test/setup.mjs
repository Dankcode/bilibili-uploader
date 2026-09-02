/**
 * TEST BOOTSTRAP — loaded via `--import` before any test file, so it runs
 * before a test can transitively import src/lib/db/sqlite.js.
 *
 * WHY: sqlite.js calls initDB() as an import side effect, so merely importing a
 * library module for a pure helper opens the operator's live config/bilibili.db
 * and runs migrations against it. `npm test` did exactly that. Pinning
 * VIDEO_SQLITE_PATH to a throwaway file keeps the suite off production data
 * regardless of which module a test happens to pull in.
 *
 * A test that wants its own database can still set VIDEO_SQLITE_PATH itself —
 * this only supplies a safe default.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';

if (!process.env.VIDEO_SQLITE_PATH) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'videops-test-db-'));
  process.env.VIDEO_SQLITE_PATH = path.join(directory, 'test.db');
}

// Resolve the extensionless relative imports the app uses (webpack does this in
// Next.js; plain Node needs the loader).
register('../scripts/extension_loader.mjs', import.meta.url);
