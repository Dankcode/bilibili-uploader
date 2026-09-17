/**
 * releaseUpload — the single path from "upload step reached" to "remote video
 * exists", with the budget check and the receipt handshake in the right order.
 *
 * Adapter contract (the shape later destinations implement too):
 *   upload(filePath, meta, onProgress) → { remoteId, url, channelId?, ... }
 *   reconcile(receipt, meta)           → { found, remoteId?, url? } | null
 *     null means "this adapter cannot look" — an operator must resolve the
 *     receipt in Publish ▸ Receipts.
 */
import db from '../db/sqlite';
import {
  DeferredError, charge, getDestinationPolicy, isQuotaExhaustedError, markExhausted, reserve,
} from './governor';
import {
  claimReceipt, contentFingerprint, findOpenReceipts, markAbandoned, markConfirmed, markFailed, markSent, noteError, receiptKey,
} from './receipts';

class ReservationRefused extends Error {
  constructor(reservation) {
    super(reservation.reason);
    this.reservation = reservation;
  }
}

function attemptFor(step) {
  return Number(step.attempt) || 1;
}

/**
 * The same job step can legitimately claim more than once within one attempt:
 * after worker recovery (attempt is not bumped) or after a reconcile abandons
 * the earlier receipt. Suffix the idempotency key rather than weaken UNIQUE.
 */
function claimInput({ job, step, destinationId }) {
  const base = receiptKey({ jobId: job.id, stepId: step.id, attempt: attemptFor(step), destinationId });
  const prior = db.prepare('SELECT COUNT(*) AS n FROM upload_receipts WHERE idempotency_key = ? OR idempotency_key LIKE ?')
    .get(base, `${base}:r%`)?.n || 0;
  return prior ? `${base}:r${prior}` : base;
}

async function reconcileOpenReceipt({ receipt, adapter, destinationId, accountRef, uploadMeta, log, budgeted = true }) {
  if (receipt.state === 'claimed') {
    // Step 3 never ran, so nothing left the machine.
    markAbandoned(receipt.id, { reason: 'Claimed but never sent (worker stopped before the upload call)', resolvedBy: 'worker' });
    log(`Receipt #${receipt.id} was claimed but never sent; starting a fresh attempt`);
    return null;
  }
  const policy = getDestinationPolicy(destinationId);
  let outcome = null;
  try {
    outcome = typeof adapter.reconcile === 'function' ? await adapter.reconcile(receipt, uploadMeta) : null;
  } catch (error) {
    noteError(receipt.id, error);
    if (budgeted && isQuotaExhaustedError(error)) {
      const budget = markExhausted(destinationId, accountRef);
      throw new DeferredError(`Waiting to reconcile receipt #${receipt.id}: ${policy?.label || destinationId} budget spent. Resets ${budget?.resetLabel || 'tomorrow'}.`, {
        nextEligibleAt: budget?.resetAt,
      });
    }
    throw new Error(`Could not confirm whether upload attempt #${receipt.id} reached ${destinationId}; refusing to upload again. ${error.message}`);
  }
  if (outcome === null) {
    throw new Error(
      `Upload attempt #${receipt.id} was sent to ${destinationId} but never confirmed, and this upload method cannot check automatically. `
      + 'Resolve it in Publish ▸ Receipts (paste the video URL, or mark it as never arrived), then retry.',
    );
  }
  if (policy && budgeted) charge(destinationId, accountRef, policy.reconcileUnits());
  if (outcome.found) {
    const confirmed = markConfirmed(receipt.id, { remoteId: outcome.remoteId, url: outcome.url, resolvedBy: 'reconcile' });
    log(`Receipt #${receipt.id} reconciled: already on ${destinationId} as ${outcome.remoteId}; not uploading again`);
    return confirmed;
  }
  markAbandoned(receipt.id, { reason: 'Reconcile found no matching upload on the channel', resolvedBy: 'reconcile' });
  log(`Receipt #${receipt.id} reconciled: no matching upload found; starting a fresh attempt`);
  return null;
}

export async function releaseUpload({
  job, step, destinationId, adapter, filePath, uploadMeta, accountRef = 'default', channelId = '', title = '',
  budgeted = true, onProgress = () => {}, log = () => {},
}) {
  // Respect what earlier attempts left behind.
  for (const receipt of findOpenReceipts(job.id, step.id)) {
    if (receipt.state === 'confirmed') {
      log(`Receipt #${receipt.id} already confirmed as ${receipt.remoteId}; not uploading again`);
      return { result: { remoteId: receipt.remoteId, url: receipt.url, channelId: receipt.channelId || channelId, receiptId: receipt.id }, receipt, reused: true };
    }
    const confirmed = await reconcileOpenReceipt({ receipt, adapter, destinationId, accountRef, uploadMeta, log, budgeted });
    if (confirmed) {
      return { result: { remoteId: confirmed.remoteId, url: confirmed.url, channelId: confirmed.channelId || channelId, receiptId: confirmed.id }, receipt: confirmed, reused: true };
    }
  }

  // Steps 1 + 2 in one transaction: a refused reservation leaves no receipt.
  const contentHash = contentFingerprint(filePath);
  let receiptId = null;
  let reservation = null;
  try {
    db.transaction(() => {
      // Unbudgeted methods (Studio screen uploads) still get a receipt — a
      // duplicate costs a channel strike risk, not quota — but reserve nothing.
      reservation = budgeted ? reserve(destinationId, accountRef) : { ok: true, units: 0, budget: null };
      if (!reservation.ok) throw new ReservationRefused(reservation);
      receiptId = claimReceipt({
        key: claimInput({ job, step, destinationId }),
        jobId: job.id,
        stepId: step.id,
        attempt: attemptFor(step),
        destinationId,
        accountRef,
        channelId,
        title,
        filePath,
        contentHash,
        units: reservation.units || 0,
      }).id;
    })();
  } catch (error) {
    if (error instanceof ReservationRefused) {
      throw new DeferredError(error.message, { nextEligibleAt: error.reservation.nextEligibleAt });
    }
    throw error;
  }
  log(`Receipt #${receiptId} claimed${reservation?.units ? `; reserved ${reservation.units} units` : ''}`);

  // Step 3 — last write before the network.
  markSent(receiptId);

  // Step 4.
  let result;
  try {
    result = await adapter.upload(filePath, uploadMeta, onProgress);
  } catch (error) {
    if (error?.notSent === true && error?.deferUntil) {
      // e.g. Studio's daily upload limit, seen before a file was selected.
      markFailed(receiptId, error);
      throw new DeferredError(error.message, { nextEligibleAt: error.deferUntil });
    }
    if (budgeted && isQuotaExhaustedError(error)) {
      // The destination refused before creating anything.
      markFailed(receiptId, error);
      const budget = markExhausted(destinationId, accountRef);
      throw new DeferredError(`${getDestinationPolicy(destinationId)?.label || destinationId} reported its quota spent. Resets ${budget?.resetLabel || 'tomorrow'}.`, {
        nextEligibleAt: budget?.resetAt,
      });
    }
    if (error?.notSent === true) {
      // The adapter knows this failed before any bytes went out (bad
      // credential reference, missing file, channel mismatch).
      markFailed(receiptId, error);
      throw error;
    }
    // Anything else may or may not have created a video. Leave it 'sent' so the
    // next attempt reconciles instead of guessing.
    noteError(receiptId, error);
    throw error;
  }

  // Step 5. (Step 6, the publication row, is the caller's.)
  const receipt = markConfirmed(receiptId, { remoteId: result?.remoteId, url: result?.url, resolvedBy: 'upload' });
  return { result: { ...(result || {}), receiptId }, receipt, reused: false };
}
