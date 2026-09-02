import { textSimilarity } from './spans.js';

function overlapping(spans, segment) {
  return spans.filter((span) => Number(span.start) < Number(segment.end) && Number(span.end) > Number(segment.start));
}

function tokens(value) {
  return String(value || '').match(/[A-Za-z][A-Za-z0-9+./_-]{2,}/g) || [];
}

function correctedText(segment, evidence) {
  let text = String(segment.text || '');
  const visible = [...new Set(evidence.flatMap((span) => tokens(span.text)))];
  for (const sourceToken of tokens(text)) {
    const replacement = visible.find((term) => {
      if (term.toLocaleLowerCase() === sourceToken.toLocaleLowerCase()) return false;
      const delta = Math.abs(term.length - sourceToken.length);
      return delta <= 2 && textSimilarity(term, sourceToken) >= 0.72;
    });
    if (replacement) text = text.replace(new RegExp(`\\b${sourceToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), replacement);
  }
  return text;
}

export function proposeTranscriptRepairs(segments = [], spans = []) {
  const corrections = [];
  const correctedSegments = segments.map((segment) => {
    const evidence = overlapping(spans, segment);
    const nextText = evidence.length ? correctedText(segment, evidence) : String(segment.text || '');
    if (nextText !== String(segment.text || '')) {
      corrections.push({
        index: Number(segment.index),
        before: String(segment.text || ''),
        after: nextText,
        evidence: evidence.map((span) => span.text).slice(0, 8),
      });
    }
    return { ...segment, text: nextText };
  });
  assertTimingPreserved(segments, correctedSegments);
  return { corrections, correctedSegments };
}

export function assertTimingPreserved(original = [], corrected = []) {
  if (original.length !== corrected.length) throw new Error('OCR repair changed the segment count.');
  for (let index = 0; index < original.length; index += 1) {
    const before = original[index];
    const after = corrected[index];
    if (Number(before.index) !== Number(after.index)
      || Number(before.start) !== Number(after.start)
      || Number(before.end) !== Number(after.end)) {
      throw new Error(`OCR repair changed timing or identity for segment ${before.index}.`);
    }
  }
  return true;
}
