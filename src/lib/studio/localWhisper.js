import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const SAMPLE_RATE = 16000;
const COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

const QUALITY_MODELS = {
  fast: { id: 'onnx-community/whisper-tiny', label: 'Tiny' },
  balanced: { id: 'onnx-community/whisper-base', label: 'Base' },
  best: { id: 'onnx-community/whisper-small', label: 'Small' },
};

const recognizers = new Map();
let modelLoadQueue = Promise.resolve();

function exists(filePath) {
  try { return Boolean(filePath && fs.existsSync(filePath)); } catch { return false; }
}

function firstExisting(values) {
  return values.find(exists) || null;
}

function bundledFfmpeg() {
  try { return require('ffmpeg-static'); } catch { return null; }
}

function bundledFfprobe() {
  try {
    const value = require('@ffprobe-installer/ffprobe');
    return typeof value === 'string' ? value : value?.path || null;
  } catch { return null; }
}

function transformersEntry() {
  return path.join(process.cwd(), 'node_modules', '@huggingface', 'transformers', 'src', 'transformers.js');
}

function transformersAvailable() {
  return exists(transformersEntry());
}

async function loadTransformers() {
  const href = pathToFileURL(transformersEntry()).href;
  return import(/* webpackIgnore: true */ href);
}

export function studioWhisperPaths() {
  const home = process.env.BILIBILI_UPLOADER_HOME || path.join(os.homedir(), '.bilibili-uploader');
  const modelRoot = process.env.WHISPER_MODEL_DIR || path.join(home, 'models');
  const workRoot = path.resolve(process.cwd(), process.env.VIDEO_WORK_DIR || 'video-work');
  return {
    home,
    modelRoot,
    modelCacheDir: path.join(modelRoot, 'transformers'),
    workRoot,
    studioRoot: path.join(workRoot, 'studio'),
    ffmpeg: process.env.FFMPEG_PATH || firstExisting([
      bundledFfmpeg(),
      '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg',
    ]),
    ffprobe: process.env.FFPROBE_PATH || firstExisting([
      bundledFfprobe(),
      '/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe',
    ]),
  };
}

function modelForQuality(quality) {
  return QUALITY_MODELS[quality] || QUALITY_MODELS.fast;
}

function modelSources() {
  const configuredHost = String(process.env.STUDIO_MODEL_HOST || '').trim();
  if (configuredHost) {
    return [{
      id: 'configured',
      label: 'configured model host',
      host: `${configuredHost.replace(/\/+$/, '')}/`,
      revision: process.env.STUDIO_MODEL_REVISION || (configuredHost.includes('modelscope.cn') ? 'master' : 'main'),
    }];
  }
  return [
    {
      id: 'modelscope', label: 'ModelScope', host: 'https://modelscope.cn/models/', revision: 'master',
    },
    {
      id: 'huggingface', label: 'Hugging Face', host: 'https://huggingface.co/', revision: 'main',
    },
  ];
}

function remoteModelsAllowed() {
  return process.env.STUDIO_OFFLINE !== '1' && process.env.STUDIO_ALLOW_REMOTE_MODELS !== 'false';
}

function modelIsCached(cacheDir, modelId) {
  const modelPath = path.join(cacheDir, ...modelId.split('/'));
  try { return fs.statSync(modelPath).isDirectory() && fs.readdirSync(modelPath).length > 0; } catch { return false; }
}

export function getLocalWhisperStatus(quality = 'fast') {
  const paths = studioWhisperPaths();
  const model = modelForQuality(quality);
  const sources = modelSources();
  const cached = modelIsCached(paths.modelCacheDir, model.id);
  const downloadable = remoteModelsAllowed();
  const checks = {
    ffmpeg: exists(paths.ffmpeg),
    ffprobe: exists(paths.ffprobe),
    recognizer: transformersAvailable(),
    model: cached || downloadable,
  };
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    model: {
      ...model,
      cached,
      downloadOnDemand: !cached && downloadable,
      downloadSource: sources[0]?.label || null,
    },
    paths: {
      ffmpeg: paths.ffmpeg,
      ffprobe: paths.ffprobe,
      modelCacheDir: paths.modelCacheDir,
      studioRoot: paths.studioRoot,
    },
  };
}

function ensureWorkDir(workDir) {
  const { workRoot } = studioWhisperPaths();
  const resolved = path.resolve(workDir || path.join(workRoot, 'studio', `transcribe-${randomUUID()}`));
  const relative = path.relative(workRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Whisper work directory must be a child of VIDEO_WORK_DIR.');
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function writeLog(logPath, entry) {
  fs.appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

function runCommand(bin, args, stage, logPath, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!exists(bin)) return reject(new Error(`${stage} binary is not installed.`));
    const child = spawn(bin, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`${stage} timed out after ${Math.round(timeoutMs / 60000)} minutes.`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`${stage} could not start: ${error.message}`));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      writeLog(logPath, { stage, code, stderr: stderr.slice(-1200) });
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${stage} failed with exit code ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

function readPcm16MonoWav(wavPath) {
  const wav = fs.readFileSync(wavPath);
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('FFmpeg did not produce a valid WAV file.');
  }
  let offset = 12;
  let format;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ' && length >= 16) {
      format = {
        encoding: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2),
        sampleRate: wav.readUInt32LE(start + 4), bits: wav.readUInt16LE(start + 14),
      };
    }
    if (id === 'data') { dataOffset = start; dataLength = Math.min(length, wav.length - start); break; }
    offset = start + length + (length % 2);
  }
  if (!format || dataOffset < 0 || format.encoding !== 1 || format.channels !== 1 || format.sampleRate !== SAMPLE_RATE || format.bits !== 16) {
    throw new Error('Expected mono 16 kHz 16-bit PCM audio from FFmpeg.');
  }
  const samples = new Float32Array(Math.floor(dataLength / 2));
  for (let index = 0; index < samples.length; index += 1) samples[index] = wav.readInt16LE(dataOffset + (index * 2)) / 32768;
  return samples;
}

function compactRepeatedWords(value) {
  const result = [];
  let previous = '';
  let repetitions = 0;
  for (const word of String(value || '').trim().split(/\s+/).filter(Boolean)) {
    const normalized = word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (normalized && normalized === previous) {
      repetitions += 1;
      if (repetitions > 2) continue;
    } else {
      previous = normalized;
      repetitions = 0;
    }
    result.push(word);
  }
  return result.join(' ');
}

export function transformerOutputToSegments(output, duration = 0) {
  const chunks = Array.isArray(output?.chunks) && output.chunks.length
    ? output.chunks
    : (String(output?.text || '').trim() ? [{ text: output.text, timestamp: [0, duration] }] : []);
  return chunks.map((chunk, index) => {
    const timestamp = Array.isArray(chunk.timestamp) ? chunk.timestamp : [];
    const start = Math.max(0, Number(timestamp[0]) || 0);
    const candidateEnd = Number(timestamp[1]);
    const end = Number.isFinite(candidateEnd) && candidateEnd > start ? candidateEnd : Math.max(start + 0.08, duration);
    return { index: index + 1, start, end, text: compactRepeatedWords(chunk.text) };
  }).filter((segment) => segment.text && segment.end > segment.start);
}

async function recognizerFor(model, cacheDir, logPath) {
  const { env, pipeline } = await loadTransformers();
  env.cacheDir = cacheDir;
  env.allowLocalModels = true;
  env.allowRemoteModels = remoteModelsAllowed();
  env.useFS = true;
  env.useFSCache = true;
  fs.mkdirSync(cacheDir, { recursive: true });
  if (!recognizers.has(model.id)) {
    const load = modelLoadQueue.then(async () => {
      const failures = [];
      for (const source of modelSources()) {
        env.remoteHost = source.host;
        env.remotePathTemplate = '{model}/resolve/{revision}/';
        writeLog(logPath, { stage: 'model', status: 'source', source: source.label, host: source.host });
        try {
          const progressBuckets = new Map();
          const recognizer = await pipeline('automatic-speech-recognition', model.id, {
            quantized: true,
            revision: source.revision,
            progress_callback: (event) => {
              if (event?.status === 'progress') {
                const key = event.file || 'model';
                const bucket = Math.min(100, Math.floor((Number(event.progress) || 0) / 10) * 10);
                if (progressBuckets.get(key) === bucket) return;
                progressBuckets.set(key, bucket);
              }
              writeLog(logPath, {
                stage: 'model', source: source.label, status: event?.status, file: event?.file, progress: event?.progress,
              });
            },
          });
          writeLog(logPath, { stage: 'model', status: 'ready', source: source.label });
          return recognizer;
        } catch (error) {
          const details = [];
          let current = error;
          for (let depth = 0; current && depth < 3; depth += 1) {
            const message = String(current.message || current);
            const detail = current.code ? `${current.code}: ${message}` : message;
            if (!details.includes(detail)) details.push(detail);
            current = current.cause;
          }
          const detail = details.join(' -> ');
          failures.push(`${source.label}: ${detail}`);
          writeLog(logPath, { stage: 'model', status: 'failed', source: source.label, error: detail });
        }
      }
      throw new Error(`Unable to download the local Whisper model. ${failures.join(' | ')}`);
    });
    modelLoadQueue = load.catch(() => {});
    recognizers.set(model.id, load.catch((error) => {
      recognizers.delete(model.id);
      throw error;
    }));
  }
  return recognizers.get(model.id);
}

export async function transcribeLocal(mediaPath, {
  quality = 'fast', language = 'zh', workDir, onProgress = () => {}, timeoutMs = COMMAND_TIMEOUT_MS,
} = {}) {
  const absoluteMediaPath = path.resolve(mediaPath || '');
  if (!exists(absoluteMediaPath)) throw new Error(`Media file not found: ${absoluteMediaPath}`);
  const status = getLocalWhisperStatus(quality);
  if (!status.ready) {
    const missing = Object.entries(status.checks).filter(([, ready]) => !ready).map(([name]) => name);
    throw new Error(`Local transcription is unavailable. Missing: ${missing.join(', ')}.`);
  }
  const resolvedWorkDir = ensureWorkDir(workDir);
  const wavPath = path.join(resolvedWorkDir, 'source.wav');
  const logPath = path.join(resolvedWorkDir, 'transcription.ndjson');
  const paths = studioWhisperPaths();
  const model = modelForQuality(quality);
  try {
    onProgress(5, 'Probing media');
    const probe = await runCommand(paths.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', absoluteMediaPath], 'ffprobe', logPath, timeoutMs);
    const probeData = JSON.parse(probe.stdout || '{}');
    const duration = Number(probeData?.format?.duration) || 0;
    const audioStream = probeData?.streams?.find((stream) => stream.codec_type === 'audio');
    const alreadyWhisperWav = path.extname(absoluteMediaPath).toLowerCase() === '.wav'
      && Number(audioStream?.sample_rate) === SAMPLE_RATE
      && Number(audioStream?.channels) === 1
      && audioStream?.codec_name === 'pcm_s16le';
    let transcriptionWav = absoluteMediaPath;
    if (!alreadyWhisperWav) {
      onProgress(12, 'Extracting mono audio');
      await runCommand(paths.ffmpeg, ['-nostdin', '-y', '-i', absoluteMediaPath, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', wavPath], 'ffmpeg', logPath, timeoutMs);
      transcriptionWav = wavPath;
    } else {
      onProgress(12, 'Using existing mono audio');
    }
    const samples = readPcm16MonoWav(transcriptionWav);
    onProgress(25, status.model.cached ? 'Loading local Whisper model' : 'Downloading local Whisper model');
    const recognizer = await recognizerFor(model, paths.modelCacheDir, logPath);
    const options = {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      max_new_tokens: 128,
      task: 'transcribe',
    };
    if (language && !['auto', 'detect'].includes(language)) options.language = language;
    onProgress(45, 'Transcribing locally');
    const output = await recognizer(samples, options);
    const segments = transformerOutputToSegments(output, duration);
    if (!segments.length) throw new Error('No speech was detected in this video.');
    onProgress(100, 'Transcription complete');
    return {
      language: options.language || null,
      fullText: segments.map((segment) => segment.text).join('\n'),
      segments,
      duration,
      engine: `whisper-local/${model.id}`,
      logPath,
    };
  } finally {
    if (wavPath !== absoluteMediaPath) {
      try { fs.rmSync(wavPath, { force: true }); } catch { /* best effort */ }
    }
  }
}

export function listLocalWhisperQualities() {
  return Object.entries(QUALITY_MODELS).map(([id, model]) => ({ id, ...model }));
}
