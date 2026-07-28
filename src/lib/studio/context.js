import { markdownTimeToSeconds, secondsToMarkdownTime } from './markdown.js';

const MAX_LIST_ITEMS = 32;

function cleanLine(value, maxLength = 600) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanList(value, limit = MAX_LIST_ITEMS) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const text = cleanLine(item, 240);
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeFrameId(value, index) {
  const candidate = cleanLine(value, 100).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return candidate || `frame-${String(index + 1).padStart(4, '0')}`;
}

function safeFrameFile(value) {
  return cleanLine(value, 180).split(/[\\/]/).at(-1) || '';
}

function cleanSha256(value) {
  const hash = String(value || '').trim().toLocaleLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
}

function segmentIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((item) => Number.isInteger(item) && item > 0))].slice(0, 100);
}

export function normalizeFrameContext(value = {}, index = 0) {
  const captureTime = Math.max(0, finiteNumber(value.captureTime, finiteNumber(value.timeMs) / 1000));
  const windowStart = Math.max(0, finiteNumber(value.windowStart, finiteNumber(value.windowStartMs) / 1000));
  const windowEndCandidate = finiteNumber(value.windowEnd, finiteNumber(value.windowEndMs) / 1000);
  const windowEnd = Math.max(windowStart + 0.05, windowEndCandidate || captureTime + 0.05);
  return {
    id: safeFrameId(value.id || value.frameId, index),
    file: safeFrameFile(value.file),
    sha256: cleanSha256(value.sha256),
    segmentIds: segmentIds(value.segmentIds),
    captureTime,
    windowStart,
    windowEnd,
    topic: cleanLine(value.topic),
    summary: cleanLine(value.summary, 1_000),
    visibleText: cleanList(value.visibleText),
    technicalTerms: cleanList(value.technicalTerms),
    entities: cleanList(value.entities),
    transcriptionHints: cleanList(value.transcriptionHints),
  };
}

function jsonList(value) {
  return JSON.stringify(cleanList(value));
}

function parseJsonList(value, field, frameId) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (!Array.isArray(parsed)) throw new Error();
    return cleanList(parsed);
  } catch {
    throw new Error(`Screenshot context ${frameId} has an invalid ${field} list.`);
  }
}

function parseSegmentIds(value, frameId) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (!Array.isArray(parsed)) throw new Error();
    return segmentIds(parsed);
  } catch {
    throw new Error(`Screenshot context ${frameId} has an invalid segment_ids list.`);
  }
}

function fieldValue(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return block.match(new RegExp(`^- ${escaped}:\\s*(.*)$`, 'm'))?.[1]?.trim() || '';
}

export function buildContextMarkdown({
  name = 'Untitled video',
  generated = new Date().toISOString(),
  provider = 'Kimi Vision',
  model = '',
  schema = 'video-context.v1',
  promptVersion = 'kimi-context.v1',
  revision = generated,
  transcriptSha256 = '',
  intervalSeconds = 15,
  duration = 0,
  frames = [],
} = {}) {
  const normalized = frames
    .map(normalizeFrameContext)
    .sort((left, right) => left.captureTime - right.captureTime);
  const resolvedDuration = Math.max(
    finiteNumber(duration),
    normalized.at(-1)?.windowEnd || 0,
  );
  const lines = [
    `# Screenshot Context - ${cleanLine(name, 180) || 'Untitled video'}`,
    `- schema: ${cleanLine(schema, 80) || 'video-context.v1'}`,
    `- generated: ${cleanLine(generated, 100)}`,
    `- revision: ${cleanLine(revision, 100)}`,
    `- provider: ${cleanLine(provider, 120)}`,
    `- model: ${cleanLine(model, 160)}`,
    `- prompt_version: ${cleanLine(promptVersion, 100)}`,
    `- transcript_sha256: ${cleanSha256(transcriptSha256)}`,
    `- interval_seconds: ${Math.max(1, finiteNumber(intervalSeconds, 15))}`,
    `- duration: ${secondsToMarkdownTime(resolvedDuration)}`,
    `- frame_count: ${normalized.length}`,
    '',
    '## Timeline',
  ];

  for (const frame of normalized) {
    lines.push(
      '',
      `### [${secondsToMarkdownTime(frame.windowStart)} --> ${secondsToMarkdownTime(frame.windowEnd)}] ${frame.id}`,
      `- captured: ${secondsToMarkdownTime(frame.captureTime)}`,
      `- file: ${frame.file}`,
      `- sha256: ${frame.sha256}`,
      `- segment_ids: ${JSON.stringify(frame.segmentIds)}`,
      `- topic: ${frame.topic}`,
      `- summary: ${frame.summary}`,
      `- visible_text: ${jsonList(frame.visibleText)}`,
      `- technical_terms: ${jsonList(frame.technicalTerms)}`,
      `- entities: ${jsonList(frame.entities)}`,
      `- transcription_hints: ${jsonList(frame.transcriptionHints)}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function parseContextMarkdown(value) {
  const source = String(value || '').replace(/\r/g, '');
  const name = source.match(/^# Screenshot Context\s*[-—]\s*(.+)$/m)?.[1]?.trim() || 'Untitled video';
  const schema = fieldValue(source, 'schema') || 'video-context.v1';
  const generated = fieldValue(source, 'generated');
  const revision = fieldValue(source, 'revision') || generated;
  const provider = fieldValue(source, 'provider');
  const model = fieldValue(source, 'model');
  const promptVersion = fieldValue(source, 'prompt_version');
  const transcriptSha256 = cleanSha256(fieldValue(source, 'transcript_sha256'));
  const intervalSeconds = Math.max(1, finiteNumber(fieldValue(source, 'interval_seconds'), 15));
  const durationValue = fieldValue(source, 'duration');
  const headingPattern = /^### \[(\d{1,3}:\d{2}:\d{2}[.,]\d{3}) --> (\d{1,3}:\d{2}:\d{2}[.,]\d{3})\]\s+([^\n]+)$/gm;
  const headings = [...source.matchAll(headingPattern)];
  const frames = headings.map((heading, index) => {
    const blockStart = heading.index + heading[0].length;
    const blockEnd = headings[index + 1]?.index ?? source.length;
    const block = source.slice(blockStart, blockEnd);
    const id = safeFrameId(heading[3], index);
    const windowStart = markdownTimeToSeconds(heading[1]);
    const windowEnd = markdownTimeToSeconds(heading[2]);
    if (windowEnd <= windowStart) throw new Error(`Screenshot context ${id} has an invalid time window.`);
    const capturedValue = fieldValue(block, 'captured');
    const captureTime = capturedValue
      ? markdownTimeToSeconds(capturedValue)
      : windowStart + ((windowEnd - windowStart) / 2);
    return normalizeFrameContext({
      id,
      file: fieldValue(block, 'file'),
      sha256: fieldValue(block, 'sha256'),
      segmentIds: parseSegmentIds(fieldValue(block, 'segment_ids'), id),
      captureTime,
      windowStart,
      windowEnd,
      topic: fieldValue(block, 'topic'),
      summary: fieldValue(block, 'summary'),
      visibleText: parseJsonList(fieldValue(block, 'visible_text'), 'visible_text', id),
      technicalTerms: parseJsonList(fieldValue(block, 'technical_terms'), 'technical_terms', id),
      entities: parseJsonList(fieldValue(block, 'entities'), 'entities', id),
      transcriptionHints: parseJsonList(fieldValue(block, 'transcription_hints'), 'transcription_hints', id),
    }, index);
  });

  if (source.includes('## Timeline') && !frames.length) {
    throw new Error('Screenshot context contains a Timeline section but no valid timestamped frames.');
  }

  const declaredCount = Number(fieldValue(source, 'frame_count'));
  if (Number.isFinite(declaredCount) && declaredCount !== frames.length) {
    throw new Error(`Screenshot context declares ${declaredCount} frames but contains ${frames.length}.`);
  }

  return {
    name,
    schema,
    generated,
    revision,
    provider,
    model,
    promptVersion,
    transcriptSha256,
    intervalSeconds,
    duration: durationValue ? markdownTimeToSeconds(durationValue) : (frames.at(-1)?.windowEnd || 0),
    frames,
  };
}

function segmentMidpoint(segment) {
  const start = Math.max(0, finiteNumber(segment?.start));
  const end = Math.max(start, finiteNumber(segment?.end, start));
  return start + ((end - start) / 2);
}

export function matchContextsToSegment(contexts, segment, { maxItems = Number.POSITIVE_INFINITY } = {}) {
  const start = Math.max(0, finiteNumber(segment?.start));
  const end = Math.max(start + 0.001, finiteNumber(segment?.end, start + 0.001));
  const midpoint = segmentMidpoint(segment);
  const matches = (Array.isArray(contexts) ? contexts : [])
    .map(normalizeFrameContext)
    .filter((context) => context.windowStart < end && context.windowEnd > start)
    .sort((left, right) => Math.abs(left.captureTime - midpoint) - Math.abs(right.captureTime - midpoint));
  const numericLimit = Number(maxItems);
  return Number.isFinite(numericLimit)
    ? matches.slice(0, Math.max(1, numericLimit))
    : matches;
}

function pushUnique(target, values, limit) {
  const keys = new Set(target.map((item) => item.toLocaleLowerCase()));
  for (const value of values) {
    const clean = cleanLine(value, 180);
    const key = clean.toLocaleLowerCase();
    if (!clean || keys.has(key)) continue;
    keys.add(key);
    target.push(clean);
    if (target.length >= limit) break;
  }
}

export function contextPromptForSegment(contexts, segment, { maxCharacters = 900 } = {}) {
  const matches = matchContextsToSegment(contexts, segment);
  if (!matches.length) return '';
  const technicalTerms = [];
  const visibleText = [];
  const entities = [];
  const hints = [];
  const topics = [];
  for (const context of matches) {
    pushUnique(technicalTerms, context.technicalTerms, 24);
    pushUnique(visibleText, context.visibleText, 24);
    pushUnique(entities, context.entities, 18);
    pushUnique(hints, context.transcriptionHints, 18);
    pushUnique(topics, [context.topic, context.summary], 6);
  }
  const lines = [
    technicalTerms.length ? `Exact technical vocabulary: ${technicalTerms.join(', ')}` : '',
    visibleText.length ? `Visible slide or screen text: ${visibleText.join(', ')}` : '',
    entities.length ? `Names and entities: ${entities.join(', ')}` : '',
    hints.length ? `Recognition hints: ${hints.join(', ')}` : '',
    topics.length ? `Scene topic: ${topics.join(' | ')}` : '',
  ].filter(Boolean);
  return cleanLine(lines.join('; '), Math.max(120, Number(maxCharacters) || 900));
}

export function buildSubtitleContextHints(segments, contexts, { maxCharacters = 48_000 } = {}) {
  const lines = [];
  let length = 0;
  for (const segment of Array.isArray(segments) ? segments : []) {
    const context = contextPromptForSegment(contexts, segment, { maxCharacters: 700 });
    if (!context) continue;
    const line = `Cue #${segment.index} [${secondsToMarkdownTime(segment.start)}]: ${context}`;
    if (length + line.length > maxCharacters) break;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join('\n');
}
