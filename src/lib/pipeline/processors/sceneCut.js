import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const id = 'sceneCut';

export async function testConnection() {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `ffmpeg is unavailable: ${error.message}` };
  }
}

export async function process(inputPath, options = {}, onProgress = () => {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error(`Scene source file not found: ${inputPath}`);
  const outputDir = options.outputDir || path.dirname(inputPath);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}-scene.mp4`);
  const clips = Array.isArray(options.clips) ? options.clips : [];
  const firstClip = clips[0] || {};
  const start = Number(firstClip.start ?? options.start ?? 0);
  const end = Number(firstClip.end ?? options.end ?? 0);

  onProgress(10, 'Preparing scene cut');
  if (!end || end <= start) {
    fs.copyFileSync(inputPath, outputPath);
    onProgress(100, 'No cut requested');
    return { outputPath, artifacts: { passthrough: true } };
  }

  await execFileAsync('ffmpeg', [
    '-y',
    '-ss', String(start),
    '-to', String(end),
    '-i', inputPath,
    '-c', 'copy',
    outputPath,
  ], { timeout: 10 * 60 * 1000 });
  onProgress(100, 'Scene cut complete');
  return {
    outputPath,
    artifacts: { clips: [{ start, end }] },
  };
}
