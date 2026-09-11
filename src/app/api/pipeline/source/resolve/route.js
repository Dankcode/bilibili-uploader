import { withOperator } from '../../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import * as bilibili from '../../../../../lib/pipeline/sources/bilibili.js';
import * as douyin from '../../../../../lib/pipeline/sources/douyin.js';
import * as localFile from '../../../../../lib/pipeline/sources/localFile.js';
import { resolveSourcePreview } from '../../../../../lib/pipeline/sourceResolve.js';

const SOURCES = { bilibili, douyin, localFile };

/**
 * Resolve is deliberately read-only: it normalizes input and fetches public
 * source metadata, but never creates a video, job, asset, or batch record.
 */
async function handlePOST(request) {
  try {
    const { sourceId, sourceInput } = await request.json();
    const source = SOURCES[String(sourceId || '').trim()];
    if (!source) throw new Error(`Source does not support resolving: ${sourceId || 'unknown'}`);
    const items = await resolveSourcePreview(source, sourceInput);
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const POST = withOperator(handlePOST);
