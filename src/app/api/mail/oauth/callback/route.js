import { withOperator } from '../../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { completeAuthorization } from '@/lib/pipeline/notifiers/gmail';
async function handleGET(request) { try { const { searchParams } = new URL(request.url); const account = await completeAuthorization({ code: searchParams.get('code'), state: searchParams.get('state') }); return NextResponse.redirect(new URL(`/?mail=connected&account=${encodeURIComponent(account.emailAddress)}`, request.url)); } catch (error) { return NextResponse.redirect(new URL(`/?mail=error&reason=${encodeURIComponent(error.message)}`, request.url)); } }

export const GET = withOperator(handleGET);
