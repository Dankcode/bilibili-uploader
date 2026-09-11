import db from '../db/sqlite.js';

// Optional for legacy callers; new console edits and all agent edits send a
// version. The read and mutation share one SQLite transaction.
export function withVersion(table, where, values, expected, mutate) {
  if (!['video_jobs', 'video_records', 'bilibili_scraped_videos'].includes(table)) throw new Error('Unsupported versioned table');
  return db.transaction(() => {
    const row = db.prepare(`SELECT updated_at FROM ${table} WHERE ${where}`).get(...values);
    if (expected && row?.updated_at !== expected.replace(/^"|"$/g, '')) {
      const error = new Error('This item changed since you loaded it. Reload before saving.');
      error.code = 'STALE_WRITE'; error.status = 409; throw error;
    }
    return mutate();
  }).immediate();
}
