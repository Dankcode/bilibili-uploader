import { createHash } from 'crypto';
import db from '../db/sqlite';

export const DEFAULT_DAILY_SECONDS = 21_600;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function keyHash(apiKey) {
  return createHash('sha256').update(String(apiKey || 'local')).digest('hex').slice(0, 20);
}

export function maskKey(key) {
  const value = String(key || 'local');
  if (value.length < 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function checkAndIncrementUsage(service, apiKey, seconds, maxDailySeconds = DEFAULT_DAILY_SECONDS) {
  const amount = Math.max(0, Number(seconds) || 0);
  const cap = Math.max(60, Number(maxDailySeconds) || DEFAULT_DAILY_SECONDS);
  const day = today();
  const hash = keyHash(apiKey);
  return db.transaction(() => {
    const current = db.prepare('SELECT seconds FROM api_usage WHERE day = ? AND service = ? AND key_hash = ?').get(day, service, hash);
    const used = Number(current?.seconds) || 0;
    if (used + amount > cap) {
      const error = new Error(`${service} daily quota exceeded (${Math.round(used / 60)} / ${Math.round(cap / 60)} minutes).`);
      error.status = 403;
      error.code = 'DAILY_QUOTA_EXCEEDED';
      throw error;
    }
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO api_usage (day, service, key_hash, seconds, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day, service, key_hash) DO UPDATE SET
        seconds = api_usage.seconds + excluded.seconds,
        updated_at = excluded.updated_at
    `).run(day, service, hash, amount, now);
    return { day, service, seconds: used + amount, maxDailySeconds: cap, ratio: (used + amount) / cap, key: maskKey(apiKey) };
  })();
}

export function getUsageSummary(day = today(), maxDailySeconds = DEFAULT_DAILY_SECONDS) {
  const cap = Math.max(60, Number(maxDailySeconds) || DEFAULT_DAILY_SECONDS);
  return db.prepare(`
    SELECT day, service, key_hash, seconds, updated_at
    FROM api_usage WHERE day = ? ORDER BY service ASC
  `).all(day).map((row) => ({
    day: row.day,
    service: row.service,
    keyHash: row.key_hash,
    seconds: Number(row.seconds) || 0,
    maxDailySeconds: cap,
    ratio: (Number(row.seconds) || 0) / cap,
    updatedAt: row.updated_at,
  }));
}
