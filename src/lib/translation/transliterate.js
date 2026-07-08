/**
 * TRANSLITERATION — romanize source-language text (e.g. Hanzi -> pinyin).
 *
 * This is the natural seam for YOUR `live-translation` project's
 * transliteration system: swap the body of `transliterate()` to call it,
 * or register it as a backend in ./backends/liveTranslation.js and route
 * through there. Transliteration is stored as a video asset artifact so it
 * can be shown under the English subtitle track (karaoke-style) or used for
 * QA of the translation.
 *
 * Zero hard dependency: if `pinyin-pro` is installed it is used; otherwise
 * transliteration degrades to null (non-fatal — the pipeline still produces
 * the English voiceover).
 */

let pinyinFn = null;
let attemptedLoad = false;

function loadPinyin() {
  if (attemptedLoad) return pinyinFn;
  attemptedLoad = true;
  try {
    // Optional dep. `npm i pinyin-pro` to enable, or replace with live-translation.
    // eval('require') keeps this OUT of the webpack/Next build graph so an
    // uninstalled optional package can't break the build — it's resolved at
    // runtime only, and any failure degrades gracefully to null below.
    // eslint-disable-next-line no-eval
    const runtimeRequire = eval('require');
    const mod = runtimeRequire('pinyin-pro');
    pinyinFn = mod?.pinyin || null;
  } catch {
    pinyinFn = null;
  }
  return pinyinFn;
}

/**
 * @param {string} text  source-language text
 * @param {object} opts  { script?: 'pinyin' }
 * @returns {string|null} romanized text, or null if unavailable
 */
export function transliterate(text, opts = {}) {
  const source = String(text || '').trim();
  if (!source) return null;
  const fn = loadPinyin();
  if (!fn) return null;
  try {
    return fn(source, { toneType: opts.toneType || 'symbol', type: 'string' });
  } catch {
    return null;
  }
}

export function transliterateSegments(segments = [], opts = {}) {
  return segments.map((seg) => ({ ...seg, translit: transliterate(seg.text, opts) }));
}

export function isAvailable() {
  return Boolean(loadPinyin());
}
