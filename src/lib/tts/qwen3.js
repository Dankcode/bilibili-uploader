/**
 * QWEN3-TTS BACKEND — Alibaba Qwen team's open-source TTS
 * (github.com/QwenLM/Qwen3-TTS). Two ways to run it, both behind this adapter:
 *
 *   • CLOUD (default): Alibaba DashScope hosted API.
 *       POST {qwenBaseUrl}/api/v1/services/aigc/multimodal-generation/generation
 *       Authorization: Bearer <qwenApiKey>
 *       body: { model, input: { text, voice } }
 *       → JSON with output.audio.url (download) or output.audio.data (base64)
 *     Base URL: https://dashscope.aliyuncs.com (mainland) or
 *               https://dashscope-intl.aliyuncs.com (international).
 *
 *   • LOCAL: a self-hosted Qwen3-TTS server exposing an OpenAI-compatible
 *       POST {qwenLocalEndpoint}/v1/audio/speech  { model, input, voice }
 *       → audio bytes. Set qwenLocalEndpoint to switch to this path.
 *
 * This adapter is the ONLY place that knows the Qwen3-TTS shape.
 */

import fs from 'fs';

export const id = 'qwen3';
export const label = 'Qwen3-TTS (Alibaba)';

const DEFAULT_BASE = 'https://dashscope.aliyuncs.com';
const DEFAULT_MODEL = 'qwen3-tts-flash';
const DEFAULT_VOICE = 'Cherry';
const GEN_PATH = '/api/v1/services/aigc/multimodal-generation/generation';

function trimUrl(u) {
  return String(u || '').replace(/\/$/, '');
}

export async function testConnection(credentials = {}) {
  const local = trimUrl(credentials.qwenLocalEndpoint || process.env.QWEN_TTS_ENDPOINT || '');
  if (local) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      await fetch(local, { signal: controller.signal }).catch((e) => { if (e.name === 'AbortError') throw e; throw e; });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `Qwen3-TTS local server unreachable at ${local}: ${error.message}` };
    } finally {
      clearTimeout(timeout);
    }
  }
  const apiKey = credentials.qwenApiKey || process.env.DASHSCOPE_API_KEY || '';
  if (!apiKey) return { ok: false, error: 'Qwen3-TTS: set qwenApiKey (DashScope) or qwenLocalEndpoint.' };
  // Cheap reachability check on the DashScope host (a 401/404 still proves reachable).
  const base = trimUrl(credentials.qwenBaseUrl || process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(base, { signal: controller.signal });
    if (res.status >= 500) return { ok: false, error: `DashScope returned HTTP ${res.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `DashScope unreachable at ${base}: ${error.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesizeLocal(text, outPath, endpoint, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`${trimUrl(endpoint)}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.qwenApiKey ? { Authorization: `Bearer ${options.qwenApiKey}` } : {}),
      },
      body: JSON.stringify({
        model: options.qwenModel || DEFAULT_MODEL,
        input: text,
        voice: options.qwenVoice || DEFAULT_VOICE,
        response_format: 'wav',
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Qwen3-TTS local failed (HTTP ${res.status}): ${detail.slice(0, 200)}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error('Qwen3-TTS local returned empty audio.');
    fs.writeFileSync(outPath, buffer);
    return { path: outPath, bytes: buffer.length };
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesizeDashscope(text, outPath, options) {
  const apiKey = options.qwenApiKey || process.env.DASHSCOPE_API_KEY || '';
  if (!apiKey) throw new Error('Qwen3-TTS: DashScope apiKey (qwenApiKey) is required.');
  const base = trimUrl(options.qwenBaseUrl || process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(`${base}${GEN_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.qwenModel || DEFAULT_MODEL,
        input: { text, voice: options.qwenVoice || DEFAULT_VOICE },
      }),
      signal: controller.signal,
    });
    const bodyText = await res.text();
    let body;
    try { body = JSON.parse(bodyText); } catch { body = null; }
    if (!res.ok) {
      const msg = body?.message || body?.code || bodyText.slice(0, 200);
      throw new Error(`Qwen3-TTS DashScope failed (HTTP ${res.status}): ${msg}`);
    }
    const audio = body?.output?.audio || {};
    if (audio.url) {
      const audioRes = await fetch(audio.url);
      if (!audioRes.ok) throw new Error(`Failed to download Qwen3-TTS audio (HTTP ${audioRes.status}).`);
      const buffer = Buffer.from(await audioRes.arrayBuffer());
      fs.writeFileSync(outPath, buffer);
      return { path: outPath, bytes: buffer.length };
    }
    if (audio.data) {
      const buffer = Buffer.from(audio.data, 'base64');
      fs.writeFileSync(outPath, buffer);
      return { path: outPath, bytes: buffer.length };
    }
    throw new Error('Qwen3-TTS DashScope response contained no audio (output.audio.url/data missing).');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {string} text
 * @param {string} outPath
 * @param {object} options { qwenLocalEndpoint?, qwenApiKey?, qwenBaseUrl?,
 *                           qwenModel?, qwenVoice? }
 */
export async function synthesizeToFile(text, outPath, options = {}) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Qwen3-TTS: cannot synthesize empty text.');
  const local = options.qwenLocalEndpoint || process.env.QWEN_TTS_ENDPOINT || '';
  if (local) return synthesizeLocal(clean, outPath, local, options);
  return synthesizeDashscope(clean, outPath, options);
}
