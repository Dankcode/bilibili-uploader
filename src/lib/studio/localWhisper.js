import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { contextPromptForSegment, matchContextsToSegment } from './context.js';

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

function specialTokenId(tokenizer, token) {
  const lookup = tokenizer?.model?.tokens_to_ids;
  if (typeof lookup?.get === 'function') return lookup.get(token);
  return lookup?.[token];
}

function flattenTokenIds(value) {
  const raw = value?.tolist?.() ?? value?.data ?? value ?? [];
  const list = Array.isArray(raw?.[0]) ? raw[0] : raw;
  return Array.from(list || []).map(Number).filter(Number.isInteger);
}

export async function buildWhisperContextPromptIds(recognizer, contextText, language = 'auto') {
  const tokenizer = recognizer?.tokenizer;
  if (typeof tokenizer !== 'function') throw new Error('The local Whisper tokenizer cannot encode context.');
  const normalizedLanguage = String(language || '').trim().toLocaleLowerCase();
  if (!normalizedLanguage || ['auto', 'detect'].includes(normalizedLanguage)) {
    throw new Error('Choose an exact source language before running context-assisted Whisper.');
  }
  const sanitizedContext = String(contextText || '').replace(/<\|[^|]{1,64}\|>/g, ' ');
  const encoded = await tokenizer(` ${sanitizedContext.trim()}`, {
    add_special_tokens: false,
    truncation: true,
  });
  const specialIds = new Set(Array.from(tokenizer.all_special_ids || []).map(Number));
  const contextIds = flattenTokenIds(encoded?.input_ids)
    .filter((id) => !specialIds.has(id))
    .slice(-96);
  const generationConfig = recognizer?.model?.generation_config || {};
  const languageToken = `<|${normalizedLanguage}|>`;
  const startOfPrevious = generationConfig.prev_sot_token_id
    ?? specialTokenId(tokenizer, '<|startofprev|>');
  const startOfTranscript = generationConfig.decoder_start_token_id
    ?? recognizer?.model?.config?.decoder_start_token_id
    ?? specialTokenId(tokenizer, '<|startoftranscript|>');
  const languageId = generationConfig.lang_to_id?.[languageToken]
    ?? generationConfig.lang_to_id?.[normalizedLanguage]
    ?? specialTokenId(tokenizer, languageToken);
  const transcribeId = generationConfig.task_to_id?.transcribe
    ?? specialTokenId(tokenizer, '<|transcribe|>');
  const noTimestampsId = generationConfig.no_timestamps_token_id
    ?? specialTokenId(tokenizer, '<|notimestamps|>');
  const controlIds = [
    startOfPrevious,
    startOfTranscript,
    languageId,
    transcribeId,
    noTimestampsId,
  ];
  if (!controlIds.every(Number.isInteger)) {
    throw new Error(`The local Whisper model does not support the "${normalizedLanguage}" context prompt.`);
  }
  const ids = [
    startOfPrevious,
    ...contextIds,
    startOfTranscript,
    languageId,
    transcribeId,
    noTimestampsId,
  ];
  return ids;
}

function contextEvidenceTerms(contexts, segment) {
  const result = [];
  const seen = new Set();
  for (const context of matchContextsToSegment(contexts, segment)) {
    const values = [
      ...(context.technicalTerms || []),
      ...(context.visibleText || []),
      ...(context.entities || []),
      ...(context.transcriptionHints || []),
    ];
    for (const value of values) {
      const text = String(value || '').trim();
      const key = text.toLocaleLowerCase();
      if (!text || key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      result.push(text);
    }
  }
  return result.slice(0, 80);
}

function newVisualEvidenceTerms(candidate, baseline, evidenceTerms) {
  const nextRaw = String(candidate || '');
  const beforeRaw = String(baseline || '');
  const next = nextRaw.toLocaleLowerCase();
  const before = beforeRaw.toLocaleLowerCase();
  return evidenceTerms.filter((term) => {
    const normalized = term.toLocaleLowerCase();
    return (nextRaw.includes(term) && !beforeRaw.includes(term))
      || (next.includes(normalized) && !before.includes(normalized));
  });
}

function comparableText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function editDistance(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

export function evaluateContextCandidate(candidate, baseline, evidenceTerms = []) {
  const beforeRaw = String(baseline || '').trim();
  const nextRaw = String(candidate || '').trim();
  if (!nextRaw) return { accepted: false, reason: 'empty-candidate', matchedEvidence: [] };
  if (nextRaw === beforeRaw) return { accepted: false, reason: 'unchanged', matchedEvidence: [] };
  const matchedEvidence = newVisualEvidenceTerms(nextRaw, beforeRaw, evidenceTerms);
  if (!matchedEvidence.length) return { accepted: false, reason: 'no-new-visual-evidence', matchedEvidence };

  const before = comparableText(beforeRaw);
  const next = comparableText(nextRaw);
  if (!before || !next) return { accepted: false, reason: 'empty-comparable-text', matchedEvidence };
  const beforeLength = Array.from(before).length;
  const nextLength = Array.from(next).length;
  const lengthRatio = nextLength / beforeLength;
  if (lengthRatio < 0.65 || lengthRatio > 1.4) {
    return { accepted: false, reason: 'length-drift', matchedEvidence, lengthRatio };
  }

  const distance = editDistance(before, next);
  const editRatio = distance / Math.max(beforeLength, nextLength);
  const exactShortEvidence = nextLength <= 16 && matchedEvidence.some(
    (term) => comparableText(term) === next,
  );
  if (editRatio > 0.32 && !exactShortEvidence) {
    return {
      accepted: false, reason: 'too-many-unrelated-edits', matchedEvidence, lengthRatio, editRatio,
    };
  }
  return {
    accepted: true, reason: 'evidence-backed-local-edit', matchedEvidence, lengthRatio, editRatio,
  };
}

async function transcribeSegmentWithContext({
  recognizer, samples, segment, contextText, language,
}) {
  const paddingSeconds = 0.4;
  const startSample = Math.max(0, Math.floor((segment.start - paddingSeconds) * SAMPLE_RATE));
  const endSample = Math.min(samples.length, Math.ceil((segment.end + paddingSeconds) * SAMPLE_RATE));
  const clip = samples.subarray(startSample, endSample);
  if (clip.length < SAMPLE_RATE / 4) return '';
  const processed = await recognizer.processor(clip);
  const decoderInputIds = await buildWhisperContextPromptIds(recognizer, contextText, language);
  const generated = await recognizer.model.generate({
    inputs: processed.input_features,
    decoder_input_ids: decoderInputIds,
    max_new_tokens: 96,
  });
  const sequences = generated?.sequences ?? generated;
  const allIds = flattenTokenIds(sequences?.[0] ?? sequences);
  const prefixMatches = decoderInputIds.every((id, index) => allIds[index] === id);
  if (!prefixMatches) throw new Error('Whisper returned an unexpected decoder sequence.');
  const newIds = allIds.slice(decoderInputIds.length);
  if (!newIds.length) return '';
  return compactRepeatedWords(
    recognizer.tokenizer.decode(newIds, { skip_special_tokens: true }).trim(),
  );
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

export async function retranscribeWithContext(mediaPath, segments, contexts, {
  quality = 'fast',
  language = 'zh',
  workDir,
  onProgress = () => {},
  timeoutMs = COMMAND_TIMEOUT_MS,
} = {}) {
  const absoluteMediaPath = path.resolve(mediaPath || '');
  if (!exists(absoluteMediaPath)) throw new Error(`Media file not found: ${absoluteMediaPath}`);
  if (!Array.isArray(segments) || !segments.length) {
    throw new Error('Context-assisted transcription requires timestamped transcript segments.');
  }
  if (!Array.isArray(contexts) || !contexts.length) {
    throw new Error('Context-assisted transcription requires timestamped screenshot context.');
  }
  if (!language || ['auto', 'detect'].includes(String(language).toLocaleLowerCase())) {
    throw new Error('Choose an exact source language before running context-assisted Whisper.');
  }
  const status = getLocalWhisperStatus(quality);
  if (!status.ready) {
    const missing = Object.entries(status.checks).filter(([, ready]) => !ready).map(([name]) => name);
    throw new Error(`Local context-assisted transcription is unavailable. Missing: ${missing.join(', ')}.`);
  }

  const resolvedWorkDir = ensureWorkDir(workDir);
  const wavPath = path.join(resolvedWorkDir, 'context-source.wav');
  const logPath = path.join(resolvedWorkDir, 'context-transcription.ndjson');
  const paths = studioWhisperPaths();
  const model = modelForQuality(quality);
  try {
    onProgress(5, 'Preparing context-assisted audio');
    const probe = await runCommand(
      paths.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', absoluteMediaPath],
      'context-ffprobe',
      logPath,
      timeoutMs,
    );
    const probeData = JSON.parse(probe.stdout || '{}');
    const audioStream = probeData?.streams?.find((stream) => stream.codec_type === 'audio');
    const alreadyWhisperWav = path.extname(absoluteMediaPath).toLowerCase() === '.wav'
      && Number(audioStream?.sample_rate) === SAMPLE_RATE
      && Number(audioStream?.channels) === 1
      && audioStream?.codec_name === 'pcm_s16le';
    let transcriptionWav = absoluteMediaPath;
    if (!alreadyWhisperWav) {
      await runCommand(
        paths.ffmpeg,
        ['-nostdin', '-y', '-i', absoluteMediaPath, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', wavPath],
        'context-ffmpeg',
        logPath,
        timeoutMs,
      );
      transcriptionWav = wavPath;
    }

    const samples = readPcm16MonoWav(transcriptionWav);
    onProgress(20, status.model.cached ? 'Loading local Whisper model' : 'Downloading local Whisper model');
    const recognizer = await recognizerFor(model, paths.modelCacheDir, logPath);
    const candidates = segments
      .map((segment) => ({
        segment,
        contextText: contextPromptForSegment(contexts, segment),
        evidenceTerms: contextEvidenceTerms(contexts, segment),
      }))
      .filter((item) => item.contextText);
    if (!candidates.length) {
      return {
        segments,
        attemptedCount: 0,
        failedCount: 0,
        failedCueIds: [],
        revisedCount: 0,
        revisions: [],
        suggestions: [],
        engine: `whisper-local/${model.id}+screenshot-context`,
        logPath,
      };
    }

    const replacements = new Map();
    const revisions = [];
    const suggestions = [];
    const failedCueIds = [];
    let failureCount = 0;
    let firstFailure = '';
    for (let index = 0; index < candidates.length; index += 1) {
      const { segment, contextText, evidenceTerms } = candidates[index];
      const progress = 25 + Math.round(((index + 1) / candidates.length) * 70);
      onProgress(progress, `Context pass ${index + 1}/${candidates.length} - cue #${segment.index}`);
      try {
        const candidate = await transcribeSegmentWithContext({
          recognizer,
          samples,
          segment,
          contextText,
          language,
        });
        const baseline = String(segment.text || '').trim();
        const evaluation = evaluateContextCandidate(candidate, baseline, evidenceTerms);
        if (!evaluation.accepted) {
          if (candidate && candidate !== baseline && evaluation.matchedEvidence.length) {
            suggestions.push({
              index: Number(segment.index),
              start: Number(segment.start),
              end: Number(segment.end),
              before: baseline,
              suggestion: candidate,
              reason: evaluation.reason,
              evidenceTerms: evaluation.matchedEvidence.slice(0, 12),
            });
          }
          continue;
        }
        replacements.set(Number(segment.index), { ...segment, text: candidate });
        revisions.push({
          index: Number(segment.index),
          start: Number(segment.start),
          end: Number(segment.end),
          before: baseline,
          after: candidate,
          contextIds: matchContextsToSegment(contexts, segment).map((item) => item.id),
          evidenceTerms: evaluation.matchedEvidence.slice(0, 12),
        });
        writeLog(logPath, { stage: 'context-cue', index: segment.index, status: 'revised' });
      } catch (error) {
        failureCount += 1;
        failedCueIds.push(Number(segment.index));
        if (!firstFailure) firstFailure = error.message;
        writeLog(logPath, {
          stage: 'context-cue',
          index: segment.index,
          status: 'kept-baseline',
          error: error.message,
        });
      }
    }
    if (failureCount === candidates.length) {
      throw new Error(`Context-assisted Whisper could not process any matched cues: ${firstFailure}`);
    }
    onProgress(100, `Context pass complete - ${revisions.length} evidence-backed revisions`);
    return {
      segments: segments.map((segment) => replacements.get(Number(segment.index)) || segment),
      attemptedCount: candidates.length,
      failedCount: failureCount,
      failedCueIds,
      revisedCount: revisions.length,
      revisions,
      suggestions,
      engine: `whisper-local/${model.id}+screenshot-context`,
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
