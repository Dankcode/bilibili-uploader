import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import db from '../db/sqlite';
import { getCredentials } from './connections';
import * as douyin from './sources/douyin';
import * as youtube from './uploaders/youtube';
import * as voiceover from './processors/voiceover';
import * as aiEditor from './processors/aiEditor';

const execFileAsync = promisify(execFile);

function ok(id, label, detail = 'OK', fixHint = '') {
  return { id, label, status: 'ok', detail, fixHint };
}

function warn(id, label, detail, fixHint) {
  return { id, label, status: 'warn', detail, fixHint };
}

function fail(id, label, detail, fixHint) {
  return { id, label, status: 'fail', detail: String(detail || '').slice(0, 240), fixHint };
}

async function settle(check) {
  try {
    return await check();
  } catch (error) {
    return fail('unknown', 'Unexpected check failure', error.message, 'Check server logs for the full stack trace.');
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
  const required = ['video_jobs', 'video_job_steps', 'video_assets', 'service_connections'];
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
  const provider = (process.env.AI_PROVIDER || 'codex').toLowerCase();
  const envName = provider === 'kimi' ? 'KIMI_API_KEY' : 'OPENAI_API_KEY';
  if (!process.env[envName]) return warn('ai_key', 'AI metadata key', `${envName} is not set`, 'Set the provider API key before generating titles/descriptions.');
  return ok('ai_key', 'AI metadata key', `${envName} configured`);
}

export async function runDiagnostics() {
  const checks = [
    () => checkDbOpen(),
    () => checkDbIntegrity(),
    () => checkCommand('ffmpeg', 'ffmpeg', 'ffmpeg', ['-version'], 'Install ffmpeg and make sure it is on PATH.'),
    () => checkCommand('python', 'Python uploader runtime', 'python3', ['--version'], 'Install Python 3.10+ and keep python3 on PATH.'),
    () => checkDisk(),
    async () => {
      const result = await douyin.testConnection(getCredentials('douyin'));
      return result.ok ? ok('douyin_sidecar', 'Douyin sidecar', 'Reachable') : warn('douyin_sidecar', 'Douyin sidecar', result.error, 'Start vendor/douyin-downloader with python run.py --server --port 8756.');
    },
    async () => {
      const result = await youtube.testConnection(getCredentials('youtube'));
      return result.ok ? ok('youtube_upload', 'YouTube uploader', 'Uploader script/config present') : warn('youtube_upload', 'YouTube uploader', result.error, 'Set YOUTUBE_CHANNEL_ID or configure the Python OAuth uploader.');
    },
    async () => {
      const result = await voiceover.testConnection(getCredentials('voiceover'));
      return result.ok ? ok('voiceover_lan', 'Voiceover LAN service', 'Reachable') : warn('voiceover_lan', 'Voiceover LAN service', result.error, 'Save and test the voiceover endpoint in Settings.');
    },
    async () => {
      const result = await aiEditor.testConnection(getCredentials('aiEditor'));
      return result.ok ? ok('hf_editor_lan', 'HF editor LAN service', 'Reachable') : warn('hf_editor_lan', 'HF editor LAN service', result.error, 'Save and test the HuggingFace editor endpoint in Settings.');
    },
    () => checkAiKey(),
  ];
  return Promise.all(checks.map(settle));
}

export function classifyError(errorText = '') {
  const text = String(errorText).toLowerCase();
  if (text.includes('ffmpeg')) return { checkId: 'ffmpeg', fixHint: 'Run diagnostics and fix the ffmpeg install.' };
  if (text.includes('python') || text.includes('uploader')) return { checkId: 'python', fixHint: 'Check Python and YouTube uploader diagnostics.' };
  if (text.includes('douyin') || text.includes('sidecar')) return { checkId: 'douyin_sidecar', fixHint: 'Start the Douyin sidecar and test the connection.' };
  if (text.includes('voice')) return { checkId: 'voiceover_lan', fixHint: 'Test the voiceover LAN service.' };
  if (text.includes('editor') || text.includes('gradio') || text.includes('hf')) return { checkId: 'hf_editor_lan', fixHint: 'Test the HF editor LAN service.' };
  if (text.includes('ai metadata') || text.includes('api_key')) return { checkId: 'ai_key', fixHint: 'Check the AI provider key.' };
  return { checkId: 'unknown', fixHint: 'Run full diagnostics.' };
}
