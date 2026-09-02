import { enqueueMail, listEnabledMailAccounts } from './store.js';

/** Queue mail evidence without ever affecting the video lifecycle. */
export function emitMailEvent({ videoId = '', jobId = null, eventKind = '', stepId = '', payload = {} } = {}) {
  try {
    if (!videoId || !eventKind) return 0;
    let queued = 0;
    for (const account of listEnabledMailAccounts()) {
      const dedupeKey = `${videoId}:${jobId || ''}:${eventKind}:${stepId || ''}:${account.id}`;
      queued += enqueueMail(account.id, { videoId, jobId, eventKind, dedupeKey, payload });
    }
    return queued;
  } catch (error) {
    console.warn('[Mail] Could not enqueue event; pipeline continues:', error.message);
    return 0;
  }
}
