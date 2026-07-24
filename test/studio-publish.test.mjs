import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildTranscriptMarkdown } from '../src/lib/studio/markdown.js';
import { buildStudioPipelineInput } from '../src/lib/studio/publishPayload.js';
import { buildAss } from '../src/lib/studio/subtitles.js';

function projectFixture(directory, patch = {}) {
  const videoPath = path.join(directory, 'sample.mp4');
  fs.writeFileSync(videoPath, Buffer.from('video-fixture'));
  const segments = [
    { index: 1, start: 0, end: 2, text: 'Original one.' },
    { index: 2, start: 2, end: 4, text: 'Original two.' },
  ];
  return {
    id: 'studio-project-test',
    name: 'sample.mp4',
    videoPath,
    transcriptMd: buildTranscriptMarkdown({
      name: 'sample.mp4', source: 'en', target: 'en', duration: 4, engine: 'test', segments,
    }),
    subtitleText: '',
    format: 'ass',
    frameManifest: [],
    analysis: {},
    sourceLang: 'en',
    targetLang: 'en',
    ...patch,
  };
}

test('Studio publish reuses same-language transcript as an existing translation', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-publish-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = buildStudioPipelineInput(projectFixture(directory), {
    voiceover: true,
    burnSubtitles: true,
    metadata: true,
    upload: false,
  });

  assert.deepEqual(input.processorIds, ['voiceover', 'metadata']);
  assert.equal(input.uploaderId, '');
  assert.equal(input.options.voiceover.existingTranslation.segments.length, 2);
  assert.equal(input.options.voiceover.existingTranslation.segments[0].textEn, 'Original one.');
  assert.equal(input.options.voiceover.burnSubtitles, true);
  assert.match(input.options.metadata.transcript, /Original two\./);
});

test('Studio publish passes saved dual subtitles and private upload settings', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-publish-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const subtitleText = buildAss([
    { index: 1, start: 0, end: 2, text: '原文', textEn: 'English line.' },
  ]);
  const input = buildStudioPipelineInput(projectFixture(directory, {
    sourceLang: 'zh', targetLang: 'en', subtitleText,
  }), {
    voiceover: true,
    metadata: false,
    upload: true,
    channelId: '12',
  });

  assert.deepEqual(input.processorIds, ['voiceover']);
  assert.equal(input.options.voiceover.existingTranslation.segments[0].textEn, 'English line.');
  assert.deepEqual(input.options.youtube, { channelId: '12', privacyStatus: 'private' });
});

test('Studio publish blocks untranslated cross-language projects', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-publish-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const project = projectFixture(directory, { sourceLang: 'zh', targetLang: 'en' });
  assert.throws(() => buildStudioPipelineInput(project, { voiceover: true }), /Translate the project/);
});
