import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyzeFrames, buildCodexArgs } from '../src/lib/context/vision/backends/codex.js';

function fixture(t, fail = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'videops-vision-fixture-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const imagePath = path.join(directory, 'source.png');
  fs.writeFileSync(imagePath, Buffer.from([137, 80, 78, 71]));
  const bin = path.join(directory, 'codex'); const trace = path.join(directory, 'trace.json');
  fs.writeFileSync(bin, `#!${process.execPath}
import fs from 'node:fs';
if (process.argv.includes('--version')) process.exit(0);
const args = process.argv.slice(2); const image = args[args.indexOf('--image') + 1];
let input = ''; for await (const chunk of process.stdin) input += chunk;
fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify({ args, cwd: process.cwd(), image, imageExists: fs.existsSync(image), hasToken: Boolean(process.env.VIDEO_OPERATOR_TOKEN), hasKey: Boolean(process.env.OPENAI_API_KEY), input }));
if (${fail}) { console.error('private authentication diagnostic'); process.exit(1); }
console.log(JSON.stringify({ contexts: [{ frameId: 'frame-0001', summary: 'Test image' }] }));
`, { mode: 0o700 });
  return { batch: [{ frameId: 'frame-0001', imagePath, draftText: 'untrusted test text' }], credentials: { codexBin: bin }, trace };
}

test('vision args disable user configuration, instructions, shell and search', () => {
  const args = buildCodexArgs([{ imagePath: '/tmp/frame.png' }]);
  for (const arg of ['--ignore-user-config', 'read-only', 'approval_policy="never"', 'web_search="disabled"', 'project_doc_max_bytes=0', 'features.shell_tool=false']) assert.ok(args.includes(arg));
});

test('vision stages only its images outside the repo, filters app credentials, and cleans up', async (t) => {
  const fake = fixture(t);
  const before = process.env.VIDEO_OPERATOR_TOKEN;
  process.env.VIDEO_OPERATOR_TOKEN = 'test-only-private-operator';
  try {
    const result = await analyzeFrames(fake.batch, fake.credentials);
    assert.equal(result.contexts[0].summary, 'Test image');
    const trace = JSON.parse(fs.readFileSync(fake.trace));
    assert.notEqual(trace.cwd, process.cwd()); assert.equal(trace.imageExists, true);
    // macOS canonicalizes /var to /private/var in the child's cwd.
    assert.equal(path.basename(path.dirname(trace.image)), path.basename(trace.cwd));
    assert.equal(trace.hasToken, false); assert.equal(trace.hasKey, false);
    assert.equal(fs.existsSync(trace.cwd), false);
    assert.match(trace.input, /untrusted test text/);
  } finally { if (before === undefined) delete process.env.VIDEO_OPERATOR_TOKEN; else process.env.VIDEO_OPERATOR_TOKEN = before; }
});

test('vision errors do not expose CLI diagnostics and still clean up', async (t) => {
  const fake = fixture(t, true);
  await assert.rejects(analyzeFrames(fake.batch, fake.credentials), (error) => {
    assert.match(error.message, /Codex vision failed/); assert.doesNotMatch(error.message, /private authentication diagnostic/); return true;
  });
  assert.equal(fs.existsSync(JSON.parse(fs.readFileSync(fake.trace)).cwd), false);
});

test('missing-frame errors do not disclose filesystem paths', async () => {
  await assert.rejects(analyzeFrames([{ frameId: 'frame-0001', imagePath: '/private/missing-fixture/frame.png' }]), (error) => {
    assert.match(error.message, /missing or unreadable/); assert.doesNotMatch(error.message, /missing-fixture/); return true;
  });
});
