import fs from 'fs';
import path from 'path';

export const id = 'douyin';

const MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);

function baseUrl(credentials = {}) {
  return String(credentials.sidecarUrl || process.env.DOUYIN_SIDECAR_URL || 'http://127.0.0.1:8756').replace(/\/$/, '');
}

async function fetchJson(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function newestMediaFile(rootDir, sinceMs) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;
  const stack = [rootDir];
  let newest = null;
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs >= sinceMs && (!newest || stat.mtimeMs > newest.mtimeMs)) {
          newest = { filePath: fullPath, mtimeMs: stat.mtimeMs };
        }
      }
    }
  }
  return newest?.filePath || null;
}

export async function testConnection(credentials = {}) {
  try {
    await fetchJson(`${baseUrl(credentials)}/api/v1/health`, {}, 5000);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Douyin sidecar is unreachable: ${error.message}` };
  }
}

export async function resolveInput(urlOrId) {
  const url = String(urlOrId || '').trim();
  if (!url) throw new Error('Douyin URL is required');
  return { items: [{ url, title: url }] };
}

export async function download(item, destDir, onProgress = () => {}, credentials = {}) {
  if (!item?.url) throw new Error('Douyin item url is required');
  fs.mkdirSync(destDir, { recursive: true });
  const startedAt = Date.now() - 2000;
  const api = baseUrl(credentials);
  onProgress(5, 'Submitting Douyin sidecar job');
  const created = await fetchJson(`${api}/api/v1/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: item.url }),
  }, 10000);
  const jobId = created.job_id;
  if (!jobId) throw new Error('Douyin sidecar did not return a job id');

  const deadline = Date.now() + 30 * 60 * 1000;
  let job = created;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    job = await fetchJson(`${api}/api/v1/jobs/${jobId}`, {}, 10000);
    const status = String(job.status || '').toLowerCase();
    onProgress(status === 'running' ? 50 : 20, `Sidecar ${status || 'pending'}`);
    if (status === 'success') break;
    if (status === 'failed') throw new Error(job.error || 'Douyin sidecar job failed');
  }
  if (String(job.status || '').toLowerCase() !== 'success') throw new Error('Douyin sidecar timed out after 30 minutes');

  const sourceFile = newestMediaFile(credentials.downloadDir, startedAt);
  if (!sourceFile) {
    throw new Error('Douyin sidecar finished, but no media file was found. Save the sidecar download folder in Settings.');
  }
  const outputPath = path.join(destDir, path.basename(sourceFile));
  fs.copyFileSync(sourceFile, outputPath);
  onProgress(100, 'Downloaded');
  return {
    filePath: outputPath,
    meta: {
      title: path.basename(outputPath, path.extname(outputPath)),
      sourceUrl: item.url,
      platform: 'douyin',
      sidecarJobId: jobId,
      counts: {
        total: job.total,
        success: job.success,
        failed: job.failed,
        skipped: job.skipped,
      },
    },
  };
}
