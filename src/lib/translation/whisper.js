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

// Backward-compatible API for callers outside the pipeline. New pipeline code
// selects an STT backend through src/lib/stt/index.js.
export { transcribe } from '../stt/openaiWhisper';
