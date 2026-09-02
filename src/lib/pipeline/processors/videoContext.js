import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { buildContextMarkdown } from '../../context/contextTrack.js';
import { extractSynchronizedFrames } from '../../context/frames.js';
import { buildTranscriptMarkdown } from '../../context/transcriptMd.js';
import { analyzeFramesWithFallback, getVisionStatus, VISION_SKIPPED_MESSAGE } from '../../context/vision/index.js';
import { extractAudio, probeDuration } from '../../media/ffmpeg.js';
import { getSttBackend } from '../../stt/index.js';

export const id = 'videoContext';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resolveCredentials(credentials = {}, options = {}) {
  const env = globalThis.process?.env || {};
  return {
    ...credentials,
    sttBackend: options.sttBackend || credentials.sttBackend || 'localWhisper',
    sttQuality: options.quality || options.sttQuality || credentials.sttQuality || 'balanced',
    transcribeApiKey: credentials.transcribeApiKey || env.OPENAI_API_KEY || '',
    transcribeBaseUrl: credentials.transcribeBaseUrl || env.WHISPER_BASE_URL || undefined,
    transcribeModel: credentials.transcribeModel || 'whisper-1',
    visionBatchSize: options.visionBatchSize || credentials.visionBatchSize,
  };
}

export async function testConnection(credentials = {}) {
  const creds = resolveCredentials(credentials);
  const stt = await getSttBackend(creds.sttBackend).test(creds);
  const vision = getVisionStatus(creds);
  return {
    ok: Boolean(stt.ok),
    stt,
    vision,
    warning: vision.configured ? '' : VISION_SKIPPED_MESSAGE,
  };
}

export async function process(inputPath, options = {}, onProgress = () => {}, credentials = {}, meta = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error(`Video context input not found: ${inputPath}`);
  const creds = resolveCredentials(credentials, options);
  const workDir = path.join(path.dirname(inputPath), 'video-context');
  const framesDir = path.join(workDir, 'frames');
  fs.mkdirSync(workDir, { recursive: true });

  onProgress(5, 'Probing video duration');
  const duration = await probeDuration(inputPath);
  const audioPath = path.join(workDir, 'source.wav');
  onProgress(10, 'Extracting audio for context transcript');
  await extractAudio(inputPath, audioPath);
  const sttBackend = getSttBackend(creds.sttBackend);
  onProgress(18, `Transcribing with ${sttBackend.label || sttBackend.id}`);
  const transcript = await sttBackend.transcribe(audioPath, {
    apiKey: creds.transcribeApiKey,
    baseURL: creds.transcribeBaseUrl,
    model: creds.transcribeModel,
    language: options.sourceLanguage || options.sourceLang || meta.language || 'auto',
    quality: creds.sttQuality,
    workDir,
    onProgress: (progress, note) => onProgress(18 + Math.round((Number(progress) || 0) * 0.34), note),
  });
  const segments = transcript.segments || [];
  if (!segments.length) throw new Error('Video context transcription produced no timestamped segments.');
  const transcriptMd = buildTranscriptMarkdown({
    name: meta.title || path.basename(inputPath),
    source: options.sourceLanguage || transcript.language || 'auto',
    target: 'en',
    duration,
    engine: sttBackend.id,
    segments,
  });
  const transcriptPath = path.join(workDir, 'transcript.md');
  fs.writeFileSync(transcriptPath, transcriptMd, 'utf8');
  const transcriptSha256 = sha256(transcriptMd);

  onProgress(55, 'Capturing synchronized screenshots');
  const frameManifest = await extractSynchronizedFrames(inputPath, segments, framesDir, {
    duration,
    intervalSeconds: Number(options.intervalSeconds) || 20,
    maxFrames: Number(options.maxFrames) || 120,
  });
  onProgress(70, `${frameManifest.length} screenshots captured`);

  let visionResult = {
    contexts: [], provider: '', model: '', promptVersion: '', attempts: [], fallbackUsed: '',
  };
  let visionSkipped = options.visionMode === 'off';
  if (!visionSkipped) {
    const batch = frameManifest.map((frame) => {
      const overlapping = segments.filter((segment) => segment.start < frame.windowEndMs / 1000 && segment.end > frame.windowStartMs / 1000);
      const imagePath = path.join(framesDir, frame.file);
      return {
        ...frame,
        imagePath,
        segmentIds: overlapping.map((segment) => segment.index),
        mimeType: 'image/jpeg',
        sha256: sha256(fs.readFileSync(imagePath)),
        draftText: overlapping.map((segment) => `#${segment.index} ${segment.text}`).join(' | '),
      };
    });
    try {
      visionResult = await analyzeFramesWithFallback(batch, {
        credentials: creds,
        onAttempt: (attempt) => onProgress(72, `${attempt.backend}: ${attempt.status}${attempt.error ? ` — ${attempt.error}` : ''}`),
      });
    } catch (error) {
      if (error.code !== 'VISION_NOT_CONFIGURED') throw error;
      visionSkipped = true;
      onProgress(78, VISION_SKIPPED_MESSAGE);
    }
  }

  const byId = new Map(visionResult.contexts.map((context) => [String(context.frameId || context.id), context]));
  const contexts = frameManifest.map((frame) => ({
    ...(byId.get(String(frame.frameId)) || {}),
    id: frame.frameId,
    file: frame.file,
    sha256: sha256(fs.readFileSync(path.join(framesDir, frame.file))),
    segmentIds: segments.filter((segment) => segment.start < frame.windowEndMs / 1000 && segment.end > frame.windowStartMs / 1000).map((segment) => segment.index),
    captureTime: frame.timeMs / 1000,
    windowStart: frame.windowStartMs / 1000,
    windowEnd: frame.windowEndMs / 1000,
  }));
  const contextMd = buildContextMarkdown({
    name: meta.title || path.basename(inputPath),
    provider: visionResult.provider || 'Frames only',
    model: visionResult.model || '',
    promptVersion: visionResult.promptVersion || 'frames-only.v1',
    transcriptSha256,
    intervalSeconds: Number(options.intervalSeconds) || 20,
    duration,
    frames: contexts,
  });
  const contextPath = path.join(workDir, 'context.md');
  fs.writeFileSync(contextPath, contextMd, 'utf8');
  onProgress(100, visionSkipped ? `Context ready; ${VISION_SKIPPED_MESSAGE}` : 'Visual context ready');

  return {
    outputPath: inputPath,
    artifactFiles: [
      { kind: 'transcript', path: transcriptPath, meta: { segmentCount: segments.length, sha256: transcriptSha256 } },
      { kind: 'frames', path: path.join(framesDir, 'frames.json'), meta: { frameCount: frameManifest.length, framesDir } },
      { kind: 'context', path: contextPath, meta: { provider: visionResult.provider, model: visionResult.model } },
    ],
    metrics: { segmentCount: segments.length, frameCount: frameManifest.length, contextFrameCount: contexts.length },
    artifacts: {
      segments, transcriptMd, transcriptPath, transcriptSha256,
      frameManifest, framesDir, duration, language: transcript.language,
      sttBackend: sttBackend.id, sttQuality: creds.sttQuality,
      contexts, contextMd, contextPath,
      visionProvider: visionResult.provider, visionModel: visionResult.model,
      visionPromptVersion: visionResult.promptVersion,
      visionFallbackUsed: visionResult.fallbackUsed,
      visionAttempts: visionResult.attempts,
      visionSkipped,
      segmentCount: segments.length, frameCount: frameManifest.length,
      contextFrameCount: contexts.length,
    },
  };
}
