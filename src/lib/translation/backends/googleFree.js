export const id = 'googleFree';
export const label = 'Google Translate (free, no key)';

function languageCode(value, fallback) {
  const normalized = String(value || fallback).toLowerCase();
  const aliases = { english: 'en', chinese: 'zh-CN', mandarin: 'zh-CN', japanese: 'ja', korean: 'ko' };
  return aliases[normalized] || normalized.split(/[-_]/)[0] || fallback;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function translateLine(text, sourceLang, targetLang) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.search = new URLSearchParams({ client: 'gtx', sl: sourceLang, tl: targetLang, dt: 't', q: text }).toString();
      const response = await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const translated = Array.isArray(payload?.[0]) ? payload[0].map((item) => item?.[0] || '').join('').trim() : '';
      if (!translated) throw new Error('empty translation');
      return translated;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await wait(250);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Google Translate failed: ${lastError?.message || 'unknown error'}`);
}

export async function translate(segments, options = {}) {
  const sourceLang = languageCode(options.sourceLang, 'auto');
  const targetLang = languageCode(options.targetLang, 'en');
  const translated = [];
  for (const segment of segments) {
    if (translated.length) await wait(60);
    translated.push({ ...segment, textEn: await translateLine(segment.text, sourceLang, targetLang) });
  }
  return translated;
}
