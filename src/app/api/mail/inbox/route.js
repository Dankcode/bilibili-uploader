import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { listMailInbox } from '@/lib/mail/store';
async function handleGET(request) { const params = new URL(request.url).searchParams; return NextResponse.json({ events: listMailInbox({ severity: params.get('severity') || '', unacknowledged: params.get('unacknowledged') === '1', unmatched: params.get('unmatched') === '1', limit: params.get('limit') || 100 }) }); }

export const GET = withOperator(handleGET);
