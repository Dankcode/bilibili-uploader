/**
 * SRT subtitle builder. Produces a standard .srt from translated segments.
 * If `withTranslit` is set and a segment has a romanization, it is added as a
 * second line (English on top, romanization beneath) — handy for language
 * learners and for QA of the translation.
 */

import fs from 'fs';

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function toTimestamp(seconds) {
  const total = Math.max(0, seconds);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const s = Math.floor(total) % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function buildSrt(segments = [], { withTranslit = false, useEnglish = true } = {}) {
  return segments
    .map((seg, i) => {
      const main = useEnglish ? seg.textEn || seg.text : seg.text;
      const lines = [main];
      if (withTranslit && seg.translit) lines.push(seg.translit);
      return `${i + 1}\n${toTimestamp(seg.start)} --> ${toTimestamp(seg.end)}\n${lines.join('\n')}\n`;
    })
    .join('\n');
}

export function writeSrt(segments, outPath, options = {}) {
  fs.writeFileSync(outPath, buildSrt(segments, options), 'utf8');
  return outPath;
}
