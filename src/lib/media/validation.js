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

  const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || ffprobeInstaller.path, [
    '-v', 'error',
    '-show_entries', 'format=duration,format_name,size,bit_rate:stream=index,codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,start_time,duration,bit_rate,sample_rate,channels',
    '-of', 'json',
    resolved,
  ], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const payload = JSON.parse(stdout || '{}');
  const stream = (payload.streams || []).find((item) => item.codec_type === 'video');
  const audio = (payload.streams || []).find((item) => item.codec_type === 'audio');
  const durationSeconds = Number(payload.format?.duration) || 0;
  if (!stream || !stream.width || !stream.height) throw new Error(`No readable video stream in output: ${resolved}`);
  if (durationSeconds <= 0) throw new Error(`Video output has no measurable duration: ${resolved}`);
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

  return {
    filePath: resolved,
    mimeType: mimeFor(resolved),
    format: payload.format?.format_name || extension.slice(1),
    codec: stream.codec_name || '',
    profile: stream.profile || '',
    pixelFormat: stream.pix_fmt || '',
    bytes: stat.size,
    durationSeconds,
    videoDurationSeconds: number(stream.duration),
    videoStartSeconds: number(stream.start_time),
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    // r_frame_rate is the stream's base rate; avg_frame_rate is what plays.
    fps: parseRate(stream.r_frame_rate),
    avgFps: parseRate(stream.avg_frame_rate),
    videoBitrate: number(stream.bit_rate),
    bitrate: number(payload.format?.bit_rate),
    audio: audio ? {
      codec: audio.codec_name || '', sampleRate: number(audio.sample_rate), channels: number(audio.channels),
      bitrate: number(audio.bit_rate), durationSeconds: number(audio.duration),
    } : null,
    sha256: await sha256File(resolved),
  };
}

/**
 * Did an edit keep the source's picture size, length, frame rate and audio?
 * Tolerances are about two frames (at least 0.1 s) for duration and 1% for
 * the average frame rate, so a re-encode passes but a trim, an added second
 * of padding, a downscale or a frame-rate conversion does not.
 */
export function compareToSource(input, output) {
  const frame = input.avgFps > 0 ? 1 / input.avgFps : 1 / 30;
  const durationTolerance = Math.max(0.1, 2 * frame);
  const videoDuration = (probe) => probe.videoDurationSeconds ?? probe.durationSeconds;
  const differences = [];
  if (input.width !== output.width || input.height !== output.height) differences.push(`dimensions ${input.width}x${input.height} -> ${output.width}x${output.height}`);
  const durationDelta = output.durationSeconds - input.durationSeconds;
  if (Math.abs(durationDelta) > durationTolerance) differences.push(`duration ${input.durationSeconds.toFixed(3)}s -> ${output.durationSeconds.toFixed(3)}s`);
  const videoDelta = videoDuration(output) - videoDuration(input);
  if (Math.abs(videoDelta) > durationTolerance) differences.push(`video stream duration ${videoDuration(input).toFixed(3)}s -> ${videoDuration(output).toFixed(3)}s`);
  if (input.avgFps > 0 && output.avgFps > 0 && Math.abs(output.avgFps - input.avgFps) / input.avgFps > 0.01) differences.push(`frame rate ${input.avgFps.toFixed(3)} -> ${output.avgFps.toFixed(3)} fps`);
  if (input.audio && !output.audio) differences.push('audio track missing');
  return {
    ok: differences.length === 0, differences, durationToleranceSeconds: Number(durationTolerance.toFixed(3)),
    durationDeltaSeconds: Number(durationDelta.toFixed(3)), videoDurationDeltaSeconds: Number(videoDelta.toFixed(3)),
  };
}

/** Frames a player actually shows (decodes the stream; packets marked discard are skipped). */
export async function countDecodedFrames(filePath) {
  const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || ffprobeInstaller.path, [
    '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path.resolve(filePath),
  ], { timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024 });
  const frames = Number(String(stdout).trim().split(/\s+/)[0]);
  return Number.isFinite(frames) ? frames : null;
}

/**
 * compareToSource plus one deeper check: when only the duration looks
 * different, count the decoded frames of both files. A stream-copied cut can
 * carry discarded pre-roll packets that count toward its nominal duration but
 * are never shown; if both decode to the same frames and the audio lasts as
 * long, the edit kept the timing and the result says why it passed.
 */
export async function compareFilesToSource(inputPath, outputPath, input, output) {
  const comparison = compareToSource(input, output);
  // Nominal durations (and the average frame rate derived from them) can be
  // skewed by never-shown packets; size or audio differences cannot.
  if (comparison.ok || !comparison.differences.every((item) => /duration|frame rate/.test(item))) return comparison;
  const [inputFrames, outputFrames] = await Promise.all([countDecodedFrames(inputPath), countDecodedFrames(outputPath)]);
  const frame = input.avgFps > 0 ? 1 / input.avgFps : 1 / 30;
  const audioSame = !input.audio || (output.audio && Math.abs((output.audio.durationSeconds ?? 0) - (input.audio.durationSeconds ?? 0)) <= frame);
  const result = { ...comparison, decodedFrames: { input: inputFrames, output: outputFrames } };
  if (inputFrames && inputFrames === outputFrames && audioSame) {
    return { ...result, ok: true, differences: [], note: `Nominal duration/frame rate differ (${comparison.differences.join('; ')}) but both decode to ${outputFrames} frames and the audio length matches; the source carries packets that are never shown.` };
  }
  return { ...result, differences: [...comparison.differences, `decoded frames ${inputFrames} -> ${outputFrames}`] };
}

export async function validateVideoOutput(filePath, {
  expectedInputPath = '',
  preserveDuration = false,
  preserveDimensions = preserveDuration,
  requireChanged = false,
} = {}) {
  const output = await probeVideo(filePath);
  let comparison = null;
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
    comparison = preserveDuration ? await compareFilesToSource(expectedInputPath, filePath, input, output) : compareToSource(input, output);
    if (preserveDuration) {
      checks.durationPreserved = !comparison.differences.some((item) => /duration|decoded frames/.test(item));
      checks.frameRatePreserved = !comparison.differences.some((item) => /frame rate/.test(item));
      checks.audioPreserved = !comparison.differences.includes('audio track missing');
    }
  }
  const required = ['readable', 'hasVideo', 'hasDuration', 'formatSupported'];
  if (preserveDuration && input) required.push('durationPreserved', 'frameRatePreserved', 'audioPreserved');
  if (preserveDimensions && input) required.push('dimensionsPreserved');
  if (requireChanged && input) required.push('changedFromInput');
  const failed = required.filter((key) => !checks[key]);
  if (failed.length) {
    const detail = comparison?.differences?.length ? `; ${comparison.differences.join('; ')}` : '';
    throw new Error(`Video output validation failed (${failed.join(', ')})${detail}: ${filePath}`);
  }
  return { ok: true, checks, input, output, ...(comparison ? { comparison } : {}) };
}
