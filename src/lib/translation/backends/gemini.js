import { GoogleGenerativeAI } from '@google/generative-ai';
import { parseAiJson } from '../../ai/getEnglish';

export const id = 'gemini';
export const label = 'Gemini';

function settings(options = {}) {
  const credentials = options.credentials || {};
  const apiKey = credentials.geminiApiKey || process.env.GEMINI_API_KEY || '';
  if (!apiKey) throw new Error('Gemini API key is not configured.');
  return { apiKey, model: credentials.geminiModel || process.env.GEMINI_MODEL || 'gemini-1.5-flash' };
}

async function complete(items, prompt, options) {
  const { apiKey, model } = settings(options);
  const client = new GoogleGenerativeAI(apiKey);
  const response = await client.getGenerativeModel({ model }).generateContent(`${prompt}\n\nReturn only JSON: {"segments":[{"index":1,"textEn":"..."}]}\n\nSegments:\n${JSON.stringify(items)}`);
  const parsed = parseAiJson(response.response.text());
  const output = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const byIndex = new Map(output.map((item) => [Number(item.index), String(item.textEn || '').trim()]));
  if (items.some((item) => !byIndex.get(Number(item.index)))) throw new Error('Gemini returned an incomplete segment set.');
  return items.map((item) => ({ index: Number(item.index), textEn: byIndex.get(Number(item.index)) }));
}

export async function translate(segments, options = {}) {
  const output = [];
  for (let offset = 0; offset < segments.length; offset += 50) {
    const chunk = segments.slice(offset, offset + 50).map((segment) => ({ index: segment.index, text: segment.text }));
    const translated = await complete(
      chunk,
      `Translate each segment from ${options.sourceLang || 'the source language'} to ${options.targetLang || 'English'}. Keep lines concise and natural. Never merge, split, add, or remove segments.`,
      options,
    );
    output.push(...translated);
  }
  let final = output;
  if (options.refine) {
    final = [];
    for (let offset = 0; offset < output.length; offset += 50) {
      const chunk = output.slice(offset, offset + 50).map((segment) => ({ index: segment.index, text: segment.textEn }));
      final.push(...await complete(chunk, 'Polish each translation for natural spoken delivery while preserving meaning and one-to-one segment identity.', options));
    }
  }
  const byIndex = new Map(final.map((item) => [item.index, item.textEn]));
  return segments.map((segment) => ({ ...segment, textEn: byIndex.get(Number(segment.index)) || '' }));
}

export async function test(credentials = {}) {
  try {
    const { apiKey, model } = settings({ credentials });
    const response = await new GoogleGenerativeAI(apiKey).getGenerativeModel({ model }).generateContent('Reply with OK.');
    return response.response.text() ? { ok: true } : { ok: false, error: 'Gemini returned an empty response.' };
  } catch (error) {
    return { ok: false, error: `Gemini test failed: ${error.message}` };
  }
}
