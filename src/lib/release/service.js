/**
 * The Publish view's read model and the operator's receipt resolutions.
 */
import db from '../db/sqlite';
import { normalizeYouTubeUploadResult } from '../pipeline/uploaders/youtube.js';
import { getBudget, isBudgeted, listBudgets } from './governor';
import { getReceipt, listReceipts, markAbandoned, markConfirmed } from './receipts';
import { studioCalibrationStatus } from '../youtube/uploadMethod.js';

function nowIso() {
  return new Date().toISOString();
}

function youtubeAccountRefs() {
  // Quota is per OAuth client (Google Cloud project), so list client refs.
  const refs = db.prepare(`
    SELECT DISTINCT COALESCE(NULLIF(client_ref, ''), credential_ref) AS ref
    FROM youtube_authorizations WHERE enabled = 1
  `).all().map((row) => row.ref);
  if (!refs.length && globalThis.process?.env?.YOUTUBE_CHANNEL_ID) refs.push(globalThis.process.env.YOUTUBE_CHANNEL_ID);
  return [...new Set(refs.filter(Boolean))];
}

/**
 * Upload steps waiting on something: deferred for budget (with when they are
 * next eligible), or simply queued behind the jobs ahead of them.
 */
export function listReleaseQueue({ limit = 100 } = {}) {
  const cap = Math.max(1, Math.min(200, Number(limit) || 100));
  return db.prepare(`
    SELECT j.id AS job_id, j.status, j.scheduled_for, j.priority, j.uploader_id, j.created_at,
           s.id AS step_id, s.step, s.attempt, s.next_eligible_at, s.defer_reason,
           vr.title AS video_title
    FROM video_jobs j
    JOIN video_job_steps s ON s.job_id = j.id AND s.step LIKE 'uploader:%'
    LEFT JOIN video_records vr ON vr.id = j.video_record_id
    WHERE j.status IN ('queued', 'running', 'review') AND s.status IN ('pending', 'running')
    ORDER BY CASE WHEN s.next_eligible_at != '' THEN 1 ELSE 0 END, j.priority DESC, j.created_at ASC
    LIMIT ?
  `).all(cap).map((row) => ({
    jobId: row.job_id,
    stepId: row.step_id,
    destinationId: row.step.split(':')[1] || '',
    status: row.status,
    attempt: row.attempt,
    title: row.video_title || '',
    held: Boolean(row.next_eligible_at && row.next_eligible_at > nowIso()),
    nextEligibleAt: row.next_eligible_at || '',
    deferReason: row.defer_reason || '',
    scheduledFor: row.scheduled_for || '',
  }));
}

export function getReleaseOverview() {
  const budgets = listBudgets({ youtube: youtubeAccountRefs() });
  if (isBudgeted('youtube') && !budgets.some((budget) => budget.destinationId === 'youtube')) {
    budgets.push(getBudget('youtube', 'default'));
  }
  const receipts = listReceipts({ limit: 50 });
  return {
    budgets,
    queue: listReleaseQueue(),
    receipts,
    needsAttention: receipts.filter((receipt) => receipt.state === 'sent').length,
    studio: studioCalibrationStatus(),
    generatedAt: nowIso(),
  };
}

/**
 * An operator settles an unconfirmed receipt that could not be reconciled
 * automatically:
 *   confirm  — the video is there; record its URL so a retry will not upload again
 *   abandon  — it never arrived; a retry may upload fresh
 */
export function resolveReceipt(receiptId, { action, url = '' } = {}) {
  const receipt = getReceipt(receiptId);
  if (!receipt) throw new Error(`Receipt not found: ${receiptId}`);
  if (!['claimed', 'sent'].includes(receipt.state)) {
    throw new Error(`Receipt #${receipt.id} is already ${receipt.state}; only unconfirmed receipts can be resolved`);
  }
  if (action === 'confirm') {
    if (receipt.destinationId !== 'youtube') throw new Error(`Manual confirmation is not supported for ${receipt.destinationId}`);
    const normalized = normalizeYouTubeUploadResult(url);
    if (!normalized.remoteId) throw new Error('Paste the YouTube watch URL or video id of the upload');
    return markConfirmed(receipt.id, { ...normalized, resolvedBy: 'operator' });
  }
  if (action === 'abandon') {
    return markAbandoned(receipt.id, { reason: 'Operator confirmed the upload never arrived', resolvedBy: 'operator' });
  }
  throw new Error('Unknown receipt action. Valid actions: confirm|abandon');
}
