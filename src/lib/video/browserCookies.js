import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const executeFile = promisify(execFile);

export async function readChromeBilibiliCookies() {
  const bundled = path.join(process.cwd(), '.venv-bilibili', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3');
  const python = process.env.BILIBILI_COOKIE_PYTHON || (fs.existsSync(bundled) ? bundled : process.env.PYTHON_BIN || 'python3');
  try {
    const { stdout } = await executeFile(python, [path.join(process.cwd(), 'scripts/python/bilibili_browser_cookies.py')], {
      timeout: 45_000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    const result = JSON.parse(stdout);
    return {
      sessions: (Array.isArray(result.sessions) ? result.sessions : []).map((session) => ({
        cookies: (Array.isArray(session.cookies) ? session.cookies : []).filter((cookie) => /(^|\.)bilibili\.com$/i.test(String(cookie.domain || ''))),
      })),
      reason: ['dependency_missing', 'browser_access_unavailable', 'no_signed_in_cookie'].includes(result.reason) ? result.reason : '',
    };
  } catch {
    // execFile errors include captured stdout/stderr. Returning only a fixed
    // reason prevents cookie material or keychain diagnostics reaching logs.
    return { sessions: [], reason: 'browser_access_unavailable' };
  }
}
