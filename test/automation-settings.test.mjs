import assert from 'node:assert/strict';
import test from 'node:test';

const { listAutomationSettings, saveAutomationSettings } = await import('../src/lib/operations/store.js');

test('saved automation settings can be reopened, edited, and persisted independently of a batch', () => {
  const saved = saveAutomationSettings({
    name: 'Bilibili default',
    settings: { sourceType: 'bilibili', steps: { videoContext: true, publish: true }, language: 'auto' },
  });
  assert.equal(saved.settings.sourceType, 'bilibili');

  const updated = saveAutomationSettings({
    id: saved.id,
    name: 'Bilibili with OCR',
    settings: { sourceType: 'bilibili', steps: { videoContext: true, ocrContext: true, publish: true }, language: 'zh' },
  });
  assert.equal(updated.name, 'Bilibili with OCR');
  assert.equal(updated.settings.steps.ocrContext, true);
  assert.equal(listAutomationSettings().filter((setting) => setting.id === saved.id).length, 1);
});
