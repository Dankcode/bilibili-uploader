import assert from 'node:assert/strict';
import test from 'node:test';
import { titleContextForVideo } from '../src/lib/operations/titleContext.js';
import { listAutomationSettings, saveAutomationSettings } from '../src/lib/operations/store.js';

test('category guidance combines with a video brief and keeps categories separate', () => {
  const contexts = { '27': 'Use a question as the title.', '24': 'Lead with the series name.', default: 'Keep titles short.' };
  assert.match(titleContextForVideo(contexts, '27', 'Mention the experiment'), /Use a question[\s\S]*Mention the experiment/);
  assert.doesNotMatch(titleContextForVideo(contexts, '27'), /series name/);
  assert.match(titleContextForVideo(contexts, ''), /Keep titles short/);
  assert.equal(titleContextForVideo(contexts, '28', 'Specific angle'), 'Video-specific guidance: Specific angle');
});

test('category contexts persist independently of reusable automation settings', () => {
  saveAutomationSettings({ id: 'category-title-context:27', settings: { context: 'Educational titles' } });
  assert.equal(listAutomationSettings({ limit: 100 }).some((item) => item.id === 'category-title-context:27'), false);
});
