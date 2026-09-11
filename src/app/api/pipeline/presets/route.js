import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { deletePreset, listPresets, savePreset } from '@/lib/pipeline/presets';

async function handleGET() {
  return NextResponse.json({ presets: listPresets() });
}

async function handlePOST(request) {
  try {
    return NextResponse.json({ preset: savePreset(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

async function handleDELETE(request) {
  try {
    const body = await request.json();
    return NextResponse.json({ deleted: deletePreset(body.id) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
export const DELETE = withOperator(handleDELETE);
