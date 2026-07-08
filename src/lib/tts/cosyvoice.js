/**
 * COSYVOICE TTS BACKEND — Alibaba's open-source voice-clone model
 * (FunAudioLLM/CosyVoice), run LOCALLY as a FastAPI server. This adapter is
 * the only place that knows its HTTP shape.
 *
 * Run the model on your machine/LAN (GPU recommended), e.g.:
 *   cd CosyVoice/runtime/python/fastapi
 *   python3 server.py --port 50000 --model_dir iic/CosyVoice-300M
 * then set the "voiceover" connection: ttsBackend=cosyvoice, cosyEndpoint,
 * cosyMode, and either cosySpeakerId (sft) or cosyPromptWav+cosyPromptText
 * (zero-shot voice clone).
 *
 * Modes map to the official routes:
 *   zero_shot     POST /inference_zero_shot     form: tts_text, prompt_text, prompt_wav(file)
 *   sft           POST /inference_sft           form: tts_text, spk_id
 *   cross_lingual POST /inference_cross_lingual form: tts_text, prompt_wav(file)
 *   instruct      POST /inference_instruct      form: tts_text, spk_id, instruct_text
 * The server streams back audio bytes (WAV) which we write to disk.
 */

import fs from 'fs';
import path from 'path';

export const id = 'cosyvoice';
export const label = 'CosyVoice (Alibaba, local)';

function base(endpoint) {
  const url = String(endpoint || process.env.COSYVOICE_ENDPOINT || 'http://127.0.0.1:50000').replace(/\/$/, '');
  return url;
}

export async function testConnection(credentials = {}) {
  const endpoint = base(credentials.cosyEndpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    // CosyVoice's FastAPI has no /health; any HTTP response means it's reachable.
    await fetch(`${endpoint}/`, { signal: controller.signal }).catch((e) => {
      if (e.name === 'AbortError') throw e;
      // A connection refused throws; a 404 resolves — only refusal is a failure.
      throw e;
    });
    return { ok: true };
  } catch (error) {
    if (error.name === 'AbortError') return { ok: false, error: `CosyVoice timed out at ${endpoint}` };
    return { ok: false, error: `CosyVoice unreachable at ${endpoint}: ${error.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {string} text
 * @param {string} outPath  .wav destination
 * @param {object} options  { cosyEndpoint, cosyMode, cosySpeakerId,
 *                            cosyPromptWav, cosyPromptText, cosyInstruct }
 */
export async function synthesizeToFile(text, outPath, options = {}) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('CosyVoice: cannot synthesize empty text.');
  const endpoint = base(options.cosyEndpoint);
  const mode = options.cosyMode || (options.cosyPromptWav ? 'zero_shot' : 'sft');

  const form = new FormData();
  form.append('tts_text', clean);

  if (mode === 'zero_shot') {
    if (!options.cosyPromptWav) throw new Error('CosyVoice zero_shot needs cosyPromptWav (reference voice).');
    if (!fs.existsSync(options.cosyPromptWav)) throw new Error(`CosyVoice prompt wav not found: ${options.cosyPromptWav}`);
    form.append('prompt_text', String(options.cosyPromptText || ''));
    const buf = fs.readFileSync(options.cosyPromptWav);
    form.append('prompt_wav', new Blob([buf], { type: 'audio/wav' }), path.basename(options.cosyPromptWav));
  } else if (mode === 'cross_lingual') {
    if (!options.cosyPromptWav) throw new Error('CosyVoice cross_lingual needs cosyPromptWav (reference voice).');
    const buf = fs.readFileSync(options.cosyPromptWav);
    form.append('prompt_wav', new Blob([buf], { type: 'audio/wav' }), path.basename(options.cosyPromptWav));
  } else if (mode === 'instruct') {
    form.append('spk_id', String(options.cosySpeakerId || '中文女'));
    form.append('instruct_text', String(options.cosyInstruct || ''));
  } else {
    // sft (preset speaker)
    form.append('spk_id', String(options.cosySpeakerId || '中文女'));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`${endpoint}/inference_${mode}`, { method: 'POST', body: form, signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`CosyVoice /inference_${mode} failed (HTTP ${res.status}): ${detail.slice(0, 200)}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error('CosyVoice returned empty audio.');
    fs.writeFileSync(outPath, buffer);
    return { path: outPath, bytes: buffer.length };
  } finally {
    clearTimeout(timeout);
  }
}
