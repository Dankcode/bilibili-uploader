import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapterDirs = [
  'src/lib/pipeline/processors',
  'src/lib/pipeline/sources',
  'src/lib/pipeline/uploaders',
];

function adapterFiles() {
  const files = [];
  for (const dir of adapterDirs) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (name.endsWith('.js')) files.push(path.join(dir, name));
    }
  }
  return files;
}

/**
 * REGRESSION — an adapter that does `export async function process(...)` hoists
 * that declaration into module scope, where it shadows Node's global `process`.
 * Any bare `process.env` read in the same file then throws
 * "Cannot read properties of undefined (reading '<VAR>')" before the adapter
 * does any work. Adapters must capture the environment via `globalThis.process`.
 */
test('adapters that export process() never read a shadowed process.env', () => {
  const offenders = [];
  for (const relative of adapterFiles()) {
    const source = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    const shadowsProcess = /^export\s+(?:async\s+)?function\s+process\b/m.test(source)
      || /^export\s*\{[^}]*\bprocess\b[^}]*\}/m.test(source);
    if (!shadowsProcess) continue;
    // `globalThis.process.env` is the supported form; a bare `process.env` is not.
    const bareEnv = source
      .split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => /(^|[^.\w])process\.env\b/.test(line));
    if (bareEnv.length) {
      offenders.push(`${relative}: ${bareEnv.map(([n]) => `line ${n}`).join(', ')}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `These adapters shadow the global process and would throw on env access:\n${offenders.join('\n')}`,
  );
});

test('every adapter exposes the contract the registry calls', async () => {
  for (const relative of adapterFiles()) {
    const module = await import(path.join(repoRoot, relative));
    assert.equal(typeof module.id, 'string', `${relative} must export an id`);
    assert.equal(typeof module.testConnection, 'function', `${relative} must export testConnection`);
  }
});

test('videoContext resolves credentials without touching a shadowed global', async () => {
  const videoContext = await import(path.join(repoRoot, 'src/lib/pipeline/processors/videoContext.js'));
  // Before the fix this threw synchronously inside resolveCredentials().
  const result = await videoContext.testConnection({ sttBackend: 'localWhisper' });
  assert.equal(typeof result, 'object');
  assert.ok('ok' in result, 'testConnection must report readiness rather than throw');
});
