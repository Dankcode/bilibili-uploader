import os from 'os';
import { randomUUID } from 'crypto';

process.env.VIDEO_PROCESS_ROLE = 'worker';

const [{ default: db, closeDB }, pipeline, { WorkflowService }, runtimeSettings, mediaRetention, mailStore, mailWorker] = await Promise.all([
  import('../src/lib/db/sqlite.js'),
  import('../src/lib/pipeline/pipeline.js'),
  import('../src/lib/services/WorkflowService.js'),
  import('../src/lib/runtime/settings.js'),
  import('../src/lib/operations/mediaRetention.js'),
  import('../src/lib/mail/store.js'),
  import('../src/lib/mail/worker.js'),
]);

const workerId = `pipeline-${os.hostname()}-${process.pid}-${randomUUID().slice(0, 6)}`;
const startedAt = new Date().toISOString();
let stopping = false;
let lastSchedulerRun = 0;
let lastMailSyncRun = 0;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function heartbeat(status = 'online', metadata = {}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO runtime_workers (id, role, host, pid, status, started_at, heartbeat_at, metadata_json)
    VALUES (?, 'pipeline', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      heartbeat_at = excluded.heartbeat_at,
      metadata_json = excluded.metadata_json
  `).run(workerId, os.hostname(), process.pid, status, startedAt, now, JSON.stringify(metadata));
}

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  try {
    heartbeat('offline', { signal });
  } catch (error) {
    console.error('[Worker] Failed to store shutdown heartbeat:', error.message);
  }
  closeDB();
  process.exit(0);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

const recovered = pipeline.recoverStaleJobs();
const recoveredMail = mailWorker.recoverStaleMailOutbox();
console.log(`[Worker] ${workerId} started${recovered ? `; recovered ${recovered} stale job(s)` : ''}${recoveredMail ? `; recovered ${recoveredMail} mail item(s)` : ''}`);

while (!stopping) {
  const settings = runtimeSettings.readRuntimeSettings();
  const pollMs = Math.max(1000, settings.workerPollSeconds * 1000);
  try {
    heartbeat('online', { pollSeconds: settings.workerPollSeconds, schedulerPollSeconds: settings.schedulerPollSeconds });
    if (settings.connectionMode === runtimeSettings.CONNECTION_MODES.REMOTE) {
      heartbeat('paused', { reason: 'remote-control-plane' });
      await sleep(pollMs);
      continue;
    }
    if (!settings.workerEnabled) {
      heartbeat('paused', { reason: 'disabled-in-settings' });
      await sleep(pollMs);
      continue;
    }

    const mailed = await mailWorker.drainMailOutbox(workerId, 2);
    if (mailed) heartbeat('online', { mailSent: mailed });
    const mailSyncDue = Date.now() - lastMailSyncRun >= 60_000;
    if (mailSyncDue) {
      for (const account of mailStore.listEnabledMailAccounts()) {
        const minutes = Math.max(5, Number(account.syncIntervalMinutes) || 15);
        if (!account.lastSyncAt || Date.now() - new Date(account.lastSyncAt).getTime() >= minutes * 60_000) {
          try { await mailWorker.syncMailAccount(account); } catch (error) { console.warn(`[Worker] Mail sync for ${account.emailAddress} failed: ${error.message}`); }
        }
      }
      lastMailSyncRun = Date.now();
    }

    const schedulerDue = Date.now() - lastSchedulerRun >= settings.schedulerPollSeconds * 1000;
    if (schedulerDue) {
      await WorkflowService.checkAllDueUploads();
      const cleanup = mediaRetention.runDueLocalMediaCleanup();
      if (cleanup.ran) console.log(`[Worker] Weekly local-media scan found ${cleanup.candidateCount} file(s) awaiting review`);
      lastSchedulerRun = Date.now();
    }

    let processed = 0;
    while (!stopping) {
      const jobId = await pipeline.runNextQueuedJob();
      if (!jobId) break;
      processed += 1;
      heartbeat('online', { lastJobId: jobId, jobsProcessedThisCycle: processed });
    }
  } catch (error) {
    console.error('[Worker] Cycle failed:', error);
    heartbeat('error', { error: error.message });
  }
  if (!stopping) await sleep(pollMs);
}
