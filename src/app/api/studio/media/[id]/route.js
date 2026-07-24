import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import { assertProjectFile, getStudioProject, projectDirectory } from '@/lib/studio/store';

const CONTENT_TYPES = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
};

function streamFile(filePath, request, allowRange) {
  const stat = fs.statSync(filePath);
  const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = allowRange ? request.headers.get('range') : null;
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': allowRange ? 'bytes' : 'none' },
  });
}

export async function GET(request, { params }) {
  try {
    const project = getStudioProject(params.id);
    if (!project) return NextResponse.json({ error: 'Studio project not found.' }, { status: 404 });
    const frame = new URL(request.url).searchParams.get('frame');
    const filePath = frame
      ? assertProjectFile(project.id, path.join(projectDirectory(project.id), 'frames', path.basename(frame)))
      : project.videoPath;
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return NextResponse.json({ error: 'Media file not found.' }, { status: 404 });
    return streamFile(filePath, request, !frame);
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not stream media.' }, { status: 400 });
  }
}
