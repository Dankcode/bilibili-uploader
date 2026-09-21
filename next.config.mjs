import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

export default function nextConfig(phase) {
  return {
    // Keep production builds from invalidating a running dev server's chunks.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
    // Renamed from experimental.serverComponentsExternalPackages in Next 15.
    serverExternalPackages: [
      'onnxruntime-node',
      'better-sqlite3',
      'ffmpeg-static',
      '@ffprobe-installer/ffprobe',
      'fluent-ffmpeg',
    ],
  };
}
