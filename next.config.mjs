import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

export default function nextConfig(phase) {
  return {
    // Keep production builds from invalidating a running dev server's chunks.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
    // Dynamic filesystem helpers otherwise cause Next to trace private working
    // state into deployable bundles. Provision these files on each host instead.
    outputFileTracingExcludes: {
      '*': [
        './config/**/*', './.env*', './.git/**/*', './.venv*/**/*',
        './video-work/**/*', './videos/**/*', './compilation_vids/**/*',
        './**/__pycache__/**/*', './**/.fuse_hidden*',
        './**/*.db', './**/*.db-*', './**/*.sqlite*',
        './*client_secret*.json*', './*_token.json*', './*_token.pickle*',
        './*credentials*.json*', './api_keys.json', './secrets.json', './*secrets*.zip',
        './docs/PLAN-*.md', './docs/SERVER-PREP-*.md',
        './docs/images/subtitle-studio-desktop.png', './docs/images/subtitle-studio-mobile.png',
      ],
    },
    // Renamed from experimental.serverComponentsExternalPackages in Next 15.
    serverExternalPackages: [
      'puppeteer-core',
      'better-sqlite3',
      'ffmpeg-static',
      '@ffprobe-installer/ffprobe',
    ],
  };
}
