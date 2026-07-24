/**
 * /api/settings/connections — the settings CRM backend.
 * GET → { checklist: [...listServiceChecklist(listConnections()),
 *                     ...scraper site rows from SCRAPER_SITES] }
 * POST { action, serviceId, ... } whitelist:
 *   'save'   { credentials }   → saveConnection (merge; never wipe unspecified keys)
 *   'test'   {}                → testService → { status, lastError }
 *   'enable' { enabled }       → only allowed when status === 'ok'
 * Secrets never returned; checklist rows carry booleans only.
 */
import { NextResponse } from 'next/server';
import { listServiceChecklist } from '../../../../lib/pipeline/registry';
import { listConnections, saveConnection, testService, setConnectionEnabled } from '../../../../lib/pipeline/connections';

export async function GET() {
  const connections = listConnections();
  const checklist = listServiceChecklist(connections).map((row) => {
    const connection = connections.find((entry) => entry.serviceId === row.id);
    return {
      ...row,
      credentialFields: connection?.credentialFields || [],
      status: connection?.status || 'untested',
      lastTestedAt: connection?.lastTestedAt || '',
      defaults: connection?.preferences || {},
    };
  });
  return NextResponse.json({ checklist });
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (body.action === 'save') {
      return NextResponse.json({ connection: saveConnection(body.serviceId, body.credentials || {}) });
    }
    if (body.action === 'test') {
      return NextResponse.json({ connection: await testService(body.serviceId) });
    }
    if (body.action === 'enable') {
      return NextResponse.json({ connection: setConnectionEnabled(body.serviceId, Boolean(body.enabled)) });
    }
    return NextResponse.json({ error: 'Unknown action. Valid actions: save|test|enable' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
