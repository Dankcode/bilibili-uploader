/**
 * SPEECH-TO-TEXT — timestamped transcription of the source-language audio.
 *
 * The video-generation flow needs SEGMENTS with timings so the English
 * voiceover can be laid back over the original video at the right moments.
 * This module is the ONLY place that knows the transcription API shape.
 *
 * Default backend: OpenAI-compatible Whisper (`/v1/audio/transcriptions`,
 * `response_format: verbose_json`, segment granularity). Works with OpenAI,
 * Groq, or any self-hosted whisper.cpp server exposing the same route — just
 * point `baseURL` at it.
 *
 * transcribe(audioPath, { apiKey, baseURL?, model?, language? })
 *   -> { language, fullText, segments: [{ index, start, end, text }] }
 */

import fs from 'fs';
import OpenAI from 'openai';

const DEFAULT_MODEL = 'whisper-1';

function clientFor({ apiKey, baseURL }) {
  if (!apiKey) throw new Error('Transcription apiKey is required (set it on the voiceover connection).');
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

function normalizeSegments(raw = []) {
  return raw
    .map((seg, index) => ({
      index,
      start: Number(seg.start) || 0,
      end: Number(seg.end) || 0,
      text: String(seg.text || '').trim(),
    }))
    .filter((seg) => seg.text.length > 0 && seg.end > seg.start);
}

/**
 * @param {string} audioPath  local wav/mp3 extracted from the source video
 * @param {object} options    { apiKey, baseURL?, model?, language? }
 * @returns {Promise<{language:string, fullText:string, segments:Array}>}
 */
export async function transcribe(audioPath, options = {}) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`Transcription input not found: ${audioPath}`);
  }
  const client = clientFor(options);
  const model = options.model || DEFAULT_MODEL;

  const response = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model,
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
    // `language` is a hint (ISO-639-1, e.g. 'zh'); omit to auto-detect.
    ...(options.language ? { language: options.language } : {}),
  });

  const segments = normalizeSegments(response.segments || []);
  if (segments.length === 0) throw new Error('Transcription returned no usable segments.');

  return {
    language: response.language || options.language || 'unknown',
    fullText: String(response.text || segments.map((s) => s.text).join(' ')).trim(),
    segments,
  };
}
