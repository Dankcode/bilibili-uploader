import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import db from '../db/sqlite';
import { getLocalWhisperStatus } from '../studio/localWhisper';
import { getCredentials, listConnections, probeService } from './connections';
import { getUsageSummary } from './usage';
const execFileAsync = promisify(execFile);
const STEP_LABELS = {
  localFile: 'Local file source', bilibili: 'Bilibili source', douyin: 'Douyin source',
  voiceover: 'AI Voiceover', aiEditor: 'AI Editor', sceneCut: 'Scene Cut', faceFusion: 'Face Fusion',
  metadata: 'AI Metadata',
  videoContext: 'Video Context', ocrContext: 'On-screen Text OCR',
  youtube: 'YouTube upload',
};
const STEP_FIX = {
  bilibili: 'Add your SESSDATA cookie in Settings ▸ bilibili for HD downloads.',
  douyin: 'Start the Douyin sidecar and set its URL/cookie in Settings ▸ douyin.',
  voiceover: 'In Settings ▸ voiceover set the Whisper key + your TTS backend (ElevenLabs / CosyVoice / Qwen3), then Test.',
  faceFusion: 'Run scripts/install_facefusion.sh, set facefusionDir + a source face image in Settings ▸ faceFusion, then Test.',
  aiEditor: 'Set and Test the HuggingFace editor endpoint in Settings ▸ aiEditor.',
  sceneCut: 'No external service — this runs locally with ffmpeg.',
  metadata: 'Configure Kimi, OpenAI, or Gemini for the metadata processor, then Test.',
  videoContext: 'Configure local/API Whisper and at least one of Gemini, Codex CLI, or Kimi Vision.',
  ocrContext: 'Install rapidocr_onnxruntime with pip install -r requirements.txt and keep python3 available.',
  youtube: 'Configure the Python OAuth uploader and register an authorized YouTube account.',
};

function ok(id, label, detail = 'OK', fixHint = '') {
  return { id, label, status: 'ok', detail, fixHint };
}

function warn(id, label, detail, fixHint) {
  return { id, label, status: 'warn', detail, fixHint };
}

function fail(id, label, detail, fixHint) {
  return { id, label, status: 'fail', detail: String(detail || '').slice(0, 240), fixHint };
}

/**
 * Runs one check and converts a thrown error into a failed row.
 *
 * The row keeps the check's own id and label: an anonymous
 * "unknown / Unexpected check failure" row leaves the operator counting
 * positions in the response array to work out which of fifteen checks broke.
 * The stack is logged too, because the fix hint promises one.
 */
async function settle(id, label, check) {
  try {
    return await check();
  } catch (error) {
    console.error(`[Diagnostics] Check "${id}" threw:`, error?.stack || error);
    return fail(id, label, error.message, 'This check crashed — see the server log for the full stack trace.');
  }
}

async function checkCommand(id, label, command, args, fixHint) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 5000 });
    const firstLine = (stdout || stderr || '').split(/\r?\n/).find(Boolean) || 'available';
    return ok(id, label, firstLine);
  } catch (error) {
    return fail(id, label, error.message, fixHint);
  }
}

function checkDisk() {
  const workDir = path.join(process.cwd(), process.env.VIDEO_WORK_DIR || 'video-work');
  fs.mkdirSync(workDir, { recursive: true });
  if (typeof fs.statfsSync !== 'function') {
    return warn('disk_space', 'Video work disk', 'Unable to inspect free space in this Node runtime', 'Keep at least 5GB free for downloads and ffmpeg output.');
  }
  const stat = fs.statfsSync(workDir);
  const freeGb = (stat.bavail * stat.bsize) / (1024 ** 3);
  if (freeGb < 5) return warn('disk_space', 'Video work disk', `${freeGb.toFixed(1)}GB free`, 'Free at least 5GB before starting large pipeline jobs.');
  return ok('disk_space', 'Video work disk', `${freeGb.toFixed(1)}GB free`);
}

function checkDbOpen() {
  const required = [
    'video_jobs', 'video_job_steps', 'video_assets', 'service_connections',
    'studio_projects', 'api_usage', 'pipeline_presets', 'app_settings',
  ];
  const existing = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  const missing = required.filter((table) => !existing.has(table));
  if (missing.length) return fail('db_open', 'Pipeline tables', `Missing: ${missing.join(', ')}`, 'Restart the Next.js server so initDB can run migrations.');
  return ok('db_open', 'Pipeline tables', 'All tables present');
}

function checkDbIntegrity() {
  const result = db.prepare('PRAGMA integrity_check').get();
  const value = Object.values(result || {})[0];
  if (value !== 'ok') return fail('db_integrity', 'SQLite integrity', value || 'Unknown result', 'Back up config/bilibili.db and inspect SQLite integrity before running jobs.');
  const stale = db.prepare(`
    SELECT COUNT(*) AS count FROM video_jobs
    WHERE status = 'running' AND updated_at < ?
  `).get(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
  if (stale.count > 0) return warn('db_integrity', 'SQLite integrity', `${stale.count} job(s) running for over 2 hours`, 'Cancel or retry stale jobs from the Pipeline tab.');
  return ok('db_integrity', 'SQLite integrity', 'Integrity check passed');
}

function checkAiKey() {
  const configured = [
    ['Kimi', process.env.KIMI_API_KEY],
    ['OpenAI', process.env.OPENAI_API_KEY],
    ['Gemini', process.env.GEMINI_API_KEY],
  ].filter(([, value]) => Boolean(value)).map(([name]) => name);
  if (!configured.length) return warn('ai_key', 'AI metadata key', 'No text provider key is set', 'Set a Kimi, OpenAI, or Gemini key before generating metadata.');
  return ok('ai_key', 'AI metadata key', `${configured.join(', ')} configured`);
}

function checkLocalWhisper() {
  const credentials = getCredentials('voiceover');
  const selected = credentials.sttBackend === 'localWhisper';
  const status = getLocalWhisperStatus(credentials.sttQuality || 'fast');
  if (status.ready) {
    const detail = `${status.model.label}: ${status.model.cached ? 'cached' : 'downloads on first run'}`;
    return ok('local_whisper', 'Local Whisper', detail);
  }
  const missing = Object.entries(status.checks).filter(([, ready]) => !ready).map(([name]) => name).join(', ');
  const detail = `Missing: ${missing}`;
  return selected
    ? fail('local_whisper', 'Local Whisper', detail, 'Install ffmpeg or enable model downloads, then retry the selected local STT backend.')
    : warn('local_whisper', 'Local Whisper', detail, 'Optional while API Whisper is selected.');
}

function checkQuota() {
  const credentials = getCredentials('voiceover');
  const cap = Number(credentials.maxDailySeconds) || 21600;
  const rows = getUsageSummary(undefined, cap);
  if (!rows.length) return ok('quota', 'Daily API quota', 'No metered use today');
  const highest = rows.reduce((current, row) => row.ratio > current.ratio ? row : current, rows[0]);
  const detail = `${highest.service}: ${Math.round(highest.seconds / 60)} / ${Math.round(cap / 60)} min`;
  return highest.ratio >= 0.8
    ? warn('quota', 'Daily API quota', detail, 'Raise the connection cap or wait for the UTC daily reset.')
    : ok('quota', 'Daily API quota', detail);
}

export async function runDiagnostics() {
  // [id, label, check] — the id and label survive a thrown check, so a crash is
  // still attributed to the check that caused it.
  const checks = [
    ['db_open', 'Pipeline tables', () => checkDbOpen()],
    ['db_integrity', 'SQLite integrity', () => checkDbIntegrity()],
    ['ffmpeg', 'ffmpeg', () => checkCommand('ffmpeg', 'ffmpeg', 'ffmpeg', ['-version'], 'Install ffmpeg and make sure it is on PATH.')],
    ['python', 'Python uploader runtime', () => checkCommand('python', 'Python uploader runtime', 'python3', ['--version'], 'Install Python 3.10+ and keep python3 on PATH.')],
    ['disk_space', 'Video work disk', () => checkDisk()],
    ['local_whisper', 'Local Whisper', () => checkLocalWhisper()],
    ['quota', 'Daily API quota', () => checkQuota()],
    ['ai_key', 'AI metadata key', () => checkAiKey()],
  ];
  const results = await Promise.all(checks.map(([id, label, check]) => settle(id, label, check)));
  return [
    ...results.map((row) => decorateIssue(row, { serviceId: row.id })),
    ...connectionHealthChecks(),
    ...recentFailedSteps(),
  ];
}

/**
 * Diagnostics deliberately renders stored connection outcomes. It must not
 * probe adapters on page load, otherwise it can disagree with Overview and
 * Connections. The explicit refresh action below is the only live probe here.
 */
function connectionHealthChecks() {
  return listConnections().map((connection) => {
    const checked = connection.checkedAt ? ` Last checked ${connection.checkedAt}.` : ' Not checked yet.';
    const status = connection.status === 'ok' ? 'ok' : connection.status === 'failed' ? 'fail' : 'warn';
    const detail = connection.lastError
      ? `${connection.lastError}${checked}`
      : connection.status === 'ok'
        ? `Connection healthy (auth: ${connection.authState || 'unknown'}).${checked}`
        : connection.configured
          ? `Credentials are saved but have not passed a connection check.${checked}`
          : `Not configured.${checked}`;
    return decorateIssue({
      id: connection.serviceId,
      label: connection.label || connection.serviceId,
      serviceId: connection.serviceId,
      status,
      configured: connection.configured,
      authState: connection.authState,
      checkedAt: connection.checkedAt,
      detail,
      fixHint: STEP_FIX[connection.serviceId] || '',
    }, { serviceId: connection.serviceId });
  });
}

export async function refreshDiagnostics(serviceIds = []) {
  const requested = Array.isArray(serviceIds) && serviceIds.length ? new Set(serviceIds.map(String)) : null;
  const targets = listConnections().filter((connection) => !requested || requested.has(connection.serviceId));
  await Promise.all(targets.map(async (connection) => {
    try {
      await probeService(connection.serviceId);
    } catch (error) {
      // probeService has already recorded the failed outcome. Keep refreshing
      // the other independent adapters so a single bad endpoint is not a
      // fourth, partial diagnosis.
      console.error(`[Diagnostics] Refresh "${connection.serviceId}" threw:`, error?.message || error);
    }
  }));
  return runDiagnostics();
}

/**
 * RUN-SPECIFIC PREFLIGHT — "show me the steps and check each one BEFORE I turn
 * on full automation." Given the chain a job would run, returns one row per
 * step (in execution order) plus the shared system checks each step needs,
 * so the operator can eyeball readiness and fix issues first.
 *
 * @param {{sourceId?:string, processorIds?:string[], uploaderId?:string}} plan
 * @returns {Promise<{ready:boolean, steps:Array}>}
 */
export async function runPreflight(plan = {}) {
  const sourceId = plan.sourceId ? String(plan.sourceId) : '';
  const processorIds = Array.isArray(plan.processorIds) ? plan.processorIds.map(String) : [];
  const uploaderId = plan.uploaderId ? String(plan.uploaderId) : '';
  const options = plan.options && typeof plan.options === 'object' ? plan.options : {};
  // The authorization this job would publish with, so the uploader check can
  // verify the real credential instead of guessing.
  const context = {
    authorizationId: String(plan.youtubeAuthorizationId || options.youtube?.authorizationId || '').trim(),
    sourceInput: String(plan.sourceInput || '').trim(),
  };

  const order = [
    ...(sourceId ? [{ role: 'source', id: sourceId }] : []),
    ...processorIds.map((id) => ({ role: 'processor', id })),
    ...(uploaderId ? [{ role: 'uploader', id: uploaderId }] : []),
  ];

  // System checks the run depends on (media processing needs ffmpeg + disk).
  const needsFfmpeg = processorIds.some((id) => ['videoContext', 'ocrContext', 'voiceover', 'faceFusion', 'sceneCut'].includes(id));
  const system = [];
  if (needsFfmpeg) {
    system.push(await settle('ffmpeg', 'ffmpeg (media processing)', () => checkCommand('ffmpeg', 'ffmpeg (media processing)', 'ffmpeg', ['-version'], 'Install ffmpeg and keep it on PATH.')));
  }
  system.push(settleSync(checkDisk));

  const steps = await Promise.all(order.map(async ({ role, id }) => {
    const label = STEP_LABELS[id] || id;
    try {
      const { result } = await probeService(id, {
        credentials: { ...getCredentials(id), ...(options[id] || {}) },
        context,
        connectionId: context.authorizationId,
      });
      return result.ok
        ? { id, role, label, status: 'ok', detail: 'Ready', fixHint: '' }
        : { id, role, label, status: 'fail', detail: String(result.error || 'Not ready').slice(0, 240), fixHint: STEP_FIX[id] || '' };
    } catch (error) {
      return { id, role, label, status: 'fail', detail: String(error.message || error).slice(0, 240), fixHint: STEP_FIX[id] || '' };
    }
  }));

  const all = [...system, ...steps].map((row) => decorateIssue(row, { serviceId: row.id, stepId: row.id }));
  const ready = all.every((c) => c.status === 'ok');
  return { ready, steps: all };
}

function settleSync(check) {
  try {
    return check();
  } catch (error) {
    return fail('unknown', 'Check failure', error.message, 'Check server logs.');
  }
}

export function classifyError(error, { serviceId = '', stepId = '' } = {}) {
  const detail = String(error?.message || error || '').replace(/\s+/g, ' ').trim().slice(0, 240) || 'The service did not report a detail.';
  const text = detail.toLowerCase();
  const match = (pattern, category, nextStep, action, severity = 'error') => pattern.test(text)
    ? { severity, category, detail, nextStep, action } : null;
  return (
    match(/invalid_grant|token has been expired|token.*expired|unauthori[sz]ed|\b401\b/, 'authorization_expired', 'Re-authorize this YouTube channel.', { type: 'goto', view: 'connections', target: 'youtube' })
    || match(/\b-352\b|\b412\b|risk.?control|sessdata|login required/, 'source_blocked', 'Your Bilibili session expired or was rate-limited — sign in again.', { type: 'goto', view: 'connections', target: 'bilibili' })
    || match(/enoent.*ff(?:mpeg|probe)|ff(?:mpeg|probe).*enoent/, 'tool_missing', 'Reinstall the media tools, then refresh Health.', { type: 'goto', view: 'diagnostics', target: 'ffmpeg' })
    || match(/enospc|no space left/, 'disk_full', 'Free space in video-work, then retry this job.', { type: 'goto', view: 'overview', target: 'retention' })
    || match(/\b429\b|quota|resource_exhausted|daily cap/, 'provider_limit', 'Wait for the limit to reset or switch the provider.', { type: 'goto', view: 'connections', target: serviceId || stepId })
    || match(/whisper|model load|model.*unavailable/, 'local_model_unavailable', 'Re-run the local Whisper install, then refresh Health.', { type: 'goto', view: 'diagnostics', target: 'local_whisper' })
    || match(/context revision mismatch|stale artifact/, 'stale_artifact', 'Re-run Timed screenshots before Kimi context.', { type: 'goto', view: 'studio', target: 'context' })
    || { severity: 'error', category: 'unexpected', detail, nextStep: 'Review this check and retry after resolving the reported issue.', action: { type: 'goto', view: 'diagnostics', target: serviceId || stepId || 'unknown' } }
  );
}

function decorateIssue(row, context = {}) {
  if (row.status === 'ok') return { ...row, severity: 'info', category: 'ready', nextStep: '', action: null };
  const issue = classifyError(row.detail, context);
  return { ...row, ...issue, severity: row.status === 'warn' && issue.severity === 'error' ? 'warning' : issue.severity };
}

function recentFailedSteps() {
  const rows = db.prepare(`
    SELECT s.id, s.step, s.progress_note, s.log, j.id AS job_id, j.error, j.updated_at
    FROM video_job_steps s
    JOIN video_jobs j ON j.id = s.job_id
    WHERE s.status = 'failed'
    ORDER BY j.updated_at DESC, s.id DESC
    LIMIT 12
  `).all();
  return rows.map((row) => decorateIssue({
    id: `job-step-${row.id}`,
    jobId: row.job_id,
    stepId: row.step,
    label: `Failed run · ${row.step}`,
    status: 'fail',
    detail: row.progress_note || row.error || row.log || 'Pipeline step failed.',
    fixHint: '',
  }, { stepId: row.step, serviceId: String(row.step || '').split(':')[1] || '' }));
}
