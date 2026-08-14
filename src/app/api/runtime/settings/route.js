import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  CONNECTION_MODES,
  assertRuntimeSettings,
  normalizeRuntimeSettings,
  publicRuntimeSettings,
  readRuntimeSettings,
  resolveDatabasePath,
  writeRuntimeSettings,
} from '../../../../lib/runtime/settings';
import { testRemoteBackend } from '../../../../lib/runtime/backendProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const originUrl = new URL(origin);
  const requestUrl = new URL(request.url);
  const forwardedHost = String(request.headers.get('x-forwarded-host') || request.headers.get('host') || '').trim();
  const allowedHosts = new Set([requestUrl.host, forwardedHost].filter(Boolean));
  if (!allowedHosts.has(originUrl.host)) throw new Error('Cross-origin settings changes are not allowed');
}

function candidateSettings(input = {}) {
  const previous = readRuntimeSettings();
  return normalizeRuntimeSettings({
    ...input,
    remoteAuthToken: String(input.remoteAuthToken || '').trim() || previous.remoteAuthToken,
    serverApiToken: String(input.serverApiToken || '').trim() || previous.serverApiToken,
  }, previous);
}

function testSqlite(settings) {
  const databasePath = resolveDatabasePath(settings);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const candidate = new Database(databasePath);
  try {
    candidate.pragma('busy_timeout = 5000');
    candidate.prepare('SELECT 1 AS ok').get();
    return { ok: true, database: { path: databasePath, bytes: fs.statSync(databasePath).size } };
  } finally {
    candidate.close();
  }
}

async function inspectRuntime(settings) {
  if (settings.connectionMode === CONNECTION_MODES.REMOTE) {
    try {
      const remote = await testRemoteBackend(settings, { timeoutMs: 4000 });
      return { connection: 'online', remote };
    } catch (error) {
      return { connection: 'offline', error: error.message };
    }
  }
  const { getDatabaseStatus } = await import('../../../../lib/db/sqlite');
  return { connection: 'online', database: getDatabaseStatus() };
}

export async function GET() {
  const settings = readRuntimeSettings();
  return Response.json({
    settings: publicRuntimeSettings(settings),
    status: await inspectRuntime(settings),
  });
}

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const body = await request.json();
    const candidate = assertRuntimeSettings(candidateSettings(body.settings || {}));

    if (body.action === 'test') {
      const result = candidate.connectionMode === CONNECTION_MODES.REMOTE
        ? await testRemoteBackend(candidate)
        : testSqlite(candidate);
      return Response.json({ ok: true, result });
    }

    if (body.action === 'save') {
      if (candidate.connectionMode !== CONNECTION_MODES.REMOTE) testSqlite(candidate);
      const saved = writeRuntimeSettings(body.settings || {});
      if (saved.connectionMode !== CONNECTION_MODES.REMOTE) {
        const { reopenDatabase } = await import('../../../../lib/db/sqlite');
        reopenDatabase();
      }
      return Response.json({
        ok: true,
        settings: publicRuntimeSettings(saved),
        status: await inspectRuntime(saved),
      });
    }

    return Response.json({ error: 'Unknown action. Valid actions: save|test' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
