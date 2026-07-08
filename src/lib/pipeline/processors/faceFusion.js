/**
 * FACEFUSION PROCESSOR — automated targeted face replacement in the video.
 * Wraps the FaceFusion headless CLI (github.com/facefusion/facefusion).
 *
 *   input video ─► facefusion.py headless-run
 *                    --source-paths <replacement face image(s)>
 *                    --target-path <input video>
 *                    --output-path <output.mp4>
 *                    --processors face_swapper [face_enhancer]
 *                    --face-selector-mode reference|one|many
 *                    [--face-selector-gender male|female]     (auto target by attribute)
 *                    [--reference-face-position N --reference-face-distance D]
 *                    --execution-providers cuda|cpu
 *               ─► face-swapped video
 *
 * "Target specific faces automatically":
 *   • reference mode → only swaps faces matching the reference face captured at
 *     referenceFacePosition/referenceFrameNumber (within referenceFaceDistance).
 *   • face-selector-gender → swap only male / only female faces.
 *   • one → the most prominent face; many → every face.
 *
 * CONNECTION credentials (Settings ▸ faceFusion) — persist on Save:
 *   facefusionDir      absolute path to the cloned facefusion repo
 *   pythonBin          default 'python'
 *   executionProviders default 'cuda' (use 'cpu' if no GPU)
 *   faceSwapperModel   default 'inswapper_128_fp16'
 *   faceEnhancer       'on' | 'off'  (adds face_enhancer / gfpgan)
 *   sourcePaths        default replacement face image(s), ';'-separated
 *   faceSelectorMode   default 'reference'
 *   faceSelectorGender optional 'male' | 'female'
 *   referenceFacePosition / referenceFaceDistance / referenceFrameNumber
 *
 * Per-job options override any of the above. Fully automated once configured.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export const id = 'faceFusion';

const CLONE_URL = 'https://github.com/facefusion/facefusion.git';
const RUN_TIMEOUT_MS = 60 * 60 * 1000; // 1h cap for long videos

function resolveCreds(c = {}) {
  return {
    facefusionDir: c.facefusionDir || process.env.FACEFUSION_DIR || '',
    pythonBin: c.pythonBin || process.env.FACEFUSION_PYTHON || 'python',
    executionProviders: c.executionProviders || process.env.FACEFUSION_EP || 'cuda',
    faceSwapperModel: c.faceSwapperModel || 'inswapper_128_fp16',
    faceEnhancer: c.faceEnhancer === 'on',
    sourcePaths: c.sourcePaths || '',
    faceSelectorMode: c.faceSelectorMode || 'reference',
    faceSelectorGender: c.faceSelectorGender || '',
    referenceFacePosition: c.referenceFacePosition ?? '0',
    referenceFaceDistance: c.referenceFaceDistance ?? '0.6',
    referenceFrameNumber: c.referenceFrameNumber ?? '0',
  };
}

function splitPaths(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '')
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Command timed out: ${cmd} ${args.join(' ')}`));
    }, opts.timeout || RUN_TIMEOUT_MS);
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
      if (opts.onLine) opts.onLine(d.toString());
    });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Exit ${code}: ${(stderr || stdout).slice(-500)}`));
    });
  });
}

/** Clone the repo if the configured dir doesn't have it yet (download step). */
async function ensureRepo(creds) {
  if (!creds.facefusionDir) throw new Error('facefusionDir is not set.');
  const entry = path.join(creds.facefusionDir, 'facefusion.py');
  if (fs.existsSync(entry)) return { installed: true };
  fs.mkdirSync(path.dirname(creds.facefusionDir), { recursive: true });
  await run('git', ['clone', '--depth', '1', CLONE_URL, creds.facefusionDir], { timeout: 5 * 60 * 1000 });
  if (!fs.existsSync(entry)) throw new Error('Clone completed but facefusion.py is missing.');
  return { installed: true, cloned: true };
}

export async function testConnection(credentials = {}) {
  const creds = resolveCreds(credentials);
  if (!creds.facefusionDir) return { ok: false, error: 'Set facefusionDir (path to the facefusion repo).' };
  try {
    await ensureRepo(creds);
  } catch (error) {
    return { ok: false, error: `FaceFusion not available: ${error.message}. Run scripts/install_facefusion.sh.` };
  }
  try {
    await run(creds.pythonBin, ['-c', 'import sys; print(sys.version)'], { timeout: 15000 });
  } catch (error) {
    return { ok: false, error: `Python (${creds.pythonBin}) not runnable: ${error.message}` };
  }
  return { ok: true };
}

/**
 * @param {string} inputPath  video to swap faces in
 * @param {object} options    per-job overrides (same keys as creds)
 * @param {function} onProgress
 * @param {object} credentials the 'faceFusion' connection credentials
 */
export async function process(inputPath, options = {}, onProgress = () => {}, credentials = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error(`FaceFusion input not found: ${inputPath}`);
  const creds = { ...resolveCreds(credentials), ...resolveCreds(options) };

  onProgress(4, 'Checking FaceFusion install');
  await ensureRepo(creds);

  const sources = splitPaths(options.sourcePaths || creds.sourcePaths);
  if (sources.length === 0) throw new Error('FaceFusion: at least one source face image (sourcePaths) is required.');
  for (const src of sources) {
    if (!fs.existsSync(src)) throw new Error(`FaceFusion source face not found: ${src}`);
  }

  const outDir = path.join(path.dirname(inputPath), 'facefusion');
  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, 'swapped.mp4');

  const processors = ['face_swapper'];
  if (creds.faceEnhancer) processors.push('face_enhancer');

  const args = [
    'facefusion.py', 'headless-run',
    '--source-paths', ...sources,
    '--target-path', inputPath,
    '--output-path', outputPath,
    '--processors', ...processors,
    '--face-swapper-model', creds.faceSwapperModel,
    '--face-selector-mode', creds.faceSelectorMode,
    '--execution-providers', creds.executionProviders,
    '--output-video-quality', String(options.outputVideoQuality || '90'),
  ];
  if (creds.faceSelectorGender) args.push('--face-selector-gender', creds.faceSelectorGender);
  if (creds.faceSelectorMode === 'reference') {
    args.push(
      '--reference-face-position', String(creds.referenceFacePosition),
      '--reference-face-distance', String(creds.referenceFaceDistance),
      '--reference-frame-number', String(creds.referenceFrameNumber),
    );
  }

  onProgress(12, 'Running FaceFusion face swap');
  await run(creds.pythonBin, args, {
    cwd: creds.facefusionDir,
    timeout: RUN_TIMEOUT_MS,
    onLine: (line) => {
      const m = line.match(/(\d{1,3})%/);
      if (m) onProgress(12 + Math.min(85, Math.round(Number(m[1]) * 0.85)), 'Swapping faces');
    },
  });

  if (!fs.existsSync(outputPath)) throw new Error('FaceFusion finished but no output file was produced.');
  onProgress(100, 'Face swap complete');
  return {
    outputPath,
    artifacts: {
      sources,
      faceSelectorMode: creds.faceSelectorMode,
      faceSelectorGender: creds.faceSelectorGender || null,
      faceSwapperModel: creds.faceSwapperModel,
      enhanced: creds.faceEnhancer,
    },
  };
}
