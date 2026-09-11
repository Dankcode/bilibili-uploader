import { withOperator } from '../../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { startAuthorization } from '@/lib/pipeline/notifiers/gmail';
async function handleGET() { try { return NextResponse.json({ url: startAuthorization() }); } catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); } }

export const GET = withOperator(handleGET);
