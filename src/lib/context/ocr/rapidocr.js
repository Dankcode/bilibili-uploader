import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { runSubprocess } from '../subprocess.js';

const require = createRequire(import.meta.url);

function ffmpegBin() {
  try { return process.env.FFMPEG_PATH || require('ffmpeg-static'); } catch { return process.env.FFMPEG_PATH || 'ffmpeg'; }
}

function pythonBin(credentials = {}) {
  return credentials.pythonBin || process.env.OCR_PYTHON_BIN || 'python3';
}

export async function extractDenseFrames(videoPath, outputDir, {
  intervalSeconds = 1,
  region = 'full',
  onProgress = () => {},
} = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const interval = Math.max(0.25, Math.min(30, Number(intervalSeconds) || 1));
  const filters = [`fps=1/${interval}`];
  if (region === 'bottom') filters.push('crop=iw:ih*0.38:0:ih*0.62');
  else if (region === 'top') filters.push('crop=iw:ih*0.38:0:0');
  else if (region === 'middle') filters.push('crop=iw:ih*0.5:0:ih*0.25');
  else if (/^\d+(?:\.\d+)?,\d+(?:\.\d+)?,\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(region)) {
    filters.push(`crop=${region.split(',').join(':')}`);
  }
  onProgress(2, 'Extracting dense OCR frames in one ffmpeg pass');
  await runSubprocess(ffmpegBin(), [
    '-nostdin', '-y', '-i', videoPath, '-vf', filters.join(','), '-q:v', '4',
    path.join(outputDir, 'dense-%06d.jpg'),
  ], { timeoutMs: 30 * 60_000, label: 'Dense OCR frame extraction' });
  return fs.readdirSync(outputDir)
    .filter((name) => /^dense-\d+\.jpg$/.test(name))
    .sort()
    .map((name, index) => ({ imagePath: path.join(outputDir, name), time: index * interval }));
}

export async function recognizeFrames(frames, options = {}, credentials = {}) {
  const scriptPath = path.join(process.cwd(), 'vendor', 'ocr', 'ocr_frames.py');
  if (!fs.existsSync(scriptPath)) throw new Error(`RapidOCR bridge is missing: ${scriptPath}`);
  const manifest = {
    frames: frames.map((frame) => ({ path: frame.imagePath, time: frame.time ?? Number(frame.timeMs) / 1000 })),
    minConfidence: Math.max(0, Math.min(1, Number(options.minConfidence) || 0.5)),
    langs: String(credentials.ocrLangs || 'ch,en'),
  };
  const { stdout } = await runSubprocess(pythonBin(credentials), [scriptPath], {
    input: JSON.stringify(manifest),
    timeoutMs: Math.max(60_000, frames.length * 2_000),
    label: 'RapidOCR',
  });
  let payload;
  try { payload = JSON.parse(stdout); } catch { throw new Error(`RapidOCR returned invalid JSON: ${stdout.slice(-800)}`); }
  if (!Array.isArray(payload?.readings)) throw new Error('RapidOCR returned an invalid readings list.');
  return payload.readings;
}

export async function testConnection(credentials = {}) {
  try {
    const result = await runSubprocess(pythonBin(credentials), ['-c', 'import rapidocr_onnxruntime; print("ok")'], {
      timeoutMs: 15_000,
      label: 'RapidOCR dependency check',
    });
    return { ok: result.stdout.trim() === 'ok' };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
