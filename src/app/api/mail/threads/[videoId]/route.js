import { NextResponse } from 'next/server';
import { listVideoMailTimeline } from '@/lib/mail/store';
export async function GET(_request, { params }) { return NextResponse.json({ events: listVideoMailTimeline(params.videoId) }); }
