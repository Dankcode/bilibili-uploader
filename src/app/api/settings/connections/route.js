import { withOperator } from '../../../../lib/agent/auth.js';
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
import { refreshBilibiliLoginStatus, startBilibiliLogin } from '../../../../lib/video/bilibili';
import { confirmYouTubeAuthorization, getYouTubeAuthorizationStatus, startDefaultYouTubeAuthorization, startYouTubeAuthorization } from '../../../../lib/youtube/oauth';

async function handleGET() {
  const connections = listConnections();
  const checklist = listServiceChecklist(connections).map((row) => {
    const connection = connections.find((entry) => entry.serviceId === row.id);
    return {
      ...row,
      credentialFields: connection?.credentialFields || [],
      status: connection?.status || 'untested',
      authState: connection?.authState || 'unknown',
      checkedAt: connection?.checkedAt || '',
      lastTestedAt: connection?.lastTestedAt || '',
      defaults: connection?.preferences || {},
    };
  });
  return NextResponse.json({ checklist });
}

async function handlePOST(request) {
  try {
    const body = await request.json();
    if (body.action === 'bilibili-login-start') {
      return NextResponse.json({ bilibiliLogin: await startBilibiliLogin() });
    }
    if (body.action === 'bilibili-login-status') {
      return NextResponse.json({ bilibiliLogin: await refreshBilibiliLoginStatus() });
    }
    if (body.action === 'youtube-login-start') {
      return NextResponse.json({ youtubeAuthorization: startYouTubeAuthorization({
        clientRef: body.clientRef, credentialRef: body.credentialRef, expectedEmail: body.expectedEmail,
      }) });
    }
    if (body.action === 'youtube-login-start-default') {
      return NextResponse.json({ youtubeAuthorization: startDefaultYouTubeAuthorization({
        expectedEmail: body.expectedEmail,
      }) });
    }
    if (body.action === 'youtube-login-status') {
      return NextResponse.json({ youtubeAuthorization: getYouTubeAuthorizationStatus(body.credentialRef) });
    }
    if (body.action === 'youtube-login-confirm') {
      return NextResponse.json({ youtubeAuthorization: confirmYouTubeAuthorization({ credentialRef: body.credentialRef, channelId: body.channelId }) });
    }
    if (body.action === 'save') {
      return NextResponse.json({ connection: saveConnection(body.serviceId, body.credentials || {}) });
    }
    if (body.action === 'test') {
      return NextResponse.json({ connection: await testService(body.serviceId, body.credentials || {}) });
    }
    if (body.action === 'enable') {
      return NextResponse.json({ connection: setConnectionEnabled(body.serviceId, Boolean(body.enabled)) });
    }
    return NextResponse.json({ error: 'Unknown action. Valid actions: save|test|enable|bilibili-login-start|bilibili-login-status|youtube-login-start-default|youtube-login-start|youtube-login-status|youtube-login-confirm' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
