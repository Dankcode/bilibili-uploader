/**
 * TRANSLATION ORCHESTRATOR — the one entry point the voiceover processor calls.
 *
 * Pipeline stage:  transcript segments (source lang)  ->  translated + romanized segments
 *
 * Backends are pluggable (registry below). Default is the AI provider; set
 * `backend: 'liveTranslation'` to route through your live-translation project.
 * Transliteration is added on top of whichever backend runs (a backend may
 * also supply its own `translit`, which wins).
 *
 *   translateTranscript({ segments, sourceLang, targetLang, backend, style, transliterate })
 *     -> { backend, segments: [{ index, start, end, text, textEn, translit }],
 *          transcriptEn, transcriptSource }
 */

import * as aiProvider from './backends/aiProvider';
import * as liveTranslation from './backends/liveTranslation';
import * as googleFree from './backends/googleFree';
import * as gemini from './backends/gemini';
import { transliterate as romanize } from './transliterate';

const BACKENDS = {
  [aiProvider.id]: aiProvider,
  [liveTranslation.id]: liveTranslation,
  [googleFree.id]: googleFree,
  [gemini.id]: gemini,
};

export function getBackend(id) {
  return BACKENDS[id] || aiProvider;
}

export function listBackends() {
  return Object.values(BACKENDS).map((b) => ({ id: b.id, label: b.label }));
}

export async function translateTranscript({
  segments,
  sourceLang,
  targetLang = 'English',
  backend = 'aiProvider',
  style,
  transliterate = true,
  credentials = {},
  refine = false,
} = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('translateTranscript requires a non-empty segments array.');
  }

  const chosen = getBackend(backend);
  const translated = await chosen.translate(segments, { sourceLang, targetLang, style, credentials, refine });

  const withTranslit = translated.map((seg) => {
    const translit = seg.translit ?? (transliterate ? romanize(seg.text) : null);
    return {
      index: seg.index,
      start: seg.start,
      end: seg.end,
      text: seg.text,
      textEn: String(seg.textEn || '').trim(),
      translit: translit || null,
    };
  });

  const missing = withTranslit.filter((s) => !s.textEn).length;
  if (missing === withTranslit.length) {
    throw new Error(`Translation backend "${chosen.id}" returned no English text.`);
  }

  return {
    backend: chosen.id,
    provider: translated.provider || chosen.id,
    model: translated.model || null,
    segments: withTranslit,
    transcriptSource: withTranslit.map((s) => s.text).join('\n'),
    transcriptEn: withTranslit.map((s) => s.textEn).filter(Boolean).join('\n'),
    partial: missing > 0,
  };
}
