import { withOperator } from '../../../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { acknowledgeMailEvent } from '@/lib/mail/store';
async function handlePOST(_request, { params }) { try { acknowledgeMailEvent(params.id); return NextResponse.json({ ok: true }); } catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); } }

export const POST = withOperator(handlePOST);
