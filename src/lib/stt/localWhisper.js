import { getLocalWhisperStatus, transcribeLocal } from '../studio/localWhisper';

export const id = 'localWhisper';
export const label = 'Local Whisper (Transformers.js)';

export function transcribe(audioPath, options = {}) {
  return transcribeLocal(audioPath, {
    quality: options.quality || 'fast',
    language: options.language,
    workDir: options.workDir,
    onProgress: options.onProgress,
  });
}

export async function test(credentials = {}) {
  const quality = credentials.sttQuality || 'fast';
  const status = getLocalWhisperStatus(quality);
  if (status.ready) return { ok: true, status };
  const missing = Object.entries(status.checks).filter(([, ready]) => !ready).map(([name]) => name);
  return { ok: false, error: `Local Whisper is missing: ${missing.join(', ')}.`, status };
}
