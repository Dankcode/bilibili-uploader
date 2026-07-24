import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { studioWhisperPaths } from './localWhisper';

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

function sampleSegments(segments, limit) {
  if (segments.length <= limit) return segments;
  const selected = [];
  const used = new Set();
  for (let slot = 0; slot < limit; slot += 1) {
    const index = Math.min(segments.length - 1, Math.round((slot / Math.max(1, limit - 1)) * (segments.length - 1)));
    if (!used.has(index)) { used.add(index); selected.push(segments[index]); }
  }
  return selected;
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

export async function extractSynchronizedFrames(videoPath, segments, outputDir, { maxFrames = 60 } = {}) {
  if (!Array.isArray(segments) || !segments.length) throw new Error('Frame extraction requires timestamped segments.');
  fs.mkdirSync(outputDir, { recursive: true });
  for (const entry of fs.readdirSync(outputDir)) {
    if (/\.(?:jpe?g)$/i.test(entry)) fs.rmSync(path.join(outputDir, entry), { force: true });
  }
  const selected = sampleSegments(segments, Math.max(1, Math.min(maxFrames, segments.length)));
  const manifest = [];
  for (const segment of selected) {
    const time = Math.max(0, segment.start + ((segment.end - segment.start) / 2));
    const milliseconds = Math.round(time * 1000);
    const file = `segment_${String(segment.index).padStart(4, '0')}_${milliseconds}.jpg`;
    const framePath = path.join(outputDir, file);
    await runFfmpeg(['-nostdin', '-y', '-ss', time.toFixed(3), '-i', videoPath, '-frames:v', '1', '-q:v', '3', framePath]);
    manifest.push({ segIndex: segment.index, timeMs: milliseconds, file, kind: 'midpoint', ...savedFrame(framePath) });
  }

  const remaining = Math.max(0, maxFrames - manifest.length);
  if (remaining > 0) {
    const pattern = path.join(outputDir, 'scene_%04d.jpg');
    const stderr = await runFfmpeg([
      '-nostdin', '-y', '-i', videoPath,
      '-vf', 'select=gt(scene\\,0.4),showinfo', '-vsync', 'vfr', '-frames:v', String(remaining), '-q:v', '3', pattern,
    ]).catch(() => '');
    const times = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1]));
    const sceneFiles = fs.readdirSync(outputDir).filter((name) => /^scene_\d+\.jpg$/.test(name)).sort();
    sceneFiles.forEach((file, index) => {
      const seconds = Number.isFinite(times[index]) ? times[index] : 0;
      const segment = nearestSegment(segments, seconds);
      manifest.push({
        segIndex: segment.index,
        timeMs: Math.round(seconds * 1000),
        file,
        kind: 'scene',
        ...savedFrame(path.join(outputDir, file)),
      });
    });
  }
  manifest.sort((left, right) => left.timeMs - right.timeMs);
  fs.writeFileSync(path.join(outputDir, 'frames.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
