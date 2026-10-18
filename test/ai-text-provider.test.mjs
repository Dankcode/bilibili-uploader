import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { buildCodexTextArgs, codexTextSettings } from '../src/lib/ai/codexText.js';
import { completeJsonWithMeta, translateSegments, validateSegmentTranslations } from '../src/lib/ai/getEnglish.js';
import { generateMetadataDraft, testConnection } from '../src/lib/pipeline/processors/metadata.js';

function fakeCodex(t, response, { fail = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'videops-fake-codex-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'codex');
  const trace = path.join(directory, 'trace.json');
  fs.writeFileSync(bin, `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
let input = ''; for await (const chunk of process.stdin) input += chunk;
fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify({ args, input, cwd: process.cwd(), hasApiKey: Boolean(process.env.OPENAI_API_KEY), hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) }));
if (${fail}) { console.error('private diagnostic'); process.exit(1); }
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], ${JSON.stringify(JSON.stringify(response))});
`, { mode: 0o700 });
  return { credentials: { provider: 'codexCli', codexBin: bin }, trace };
}

test('Codex uses the requested Sol model and medium effort with isolated settings', () => {
  const config = codexTextSettings({ codexBin: '/test/codex', codexModel: 'gpt-6.1-sol', codexReasoningEffort: 'medium' });
  const args = buildCodexTextArgs(config, '/tmp/answer');
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-6.1-sol');
  for (const flag of ['--ignore-user-config', '--ephemeral', 'read-only', 'model_reasoning_effort="medium"', 'features.shell_tool=false']) assert.ok(args.includes(flag));
});

test('metadata generation uses Codex, preserves manual fields, and cleans its temp directory', async (t) => {
  const fake = fakeCodex(t, { titleEn: 'A quiet brush session', descriptionEn: 'Generated description', tags: ['brush', 'brush', 'quiet'] });
  const result = await generateMetadataDraft({
    sourceTitle: '轻柔刷子', referenceMaterial: 'Soft brushing sounds.',
    generateFields: ['title', 'tags'], existingMetadata: { description: 'My manual description' },
    credentials: fake.credentials,
  });
  assert.equal(result.provider, 'codexcli');
  assert.equal(result.model, 'gpt-6.1-sol');
  assert.deepEqual(result.metadata, { titleEn: 'A quiet brush session', descriptionEn: 'My manual description', tags: ['brush', 'quiet'] });
  const trace = JSON.parse(fs.readFileSync(fake.trace));
  assert.notEqual(trace.cwd, process.cwd());
  assert.equal(fs.existsSync(trace.cwd), false);
  assert.equal(trace.hasApiKey, false);
  assert.equal(trace.hasGeminiKey, false);
  assert.match(trace.input, /untrusted reference/);
});

test('selected Codex errors fail without falling back or exposing CLI diagnostics', async (t) => {
  const fake = fakeCodex(t, {}, { fail: true });
  await assert.rejects(completeJsonWithMeta('Return JSON.', { provider: 'codexCli', credentials: fake.credentials }), (error) => {
    assert.match(error.message, /codex login status/);
    assert.doesNotMatch(error.message, /private diagnostic|gemini:/);
    return true;
  });
  const trace = JSON.parse(fs.readFileSync(fake.trace));
  assert.equal(fs.existsSync(trace.cwd), false);
});

test('connection test verifies an actual Codex answer', async (t) => {
  const fake = fakeCodex(t, { ok: true });
  const result = await testConnection(fake.credentials);
  assert.equal(result.ok, true);
  assert.match(result.detail, /codexcli\/gpt-6.1-sol/);
});

test('voiceover translation obeys the saved provider and source order', async (t) => {
  const fake = fakeCodex(t, { segments: [{ index: 2, textEn: 'Second' }, { index: 1, textEn: 'First' }] });
  const result = await translateSegments([{ index: 1, text: '一' }, { index: 2, text: '二' }], { credentials: fake.credentials });
  assert.equal(result.provider, 'codexcli');
  assert.deepEqual(result.map((item) => item.textEn), ['First', 'Second']);
});

test('translation rejects dropped, duplicate, invented, non-numeric and empty segments', () => {
  const source = [{ index: 1 }, { index: 2 }];
  for (const segments of [
    [{ index: 1, textEn: 'One' }],
    [{ index: 1, textEn: 'One' }, { index: 1, textEn: 'Again' }],
    [{ index: 1, textEn: 'One' }, { index: 3, textEn: 'Unknown' }],
    [{ index: 1, textEn: 'One' }, { index: '2', textEn: 'Two' }],
    [{ index: 1, textEn: 'One' }, { index: 2, textEn: ' ' }],
  ]) assert.throws(() => validateSegmentTranslations(source, { segments }), /Translation/);
});

test('OpenAI Sol API requests use medium reasoning and omit unsupported temperature', async (t) => {
  let body;
  const server = http.createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk;
    body = JSON.parse(text);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await completeJsonWithMeta('Return JSON.', { provider: 'openai', credentials: {
    openaiApiKey: 'test-only-key', openaiModel: 'gpt-6.1-sol', openaiBaseURL: `http://127.0.0.1:${server.address().port}/v1`,
  } });
  assert.equal(result.data.ok, true);
  assert.equal(body.reasoning_effort, 'medium');
  assert.equal('temperature' in body, false);
  assert.deepEqual(body.response_format, { type: 'json_object' });
});
