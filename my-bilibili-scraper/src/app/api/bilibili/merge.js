'use client'
import { createFFmpeg, fetchFile } from '@ffmpeg/ffmpeg';

const MergeVideoAudio = async () => {
  const ffmpeg = createFFmpeg({ log: true });

  await ffmpeg.load();

  // Fetch a file from the web, and write it to the WASM filesystem
  ffmpeg.FS('writeFile', 'input.mp4', await fetchFile('https://example.com/input.mp4'));

  // Run a conversion
  await ffmpeg.run('-i', 'input.mp4', 'output.avi');

  // Read the converted file from the WASM filesystem
  const data = ffmpeg.FS('readFile', 'output.avi');

  // You can then use this data, for example by creating a URL for it
  const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/avi' }));

  console.log(url);
};

export default MergeVideoAudio();