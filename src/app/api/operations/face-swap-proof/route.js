import { withOperator } from '../../../../lib/agent/auth.js';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import { getLatestFaceSwapProof } from '@/lib/operations/store';

export const dynamic = 'force-dynamic';

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function streamFile(filePath, request) {
  const stat = fs.statSync(filePath);
  const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = request.headers.get('range');
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!match || start < 0 || end < start || start >= stat.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' },
  });
}

async function handleGET(request) {
  try {
    const proof = getLatestFaceSwapProof();
    if (!proof) return NextResponse.json({ proof: null });
    const kind = new URL(request.url).searchParams.get('media');
    if (!kind) return NextResponse.json({ proof });
    const filePath = ({
      source: proof.sourceImagePath,
      target: proof.targetVideoPath,
      output: proof.outputVideoPath,
      before: proof.validation?.beforeFramePath,
      after: proof.validation?.afterFramePath,
    })[kind];
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return NextResponse.json({ error: 'Proof media not found' }, { status: 404 });
    }
    return streamFile(filePath, request);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const GET = withOperator(handleGET);
