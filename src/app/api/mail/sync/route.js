import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { getMailAccount } from '@/lib/mail/store';
import { syncMailAccount } from '@/lib/mail/worker';
async function handlePOST(request) { try { const { accountId } = await request.json(); const account = getMailAccount(accountId); return NextResponse.json({ synced: await syncMailAccount(account), account }); } catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); } }

export const POST = withOperator(handlePOST);
