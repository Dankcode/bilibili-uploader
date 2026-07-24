/**
 * AI-PROVIDER TRANSLATION BACKEND (default).
 * Uses the existing Kimi/OpenAI provider layer in lib/ai/getEnglish.js.
 * Good, automated, no extra services to run.
 */

import { translateSegments as aiTranslateSegments } from '../../ai/getEnglish';

export const id = 'aiProvider';
export const label = 'AI Provider (Kimi / OpenAI)';

export async function translate(segments, options = {}) {
  const translated = await aiTranslateSegments(segments, {
    sourceLang: options.sourceLang,
    targetLang: options.targetLang || 'English',
    style: options.style,
    credentials: options.credentials,
  });
  const byIndex = new Map(translated.map((t) => [t.index, t.textEn]));
  const result = segments.map((seg) => ({ ...seg, textEn: byIndex.get(seg.index) || '' }));
  result.provider = translated.provider;
  result.model = translated.model;
  return result;
}
