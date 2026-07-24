import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildTranscriptMarkdown, parseTranscriptMarkdown } from '../src/lib/studio/markdown.js';
import { assertSameTiming, buildAss, buildSrt, parseAss, parseSrt } from '../src/lib/studio/subtitles.js';

const fixture = fs.readFileSync(new URL('./fixtures/transcript.md', import.meta.url), 'utf8');

test('transcript markdown round-trips timestamps and text', () => {
  const parsed = parseTranscriptMarkdown(fixture);
  const rebuilt = buildTranscriptMarkdown(parsed);
  const next = parseTranscriptMarkdown(rebuilt);
  assert.equal(next.segments.length, 2);
  assert.deepEqual(next.segments, parsed.segments);
});

test('ASS and SRT retain cue timing and dual text', () => {
  const source = parseTranscriptMarkdown(fixture).segments.map((segment) => ({
    ...segment,
    textEn: `English ${segment.index}`,
  }));
  const ass = parseAss(buildAss(source));
  const srt = parseSrt(buildSrt(source));
  assertSameTiming(source, ass);
  assertSameTiming(source, srt);
  assert.equal(ass[0].textEn, 'English 1');
  assert.equal(srt[1].textEn, 'English 2');
});

test('ASS keeps distinct cues that share the same time window', () => {
  const segments = [
    { index: 1, start: 1, end: 2, text: 'A', textEn: 'One' },
    { index: 2, start: 1, end: 2, text: 'B', textEn: 'Two' },
  ];
  const parsed = parseAss(buildAss(segments));
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed.map((item) => item.textEn), ['One', 'Two']);
});
