import { NextResponse } from 'next/server';
import { listMailAccounts, registerMailAccount, setMailAccountEnabled } from '@/lib/mail/store';

export async function GET() { return NextResponse.json({ accounts: listMailAccounts() }); }
export async function POST(request) { try { return NextResponse.json({ account: registerMailAccount(await request.json()) }); } catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); } }
export async function PATCH(request) { try { const body = await request.json(); return NextResponse.json({ account: setMailAccountEnabled(body.id, Boolean(body.enabled)) }); } catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); } }
