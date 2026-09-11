import { withOperator } from '../../../../../lib/agent/auth.js';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import db from '../../../../../lib/db/sqlite';

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.srt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function handleGET(_request, { params }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid asset id' }, { status: 400 });
  }

  const asset = db.prepare('SELECT * FROM video_assets WHERE id = ?').get(id);
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  if (/^https?:\/\//i.test(asset.file_path || '')) {
    return NextResponse.json({ id, kind: asset.kind, url: asset.file_path });
  }

  const workRoot = path.resolve(process.cwd(), process.env.VIDEO_WORK_DIR || 'video-work');
  const filePath = path.resolve(asset.file_path || '');
  if (!isInside(workRoot, filePath)) {
    return NextResponse.json({ error: 'Asset is outside the previewable work directory' }, { status: 403 });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return NextResponse.json({ error: 'Asset file is missing' }, { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const stream = Readable.toWeb(fs.createReadStream(filePath));
  return new Response(stream, {
    headers: {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="${path.basename(filePath).replace(/"/g, '')}"`,
    },
  });
}

export const GET = withOperator(handleGET);
