import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import { probeVideo } from '@/lib/media/validation';

export const runtime = 'nodejs';

export async function POST(request) {
  let destination = '';
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.stream !== 'function') throw new Error('A video file is required');
    const extension = path.extname(file.name || '').toLowerCase();
    if (!['.mp4', '.mov', '.mkv', '.webm', '.m4v'].includes(extension)) throw new Error(`Unsupported video format: ${extension || 'unknown'}`);
    const inbox = path.join(process.cwd(), process.env.VIDEO_WORK_DIR || 'video-work', 'inbox');
    fs.mkdirSync(inbox, { recursive: true });
    const safeName = path.basename(file.name, extension).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 100) || 'video';
    destination = path.join(inbox, `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}${extension}`);
    await pipeline(Readable.fromWeb(file.stream()), fs.createWriteStream(destination, { flags: 'wx' }));
    const probe = await probeVideo(destination);
    return NextResponse.json({ file: { name: file.name, path: destination, probe } });
  } catch (error) {
    if (destination && fs.existsSync(destination)) fs.unlinkSync(destination);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
