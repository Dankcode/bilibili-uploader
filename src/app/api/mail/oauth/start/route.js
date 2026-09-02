import { NextResponse } from 'next/server';
import { startAuthorization } from '@/lib/pipeline/notifiers/gmail';
export async function GET() { try { return NextResponse.json({ url: startAuthorization() }); } catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); } }
