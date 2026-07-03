import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const sessionDir = path.join(process.cwd(), 'config', 'scraper-logins');
const loginSessions = new Map();

function loginPath(siteId) {
  return path.join(sessionDir, `${String(siteId || '').replace(/[^\w:-]+/g, '_')}.json`);
}

export async function getBrowserContext(siteId) {
  return {
    siteId,
    available: false,
    reason: 'Headed Playwright login is not enabled in this runtime yet.',
  };
}

export async function startInteractiveLogin(siteId) {
  const sessionId = randomUUID();
  loginSessions.set(sessionId, {
    siteId,
    startedAt: Date.now(),
    status: 'waiting',
  });
  return { sessionId, status: 'waiting', message: 'Use importCookies until headed Playwright login is enabled.' };
}

export async function pollLogin(sessionId) {
  const session = loginSessions.get(sessionId);
  if (!session) return { status: 'closed' };
  if (Date.now() - session.startedAt > 15 * 60 * 1000) {
    loginSessions.delete(sessionId);
    return { status: 'timeout' };
  }
  if (fs.existsSync(loginPath(session.siteId))) {
    loginSessions.delete(sessionId);
    return { status: 'ok' };
  }
  return { status: 'waiting' };
}

export async function importCookies(siteId, cookieStringOrStorageState) {
  if (!siteId) throw new Error('siteId is required');
  if (!cookieStringOrStorageState) throw new Error('cookieStringOrStorageState is required');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(loginPath(siteId), JSON.stringify({
    siteId,
    importedAt: new Date().toISOString(),
    cookieOrState: String(cookieStringOrStorageState),
  }, null, 2));
  return { ok: true };
}

export async function scrapeWithBrowser(_siteId, _query, _limit) {
  return [];
}

export async function isLoggedIn(siteId) {
  return fs.existsSync(loginPath(siteId));
}
