import { NextResponse } from 'next/server';
import { getVideoProcessGraph } from '@/lib/operations/store';

export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  try {
    const payload = getVideoProcessGraph(params.id);
    if (!payload) return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
