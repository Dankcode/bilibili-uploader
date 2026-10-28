/**
 * PIPELINE REGISTRY — single source of truth for the modular video pipeline.
 * — full design in .agent/context.md §F.
 *
 * DESIGN: the app stops being hardcoded "bilibili → YouTube". Every video
 * flows through three adapter slots:
 *
 *   SOURCE (import) ──► PROCESSOR chain (0..n, ordered) ──► UPLOADER (publish)
 *   bilibili, douyin     videoEditor, metadata       youtube (more later)
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

const TEXT_PROVIDER_FIELDS = [
  { key: 'provider', label: 'Text generation provider', type: 'select', required: false, options: [
    { value: '', label: 'Use environment / automatic selection' },
    { value: 'codexCli', label: 'GPT-6.1 Sol · Codex sign-in' },
    { value: 'openai', label: 'OpenAI API' },
    { value: 'codex', label: 'OpenAI API (legacy codex setting)' },
    { value: 'kimi', label: 'Kimi' },
    { value: 'gemini', label: 'Gemini' },
  ] },
  { key: 'codexBin', label: 'Codex executable', type: 'text', required: false, placeholder: 'Automatic detection, or an absolute path' },
  { key: 'codexModel', label: 'Codex text model', type: 'text', required: false, placeholder: 'gpt-6.1-sol' },
  { key: 'codexReasoningEffort', label: 'Codex reasoning effort', type: 'select', required: false, options: [
    { value: '', label: 'Use environment (default: medium)' },
    ...['low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({ value, label: value })),
  ] },
  { key: 'openaiApiKey', label: 'OpenAI API key', type: 'secret', required: false },
  { key: 'openaiModel', label: 'OpenAI API model', type: 'text', required: false, placeholder: 'gpt-6.1-sol' },
];

export const SOURCES = [
  { id: 'library', label: 'Saved library video', credentialFields: [], inputKinds: ['video-record-id'], adapterPath: 'src/lib/pipeline/sources/library.js' },
  {
    id: 'localFile',
    label: 'Local File',
    credentialFields: [],
    inputKinds: ['absolute-path'],
    adapterPath: 'src/lib/pipeline/sources/localFile.js',
  },
  {
    id: 'bilibili',
    label: 'Bilibili',
    // Connections accepts a profile URL and reuses the saved cookie. A missing
    // session is captured once in the app-owned Bilibili browser.
    credentialFields: [],
    inputKinds: ['video-url', 'space-url'],
    adapterPath: 'src/lib/pipeline/sources/bilibili.js',
  },
  {
    id: 'douyin',
    label: 'Douyin (抖音)',
    // Backed by vendor/douyin-downloader (FastAPI sidecar) — see sources/douyin.js.
    credentialFields: [
      { key: 'cookie', label: 'Douyin Cookie', type: 'secret', required: false, pattern: '^[^\\s=;]+=[^\\s;]+(?:;\\s*[^\\s=;]+=[^\\s;]+)*$', example: 'sessionid=…; msToken=…', hint: 'Paste browser cookie pairs only (for example sessionid=…; msToken=…), not a JSON export.' },
      { key: 'sidecarUrl', label: 'Sidecar URL', type: 'text', placeholder: 'http://127.0.0.1:8756', pattern: '^https?://[^\\s/]+(?::\\d+)?(?:/.*)?$', example: 'http://127.0.0.1:8756', hint: 'Use a complete HTTP URL, including its protocol and port.' },
      { key: 'downloadDir', label: 'Sidecar Download Folder', type: 'text', required: false, pattern: '^/[^\\n\\r]*$', example: '/Volumes/media/douyin', hint: 'Use an absolute local folder path without a trailing newline.' },
    ],
    inputKinds: ['video-url', 'user-profile', 'mix-collection', 'music-page'],
    adapterPath: 'src/lib/pipeline/sources/douyin.js',
  },
];

export const PROCESSORS = [
  {
    id: 'videoEditor',
    label: 'Video creation (Video Editor MCP)',
    credentialFields: [
      { key: 'endpoint', label: 'Video Editor MCP URL', type: 'text', required: false, placeholder: 'http://127.0.0.1:4560/mcp', pattern: '^https?://[^\\s]+$', hint: 'Use the video-automation MCP endpoint, including /mcp.' },
      { key: 'apiKey', label: 'Video Editor bearer token', type: 'secret', required: false },
      { key: 'timeoutMs', label: 'Processing timeout (milliseconds)', type: 'text', required: false, placeholder: '21600000' },
    ],
    adapterPath: 'src/lib/pipeline/processors/videoEditor.js',
  },
  {
    id: 'metadata',
    label: 'AI Metadata (title, description, tags)',
    credentialFields: [
      ...TEXT_PROVIDER_FIELDS,
      { key: 'metadataStyle', label: 'Metadata Style', type: 'text', required: false, placeholder: 'professional | educational | asmr' },
      { key: 'kimiApiKey', label: 'Kimi API Key', type: 'secret', required: false, pattern: '^sk-[A-Za-z0-9_-]{12,}$', example: 'sk-…', hint: 'Kimi keys start with sk-. Check that an OpenAI or Gemini key was not pasted here.' },
      { key: 'kimiModel', label: 'Kimi Model', type: 'text', required: false, placeholder: 'moonshot-v1-32k' },
      { key: 'geminiApiKey', label: 'Gemini API Key', type: 'secret', required: false },
      { key: 'geminiModel', label: 'Gemini Model', type: 'text', required: false, placeholder: 'gemini-2.0-flash' },
    ],
    adapterPath: 'src/lib/pipeline/processors/metadata.js',
  },
];

export const UPLOADERS = [
  {
    id: 'youtube',
    label: 'YouTube',
    // Adapter WRAPS the existing lib/video/uploader.js (python api/pygui
    // uploaders) — it already works; the adapter adds testConnection + the
    // uniform contract. Per-job OAuth identity is resolved through
    // youtube_authorizations; SQL stores only a local credential reference.
    credentialFields: [],
    adapterPath: 'src/lib/pipeline/uploaders/youtube.js',
  },
  // FUTURE: tiktok, instagram-reels — entry + adapter file each.
];

export const NOTIFIERS = [
  {
    id: 'gmail', label: 'Gmail (tracking + inbox)',
    credentialFields: [
      { key: 'clientId', label: 'Google OAuth Client ID', type: 'text' },
      { key: 'clientSecret', label: 'Google OAuth Client Secret', type: 'secret' },
      { key: 'redirectUri', label: 'OAuth Redirect URI', type: 'text', required: false, placeholder: 'http://localhost:4455/api/mail/oauth/callback' },
      { key: 'labelPrefix', label: 'Root Label', type: 'text', required: false, placeholder: 'Studio' },
      { key: 'ingestEnabled', label: 'Ingest inbound mail (on/off)', type: 'text', required: false, placeholder: 'on' },
      { key: 'syncIntervalMinutes', label: 'Inbox sync interval (minutes)', type: 'text', required: false, placeholder: '15' },
    ],
    adapterPath: 'src/lib/pipeline/notifiers/gmail.js',
  },
];

export function getSource(id) { return SOURCES.find((s) => s.id === id) || null; }
export function getProcessor(id) { return PROCESSORS.find((p) => p.id === id) || null; }
export function getUploader(id) { return UPLOADERS.find((u) => u.id === id) || null; }

export const PROCESSOR_ORDER = ['videoEditor', 'metadata'];

export const PROCESSOR_REQUIRES = {};

export function validateProcessorChain(processorIds = []) {
  const ids = Array.isArray(processorIds) ? processorIds.map(String) : [];
  const errors = [];
  const seen = new Set();
  let lastOrder = -1;
  for (const id of ids) {
    if (!getProcessor(id)) {
      errors.push(`Unknown processor "${id}". Video processing moved to videoEditor (Video Editor MCP); update this workflow.`);
      continue;
    }
    if (seen.has(id)) errors.push(`Processor "${id}" appears more than once.`);
    for (const dependency of PROCESSOR_REQUIRES[id] || []) {
      if (!seen.has(dependency)) errors.push(`${id} requires ${dependency} to run earlier.`);
    }
    const order = PROCESSOR_ORDER.indexOf(id);
    if (order >= 0 && order < lastOrder) {
      const previous = ids[Math.max(0, ids.indexOf(id) - 1)];
      errors.push(`${id} must run before ${previous}.`);
    }
    lastOrder = Math.max(lastOrder, order);
    seen.add(id);
  }
  const normalized = [...ids].sort((left, right) => PROCESSOR_ORDER.indexOf(left) - PROCESSOR_ORDER.indexOf(right));
  return { ok: errors.length === 0, errors, normalized };
}

/**
 * Settings checklist rows for every adapter. Merged with service_connections rows
 * (lib/pipeline/connections.js). View model:
 *   [{ id, role, label, configured, tested, enabled, authState, checkedAt,
 *      lastError }]
 */
export function listServiceChecklist(connections = []) {
  const all = [
    ...SOURCES.map((e) => ({ ...e, role: 'source' })),
    ...PROCESSORS.map((e) => ({ ...e, role: 'processor' })),
    ...UPLOADERS.map((e) => ({ ...e, role: 'uploader' })),
    ...NOTIFIERS.map((e) => ({ ...e, role: 'notifier' })),
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
      authState: conn?.authState || 'unknown',
      checkedAt: conn?.checkedAt || '',
      lastError: conn?.lastError || '',
    };
  });
}
