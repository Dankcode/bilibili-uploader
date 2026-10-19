import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const directory = path.resolve(root, '.next');
// Check deployment inputs by path only; never open private credential values.
export function privateBuildPath(relative) {
  const value = relative.replaceAll('\\', '/');
  return /^(?:config|video-work|videos|compilation_vids|\.git|\.venv[^/]*)(?:\/|$)|^\.env(?:$|\.)|(?:^|\/)(?:__pycache__|\.fuse_hidden[^/]*)(?:\/|$)|\.(?:db|sqlite3?)(?:$|-)|^(?:.*client_secret.*\.json|.*_token\.(?:json|pickle)|.*credentials.*\.json|api_keys\.json|secrets\.json|.*secrets.*\.zip)|^docs\/(?:PLAN-|SERVER-PREP-)|^docs\/images\/subtitle-studio-(?:desktop|mobile)\.png$/i.test(value);
}

function manifests(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? manifests(file) : entry.name.endsWith('.nft.json') ? [file] : [];
  });
}

const traces = manifests(directory);
if (!traces.length) throw new Error('No production trace manifests found. Run next build first.');
let findings = 0;
for (const trace of traces) {
  for (const input of JSON.parse(fs.readFileSync(trace, 'utf8')).files || []) {
    const relative = path.relative(root, path.resolve(path.dirname(trace), input));
    if (privateBuildPath(relative)) {
      console.error(`${path.relative(root, trace)}: private deployment input ${relative}`); findings += 1;
    }
  }
}
console.log(`Checked ${traces.length} deployment traces; ${findings} private input(s).`);
if (findings) process.exitCode = 1;
