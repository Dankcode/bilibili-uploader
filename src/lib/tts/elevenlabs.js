/**
 * ELEVENLABS TEXT-TO-SPEECH CLIENT.
 * The single place that knows the ElevenLabs API shape.
 *
 *   POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}
 *   header: xi-api-key
 *   body:   { text, model_id, voice_settings, output_format? }
 *
 * eleven_multilingual_v2 is the default model (29 languages, up to 10k chars,
 * best quality). Use eleven_turbo_v2_5 / eleven_flash_v2_5 for lower latency.
 */

import fs from 'fs';

const API_ROOT = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const DEFAULT_FORMAT = 'mp3_44100_128';

function authHeaders(apiKey) {
  if (!apiKey) throw new Error('ElevenLabs apiKey is required (set it on the voiceover connection).');
  return { 'xi-api-key': apiKey };
}

/** Lightweight reachability + key/voice validity probe. */
export async function testConnection({ apiKey, voiceId } = {}) {
  if (!apiKey) return { ok: false, error: 'ElevenLabs API key is not set.' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${API_ROOT}/user`, { headers: authHeaders(apiKey), signal: controller.signal });
    if (res.status === 401) return { ok: false, error: 'ElevenLabs API key was rejected (401).' };
    if (!res.ok) return { ok: false, error: `ElevenLabs unreachable: HTTP ${res.status}` };
    if (voiceId) {
      const v = await fetch(`${API_ROOT}/voices/${voiceId}`, { headers: authHeaders(apiKey) });
      if (!v.ok) return { ok: false, error: `Voice "${voiceId}" not found on this account (HTTP ${v.status}).` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `ElevenLabs unreachable: ${error.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Synthesize one line of speech and write it to `outPath`.
 * @returns {Promise<{ path: string, bytes: number }>}
 */
export async function synthesizeToFile(text, outPath, options = {}) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Cannot synthesize empty text.');
  const { apiKey, voiceId, modelId = DEFAULT_MODEL, outputFormat = DEFAULT_FORMAT, voiceSettings } = options;
  if (!voiceId) throw new Error('ElevenLabs voiceId is required.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(
      `${API_ROOT}/text-to-speech/${voiceId}?output_format=${encodeURIComponent(outputFormat)}`,
      {
        method: 'POST',
        headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: clean,
          model_id: modelId,
          voice_settings: voiceSettings || { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`ElevenLabs TTS failed (HTTP ${res.status}): ${detail.slice(0, 300)}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buffer);
    return { path: outPath, bytes: buffer.length };
  } finally {
    clearTimeout(timeout);
  }
}

export const DEFAULTS = { model: DEFAULT_MODEL, format: DEFAULT_FORMAT };
