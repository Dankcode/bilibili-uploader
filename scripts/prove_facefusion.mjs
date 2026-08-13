#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import ffmpegPath from 'ffmpeg-static';
import { process as runFaceFusion } from '../src/lib/pipeline/processors/faceFusion.js';
import { probeVideo, validateVideoOutput } from '../src/lib/media/validation.js';
import { failRunningFaceSwapProofs, saveFaceSwapProof } from '../src/lib/operations/store.js';

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    values[key.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return values;
}

async function engineVersion(repoDir) {
  try {
    const { stdout } = await execFileAsync('git', ['describe', '--tags', '--always'], { cwd: repoDir, timeout: 5000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function extractFrame(videoPath, outputPath) {
  await execFileAsync(ffmpegPath, [
    '-y', '-ss', '0', '-i', videoPath, '-frames:v', '1', '-q:v', '2', outputPath,
  ], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
}

async function runGeometricProof({ sourcePath, targetPath, proofDir, pythonBin, detectorModelPath, maxFrames }) {
  if (!fs.existsSync(detectorModelPath) || fs.statSync(detectorModelPath).size < 100_000) {
    throw new Error(`YuNet detector model is missing or invalid: ${detectorModelPath}`);
  }
  const rawOutputPath = path.join(proofDir, 'geometric-raw.mp4');
  const outputPath = path.join(proofDir, 'geometric-face-swap.mp4');
  const scriptPath = path.resolve('scripts/geometric_face_swap.py');
  const { stdout } = await execFileAsync(pythonBin, [
    scriptPath,
    '--source', sourcePath,
    '--target', targetPath,
    '--output', rawOutputPath,
    '--detector-model', detectorModelPath,
    '--max-frames', String(maxFrames),
  ], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  await execFileAsync(ffmpegPath, [
    '-y', '-i', rawOutputPath, '-i', targetPath,
    '-map', '0:v:0', '-map', '1:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
    outputPath,
  ], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  fs.rmSync(rawOutputPath, { force: true });
  const validation = await validateVideoOutput(outputPath, {
    expectedInputPath: targetPath,
    preserveDimensions: true,
    requireChanged: true,
  });
  return {
    engine: 'opencv-yunet-geometric',
    engineVersion: `OpenCV ${JSON.parse(stdout).opencvVersion}`,
    outputPath,
    validation,
    runtime: JSON.parse(stdout),
  };
}

const args = parseArgs(process.argv.slice(2));
const sourcePath = path.resolve(String(args.source || ''));
const targetPath = path.resolve(String(args.target || ''));
const facefusionDir = path.resolve(String(args['facefusion-dir'] || process.env.FACEFUSION_DIR || ''));
const pythonBin = String(args.python || process.env.FACEFUSION_PYTHON || path.join(facefusionDir, '.venv', 'bin', 'python'));
const requestedEngine = String(args.engine || 'auto').toLowerCase();
const detectorModelPath = path.resolve(String(args['detector-model'] || path.join(process.cwd(), 'scripts', 'assets', 'face_detection_yunet_2023mar.onnx')));
const maxFrames = Math.max(1, Math.min(300, Number(args['trim-frame-end']) || 30));
if (!args.source || !fs.existsSync(sourcePath)) throw new Error('Pass an existing source image with --source');
if (!args.target || !fs.existsSync(targetPath)) throw new Error('Pass an existing target video with --target');
if (!fs.existsSync(pythonBin)) throw new Error(`Proof Python runtime not found: ${pythonBin}`);
if (!['auto', 'facefusion', 'geometric'].includes(requestedEngine)) throw new Error('--engine must be auto, facefusion, or geometric');

const proofId = `facefusion-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const proofDir = path.resolve(String(args['work-dir'] || path.join(process.cwd(), 'video-work', 'proofs', proofId)));
fs.mkdirSync(proofDir, { recursive: true });
const proofSource = path.join(proofDir, `source${path.extname(sourcePath) || '.jpg'}`);
const proofTarget = path.join(proofDir, `target${path.extname(targetPath) || '.mp4'}`);
fs.copyFileSync(sourcePath, proofSource);
fs.copyFileSync(targetPath, proofTarget);

const facefusionReady = fs.existsSync(path.join(facefusionDir, 'facefusion.py'));
const version = facefusionReady ? await engineVersion(facefusionDir) : '';
const startedAt = Date.now();
failRunningFaceSwapProofs('Superseded after an interrupted proof run');
saveFaceSwapProof({
  id: proofId,
  engine: requestedEngine,
  engineVersion: version,
  status: 'running',
  sourceImagePath: proofSource,
  targetVideoPath: proofTarget,
  createdAt: new Date(startedAt).toISOString(),
});
let proofCompleted = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (!proofCompleted) {
      saveFaceSwapProof({
        id: proofId,
        engineVersion: version,
        status: 'failed',
        sourceImagePath: proofSource,
        targetVideoPath: proofTarget,
        durationMs: Date.now() - startedAt,
        error: `Proof interrupted by ${signal}`,
        createdAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
      });
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

try {
  const inputProbe = await probeVideo(proofTarget);
  let result = null;
  let fallbackReason = '';
  const facefusionModel = path.join(facefusionDir, '.assets', 'models', 'inswapper_128_fp16.onnx');
  if (requestedEngine !== 'geometric') {
    if (!facefusionReady) {
      fallbackReason = 'FaceFusion checkout is not available';
    } else if (!fs.existsSync(facefusionModel) || fs.statSync(facefusionModel).size < 100_000) {
      fallbackReason = 'FaceFusion neural model assets are not installed';
    } else {
      try {
        const facefusionResult = await runFaceFusion(proofTarget, {
          sourcePaths: [proofSource],
          faceSelectorMode: args['selector-mode'] || 'one',
          executionProviders: args.provider || 'cpu',
          downloadProviders: args['download-providers'] || 'huggingface github',
          trimFrameEnd: maxFrames,
          outputVideoQuality: Number(args.quality) || 90,
        }, (progress, note) => process.stderr.write(`[${String(Math.round(progress)).padStart(3, ' ')}%] ${note}\n`), {
          facefusionDir,
          pythonBin,
        });
        result = {
          engine: 'facefusion',
          engineVersion: version,
          outputPath: facefusionResult.outputPath,
          validation: facefusionResult.artifacts.validation,
          runtime: facefusionResult.artifacts,
        };
      } catch (facefusionError) {
        fallbackReason = facefusionError.message;
      }
    }
  }
  if (!result) {
    if (requestedEngine === 'facefusion') throw new Error(fallbackReason || 'FaceFusion proof failed');
    process.stderr.write(`[proof] ${fallbackReason || 'Geometric engine requested'}; using OpenCV YuNet fallback.\n`);
    result = await runGeometricProof({
      sourcePath: proofSource,
      targetPath: proofTarget,
      proofDir,
      pythonBin,
      detectorModelPath,
      maxFrames,
    });
  }
  const outputProbe = result.validation.output;
  const expectedDuration = Math.min(inputProbe.durationSeconds, maxFrames / Math.max(1, inputProbe.fps));
  if (Math.abs(outputProbe.durationSeconds - expectedDuration) > Math.max(0.35, expectedDuration * 0.15)) {
    throw new Error(`Proof output duration ${outputProbe.durationSeconds}s did not match expected ${expectedDuration.toFixed(3)}s`);
  }
  const beforeFramePath = path.join(proofDir, 'before.jpg');
  const afterFramePath = path.join(proofDir, 'after.jpg');
  await extractFrame(proofTarget, beforeFramePath);
  await extractFrame(result.outputPath, afterFramePath);
  const durationMs = Date.now() - startedAt;
  saveFaceSwapProof({
    id: proofId,
    engine: result.engine,
    engineVersion: result.engineVersion,
    status: 'passed',
    sourceImagePath: proofSource,
    targetVideoPath: proofTarget,
    outputVideoPath: result.outputPath,
    durationMs,
    inputProbe,
    outputProbe,
    validation: {
      ...result.validation,
      runtime: result.runtime,
      primaryEngine: 'facefusion',
      fallbackReason,
      beforeFramePath,
      afterFramePath,
    },
    createdAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
  });
  proofCompleted = true;
  process.stdout.write(`${JSON.stringify({
    id: proofId,
    status: 'passed',
    engine: result.engine,
    engineVersion: result.engineVersion,
    proofDir,
    outputPath: result.outputPath,
    beforeFramePath,
    afterFramePath,
    inputProbe,
    outputProbe,
    durationMs,
  }, null, 2)}\n`);
} catch (error) {
  saveFaceSwapProof({
    id: proofId,
    engine: requestedEngine,
    engineVersion: version,
    status: 'failed',
    sourceImagePath: proofSource,
    targetVideoPath: proofTarget,
    durationMs: Date.now() - startedAt,
    error: error.message,
    createdAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
  });
  proofCompleted = true;
  throw error;
}
