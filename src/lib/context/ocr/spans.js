function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function similarity(left, right) {
  const a = normalizeText(left).toLocaleLowerCase();
  const b = normalizeText(right).toLocaleLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j];
  }
  return 1 - (previous[b.length] / Math.max(a.length, b.length));
}

export function collapseReadingsToSpans(readings = [], { similarityThreshold = 0.85, intervalSeconds = 1 } = {}) {
  const ordered = readings
    .map((reading) => ({
      time: Math.max(0, Number(reading.time ?? reading.timeSeconds ?? Number(reading.timeMs) / 1000) || 0),
      text: normalizeText(reading.text),
      confidence: Math.max(0, Math.min(1, Number(reading.confidence) || 0)),
    }))
    .filter((reading) => reading.text)
    .sort((left, right) => left.time - right.time);
  const spans = [];
  for (const reading of ordered) {
    const current = spans.at(-1);
    if (current && similarity(current.text, reading.text) >= similarityThreshold
      && reading.time <= current.end + (Number(intervalSeconds) * 1.75)) {
      current.end = Math.max(current.end, reading.time + Number(intervalSeconds));
      if (reading.confidence > current.confidence) current.text = reading.text;
      current.confidence = Math.max(current.confidence, reading.confidence);
      current.readingCount += 1;
    } else {
      spans.push({
        id: `ocr-${String(spans.length + 1).padStart(4, '0')}`,
        start: reading.time,
        end: reading.time + Number(intervalSeconds),
        text: reading.text,
        confidence: reading.confidence,
        readingCount: 1,
      });
    }
  }
  return spans;
}

export { similarity as textSimilarity };
