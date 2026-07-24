import { NextResponse } from 'next/server';
import { deletePreset, listPresets, savePreset } from '@/lib/pipeline/presets';

export async function GET() {
  return NextResponse.json({ presets: listPresets() });
}

export async function POST(request) {
  try {
    return NextResponse.json({ preset: savePreset(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();
    return NextResponse.json({ deleted: deletePreset(body.id) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
