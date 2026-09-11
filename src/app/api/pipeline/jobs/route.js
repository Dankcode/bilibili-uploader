import { withOperator } from '../../../../lib/agent/auth.js';
/**
 * /api/pipeline/jobs — pipeline job CRUD.
 * GET  ?status=&limit=  → { jobs: listJobs(filter) }   (dashboard polls 3s)
 * POST { action, ... }  → explicit whitelist:
 *   'create' { sourceId, sourceInput, processorIds, uploaderId, options }
 *   'retry'  { jobId }        'cancel' { jobId }
 * Unknown action → 400 + valid list. Validate every id against
 * lib/pipeline/registry.js before touching lib/pipeline/pipeline.js.
 */
import { NextResponse } from 'next/server.js';
import { withVersion } from '../../../../lib/agent/concurrency.js';
import {
  approveCorrections, approveMetadata, bulkJobAction, cancelJob, createJob, createJobBatch, listJobs, retryJob, updateQueuedJob,
} from '../../../../lib/pipeline/pipeline';

async function handleGET(request) {
  const { searchParams } = new URL(request.url);
  return NextResponse.json({
    jobs: listJobs({
      status: searchParams.get('status') || '',
      limit: searchParams.get('limit') || 100,
    }),
  });
}

async function handlePOST(request) {
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
    if (body.action === 'update') {
      return NextResponse.json({ job: withVersion('video_jobs', 'id = ?', [body.jobId], request.headers.get('if-match'), () => updateQueuedJob(body.jobId, body.patch)) });
    }
    if (body.action === 'approveMetadata') {
      return NextResponse.json({ job: withVersion('video_jobs', 'id = ?', [body.jobId], request.headers.get('if-match'), () => approveMetadata(body.jobId, body.metadata, 'operator')) });
    }
    if (body.action === 'approveCorrections') {
      return NextResponse.json({ job: approveCorrections(body.jobId, body.corrections) });
    }
    return NextResponse.json({ error: 'Unknown action. Valid actions: create|createBatch|update|retry|cancel|bulkRetry|bulkCancel|approveMetadata|approveCorrections' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status || 400 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
