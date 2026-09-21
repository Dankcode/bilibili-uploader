import { withOperator } from '../../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { listVideoMailTimeline } from '@/lib/mail/store';
async function handleGET(_request, { params: paramsPromise }) { const params = await paramsPromise; return NextResponse.json({ events: listVideoMailTimeline(params.videoId) }); }

export const GET = withOperator(handleGET);
