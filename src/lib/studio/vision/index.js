import fs from 'fs';
import * as codex from './backends/codex.js';
import * as gemini from './backends/gemini.js';
import * as local from './backends/local.js';
import * as kimiVision from './backends/kimiVision.js';

const BACKENDS = { codex, gemini, local, kimiVision };
export const VISION_SKIPPED_MESSAGE = 'Screenshot context was skipped because no vision provider is configured.';

function selectedBackendId() {
  return process.env.VISION_BACKEND
    || (kimiVision.isConfigured() ? kimiVision.id : '')
    || (gemini.isConfigured() ? gemini.id : '');
}

function isConfigured(backend) {
  return Boolean(backend && typeof backend.isConfigured === 'function' && backend.isConfigured());
}

function supportsScreenshotContext(backend) {
  return Boolean(backend && typeof backend.analyzeFrames === 'function');
}

export function getVisionBackend(id = selectedBackendId()) {
  if (!id) return null;
  const backend = BACKENDS[id];
  if (!backend) throw new Error(`Unknown VISION_BACKEND "${id}".`);
  return backend;
}

export function getVisionStatus() {
  const selected = selectedBackendId();
  const backend = selected ? getVisionBackend(selected) : null;
  const contextCapable = supportsScreenshotContext(backend);
  const configured = contextCapable && isConfigured(backend);
  return {
    configured,
    backend: contextCapable ? (selected || null) : null,
    model: configured
      ? (typeof backend.getModel === 'function'
        ? backend.getModel()
        : null)
      : null,
    available: Object.values(BACKENDS).map((item) => ({
      id: item.id,
      label: item.label,
      configured: isConfigured(item),
      contextCapable: supportsScreenshotContext(item),
      contextReady: isConfigured(item) && supportsScreenshotContext(item),
    })),
  };
}

export async function analyzeFrames(batch) {
  const backend = getVisionBackend();
  if (!backend || !isConfigured(backend) || !supportsScreenshotContext(backend)) {
    const error = new Error(VISION_SKIPPED_MESSAGE);
    error.code = 'VISION_NOT_CONFIGURED';
    throw error;
  }
  for (const entry of batch) {
    const stat = fs.statSync(entry.imagePath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Vision frame is missing or empty: ${entry.imagePath}`);
    }
  }
  const result = await backend.analyzeFrames(batch);
  if (!result || !Array.isArray(result.contexts)) {
    throw new Error(`Vision backend "${backend.id}" returned invalid screenshot context.`);
  }
  return result;
}

export async function correctSegments(batch) {
  const backend = getVisionBackend();
  if (!backend) {
    const error = new Error(VISION_SKIPPED_MESSAGE);
    error.code = 'VISION_NOT_CONFIGURED';
    throw error;
  }
  for (const entry of batch) {
    const stat = fs.statSync(entry.imagePath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Vision frame is missing or empty: ${entry.imagePath}`);
    }
  }
  const corrected = await backend.correctSegments(batch);
  if (!Array.isArray(corrected)) throw new Error(`Vision backend "${backend.id}" returned an invalid result.`);
  const expected = new Set(batch.map((entry) => Number(entry.segIndex)));
  for (const item of corrected) {
    if (!expected.has(Number(item.segIndex)) || typeof item.text !== 'string') {
      throw new Error(`Vision backend "${backend.id}" changed segment identity.`);
    }
  }
  return corrected;
}
