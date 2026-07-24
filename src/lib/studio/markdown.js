const TIMESTAMP_PATTERN = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})/;

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

export function secondsToMarkdownTime(value) {
  const totalMs = Math.max(0, Math.round((Number(value) || 0) * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(milliseconds, 3)}`;
}

export function markdownTimeToSeconds(value) {
  const match = String(value || '').trim().match(TIMESTAMP_PATTERN);
  if (!match) throw new Error(`Invalid transcript timestamp: ${value}`);
  return (Number(match[1]) * 3600)
    + (Number(match[2]) * 60)
    + Number(match[3])
    + (Number(match[4]) / 1000);
}

function durationLabel(seconds) {
  return secondsToMarkdownTime(seconds).replace(/\.\d{3}$/, '');
}

export function buildTranscriptMarkdown({
  name = 'Untitled video',
  source = 'zh',
  target = 'en',
  duration,
  generated = new Date().toISOString(),
  engine = 'whisper-local',
  corrected = false,
  segments = [],
} = {}) {
  const safeSegments = segments.map((segment, index) => ({
    index: Number(segment.index ?? index + 1),
    start: Number(segment.start) || 0,
    end: Math.max(Number(segment.end) || 0, (Number(segment.start) || 0) + 0.08),
    text: String(segment.text ?? segment.original ?? '').trim(),
  }));
  const resolvedDuration = Number(duration) || safeSegments.at(-1)?.end || 0;
  const lines = [
    `# Transcript - ${String(name).replace(/[\r\n]+/g, ' ').trim()}`,
    `- source: ${source}   target: ${target}   duration: ${durationLabel(resolvedDuration)}`,
    `- generated: ${generated}   engine: ${engine}`,
  ];
  if (corrected) lines.push('- corrected: true');
  lines.push('', '## Segments');
  for (const segment of safeSegments) {
    lines.push(
      `### [${secondsToMarkdownTime(segment.start)} --> ${secondsToMarkdownTime(segment.end)}] #${segment.index}`,
      segment.text,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function parseTranscriptMarkdown(text) {
  const source = String(text || '').replace(/\r/g, '');
  const title = source.match(/^# Transcript\s*[-—]\s*(.+)$/m)?.[1]?.trim() || 'Untitled video';
  const languageLine = source.match(/^- source:\s*(\S+)\s+target:\s*(\S+)\s+duration:\s*(\S+)/m);
  const generatedLine = source.match(/^- generated:\s*(\S+)\s+engine:\s*(.+)$/m);
  const segmentPattern = /^### \[(\d{1,2}:\d{2}:\d{2}[.,]\d{3}) --> (\d{1,2}:\d{2}:\d{2}[.,]\d{3})\] #(\d+)\s*\n([\s\S]*?)(?=^### \[|\s*$)/gm;
  const segments = [];
  let match;
  while ((match = segmentPattern.exec(source)) !== null) {
    const start = markdownTimeToSeconds(match[1]);
    const end = markdownTimeToSeconds(match[2]);
    if (end <= start) throw new Error(`Transcript segment #${match[3]} has an invalid time window.`);
    segments.push({
      index: Number(match[3]),
      start,
      end,
      text: match[4].trim(),
    });
  }
  if (!segments.length && source.includes('## Segments')) {
    throw new Error('Transcript contains a Segments section but no valid timestamped segments.');
  }
  return {
    name: title,
    source: languageLine?.[1] || 'zh',
    target: languageLine?.[2] || 'en',
    duration: segments.at(-1)?.end || 0,
    generated: generatedLine?.[1] || '',
    engine: generatedLine?.[2]?.trim() || '',
    corrected: /^- corrected:\s*true\s*$/mi.test(source),
    segments,
  };
}

export function replaceTranscriptSegments(markdown, segments, { corrected } = {}) {
  const parsed = parseTranscriptMarkdown(markdown);
  return buildTranscriptMarkdown({
    ...parsed,
    corrected: corrected ?? parsed.corrected,
    segments,
  });
}
