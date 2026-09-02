import fs from 'fs';
import path from 'path';
import { buildContextMarkdown, mergeContextTracks } from '../../context/contextTrack.js';
import { extractGlossary } from '../../context/ocr/glossary.js';
import { getOcrBackend } from '../../context/ocr/index.js';
import { assertTimingPreserved, proposeTranscriptRepairs } from '../../context/ocr/repair.js';
import { collapseReadingsToSpans } from '../../context/ocr/spans.js';

export const id = 'ocrContext';

export async function testConnection(credentials = {}) {
  return getOcrBackend(credentials.ocrBackend || 'rapidocr').testConnection(credentials);
}

export async function process(inputPath, options = {}, onProgress = () => {}, credentials = {}, meta = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error(`OCR context input not found: ${inputPath}`);
  if (!Array.isArray(meta.segments) || !Array.isArray(meta.frameManifest)) {
    throw new Error('ocrContext requires videoContext to run first.');
  }
  const backend = getOcrBackend(credentials.ocrBackend || 'rapidocr');
  const workDir = path.join(path.dirname(inputPath), 'ocr-context');
  const denseDir = path.join(workDir, 'dense');
  fs.mkdirSync(workDir, { recursive: true });
  const denseInterval = Math.max(0.25, Number(options.denseInterval) || 1);
  let frames;
  if (options.denseSampling !== false) {
    frames = await backend.extractDenseFrames(inputPath, denseDir, {
      intervalSeconds: denseInterval,
      region: options.region || 'full',
      onProgress: (progress, note) => onProgress(Math.min(30, progress), note),
    });
  } else {
    frames = meta.frameManifest.map((frame) => ({
      imagePath: path.join(meta.framesDir, frame.file),
      time: Number(frame.timeMs) / 1000,
    }));
  }
  onProgress(32, `Reading ${frames.length} frames with RapidOCR`);
  const readings = await backend.recognizeFrames(frames, options, credentials);
  onProgress(62, 'Collapsing OCR readings into timed spans');
  const onscreenSpans = collapseReadingsToSpans(readings, {
    similarityThreshold: Number(options.similarity) || 0.85,
    intervalSeconds: denseInterval,
  });
  onProgress(72, 'Building recurring-term glossary');
  const glossary = extractGlossary(onscreenSpans);
  const contexts = mergeContextTracks(meta.contexts || [], onscreenSpans);
  const contextMd = buildContextMarkdown({
    name: meta.title || path.basename(inputPath),
    provider: [meta.visionProvider, 'RapidOCR'].filter(Boolean).join('+') || 'RapidOCR',
    model: [meta.visionModel, 'rapidocr_onnxruntime'].filter(Boolean).join('+'),
    promptVersion: [meta.visionPromptVersion, 'rapidocr-spans.v1'].filter(Boolean).join('+'),
    transcriptSha256: meta.transcriptSha256,
    intervalSeconds: denseInterval,
    duration: meta.duration,
    frames: contexts,
  });
  const contextPath = path.join(workDir, 'context.md');
  const glossaryPath = path.join(workDir, 'glossary.json');
  const onscreenPath = path.join(workDir, 'onscreen.json');
  const correctionsPath = path.join(workDir, 'corrections.json');
  fs.writeFileSync(contextPath, contextMd, 'utf8');
  fs.writeFileSync(glossaryPath, JSON.stringify(glossary, null, 2), 'utf8');
  fs.writeFileSync(onscreenPath, JSON.stringify(onscreenSpans, null, 2), 'utf8');
  onProgress(86, 'Comparing OCR evidence with transcript');
  const repair = proposeTranscriptRepairs(meta.segments, onscreenSpans);
  assertTimingPreserved(meta.segments, repair.correctedSegments);
  fs.writeFileSync(correctionsPath, JSON.stringify(repair.corrections, null, 2), 'utf8');
  const applyMode = ['auto', 'review', 'off'].includes(options.applyCorrections) ? options.applyCorrections : 'auto';
  const correctedSegments = applyMode === 'off' ? meta.segments : repair.correctedSegments;
  const ocrEmpty = onscreenSpans.length === 0;
  if (options.denseSampling !== false) fs.rmSync(denseDir, { recursive: true, force: true });
  onProgress(100, ocrEmpty
    ? `OCR found no readable text in ${frames.length} frames — leaving the transcript unchanged`
    : `${onscreenSpans.length} spans and ${repair.corrections.length} proposed corrections`);
  return {
    outputPath: inputPath,
    pauseForReview: applyMode === 'review' && repair.corrections.length > 0,
    reviewType: 'corrections',
    artifactFiles: [
      { kind: 'context', path: contextPath, meta: { merged: true } },
      { kind: 'glossary', path: glossaryPath, meta: { termCount: glossary.length } },
      { kind: 'onscreen', path: onscreenPath, meta: { spanCount: onscreenSpans.length } },
      { kind: 'corrections', path: correctionsPath, meta: { correctionCount: repair.corrections.length, applyMode } },
    ],
    metrics: { framesRead: frames.length, spanCount: onscreenSpans.length, termCount: glossary.length, correctionCount: repair.corrections.length, ocrEmpty },
    artifacts: {
      segments: meta.segments,
      contextMd, contextPath, contexts,
      onscreenSpans, glossary, glossaryPath,
      corrections: repair.corrections, correctedSegments,
      framesRead: frames.length, spanCount: onscreenSpans.length,
      termCount: glossary.length, correctionCount: repair.corrections.length,
      ocrBackend: credentials.ocrBackend || 'rapidocr', ocrEmpty,
      contextSource: 'ocrContext', correctionsApplied: applyMode === 'auto' ? repair.corrections.length : 0,
    },
  };
}
