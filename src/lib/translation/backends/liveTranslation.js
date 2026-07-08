/**
 * LIVE-TRANSLATION BACKEND — integration seam for YOUR
 * `~/Documents/GitHub/live-translation` project.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  HOW TO WIRE IN THE REAL CODE (once the folder is mounted):
 *  1. Copy (or symlink) the live-translation source under
 *     `vendor/live-translation/` in this repo, OR set LIVE_TRANSLATION_PATH
 *     in .env to its absolute path.
 *  2. Make sure it exports (or expose a thin index that exports) a function
 *     matching ONE of the accepted shapes below. This adapter probes for them
 *     in order, so you usually don't have to change live-translation at all:
 *
 *        // Preferred — batch, timing aware:
 *        translateSegments(segments, { sourceLang, targetLang }) -> [{ index, textEn, translit? }]
 *
 *        // Or per-line:
 *        translate(text, { sourceLang, targetLang }) -> string        (English)
 *        transliterate(text) -> string                                (romanization)
 *
 *  3. On the "voiceover" connection in Settings, set
 *     translationBackend = "liveTranslation".
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Until the module is present this backend throws a CLEAR, actionable error
 * (never silently falls back), so a misconfiguration is obvious in the job log.
 */

export const id = 'liveTranslation';
export const label = 'live-translation project';

let cachedModule = null;

async function loadLiveModule() {
  if (cachedModule) return cachedModule;
  const { pathToFileURL } = await import('url');
  const path = await import('path');
  const fs = await import('fs');
  const explicitPath = process.env.LIVE_TRANSLATION_PATH
    ? path.resolve(process.env.LIVE_TRANSLATION_PATH)
    : '';
  const candidates = [
    explicitPath,
    path.join(process.cwd(), 'vendor', 'live-translation', 'index.js'),
    path.join(process.cwd(), 'vendor', 'live-translation'),
  ].filter(Boolean);

  const errors = [];
  for (const candidate of candidates) {
    try {
      const target = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()
        ? path.join(candidate, 'index.js')
        : candidate;
      if (!fs.existsSync(target)) throw new Error('path does not exist');
      const href = pathToFileURL(target).href;
      // eslint-disable-next-line no-await-in-loop
      const mod = await import(/* webpackIgnore: true */ href);
      cachedModule = mod?.default && Object.keys(mod).length === 1 ? mod.default : mod;
      return cachedModule;
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(
    'live-translation module not found. Vendor it under vendor/live-translation/ ' +
      'or set LIVE_TRANSLATION_PATH. Tried:\n  ' + errors.join('\n  ')
  );
}

export async function translate(segments, options = {}) {
  const mod = await loadLiveModule();

  // Shape 1: batch, timing-aware.
  if (typeof mod.translateSegments === 'function') {
    const out = await mod.translateSegments(segments, options);
    const byIndex = new Map((out || []).map((t) => [Number(t.index), t]));
    return segments.map((seg) => {
      const hit = byIndex.get(seg.index) || {};
      return { ...seg, textEn: hit.textEn || hit.text || '', translit: hit.translit ?? seg.translit };
    });
  }

  // Shape 2: per-line translate() (+ optional transliterate()).
  if (typeof mod.translate === 'function') {
    const results = [];
    for (const seg of segments) {
      // eslint-disable-next-line no-await-in-loop
      const textEn = await mod.translate(seg.text, options);
      const translit =
        typeof mod.transliterate === 'function'
          ? // eslint-disable-next-line no-await-in-loop
            await mod.transliterate(seg.text)
          : seg.translit;
      results.push({ ...seg, textEn: String(textEn || '').trim(), translit });
    }
    return results;
  }

  throw new Error(
    'live-translation module loaded but exposes neither translateSegments() nor translate(). ' +
      'See the contract at the top of backends/liveTranslation.js.'
  );
}
