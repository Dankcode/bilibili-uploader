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

function fromTimestamp(value) {
  const match = String(value || '').trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!match) throw new Error(`Invalid SRT timestamp: ${value}`);
  return (Number(match[1] || 0) * 3600) + (Number(match[2]) * 60) + Number(match[3]) + (Number(match[4].padEnd(3, '0')) / 1000);
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

export function parseSrt(text) {
  return String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((block, index) => {
    const lines = block.split('\n').filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) return null;
    const [start, end] = lines[timingIndex].split('-->').map((value) => value.trim());
    return {
      index: Number(lines[0]) || index + 1,
      start: fromTimestamp(start),
      end: fromTimestamp(end),
      text: lines.slice(timingIndex + 1).join('\n').trim(),
    };
  }).filter((segment) => segment?.text && segment.end > segment.start);
}

export function writeDualSrt(segments, outPath, { showTranslit = false } = {}) {
  const text = segments.map((segment, index) => {
    const lines = [segment.text, segment.textEn];
    if (showTranslit && segment.translit) lines.push(segment.translit);
    return `${index + 1}\n${toTimestamp(segment.start)} --> ${toTimestamp(segment.end)}\n${lines.filter(Boolean).join('\n')}\n`;
  }).join('\n');
  fs.writeFileSync(outPath, text, 'utf8');
  return outPath;
}
