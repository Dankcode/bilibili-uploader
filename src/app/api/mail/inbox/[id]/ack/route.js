import { NextResponse } from 'next/server';
import { acknowledgeMailEvent } from '@/lib/mail/store';
export async function POST(_request, { params }) { try { acknowledgeMailEvent(params.id); return NextResponse.json({ ok: true }); } catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); } }
