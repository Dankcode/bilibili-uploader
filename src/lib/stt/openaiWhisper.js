import fs from 'fs';
import OpenAI from 'openai';

export const id = 'openaiWhisper';
export const label = 'OpenAI-compatible Whisper';

function clientFor(options = {}) {
  if (!options.apiKey) throw new Error('Transcription API key is required.');
  return new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    timeout: Number(options.timeoutMs) || 10 * 60 * 1000,
  });
}

function normalizeSegments(raw = []) {
  return raw.map((segment, index) => ({
    index: Number(segment.id ?? segment.index ?? index + 1),
    start: Number(segment.start) || 0,
    end: Number(segment.end) || 0,
    text: String(segment.text || '').trim(),
  })).filter((segment) => segment.text && segment.end > segment.start);
}

export async function transcribe(audioPath, options = {}) {
  if (!audioPath || !fs.existsSync(audioPath)) throw new Error(`Transcription input not found: ${audioPath}`);
  const response = await clientFor(options).audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: options.model || 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
    ...(options.language && !['auto', 'detect'].includes(options.language) ? { language: options.language } : {}),
  });
  const segments = normalizeSegments(response.segments || []);
  if (!segments.length) throw new Error('Transcription returned no usable segments.');
  return {
    language: response.language || options.language || 'unknown',
    fullText: String(response.text || segments.map((segment) => segment.text).join(' ')).trim(),
    segments,
  };
}

export async function test(credentials = {}) {
  const apiKey = credentials.transcribeApiKey || process.env.OPENAI_API_KEY || '';
  if (!apiKey) return { ok: false, error: 'Transcription API key is not configured.' };
  try {
    const client = clientFor({
      apiKey,
      baseURL: credentials.transcribeBaseUrl || process.env.WHISPER_BASE_URL,
      timeoutMs: 10_000,
    });
    await client.models.retrieve(credentials.transcribeModel || 'whisper-1');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Whisper API test failed: ${error.message}` };
  }
}
