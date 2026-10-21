import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export function bilibiliCliPython(root = process.cwd()) {
  return process.env.BILIBILI_CLI_PYTHON || path.join(root, '.venv-bilibili-cli', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

/** Optional, strictly anonymous adapter. No shell, login discovery, or cookie file. */
export async function queryBilibiliCli(request, { python = bilibiliCliPython(), root = process.cwd(), execute = execFile } = {}) {
  if (!fs.existsSync(python)) return null;
  return new Promise((resolve, reject) => {
    const child = execute(python, [path.join(root, 'scripts/python/bilibili_cli_bridge.py')], {
      timeout: 65_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    }, (error, stdout) => {
      if (error) return reject(new Error('Bilibili CLI bridge could not complete the anonymous request'));
      try {
        const result = JSON.parse(stdout);
        if (result.ok !== true || !result.data || typeof result.data !== 'object') throw new Error();
        resolve(result.data);
      } catch { reject(new Error('Bilibili CLI bridge returned no usable anonymous data')); }
    });
    child.stdin.on('error', () => {}); // Early interpreter exit is handled above.
    child.stdin.end(JSON.stringify(request));
  });
}
