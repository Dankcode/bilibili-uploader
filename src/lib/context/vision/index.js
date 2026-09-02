import fs from 'fs';
import * as codex from './backends/codex.js';
import * as gemini from './backends/gemini.js';
import * as local from '../../studio/vision/backends/local.js';
import * as kimiVision from '../../studio/vision/backends/kimiVision.js';

const BACKENDS = { codex, gemini, local, kimiVision };
export const DEFAULT_VISION_CHAIN = ['gemini', 'codex', 'kimiVision'];
export const VISION_SKIPPED_MESSAGE = 'Screenshot context was skipped because no vision provider is configured.';

function configured(backend, credentials = {}) {
  return Boolean(backend && typeof backend.isConfigured === 'function' && backend.isConfigured(credentials));
}

function contextCapable(backend) {
  return Boolean(backend && typeof backend.analyzeFrames === 'function');
}

function requestedIds(credentials = {}) {
  const explicit = String(credentials.visionBackend || '').trim();
  if (explicit) return [explicit];
  const fallback = String(credentials.visionFallback || '').trim();
  if (fallback) return fallback.split(',').map((value) => value.trim()).filter(Boolean);
  const envSelected = String(process.env.VISION_BACKEND || '').trim();
  if (envSelected) return envSelected.split(',').map((value) => value.trim()).filter(Boolean);
  return DEFAULT_VISION_CHAIN;
}

export function getVisionBackend(id) {
  if (!id) return null;
  const backend = BACKENDS[id];
  if (!backend) throw new Error(`Unknown vision backend "${id}".`);
  return backend;
}

export function resolveVisionChain(credentials = {}, { includeUnavailable = false } = {}) {
  const unique = [...new Set(requestedIds(credentials))];
  const resolved = unique.map((id) => getVisionBackend(id));
  return includeUnavailable
    ? resolved
    : resolved.filter((backend) => contextCapable(backend) && configured(backend, credentials));
}

export function getVisionStatus(credentials = {}) {
  const requested = resolveVisionChain(credentials, { includeUnavailable: true });
  const chain = requested.map((backend) => ({
    id: backend.id,
    label: backend.label,
    configured: configured(backend, credentials),
    contextCapable: contextCapable(backend),
    contextReady: configured(backend, credentials) && contextCapable(backend),
    model: typeof backend.getModel === 'function' ? backend.getModel(credentials) : null,
    reason: !contextCapable(backend)
      ? 'This adapter cannot build screenshot context.'
      : (!configured(backend, credentials) ? 'Not configured.' : ''),
  }));
  const ready = chain.find((item) => item.contextReady) || null;
  return {
    configured: Boolean(ready),
    backend: ready?.id || null,
    model: ready?.model || null,
    chain,
    available: Object.values(BACKENDS).map((backend) => ({
      id: backend.id,
      label: backend.label,
      configured: configured(backend, credentials),
      contextCapable: contextCapable(backend),
      contextReady: configured(backend, credentials) && contextCapable(backend),
    })),
  };
}

function validateFrameFiles(batch) {
  for (const entry of batch) {
    const stat = fs.statSync(entry.imagePath);
    if (!stat.isFile() || stat.size === 0) throw new Error(`Vision frame is missing or empty: ${entry.imagePath}`);
  }
}

function validateContextIdentity(contexts, batch, backendId) {
  if (!Array.isArray(contexts)) throw new Error(`Vision backend "${backendId}" returned invalid screenshot context.`);
  const expected = new Set(batch.map((entry) => String(entry.frameId)));
  const seen = new Set();
  for (const context of contexts) {
    const frameId = String(context?.frameId || context?.id || '');
    if (!expected.has(frameId) || seen.has(frameId)) {
      throw new Error(`Vision backend "${backendId}" changed frame identity.`);
    }
    seen.add(frameId);
  }
  if (seen.size !== expected.size && contexts.length > 0) {
    throw new Error(`Vision backend "${backendId}" omitted frame context.`);
  }
}

export async function analyzeFramesWithFallback(batch, {
  chain,
  credentials = {},
  onAttempt = () => {},
  backends = BACKENDS,
} = {}) {
  validateFrameFiles(batch);
  const candidates = chain
    ? chain.map((item) => typeof item === 'string' ? backends[item] : item).filter(Boolean)
    : resolveVisionChain(credentials);
  if (!candidates.length) {
    const error = new Error(VISION_SKIPPED_MESSAGE);
    error.code = 'VISION_NOT_CONFIGURED';
    throw error;
  }
  const attempts = [];
  for (const backend of candidates) {
    try {
      onAttempt({ backend: backend.id, status: 'starting' });
      const result = await backend.analyzeFrames(batch, credentials);
      validateContextIdentity(result?.contexts, batch, backend.id);
      attempts.push({ backend: backend.id, ok: true });
      onAttempt({ backend: backend.id, status: 'ok' });
      return {
        ...result,
        attempts,
        fallbackUsed: backend.id === candidates[0]?.id ? '' : backend.id,
      };
    } catch (error) {
      attempts.push({ backend: backend.id, ok: false, error: error.message });
      onAttempt({ backend: backend.id, status: 'failed', error: error.message });
    }
  }
  const failure = new AggregateError(
    attempts.map((attempt) => new Error(`${attempt.backend}: ${attempt.error}`)),
    `Every screenshot-context backend failed: ${attempts.map((attempt) => `${attempt.backend} (${attempt.error})`).join('; ')}`,
  );
  failure.code = 'VISION_ALL_FAILED';
  failure.attempts = attempts;
  throw failure;
}

export async function analyzeFrames(batch, options = {}) {
  return analyzeFramesWithFallback(batch, options);
}

export async function correctSegments(batch, { backendId, credentials = {} } = {}) {
  validateFrameFiles(batch);
  const backend = backendId ? getVisionBackend(backendId) : resolveVisionChain(credentials, { includeUnavailable: false })[0];
  if (!backend || typeof backend.correctSegments !== 'function') {
    const error = new Error(VISION_SKIPPED_MESSAGE);
    error.code = 'VISION_NOT_CONFIGURED';
    throw error;
  }
  const corrected = await backend.correctSegments(batch, credentials);
  if (!Array.isArray(corrected)) throw new Error(`Vision backend "${backend.id}" returned an invalid result.`);
  const expected = new Set(batch.map((entry) => Number(entry.segIndex)));
  for (const item of corrected) {
    if (!expected.has(Number(item.segIndex)) || typeof item.text !== 'string') {
      throw new Error(`Vision backend "${backend.id}" changed segment identity.`);
    }
  }
  return corrected;
}
