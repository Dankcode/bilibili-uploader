import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylesDir = path.join(root, 'src');
const globalsPath = path.join(stylesDir, 'app/globals.css');
const globals = fs.readFileSync(globalsPath, 'utf8');
const tokens = new Set([...globals.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));

function cssFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(target);
    return entry.name.endsWith('.css') ? [target] : [];
  });
}

test('component CSS uses only shared color tokens and defined variables', () => {
  const undefinedTokens = [];
  const rawColors = [];
  for (const file of cssFiles(stylesDir)) {
    if (file === globalsPath) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/var\((--[a-z0-9-]+)/gi)) {
      if (!tokens.has(match[1])) undefinedTokens.push(`${path.relative(root, file)}: ${match[1]}`);
    }
    if (/#(?:[0-9a-f]{3,8})\b/gi.test(source)) rawColors.push(path.relative(root, file));
  }
  assert.deepEqual(undefinedTokens, [], `Undefined CSS tokens:\n${undefinedTokens.join('\n')}`);
  assert.deepEqual(rawColors, [], `Hard-coded component colors:\n${rawColors.join('\n')}`);
});
