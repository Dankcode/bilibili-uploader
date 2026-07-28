import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { studioWhisperPaths } from './localWhisper.js';

function runFfmpeg(args, timeoutMs = 10 * 60 * 1000) {
  const bin = studioWhisperPaths().ffmpeg;
  return new Promise((resolve, reject) => {
    if (!bin) return reject(new Error('ffmpeg binary is not installed.'));
    const child = spawn(bin, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('Frame extraction timed out.'));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`ffmpeg could not start: ${error.message}`));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`Frame extraction failed: ${stderr.slice(-1200)}`));
    });
  });
}

function nearestSegment(segments, time) {
  let winner = segments[0];
  let distance = Infinity;
  for (const segment of segments) {
    const midpoint = segment.start + ((segment.end - segment.start) / 2);
    const nextDistance = Math.abs(midpoint - time);
    if (nextDistance < distance) { distance = nextDistance; winner = segment; }
  }
  return winner;
}

function savedFrame(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Frame was not saved correctly: ${path.basename(filePath)}`);
  return { byteSize: stat.size };
}

export function buildTimedFramePlan(duration, {
  intervalSeconds = 15,
  maxFrames = 120,
} = {}) {
  const safeDuration = Number(duration);
  const safeInterval = Math.max(2, Math.min(300, Number(intervalSeconds) || 15));
  const safeLimit = Math.max(1, Math.min(240, Number(maxFrames) || 120));
  if (!Number.isFinite(safeDuration) || safeDuration <= 0) {
    throw new Error('Timed screenshot extraction requires a positive video duration.');
  }
  const frameCount = Math.ceil(safeDuration / safeInterval);
  if (frameCount > safeLimit) {
    const error = new Error(
      `This ${safeInterval}s interval needs ${frameCount} screenshots. Increase the interval or raise the ${safeLimit}-frame safety limit.`,
    );
    error.code = 'CONTEXT_FRAME_LIMIT';
    throw error;
  }
  return Array.from({ length: frameCount }, (_, index) => {
    const windowStart = index * safeInterval;
    const windowEnd = Math.min(safeDuration, (index + 1) * safeInterval);
    const captureTime = windowStart + ((windowEnd - windowStart) / 2);
    const timeMs = Math.round(captureTime * 1000);
    const frameId = `frame-${String(index + 1).padStart(4, '0')}`;
    return {
      frameId,
      timeMs,
      windowStartMs: Math.round(windowStart * 1000),
      windowEndMs: Math.round(windowEnd * 1000),
      file: `${frameId}_${String(timeMs).padStart(9, '0')}.jpg`,
      kind: 'interval',
    };
  });
}

export async function extractSynchronizedFrames(videoPath, segments, outputDir, {
  duration,
  intervalSeconds = 15,
  maxFrames = 120,
} = {}) {
  if (!Array.isArray(segments) || !segments.length) throw new Error('Frame extraction requires timestamped segments.');
  const resolvedDuration = Number(duration) || Number(segments.at(-1)?.end) || 0;
  const plan = buildTimedFramePlan(resolvedDuration, { intervalSeconds, maxFrames });
  const parentDir = path.dirname(outputDir);
  const outputName = path.basename(outputDir);
  const stagingDir = path.join(parentDir, `${outputName}.next-${randomUUID()}`);
  const backupDir = path.join(parentDir, `${outputName}.previous-${randomUUID()}`);
  fs.mkdirSync(parentDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  try {
    const manifest = [];
    for (const item of plan) {
      const seconds = item.timeMs / 1000;
      const segment = nearestSegment(segments, seconds);
      const framePath = path.join(stagingDir, item.file);
      await runFfmpeg([
        '-nostdin', '-y', '-ss', seconds.toFixed(3), '-i', videoPath,
        '-frames:v', '1',
        '-vf', 'scale=1280:-2:force_original_aspect_ratio=decrease',
        '-q:v', '4',
        framePath,
      ]);
      manifest.push({
        ...item,
        segIndex: segment.index,
        ...savedFrame(framePath),
      });
    }
    fs.writeFileSync(path.join(stagingDir, 'frames.json'), JSON.stringify(manifest, null, 2));

    let previousMoved = false;
    try {
      if (fs.existsSync(outputDir)) {
        fs.renameSync(outputDir, backupDir);
        previousMoved = true;
      }
      fs.renameSync(stagingDir, outputDir);
    } catch (error) {
      if (previousMoved && !fs.existsSync(outputDir) && fs.existsSync(backupDir)) {
        fs.renameSync(backupDir, outputDir);
      }
      throw error;
    }
    if (previousMoved) {
      try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    return manifest;
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
