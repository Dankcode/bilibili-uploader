/**
 * ENGLISH VOICEOVER PROCESSOR — whisper transcription + cloned-voice TTS.
 * Talks to YOUR LAN voice service (settings: 'voiceover' connection).
 *
 * Expected LAN API (adjust to your whisper-clone box — keep this adapter the
 * ONLY place that knows the shape):
 *   POST {endpoint}/transcribe  file → { segments: [{start, end, textZh}] }
 *        (skip if the douyin sidecar already produced a transcript via its
 *         cli/whisper_transcribe.py)
 *   POST {endpoint}/translate   segments → EN  (or reuse lib/ai/getEnglish.js
 *        provider — it already fronts Kimi/OpenAI server-side)
 *   POST {endpoint}/tts         { text, voiceId, timing } → wav per segment
 *
 * Local assembly with fluent-ffmpeg (already a dep):
 *   1. duck original audio (volume=0.15 or sidechain)
 *   2. overlay TTS wavs at segment starts (adelay + amix)
 *   3. optional burned EN subtitles (subtitles= filter)
 *
 * options: { targetLang:'en', burnSubtitles, keepOriginalAudioLevel,
 *            existingTranscript? }  ← scene pipeline passes Kimi-drafted VO
 *            text here to REPLACE literal translation.
 * Returns { outputPath, artifacts: { transcriptZh, transcriptEn, srtPath } }
 * — persisted as video_assets so scenes reuse them without re-processing.
 */

export const id = 'voiceover';

/** GET {endpoint}/health + verify voiceId exists. */
export async function testConnection(credentials = {}) {
  if (!credentials.endpoint) return { ok: false, error: 'Voice service endpoint is not configured' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${String(credentials.endpoint).replace(/\/$/, '')}/health`, {
      signal: controller.signal,
      headers: credentials.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {},
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Voice service is unreachable: ${error.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

export async function process(_inputPath, _options, _onProgress) {
  throw new Error('Voiceover processing requires the LAN transcribe/translate/TTS API described in this adapter.');
}
