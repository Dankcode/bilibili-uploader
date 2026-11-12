import assert from 'node:assert/strict';
import test from 'node:test';
import { operations } from '../src/lib/agent/contract.js';
import { executeOperation, readAgentResource, toAgentError } from '../src/lib/agent/service.js';
import { ensureVideoRecord } from '../src/lib/operations/store.js';

const principal = 'agent:tools-test';
let keys = 0;
const call = (name, input) => executeOperation(name, input, principal);
const write = (name, input) => call(name, { idempotencyKey: `tools-test-${++keys}`, ...input });
const rejects = (promise, code) => assert.rejects(promise, (error) => { assert.equal(error.code, code, error.message); return true; });

test('every contract operation imports with a handler, and hints match read/write roles', () => {
  for (const op of operations) {
    assert.equal(op.annotations.destructiveHint && op.annotations.readOnlyHint, false, op.name);
  }
  assert.equal(operations.find((op) => op.name === 'cancel_job').annotations.destructiveHint, true);
  assert.equal(operations.find((op) => op.name === 'update_video_record').annotations.destructiveHint, false);
});

test('update_video_record edits Library fields with versioning and refuses deleted records', async () => {
  const record = ensureVideoRecord({ title: 'Original', sourceType: 'bilibili', sourceUrl: 'https://www.bilibili.com/video/BV1Tools00001' });
  const updated = await write('update_video_record', { videoId: record.id, ifMatch: record.updatedAt, title: 'Edited title', campaign: 'Autumn', priority: 5 });
  assert.equal(updated.title, 'Edited title'); assert.equal(updated.campaign, 'Autumn'); assert.equal(updated.priority, 5);
  assert.notEqual(updated.updatedAt, record.updatedAt);
  await rejects(write('update_video_record', { videoId: record.id, ifMatch: record.updatedAt, title: 'Stale' }), 'STALE_WRITE');
  await rejects(write('update_video_record', { videoId: record.id, ifMatch: updated.updatedAt }), 'INVALID_INPUT');
  await rejects(write('update_video_record', { videoId: record.id, ifMatch: updated.updatedAt, status: 'published' }), 'INVALID_INPUT');
  await write('delete_video_record', { videoId: record.id, ifMatch: updated.updatedAt });
  await rejects(write('update_video_record', { videoId: record.id, ifMatch: updated.updatedAt, title: 'Gone' }), 'NOT_FOUND');
});

test('save_youtube_post creates and edits drafts; domain errors arrive typed with their message', async () => {
  const channelId = 'UC' + 'a'.repeat(22);
  const draft = await write('save_youtube_post', { channelId, text: 'First draft' });
  assert.equal(draft.status, 'draft');
  const edited = await write('save_youtube_post', { postId: draft.id, ifMatch: draft.updatedAt, channelId, text: 'Second draft' });
  assert.equal(edited.text, 'Second draft');
  await rejects(write('save_youtube_post', { postId: draft.id, ifMatch: draft.updatedAt, channelId, text: 'Stale' }), 'STALE_WRITE');
  await assert.rejects(write('save_youtube_post', { channelId, text: 'Past', scheduledFor: '2001-01-01T00:00:00Z' }),
    (error) => error.code === 'PRECONDITION_FAILED' && /future schedule/.test(error.message));
  await assert.rejects(call('get_youtube_post', { postId: 'missing-post' }), (error) => error.code === 'NOT_FOUND' && error.status === 404 && /not found/.test(error.message));
});

test('save_title_context writes the same settings the console reads', async () => {
  await write('save_title_context', { categoryId: '27', context: 'Use a question as the title.' });
  assert.equal(readAgentResource('videops://title-contexts').contexts['27'], 'Use a question as the title.');
  await rejects(write('save_title_context', { categoryId: 'abc', context: 'x' }), 'INVALID_INPUT');
});

test('driver errors stay generic so SQL never reaches a tool result', () => {
  const quiet = console.error; console.error = () => {};
  try {
    const error = toAgentError(Object.assign(new Error('no such column: secret_sql'), { code: 'SQLITE_ERROR' }));
    assert.equal(error.code, 'PRECONDITION_FAILED'); assert.doesNotMatch(error.message, /secret_sql/);
  } finally { console.error = quiet; }
  assert.equal(toAgentError(Object.assign(new Error('Post changed. Reload before editing.'), { status: 409 })).code, 'STALE_WRITE');
});
