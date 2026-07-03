import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

const loginDir = path.join(process.cwd(), 'config', 'scraper-logins');

function loginPath(siteId) {
  return path.join(loginDir, `${String(siteId || '').replace(/[^\w:-]+/g, '_')}.json`);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const siteId = String(body.siteId || '').trim();
    if (!siteId && body.action !== 'poll') throw new Error('siteId is required');
    if (body.action === 'status') {
      return NextResponse.json({ loggedIn: fs.existsSync(loginPath(siteId)) });
    }
    if (body.action === 'import-cookie') {
      if (!body.cookieOrState) throw new Error('cookieOrState is required');
      fs.mkdirSync(loginDir, { recursive: true });
      fs.writeFileSync(loginPath(siteId), JSON.stringify({
        siteId,
        importedAt: new Date().toISOString(),
        cookieOrState: String(body.cookieOrState),
      }, null, 2));
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'start') {
      return NextResponse.json(
        { error: 'Interactive Playwright login is not enabled yet. Use import-cookie for this site.' },
        { status: 409 }
      );
    }
    if (body.action === 'poll') {
      return NextResponse.json({ status: 'waiting' });
    }
    return NextResponse.json({ error: 'Unknown action. Valid actions: start|poll|import-cookie|status' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
