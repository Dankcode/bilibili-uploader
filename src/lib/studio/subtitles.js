function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

export function parseSubtitleTimestamp(value) {
  const match = String(value || '').trim().match(/(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/);
  if (!match) throw new Error(`Invalid subtitle timestamp: ${value}`);
  return (Number(match[1] || 0) * 3600)
    + (Number(match[2]) * 60)
    + Number(match[3])
    + (Number(match[4].padEnd(3, '0').slice(0, 3)) / 1000);
}

export function secondsToSrt(value) {
  const totalMs = Math.max(0, Math.round((Number(value) || 0) * 1000));
  return `${pad(Math.floor(totalMs / 3_600_000))}:${pad(Math.floor((totalMs % 3_600_000) / 60_000))}:${pad(Math.floor((totalMs % 60_000) / 1000))},${pad(totalMs % 1000, 3)}`;
}

export function secondsToAss(value) {
  const totalCs = Math.max(0, Math.round((Number(value) || 0) * 100));
  return `${Math.floor(totalCs / 360_000)}:${pad(Math.floor((totalCs % 360_000) / 6000))}:${pad(Math.floor((totalCs % 6000) / 100))}.${pad(totalCs % 100)}`;
}

function cleanText(value) {
  return String(value || '')
    .replace(/\{\\[^}]+}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\N/g, '\n')
    .trim();
}

function normalizeSegment(segment, index) {
  const start = Number(segment.start) || 0;
  return {
    index: Number(segment.index ?? index + 1),
    start,
    end: Math.max(Number(segment.end) || 0, start + 0.08),
    text: cleanText(segment.text ?? segment.original),
    textEn: cleanText(segment.textEn ?? segment.translation),
    translit: cleanText(segment.translit),
  };
}

export function buildSrt(segments = [], { dual = true, showTranslit = false } = {}) {
  return segments.map(normalizeSegment).map((segment, index) => {
    const lines = [];
    if (segment.text) lines.push(segment.text);
    if (dual && segment.textEn) lines.push(segment.textEn);
    if (showTranslit && segment.translit) lines.push(segment.translit);
    return `${index + 1}\n${secondsToSrt(segment.start)} --> ${secondsToSrt(segment.end)}\n${lines.join('\n')}`;
  }).join('\n\n').concat(segments.length ? '\n' : '');
}

export function buildVtt(segments = [], options = {}) {
  return `WEBVTT\n\n${buildSrt(segments, options).replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
}

function assText(value) {
  return String(value || '').replace(/[\r\n]+/g, '\\N').trim();
}

export function buildAss(segments = [], { title = 'Subtitle Studio export' } = {}) {
  const header = [
    '[Script Info]',
    `Title: ${String(title).replace(/[\r\n]+/g, ' ')}`,
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Original,Arial,42,&H00FFFFFF,&H000000FF,&H00111111,&H66000000,-1,0,0,0,100,100,0,0,1,2,0,2,40,40,92,1',
    'Style: Translation,Arial,34,&H006AD8F8,&H000000FF,&H00111111,&H66000000,-1,0,0,0,100,100,0,0,1,2,0,2,40,40,42,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = segments.map(normalizeSegment).flatMap((segment) => [
    `Dialogue: 0,${secondsToAss(segment.start)},${secondsToAss(segment.end)},Original,,0,0,0,,${assText(segment.text)}`,
    `Dialogue: 0,${secondsToAss(segment.start)},${secondsToAss(segment.end)},Translation,,0,0,0,,${assText(segment.textEn)}`,
  ]);
  return `${[...header, ...events].join('\n')}\n`;
}

export function parseSrt(text) {
  return String(text || '').replace(/^WEBVTT[^\n]*\n/i, '').replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((block, index) => {
      const lines = block.split('\n').filter((line) => line.trim() !== '');
      const timingIndex = lines.findIndex((line) => line.includes('-->'));
      if (timingIndex === -1) return null;
      const [startRaw, endRaw] = lines[timingIndex].split('-->').map((part) => part.trim());
      const body = lines.slice(timingIndex + 1).map(cleanText);
      return normalizeSegment({
        index: Number(lines[0]) || index + 1,
        start: parseSubtitleTimestamp(startRaw),
        end: parseSubtitleTimestamp(endRaw),
        text: body[0] || '',
        textEn: body.slice(1).join('\n'),
      }, index);
    })
    .filter(Boolean);
}

export function parseAss(text) {
  const groups = [];
  for (const line of String(text || '').replace(/\r/g, '').split('\n')) {
    if (!line.startsWith('Dialogue:')) continue;
    const parts = line.slice('Dialogue:'.length).split(',');
    if (parts.length < 10) continue;
    const start = parseSubtitleTimestamp(parts[1]);
    const end = parseSubtitleTimestamp(parts[2]);
    const style = String(parts[3] || '').trim().toLowerCase();
    const key = `${Math.round(start * 1000)}:${Math.round(end * 1000)}`;
    const body = cleanText(parts.slice(9).join(','));
    if (style === 'translation') {
      const current = groups.slice().reverse().find((group) => group.key === key && !group.textEn);
      if (current) current.textEn = body;
      else groups.push({ key, index: groups.length + 1, start, end, text: '', textEn: body });
    } else {
      groups.push({ key, index: groups.length + 1, start, end, text: body, textEn: '' });
    }
  }
  return groups.map(({ key: _key, ...segment }) => segment).map(normalizeSegment);
}

export function parseSubtitle(text, format) {
  const resolved = String(format || '').toLowerCase();
  if (resolved === 'ass' || resolved === 'ssa' || /^\s*\[Script Info\]/im.test(String(text))) return parseAss(text);
  return parseSrt(text);
}

export function timingSignature(segments = []) {
  return segments.map((segment) => `${Math.round(Number(segment.start) * 1000)}:${Math.round(Number(segment.end) * 1000)}`);
}

export function assertSameTiming(before, after) {
  const left = timingSignature(before);
  const right = timingSignature(after);
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw new Error('Subtitle timestamps or segment count changed during model processing.');
  }
  return true;
}
