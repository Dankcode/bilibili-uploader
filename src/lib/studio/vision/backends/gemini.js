import { promises as fs } from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const id = 'gemini';
export const label = 'Gemini Vision';

export function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function settings() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured for vision correction.');
  return {
    apiKey,
    model: process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    batchSize: Math.max(1, Math.min(12, Number(process.env.VISION_BATCH_SIZE) || 8)),
  };
}

function parseJson(value) {
  const text = String(value || '').trim();
  const unfenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() || text;
  const arrayStart = unfenced.indexOf('[');
  const objectStart = unfenced.indexOf('{');
  const start = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart) ? arrayStart : objectStart;
  const end = start === arrayStart ? unfenced.lastIndexOf(']') : unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Gemini Vision did not return JSON.');
  return JSON.parse(unfenced.slice(start, end + 1));
}

function correctionsFromResponse(value, batch) {
  const payload = parseJson(value);
  const items = Array.isArray(payload) ? payload : payload?.corrections;
  if (!Array.isArray(items)) throw new Error('Gemini Vision returned an invalid corrections list.');
  const source = new Map(batch.map((entry) => [Number(entry.segIndex), String(entry.text || '').trim()]));
  const corrections = new Map();
  for (const item of items) {
    const segIndex = Number(item?.segIndex);
    const text = String(item?.text || '').trim();
    if (!source.has(segIndex) || !text) throw new Error('Gemini Vision changed segment identity or returned empty text.');
    if (text !== source.get(segIndex)) corrections.set(segIndex, { segIndex, text });
  }
  return [...corrections.values()];
}

function promptFor(batch) {
  const transcriptLines = batch
    .map((entry) => `Segment ${entry.segIndex} at ${(entry.timeMs / 1000).toFixed(3)}s: ${entry.text}`)
    .join('\n');
  return `You verify speech-to-text using synchronized video screenshots.

Each image follows the matching segment line in the same order. Inspect visible slide headings, captions, company names, product/model names, acronyms, and technical terms. Correct a transcript line only when text visible in its image provides direct evidence. Do not make stylistic edits, infer missing speech, translate, merge lines, or change segment IDs.

Return strict JSON only in this shape:
{"corrections":[{"segIndex":1,"text":"complete corrected transcript line"}]}

Include changed lines only. Return {"corrections":[]} when the images do not justify a correction.

Transcript lines:
${transcriptLines}`;
}

async function imageParts(batch) {
  const parts = [{ text: promptFor(batch) }];
  for (const entry of batch) {
    const image = await fs.readFile(entry.imagePath);
    if (!image.length) throw new Error(`Gemini Vision frame is empty: ${entry.imagePath}`);
    parts.push(
      { text: `Image for segment ${entry.segIndex}:` },
      { inlineData: { mimeType: entry.mimeType || 'image/jpeg', data: image.toString('base64') } },
    );
  }
  return parts;
}

export async function dispatchGeminiBatches(batch, { model, batchSize = 8 }) {
  if (!model?.generateContent) throw new Error('A Gemini Vision model transport is required.');
  const size = Math.max(1, Math.min(12, Number(batchSize) || 8));
  const corrected = [];
  for (let offset = 0; offset < batch.length; offset += size) {
    const current = batch.slice(offset, offset + size);
    const result = await model.generateContent(await imageParts(current));
    corrected.push(...correctionsFromResponse(result.response.text(), current));
  }
  return corrected;
}

export async function correctSegments(batch) {
  const config = settings();
  const client = new GoogleGenerativeAI(config.apiKey);
  const model = client.getGenerativeModel({
    model: config.model,
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  });
  return dispatchGeminiBatches(batch, { model, batchSize: config.batchSize });
}
