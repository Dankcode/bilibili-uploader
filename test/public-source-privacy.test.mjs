import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

test('public-source gate checks new files, ignores private state and reports no secret values', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'videops-privacy-check-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', cwd]);
  fs.mkdirSync(path.join(cwd, 'src')); fs.mkdirSync(path.join(cwd, 'config'));
  fs.writeFileSync(path.join(cwd, '.gitignore'), '.env.local\nconfig/*.json\n');
  fs.writeFileSync(path.join(cwd, '.env.local'), 'PRIVATE=not-for-publication');
  fs.writeFileSync(path.join(cwd, 'config', 'storage.json'), '{"cookies":[]}');
  const check = () => spawnSync(process.execPath, [path.resolve('scripts/check_secrets.mjs')], { cwd, encoding: 'utf8' });
  assert.equal(check().status, 0);
  const value = 'sk-' + 'A'.repeat(40);
  fs.writeFileSync(path.join(cwd, 'src', 'example.js'), `const secret = '${value}';\nconst email = 'private-person' + '@gmail.com';\n`);
  let result = check();
  assert.equal(result.status, 1); assert.match(result.stderr, /src\/example.js:1: OpenAI/);
  assert.doesNotMatch(result.stderr, new RegExp(value));
  const address = 'private-person' + '@gmail.com';
  fs.writeFileSync(path.join(cwd, 'src', 'example.js'), `const email = '${address}';`);
  result = check(); assert.equal(result.status, 1); assert.match(result.stderr, /personal email/); assert.doesNotMatch(result.stderr, /private-person@/);
  fs.writeFileSync(path.join(cwd, 'src', 'example.js'), "const email = 'you@example.com';");
  assert.equal(check().status, 0);
  execFileSync('git', ['add', '--force', 'config/storage.json'], { cwd });
  result = check(); assert.equal(result.status, 1); assert.match(result.stderr, /local state must be untracked/);
});

test('build-privacy gate rejects private traced files without reading their contents', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'videops-build-check-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const next = path.join(cwd, '.next'); fs.mkdirSync(next);
  const manifest = path.join(next, 'next-server.js.nft.json');
  const check = () => spawnSync(process.execPath, [path.resolve('scripts/check_build_privacy.mjs')], { cwd, encoding: 'utf8' });
  fs.writeFileSync(manifest, JSON.stringify({ files: ['../node_modules/next/index.js', '../src/app/page.js'] }));
  assert.equal(check().status, 0);
  for (const file of ['../config/storage.json', '../.env.local', '../sample_token.json', '../video-work/source.mp4', '../docs/images/subtitle-studio-mobile.png']) {
    fs.writeFileSync(manifest, JSON.stringify({ files: [file] }));
    const result = check(); assert.equal(result.status, 1); assert.match(result.stderr, /private deployment input/);
  }
});
