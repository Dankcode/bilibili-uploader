/**
 * UPLOAD RECEIPTS — the duplicate-upload half of the release layer.
 *
 * The ordering is the whole point:
 *   1 INSERT receipt state='claimed'      ← before anything leaves the machine
 *   2 governor.reserve(destination, units) (same transaction as 1)
 *   3 UPDATE state='sent', sent_at
 *   4 ...the actual upload call...
 *   5 UPDATE state='confirmed', remote_id, url
 *   6 INSERT video_publications row
 *
 * A crash between 3 and 5 leaves a 'sent' receipt with no remote id — a
 * specific, detectable state. A retry reconciles it (a few list units) instead
 * of paying 1,600 units to upload the same video twice.
 *
 * States: claimed → sent → confirmed | failed | abandoned
 *   failed    — the destination refused before creating anything (quota, auth)
 *   abandoned — reconciled or resolved by an operator as "never arrived"
 */
import fs from 'fs';
import { createHash } from 'crypto';
import db from '../db/sqlite';

export const RECEIPT_STATES = ['claimed', 'sent', 'confirmed', 'failed', 'abandoned'];
const SAMPLE_BYTES = 4 * 1024 * 1024;

function nowIso() {
  return new Date().toISOString();
}

export function receiptKey({ jobId, stepId, attempt, destinationId }) {
  return `${jobId}:${stepId}:${attempt || 1}:${destinationId}`;
}

/**
 * A cheap fingerprint of the upload: size plus the first and last 4 MB. A full
 * hash of a multi-GB render on every attempt is not worth its disk time; this
 * is enough to tell "the same file" from "a re-render" when reconciling.
 */
export function contentFingerprint(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const hash = createHash('sha256').update(String(stats.size));
    const fd = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(Math.min(SAMPLE_BYTES, stats.size));
      fs.readSync(fd, head, 0, head.length, 0);
      hash.update(head);
      if (stats.size > SAMPLE_BYTES) {
        const tail = Buffer.alloc(Math.min(SAMPLE_BYTES, stats.size - SAMPLE_BYTES));
        fs.readSync(fd, tail, 0, tail.length, stats.size - tail.length);
        hash.update(tail);
      }
    } finally {
      fs.closeSync(fd);
    }
    return `s256-sampled:${hash.digest('hex').slice(0, 32)}`;
  } catch {
    return '';
  }
}

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    jobId: row.job_id,
    stepId: row.step_id,
    attempt: row.attempt,
    destinationId: row.destination_id,
    accountRef: row.account_ref,
    channelId: row.channel_id,
    title: row.title,
    contentHash: row.content_hash,
    units: row.units,
    state: row.state,
    remoteId: row.remote_id,
    url: row.url,
    lastError: row.last_error,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    confirmedAt: row.confirmed_at,
    updatedAt: row.updated_at,
  };
}

export function getReceipt(id) {
  return toPublic(db.prepare('SELECT * FROM upload_receipts WHERE id = ?').get(Number(id)));
}

/** Step 1. Throws on a duplicate idempotency key. */
export function claimReceipt({ key = '', jobId, stepId, attempt, destinationId, accountRef = '', channelId = '', title = '', filePath = '', contentHash = '', units = 0 }) {
  const createdAt = nowIso();
  const result = db.prepare(`
    INSERT INTO upload_receipts (
      idempotency_key, job_id, step_id, attempt, destination_id, account_ref, channel_id,
      title, file_path, content_hash, units, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'claimed', ?, ?)
  `).run(
    key || receiptKey({ jobId, stepId, attempt, destinationId }), jobId, stepId, attempt || 1, destinationId,
    String(accountRef || ''), String(channelId || ''), String(title || '').slice(0, 500), String(filePath || ''),
    contentHash, Math.max(0, Number(units) || 0), createdAt, createdAt,
  );
  return getReceipt(result.lastInsertRowid);
}

/** Step 3 — the last write before the network call. */
export function markSent(id) {
  const at = nowIso();
  db.prepare("UPDATE upload_receipts SET state = 'sent', sent_at = ?, updated_at = ? WHERE id = ? AND state = 'claimed'").run(at, at, id);
  return getReceipt(id);
}

/** Step 5. */
export function markConfirmed(id, { remoteId = '', url = '', resolvedBy = '' } = {}) {
  const at = nowIso();
  db.prepare(`
    UPDATE upload_receipts
    SET state = 'confirmed', remote_id = ?, url = ?, confirmed_at = ?, resolved_by = ?, last_error = '', updated_at = ?
    WHERE id = ?
  `).run(String(remoteId || ''), String(url || ''), at, String(resolvedBy || ''), at, id);
  return getReceipt(id);
}

export function markFailed(id, error) {
  db.prepare("UPDATE upload_receipts SET state = 'failed', last_error = ?, updated_at = ? WHERE id = ?")
    .run(String(error?.message || error || '').slice(0, 2000), nowIso(), id);
  return getReceipt(id);
}

export function markAbandoned(id, { reason = '', resolvedBy = '' } = {}) {
  db.prepare("UPDATE upload_receipts SET state = 'abandoned', last_error = ?, resolved_by = ?, updated_at = ? WHERE id = ?")
    .run(String(reason || '').slice(0, 2000), String(resolvedBy || ''), nowIso(), id);
  return getReceipt(id);
}

/** Keep a 'sent' receipt 'sent' but remember why the call errored. */
export function noteError(id, error) {
  db.prepare('UPDATE upload_receipts SET last_error = ?, updated_at = ? WHERE id = ?')
    .run(String(error?.message || error || '').slice(0, 2000), nowIso(), id);
  return getReceipt(id);
}

/**
 * The receipts a new attempt must respect for this job step, newest first:
 * a 'confirmed' one means the video already exists; a 'sent' or stale
 * 'claimed' one means it might.
 */
export function findOpenReceipts(jobId, stepId) {
  return db.prepare(`
    SELECT * FROM upload_receipts
    WHERE job_id = ? AND step_id = ? AND state IN ('claimed', 'sent', 'confirmed')
    ORDER BY id DESC
  `).all(jobId, stepId).map(toPublic);
}

/**
 * Receipts for the Publish view. Unconfirmed 'sent' rows are pinned to the top —
 * they are the one state that may need a person.
 */
export function listReceipts({ limit = 50 } = {}) {
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));
  return db.prepare(`
    SELECT r.*, vr.title AS video_title, j.status AS job_status
    FROM upload_receipts r
    LEFT JOIN video_jobs j ON j.id = r.job_id
    LEFT JOIN video_records vr ON vr.id = j.video_record_id
    ORDER BY CASE WHEN r.state IN ('sent', 'claimed') THEN 0 ELSE 1 END, r.updated_at DESC
    LIMIT ?
  `).all(cap).map((row) => ({ ...toPublic(row), videoTitle: row.video_title || '', jobStatus: row.job_status || '' }));
}
