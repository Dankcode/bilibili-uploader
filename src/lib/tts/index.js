/**
 * TTS BACKEND REGISTRY — the voiceover processor calls THIS, never a specific
 * engine. Pick the backend per "voiceover" connection via `ttsBackend`.
 *
 *   elevenlabs  → cloud, best quality, multilingual (needs API key)
 *   cosyvoice   → Alibaba CosyVoice, self-hosted local voice clone (no per-use cost)
 *
 * Every backend exports: synthesizeToFile(text, outPath, options) and
 * testConnection(credentials). Adding an engine = one file + one line here.
 */

import * as elevenlabs from './elevenlabs';
import * as cosyvoice from './cosyvoice';
import * as qwen3 from './qwen3';

const BACKENDS = {
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs (cloud)',
    ext: 'mp3',
    synthesize: (text, out, o) =>
      elevenlabs.synthesizeToFile(text, out, {
        apiKey: o.elevenApiKey,
        voiceId: o.voiceId,
        modelId: o.modelId,
      }),
    test: (creds) => elevenlabs.testConnection({ apiKey: creds.elevenApiKey, voiceId: creds.voiceId }),
  },
  cosyvoice: {
    id: 'cosyvoice',
    label: cosyvoice.label,
    ext: 'wav',
    synthesize: (text, out, o) =>
      cosyvoice.synthesizeToFile(text, out, {
        cosyEndpoint: o.cosyEndpoint,
        cosyMode: o.cosyMode,
        cosySpeakerId: o.cosySpeakerId,
        cosyPromptWav: o.cosyPromptWav,
        cosyPromptText: o.cosyPromptText,
        cosyInstruct: o.cosyInstruct,
      }),
    test: (creds) => cosyvoice.testConnection(creds),
  },
  qwen3: {
    id: 'qwen3',
    label: qwen3.label,
    ext: 'wav',
    synthesize: (text, out, o) =>
      qwen3.synthesizeToFile(text, out, {
        qwenLocalEndpoint: o.qwenLocalEndpoint,
        qwenApiKey: o.qwenApiKey,
        qwenBaseUrl: o.qwenBaseUrl,
        qwenModel: o.qwenModel,
        qwenVoice: o.qwenVoice,
      }),
    test: (creds) => qwen3.testConnection(creds),
  },
};

export function getTtsBackend(id) {
  return BACKENDS[String(id || 'elevenlabs').toLowerCase()] || BACKENDS.elevenlabs;
}

export function listTtsBackends() {
  return Object.values(BACKENDS).map((b) => ({ id: b.id, label: b.label }));
}
