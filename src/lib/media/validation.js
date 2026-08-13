import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

const execFileAsync = promisify(execFile);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);

function parseRate(value) {
  const [left, right = '1'] = String(value || '0').split('/').map(Number);
  return right ? left / right : 0;
}

function mimeFor(filePath) {
  return ({
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
  })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export async function probeVideo(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  if (!fs.existsSync(resolved)) throw new Error(`Video output not found: ${resolved}`);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size < 1024) throw new Error(`Video output is empty or invalid: ${resolved}`);
  const extension = path.extname(resolved).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(extension)) throw new Error(`Unsupported video output format: ${extension || 'none'}`);

  const { stdout } = await execFileAsync(ffprobeInstaller.path, [
    '-v', 'error',
    '-show_entries', 'format=duration,format_name,size:stream=index,codec_type,codec_name,width,height,r_frame_rate',
    '-of', 'json',
    resolved,
  ], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const payload = JSON.parse(stdout || '{}');
  const stream = (payload.streams || []).find((item) => item.codec_type === 'video');
  const durationSeconds = Number(payload.format?.duration) || 0;
  if (!stream || !stream.width || !stream.height) throw new Error(`No readable video stream in output: ${resolved}`);
  if (durationSeconds <= 0) throw new Error(`Video output has no measurable duration: ${resolved}`);

  return {
    filePath: resolved,
    mimeType: mimeFor(resolved),
    format: payload.format?.format_name || extension.slice(1),
    codec: stream.codec_name || '',
    bytes: stat.size,
    durationSeconds,
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    fps: parseRate(stream.r_frame_rate),
    sha256: await sha256File(resolved),
  };
}

export async function validateVideoOutput(filePath, {
  expectedInputPath = '',
  preserveDuration = false,
  preserveDimensions = preserveDuration,
  requireChanged = false,
} = {}) {
  const output = await probeVideo(filePath);
  const checks = {
    readable: true,
    hasVideo: output.width > 0 && output.height > 0,
    hasDuration: output.durationSeconds > 0,
    formatSupported: VIDEO_EXTENSIONS.has(path.extname(output.filePath).toLowerCase()),
    changedFromInput: true,
    durationPreserved: true,
    dimensionsPreserved: true,
  };
  let input = null;
  if (expectedInputPath && fs.existsSync(expectedInputPath)) {
    input = await probeVideo(expectedInputPath);
    checks.changedFromInput = input.sha256 !== output.sha256;
    checks.dimensionsPreserved = input.width === output.width && input.height === output.height;
    if (preserveDuration) {
      const tolerance = Math.max(0.25, input.durationSeconds * 0.03);
      checks.durationPreserved = Math.abs(input.durationSeconds - output.durationSeconds) <= tolerance;
    }
  }
  const required = ['readable', 'hasVideo', 'hasDuration', 'formatSupported'];
  if (preserveDuration && input) required.push('durationPreserved');
  if (preserveDimensions && input) required.push('dimensionsPreserved');
  if (requireChanged && input) required.push('changedFromInput');
  const failed = required.filter((key) => !checks[key]);
  if (failed.length) throw new Error(`Video output validation failed (${failed.join(', ')}): ${filePath}`);
  return { ok: true, checks, input, output };
}
