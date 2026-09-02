const TERM_PATTERN = /[A-Za-z][A-Za-z0-9+./_-]{2,}|[\p{Script=Han}]{2,12}/gu;

export function extractGlossary(spans = [], { minOccurrences = 2, maxTerms = 120 } = {}) {
  const terms = new Map();
  for (const span of spans) {
    const unique = new Set(String(span.text || '').match(TERM_PATTERN) || []);
    for (const term of unique) {
      const key = term.toLocaleLowerCase();
      const current = terms.get(key) || { term, count: 0, firstSeen: Number(span.start) || 0 };
      current.count += 1;
      current.firstSeen = Math.min(current.firstSeen, Number(span.start) || 0);
      if (term.length > current.term.length || /[A-Z]/.test(term)) current.term = term;
      terms.set(key, current);
    }
  }
  return [...terms.values()]
    .filter((item) => item.count >= Math.max(1, Number(minOccurrences) || 2))
    .sort((left, right) => right.count - left.count || left.firstSeen - right.firstSeen)
    .slice(0, Math.max(1, Number(maxTerms) || 120));
}
