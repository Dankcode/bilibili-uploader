import { NextResponse } from 'next/server';
import { withOperator } from '../../../../lib/agent/auth.js';
import { queueLibraryUploads } from '../../../../lib/operations/libraryUpload.js';

export const POST = withOperator(async (request) => {
  try { return NextResponse.json({ batch: queueLibraryUploads(await request.json()) }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
});
