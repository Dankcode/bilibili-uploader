import fs from 'fs';
import * as codex from './backends/codex.js';
import * as gemini from './backends/gemini.js';
import * as local from './backends/local.js';
import * as kimiVision from './backends/kimiVision.js';

const BACKENDS = { codex, gemini, local, kimiVision };
export const VISION_SKIPPED_MESSAGE = 'Vision correction was skipped due to no provider.';

function selectedBackendId() {
  return process.env.VISION_BACKEND || (gemini.isConfigured() ? gemini.id : '');
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
  const configured = Boolean(backend && (typeof backend.isConfigured !== 'function' || backend.isConfigured()));
  return {
    configured,
    backend: selected || null,
    model: selected === gemini.id && configured
      ? (process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash')
      : null,
    available: Object.values(BACKENDS).map((item) => ({
      id: item.id,
      label: item.label,
      configured: typeof item.isConfigured === 'function' ? item.isConfigured() : false,
    })),
  };
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
