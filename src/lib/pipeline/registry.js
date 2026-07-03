/**
 * PIPELINE REGISTRY — single source of truth for the modular video pipeline.
 * — full design in .agent/context.md §F.
 *
 * DESIGN: the app stops being hardcoded "bilibili → YouTube". Every video
 * flows through three adapter slots:
 *
 *   SOURCE (import) ──► PROCESSOR chain (0..n, ordered) ──► UPLOADER (publish)
 *   bilibili, douyin     voiceover, aiEditor, sceneCut       youtube (more later)
 *
 * A pipeline job is pure data { sourceId, sourceInput, processorIds[],
 * uploaderId, options } persisted in config/bilibili.db (lib/pipeline/pipeline.js).
 * Adding a platform = one registry entry + one adapter file. The EXISTING
 * WorkflowService flow becomes just one preset: source:bilibili → uploader:youtube.
 *
 * ADAPTER CONTRACTS (every adapter file exports):
 *   Source:    { id, testConnection(creds), resolveInput(urlOrId) -> {items[]},
 *                download(item, destDir, onProgress) -> { filePath, meta } }
 *   Processor: { id, testConnection(creds), process(inputPath, options, onProgress)
 *                -> { outputPath, artifacts } }
 *   Uploader:  { id, testConnection(creds), upload(filePath, meta, onProgress)
 *                -> { remoteId, url } }
 */

export const SOURCES = [
  {
    id: 'bilibili',
    label: 'Bilibili',
    // Adapter WRAPS the existing working code: lib/video/scraper.js (space
    // pages via puppeteer) + lib/video/bilibili.js processBilibiliUrl (download).
    credentialFields: [{ key: 'sessdata', label: 'SESSDATA Cookie (for HD)', type: 'secret' }],
    inputKinds: ['video-url', 'space-url'],
    adapterPath: 'src/lib/pipeline/sources/bilibili.js',
  },
  {
    id: 'douyin',
    label: 'Douyin (抖音)',
    // Backed by vendor/douyin-downloader (FastAPI sidecar) — see sources/douyin.js.
    credentialFields: [
      { key: 'cookie', label: 'Douyin Cookie', type: 'secret' },
      { key: 'sidecarUrl', label: 'Sidecar URL', type: 'text', placeholder: 'http://127.0.0.1:8756' },
      { key: 'downloadDir', label: 'Sidecar Download Folder', type: 'text', required: false },
    ],
    inputKinds: ['video-url', 'user-profile', 'mix-collection', 'music-page'],
    adapterPath: 'src/lib/pipeline/sources/douyin.js',
  },
];

export const PROCESSORS = [
  {
    id: 'voiceover',
    label: 'English Voiceover (Whisper clone)',
    credentialFields: [
      { key: 'endpoint', label: 'Voice Service URL (LAN)', type: 'text', placeholder: 'http://192.168.x.x:9000' },
      { key: 'voiceId', label: 'Cloned Voice ID', type: 'text' },
      { key: 'apiKey', label: 'API Key (optional)', type: 'secret' },
    ],
    adapterPath: 'src/lib/pipeline/processors/voiceover.js',
  },
  {
    id: 'aiEditor',
    label: 'AI Video Editor (HuggingFace LAN)',
    credentialFields: [
      { key: 'endpoint', label: 'HF Editor URL (LAN)', type: 'text', placeholder: 'http://192.168.x.x:7860' },
      { key: 'defaultModel', label: 'Default Model', type: 'text', placeholder: 'e.g. Lightricks/LTX-Video' },
      { key: 'apiKey', label: 'API Key (optional)', type: 'secret' },
    ],
    adapterPath: 'src/lib/pipeline/processors/aiEditor.js',
  },
  {
    id: 'sceneCut',
    label: 'Scene Snippet Cutter',
    // fluent-ffmpeg (already a dep) cut+concat driven by SceneScript beats.
    credentialFields: [],
    adapterPath: 'src/lib/pipeline/processors/sceneCut.js', // TODO create at impl
  },
];

export const UPLOADERS = [
  {
    id: 'youtube',
    label: 'YouTube',
    // Adapter WRAPS the existing lib/video/uploader.js (python api/pygui
    // uploaders) — it already works; the adapter adds testConnection + the
    // uniform contract. channelId comes from the existing youtube_channels table.
    credentialFields: [], // creds live in scripts/python OAuth files today; migrate later 📋
    adapterPath: 'src/lib/pipeline/uploaders/youtube.js',
  },
  // FUTURE: tiktok, instagram-reels — entry + adapter file each.
];

export function getSource(id) { return SOURCES.find((s) => s.id === id) || null; }
export function getProcessor(id) { return PROCESSORS.find((p) => p.id === id) || null; }
export function getUploader(id) { return UPLOADERS.find((u) => u.id === id) || null; }

/**
 * Settings-CRM checklist rows for every adapter + scraper sites (scenes/scraper.js
 * SCRAPER_SITES appended by the caller). Merged with service_connections rows
 * (lib/pipeline/connections.js). View model:
 *   [{ id, role, label, configured, tested, enabled, lastError }]
 */
export function listServiceChecklist(connections = []) {
  const all = [
    ...SOURCES.map((e) => ({ ...e, role: 'source' })),
    ...PROCESSORS.map((e) => ({ ...e, role: 'processor' })),
    ...UPLOADERS.map((e) => ({ ...e, role: 'uploader' })),
  ];
  const byId = new Map(connections.map((row) => [row.serviceId, row]));
  return all.map((entry) => {
    const conn = byId.get(entry.id);
    return {
      id: entry.id,
      role: entry.role,
      label: entry.label,
      configured: Boolean(conn?.configured),
      tested: conn?.status === 'ok',
      enabled: Boolean(conn?.enabled && conn?.status === 'ok'),
      lastError: conn?.lastError || '',
    };
  });
}
