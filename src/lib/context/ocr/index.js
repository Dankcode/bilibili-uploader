import * as rapidocr from './rapidocr.js';

const BACKENDS = { rapidocr };

export function getOcrBackend(id = 'rapidocr') {
  const backend = BACKENDS[id];
  if (!backend) throw new Error(`Unknown OCR backend "${id}".`);
  return backend;
}

export function getOcrStatus(credentials = {}) {
  return { backend: credentials.ocrBackend || 'rapidocr', available: Object.keys(BACKENDS) };
}
