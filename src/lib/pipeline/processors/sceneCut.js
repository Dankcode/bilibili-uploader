import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

export const id = 'sceneCut';

export async function testConnection() {
  try {
    const { stdout } = await execFileAsync(ffmpegPath, ['-version'], { timeout: 5000 });
    return { ok: true, detail: stdout.split('\n')[0] };
  } catch (error) {
    return { ok: false, error: `ffmpeg is unavailable: ${error.message}` };
  }
}

export async function process(inputPath, options = {}, onProgress = () => {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error(`Scene source file not found: ${inputPath}`);
  const outputDir = options.outputDir || path.dirname(inputPath);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}-scene.mp4`);
  const requestedClips = Array.isArray(options.clips) && options.clips.length
    ? options.clips
    : [{ start: options.start, end: options.end }];
  const clips = requestedClips
    .map((clip) => ({ start: Math.max(0, Number(clip.start) || 0), end: Number(clip.end) || 0 }))
    .filter((clip) => clip.end > clip.start)
    .slice(0, 100);

  onProgress(5, 'Preparing edit timeline');
  if (clips.length === 0) clips.push({ start: 0, end: 0 });

  const segmentDir = path.join(outputDir, `.scene-cut-${Date.now()}`);
  fs.mkdirSync(segmentDir, { recursive: true });
  const segmentPaths = [];
  const formats = {
    '16:9': { width: 1280, height: 720 },
    '9:16': { width: 720, height: 1280 },
    '1:1': { width: 1080, height: 1080 },
  };
  const targetFormat = formats[options.aspectRatio];
  const videoFilter = targetFormat
    ? `scale=${targetFormat.width}:${targetFormat.height}:force_original_aspect_ratio=increase,crop=${targetFormat.width}:${targetFormat.height},setsar=1`
    : '';
  try {
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const segmentPath = path.join(segmentDir, `segment-${String(index).padStart(3, '0')}.mp4`);
      const timing = clip.end > clip.start
        ? ['-ss', String(clip.start), '-to', String(clip.end)]
        : [];
      await execFileAsync(ffmpegPath, [
        '-y', ...timing, '-i', inputPath,
        '-map', '0:v:0', '-map', '0:a?',
        ...(videoFilter ? ['-vf', videoFilter] : []),
        '-c:v', 'libx264', '-preset', options.encodingPreset || 'medium', '-crf', String(options.crf || 20),
        '-pix_fmt', 'yuv420p', ...(options.frameRate ? ['-r', String(options.frameRate)] : []),
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart', segmentPath,
      ], { timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
      segmentPaths.push(segmentPath);
      onProgress(10 + Math.round(((index + 1) / clips.length) * 75), `Rendered clip ${index + 1} of ${clips.length}`);
    }

    if (segmentPaths.length === 1) {
      fs.copyFileSync(segmentPaths[0], outputPath);
    } else {
      const concatPath = path.join(segmentDir, 'concat.txt');
      fs.writeFileSync(concatPath, segmentPaths.map((segment) => `file '${segment.replace(/'/g, "'\\''")}'`).join('\n'));
      await execFileAsync(ffmpegPath, [
        '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
        '-c', 'copy', '-movflags', '+faststart', outputPath,
      ], { timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
    }
  } finally {
    fs.rmSync(segmentDir, { recursive: true, force: true });
  }
  onProgress(100, 'Scene cut complete');
  return {
    outputPath,
    artifacts: {
      clips: clips.map((clip) => ({ start: clip.start, end: clip.end || null })),
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      aspectRatio: options.aspectRatio || 'source',
      width: targetFormat?.width || null,
      height: targetFormat?.height || null,
    },
  };
}
