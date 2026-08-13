/**
 * /api/pipeline/jobs — pipeline job CRUD.
 * GET  ?status=&limit=  → { jobs: listJobs(filter) }   (dashboard polls 3s)
 * POST { action, ... }  → explicit whitelist:
 *   'create' { sourceId, sourceInput, processorIds, uploaderId, options }
 *   'retry'  { jobId }        'cancel' { jobId }
 * Unknown action → 400 + valid list. Validate every id against
 * lib/pipeline/registry.js before touching lib/pipeline/pipeline.js.
 */
import { NextResponse } from 'next/server';
import {
  approveMetadata, bulkJobAction, cancelJob, createJob, createJobBatch, listJobs, retryJob,
} from '../../../../lib/pipeline/pipeline';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  return NextResponse.json({
    jobs: listJobs({
      status: searchParams.get('status') || '',
      limit: searchParams.get('limit') || 100,
    }),
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (body.action === 'create') {
      const job = createJob(body);
      return NextResponse.json({ job });
    }
    if (body.action === 'createBatch') {
      return NextResponse.json({ batch: createJobBatch(body) });
    }
    if (body.action === 'bulkRetry' || body.action === 'bulkCancel') {
      return NextResponse.json({
        results: bulkJobAction(body.action === 'bulkRetry' ? 'retry' : 'cancel', body.jobIds),
      });
    }
    if (body.action === 'retry') {
      return NextResponse.json({ job: retryJob(body.jobId) });
    }
    if (body.action === 'cancel') {
      return NextResponse.json({ job: cancelJob(body.jobId) });
    }
    if (body.action === 'approveMetadata') {
      return NextResponse.json({ job: approveMetadata(body.jobId, body.metadata) });
    }
    return NextResponse.json({ error: 'Unknown action. Valid actions: create|createBatch|retry|cancel|bulkRetry|bulkCancel|approveMetadata' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
