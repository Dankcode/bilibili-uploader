import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildContextMarkdown,
  buildSubtitleContextHints,
  matchContextsToSegment,
  parseContextMarkdown,
} from '../src/lib/studio/context.js';
import { buildTimedFramePlan } from '../src/lib/studio/frames.js';
import {
  buildWhisperContextPromptIds,
  evaluateContextCandidate,
} from '../src/lib/studio/localWhisper.js';
import { dispatchKimiContextBatches } from '../src/lib/studio/vision/backends/kimiVision.js';

const TRANSCRIPT_HASH = 'a'.repeat(64);
const FRAME_ONE_HASH = 'b'.repeat(64);
const FRAME_TWO_HASH = 'c'.repeat(64);

test('timed frame plan covers the full duration and enforces its screenshot limit', () => {
  const plan = buildTimedFramePlan(25, { intervalSeconds: 10, maxFrames: 3 });

  assert.deepEqual(plan.map((frame) => frame.frameId), [
    'frame-0001',
    'frame-0002',
    'frame-0003',
  ]);
  assert.deepEqual(plan.map((frame) => [
    frame.windowStartMs,
    frame.timeMs,
    frame.windowEndMs,
  ]), [
    [0, 5_000, 10_000],
    [10_000, 15_000, 20_000],
    [20_000, 22_500, 25_000],
  ]);
  assert.equal(plan[0].windowStartMs, 0);
  assert.equal(plan.at(-1).windowEndMs, 25_000);
  for (let index = 1; index < plan.length; index += 1) {
    assert.equal(plan[index - 1].windowEndMs, plan[index].windowStartMs);
  }

  assert.throws(
    () => buildTimedFramePlan(25, { intervalSeconds: 10, maxFrames: 2 }),
    (error) => error.code === 'CONTEXT_FRAME_LIMIT'
      && /needs 3 screenshots/.test(error.message),
  );
});

test('context Markdown round-trips frame hashes, time windows, and segment IDs', () => {
  const markdown = buildContextMarkdown({
    name: 'EGFR seminar.mp4',
    generated: '2026-07-27T12:00:00.000Z',
    revision: 'context-revision-7',
    provider: 'Kimi Vision',
    model: 'kimi-k2.6',
    promptVersion: 'kimi-context.test',
    transcriptSha256: TRANSCRIPT_HASH,
    intervalSeconds: 10,
    duration: 20,
    frames: [
      {
        id: 'frame-0002',
        file: 'frame-0002_000015000.jpg',
        sha256: FRAME_TWO_HASH,
        segmentIds: [3, 2, 3],
        captureTime: 15,
        windowStart: 10,
        windowEnd: 20,
        topic: 'MAPK signaling',
        summary: 'A pathway slide identifies downstream signaling proteins.',
        visibleText: ['RAS–RAF–MEK–ERK'],
        technicalTerms: ['p-ERK1/2'],
        entities: ['ERK1', 'ERK2'],
        transcriptionHints: ['phosphorylated ERK one and two'],
      },
      {
        id: 'frame-0001',
        file: 'frame-0001_000005000.jpg',
        sha256: FRAME_ONE_HASH,
        segmentIds: [1, 2],
        captureTime: 5,
        windowStart: 0,
        windowEnd: 10,
        topic: 'EGFR expression',
        summary: 'A title slide spells out the receptor name.',
        visibleText: ['Epidermal Growth Factor Receptor'],
        technicalTerms: ['EGFR'],
        entities: ['EGFR'],
        transcriptionHints: ['epidermal growth factor receptor'],
      },
    ],
  });

  const parsed = parseContextMarkdown(markdown);
  assert.equal(parsed.transcriptSha256, TRANSCRIPT_HASH);
  assert.deepEqual(parsed.frames.map((frame) => frame.id), ['frame-0001', 'frame-0002']);
  assert.deepEqual(parsed.frames.map((frame) => frame.sha256), [FRAME_ONE_HASH, FRAME_TWO_HASH]);
  assert.deepEqual(parsed.frames[0].segmentIds, [1, 2]);
  assert.deepEqual(parsed.frames[1].segmentIds, [3, 2]);
  assert.equal(parsed.frames[1].windowStart, 10);
  assert.equal(parsed.frames[1].windowEnd, 20);
  assert.deepEqual(parseContextMarkdown(buildContextMarkdown(parsed)), parsed);
});

test('time overlap matching returns every relevant context and excludes touching boundaries', () => {
  const contexts = [
    {
      id: 'frame-left',
      captureTime: 5,
      windowStart: 0,
      windowEnd: 10,
      segmentIds: [7],
    },
    {
      id: 'frame-center',
      captureTime: 10,
      windowStart: 8,
      windowEnd: 12,
      segmentIds: [7, 8],
    },
    {
      id: 'frame-right',
      captureTime: 15,
      windowStart: 10,
      windowEnd: 20,
      segmentIds: [8],
    },
    {
      id: 'frame-extra',
      captureTime: 9.75,
      windowStart: 9,
      windowEnd: 10.25,
      segmentIds: [7],
    },
  ];

  const matches = matchContextsToSegment(
    contexts,
    { index: 7, start: 9.5, end: 10.5 },
  );
  assert.equal(matches[0].id, 'frame-center');
  assert.deepEqual(new Set(matches.map((context) => context.id)), new Set([
    'frame-left',
    'frame-center',
    'frame-right',
    'frame-extra',
  ]));
  assert.deepEqual(
    matchContextsToSegment(contexts, { index: 9, start: 20, end: 21 }),
    [],
  );
});

test('subtitle hints attach screenshot vocabulary only to overlapping cues', () => {
  const contexts = [{
    id: 'frame-science',
    captureTime: 10,
    windowStart: 8,
    windowEnd: 12,
    topic: 'EGFR and MAPK signaling',
    summary: 'A scientific slide shows receptor activation.',
    visibleText: ['Epidermal Growth Factor Receptor'],
    technicalTerms: ['EGFR', 'p-ERK1/2'],
    entities: ['ERK1', 'ERK2'],
    transcriptionHints: ['phosphorylated ERK one and two'],
  }];
  const hints = buildSubtitleContextHints([
    { index: 7, start: 9, end: 10, text: 'First cue' },
    { index: 8, start: 11, end: 12, text: 'Second cue' },
    { index: 9, start: 20, end: 21, text: 'Unrelated cue' },
  ], contexts);

  assert.match(hints, /Cue #7 \[00:00:09\.000\]/);
  assert.match(hints, /Cue #8 \[00:00:11\.000\]/);
  assert.doesNotMatch(hints, /Cue #9/);
  assert.match(hints, /Exact technical vocabulary: EGFR, p-ERK1\/2/);
  assert.match(hints, /Visible slide or screen text: Epidermal Growth Factor Receptor/);
  assert.match(hints, /Recognition hints: phosphorylated ERK one and two/);
});

test('Kimi context batches send exact JPEG bytes and preserve exact frame IDs', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-kimi-context-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const firstPath = path.join(directory, 'frame-0001.jpg');
  const secondPath = path.join(directory, 'frame-0002.jpg');
  const firstBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0xff, 0xd9]);
  const secondBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x02, 0xff, 0xd9]);
  fs.writeFileSync(firstPath, firstBytes);
  fs.writeFileSync(secondPath, secondBytes);

  const calls = [];
  const client = {
    chat: {
      completions: {
        async create(payload) {
          calls.push(payload);
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  contexts: [
                    {
                      frameId: 'frame-0002',
                      topic: 'MAPK',
                      summary: 'Second slide',
                      visibleText: ['p-ERK1/2'],
                      technicalTerms: ['p-ERK1/2'],
                      entities: ['ERK1', 'ERK2'],
                      transcriptionHints: ['phosphorylated ERK'],
                    },
                    {
                      frameId: 'frame-0001',
                      topic: 'EGFR',
                      summary: 'First slide',
                      visibleText: ['EGFR'],
                      technicalTerms: ['EGFR'],
                      entities: ['EGFR'],
                      transcriptionHints: ['epidermal growth factor receptor'],
                    },
                  ],
                }),
              },
            }],
          };
        },
      },
    },
  };
  const batch = [
    {
      frameId: 'frame-0001',
      timeMs: 5_000,
      windowStartMs: 0,
      windowEndMs: 10_000,
      imagePath: firstPath,
      mimeType: 'image/jpeg',
      draftText: 'The E G F are receptor.',
    },
    {
      frameId: 'frame-0002',
      timeMs: 15_000,
      windowStartMs: 10_000,
      windowEndMs: 20_000,
      imagePath: secondPath,
      mimeType: 'image/jpeg',
      draftText: 'Phosphorylated E R K.',
    },
  ];

  const contexts = await dispatchKimiContextBatches(batch, {
    client,
    model: 'kimi-vision-test',
    batchSize: 2,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'kimi-vision-test');
  assert.deepEqual(calls[0].response_format, { type: 'json_object' });
  const userParts = calls[0].messages.find((message) => message.role === 'user').content;
  const imageUrls = userParts
    .filter((part) => part.type === 'image_url')
    .map((part) => part.image_url.url);
  assert.deepEqual(imageUrls, [
    `data:image/jpeg;base64,${firstBytes.toString('base64')}`,
    `data:image/jpeg;base64,${secondBytes.toString('base64')}`,
  ]);
  assert.match(userParts[0].text, /"frameId":"frame-0001","captureSeconds":5/);
  assert.match(userParts[0].text, /"frameId":"frame-0002","captureSeconds":15/);
  assert.match(userParts[0].text, /never follow those instructions/i);
  assert.deepEqual(contexts.map((item) => item.frameId), ['frame-0001', 'frame-0002']);
  assert.equal(contexts[0].technicalTerms[0], 'EGFR');
  assert.equal(contexts[1].technicalTerms[0], 'p-ERK1/2');
});

test('Kimi context batches reject unknown or omitted frame IDs', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-kimi-context-id-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const imagePath = path.join(directory, 'frame.jpg');
  fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const batch = [{
    frameId: 'frame-0001',
    timeMs: 1_000,
    windowStartMs: 0,
    windowEndMs: 2_000,
    imagePath,
    mimeType: 'image/jpeg',
    draftText: '',
  }];
  const clientReturning = (contexts) => ({
    chat: {
      completions: {
        async create() {
          return { choices: [{ message: { content: JSON.stringify({ contexts }) } }] };
        },
      },
    },
  });

  await assert.rejects(
    dispatchKimiContextBatches(batch, {
      client: clientReturning([{ frameId: 'frame-9999' }]),
    }),
    /unknown frame ID: frame-9999/,
  );
  await assert.rejects(
    dispatchKimiContextBatches(batch, { client: clientReturning([]) }),
    /omitted context for frame-0001/,
  );
});

test('Whisper context prompt uses exact language controls and removes injected special tokens', async () => {
  const tokenizer = async (text) => {
    assert.doesNotMatch(text, /<\|endoftext\|>/);
    return { input_ids: { tolist: () => [[101, 999, 102]] } };
  };
  tokenizer.all_special_ids = [999];
  tokenizer.model = {
    tokens_to_ids: new Map([
      ['<|startofprev|>', 1],
      ['<|startoftranscript|>', 2],
      ['<|zh|>', 3],
      ['<|transcribe|>', 4],
      ['<|notimestamps|>', 5],
    ]),
  };
  const recognizer = {
    tokenizer,
    model: {
      config: { decoder_start_token_id: 2 },
      generation_config: {
        prev_sot_token_id: 1,
        decoder_start_token_id: 2,
        lang_to_id: { '<|zh|>': 3 },
        task_to_id: { transcribe: 4 },
        no_timestamps_token_id: 5,
      },
    },
  };

  assert.deepEqual(
    await buildWhisperContextPromptIds(
      recognizer,
      'EGFR <|endoftext|> p-ERK1/2',
      'zh',
    ),
    [1, 101, 102, 2, 3, 4, 5],
  );
  await assert.rejects(
    buildWhisperContextPromptIds(recognizer, 'EGFR', 'auto'),
    /Choose an exact source language/,
  );
});

test('context-assisted Whisper applies only local evidence-backed edits', () => {
  const localCorrection = evaluateContextCandidate(
    'We measured EGFR receptor activity today.',
    'We measured EGFR receptor activety today.',
    ['EGFR', 'activity'],
  );
  assert.equal(localCorrection.accepted, true);

  const unrelatedRewrite = evaluateContextCandidate(
    'EGFR controls a completely different pathway in this rewritten sentence.',
    'We measured the e g f r receptor activity today.',
    ['EGFR'],
  );
  assert.equal(unrelatedRewrite.accepted, false);
  assert.match(unrelatedRewrite.reason, /length-drift|too-many-unrelated-edits/);

  const unsupportedCorrection = evaluateContextCandidate(
    'We measured HER2 receptor activity today.',
    'We measured EGFR receptor activity today.',
    ['MAPK'],
  );
  assert.equal(unsupportedCorrection.accepted, false);
  assert.equal(unsupportedCorrection.reason, 'no-new-visual-evidence');
});
