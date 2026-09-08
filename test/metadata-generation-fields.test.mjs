import assert from 'node:assert/strict';
import test from 'node:test';

const { generateMetadataDraft, normalizeGenerationFields } = await import('../src/lib/pipeline/processors/metadata.js');

test('normalizes selected AI metadata fields from checkbox-style values', () => {
  assert.deepEqual(normalizeGenerationFields(), ['title', 'description', 'tags']);
  assert.deepEqual(normalizeGenerationFields({ title: true, description: false, tags: true }), ['title', 'tags']);
  assert.deepEqual(normalizeGenerationFields(['tags', 'title', 'invalid', 'tags']), ['tags', 'title']);
});

test('uses complete operator metadata without an AI request when no fields are selected', async () => {
  const result = await generateMetadataDraft({
    generateFields: [],
    existingMetadata: {
      title: 'Hand-mixed title',
      description: 'Hand-mixed description',
      tags: 'calm, focus, calm',
    },
  });

  assert.equal(result.provider, 'manual');
  assert.equal(result.model, 'manual');
  assert.deepEqual(result.metadata, {
    titleEn: 'Hand-mixed title',
    descriptionEn: 'Hand-mixed description',
    tags: ['calm', 'focus'],
  });
});

test('requires complete manual values when AI generation is disabled', async () => {
  await assert.rejects(
    generateMetadataDraft({ generateFields: [], existingMetadata: { title: 'Only a title' } }),
    /incomplete title, description, or tags/i,
  );
});
