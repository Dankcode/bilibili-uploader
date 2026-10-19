import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Only filenames, line numbers, and rule names are printed, never matches.
const signatures = [
  ['OpenAI/provider key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/g],
  ['Google API key', /\bAIza[A-Za-z0-9_-]{30,}\b/g],
  ['Google OAuth secret', /\bGOCSPX-[A-Za-z0-9_-]{16,}\b/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
const localState = /(?:^|\/)(?:node_modules|__pycache__|\.venv[^/]*)(?:\/|$)|^config\/(?!README\.md$|\.gitkeep$)|(?:^|\/)\.fuse_hidden|\.(?:db|sqlite3?)(?:$|-)|(?:^|\/)\.env(?:$|\.(?!example$))|client_secret.*\.json|_token\.(?:json|pickle)|secrets.*\.zip/i;
// Include new publishable files, but never open ignored working credentials.
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).split('\0').filter(Boolean))];
const personalEmail = /\b[A-Z0-9._%+-]+@(?:gmail|outlook|hotmail|qq|163|126|icloud)\.com\b/gi;
const vendorRedactionSentinels = new Set(['sk-' + 'PLAINTEXT-SECRET-DO-NOT-LEAK-12345', 'sk-' + 'LEAK-PROBE-1234567890ABCDEF']);
let findings = 0;
for (const file of files) {
  if (localState.test(file)) {
    console.error(`${file}: local state must be untracked`); findings += 1; continue;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  const data = fs.readFileSync(file, 'utf8');
  if (/^(?:src|scripts|test|docs)\/|^(?:README\.md|\.env\.example)$/.test(file)) {
    for (const match of data.matchAll(personalEmail)) {
      const line = data.slice(0, match.index).split('\n').length;
      console.error(`${file}:${line}: personal email; use an example.com fixture`); findings += 1;
    }
  }
  for (const [rule, pattern] of signatures) {
    for (const match of data.matchAll(pattern)) {
      // Vendored redaction tests use explicit sentinel/fake keys.
      if (/(?:sentinel|fake|dummy|test)/i.test(match[0]) && /(?:^|\/)tests?\//.test(file)) continue;
      if (file === 'vendor/douyin-downloader/tests/test_transcript_manager_audio.py' && vendorRedactionSentinels.has(match[0])) continue;
      const line = data.slice(0, match.index).split('\n').length;
      console.error(`${file}:${line}: ${rule}`); findings += 1;
    }
  }
}
console.log(`Checked ${files.length} publishable files; ${findings} finding(s).`);
if (findings) process.exitCode = 1;
