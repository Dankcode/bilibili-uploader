import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { listMailAccounts, registerMailAccount, setMailAccountEnabled } from '@/lib/mail/store';

async function handleGET() { return NextResponse.json({ accounts: listMailAccounts() }); }
async function handlePOST(request) { try { return NextResponse.json({ account: registerMailAccount(await request.json()) }); } catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); } }
async function handlePATCH(request) { try { const body = await request.json(); return NextResponse.json({ account: setMailAccountEnabled(body.id, Boolean(body.enabled)) }); } catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); } }

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
export const PATCH = withOperator(handlePATCH);
