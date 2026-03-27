import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
var ffmpeg = require('fluent-ffmpeg');
var command = ffmpeg();

export async function POST(req) {
  try {
    const videoPath = './VideoAudioMix/2024-09-08.mp4';
    const audioPath = './VideoAudioMix/2024-09-08.m4a';
    const outputPath = path.join('./Videos', `merged-output-${Date.now()}.mp4`);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .addInput(videoPath)
        .addInput(audioPath)
        .outputOptions(
[          '-map 0:v',
          '-map 1:a',
          '-c copy']
        )
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
        // Read the file from disk to send it back as a response
        const fileBuffer = fs.readFileSync(outputPath);

        // Set the headers to indicate that this is a file download
        const headers = new Headers();
        headers.append('Content-Type', 'video/mp4');
        headers.append('Content-Disposition', `attachment; filename=merged-output.mp4`);
    
        return new NextResponse(fileBuffer, { headers });
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json({ error: 'Failed to process the request' }, { status: 500 });
  }
}