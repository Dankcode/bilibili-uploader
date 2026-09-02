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
    id: 'localFile',
    label: 'Local File',
    credentialFields: [],
    inputKinds: ['absolute-path'],
    adapterPath: 'src/lib/pipeline/sources/localFile.js',
  },
  {
    id: 'bilibili',
    label: 'Bilibili',
    // Login is captured by a visible Playwright session and stored locally in
    // config/storage.json; the SESSDATA cookie is never typed into the app.
    credentialFields: [],
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
    id: 'videoContext',
    label: 'Video Context Builder (transcript + synchronized frames)',
    credentialFields: [
      { key: 'sttBackend', label: 'STT Backend', type: 'text', required: false, placeholder: 'localWhisper | openaiWhisper' },
      { key: 'sttQuality', label: 'Local STT Quality', type: 'text', required: false, placeholder: 'fast | balanced | best' },
      { key: 'transcribeApiKey', label: 'Whisper API Key', type: 'secret', required: false },
      { key: 'transcribeBaseUrl', label: 'Whisper Base URL', type: 'text', required: false },
      { key: 'transcribeModel', label: 'Whisper Model', type: 'text', required: false },
      { key: 'visionBackend', label: 'Vision Backend', type: 'text', required: false, placeholder: 'gemini | codex | kimiVision' },
      { key: 'visionFallback', label: 'Vision Fallback Order', type: 'text', required: false, placeholder: 'gemini,codex,kimiVision' },
      { key: 'geminiApiKey', label: 'Gemini API Key', type: 'secret', required: false },
      { key: 'geminiVisionModel', label: 'Gemini Vision Model', type: 'text', required: false, placeholder: 'gemini-2.0-flash' },
      { key: 'codexBin', label: 'Codex CLI Binary', type: 'text', required: false, placeholder: 'codex' },
      { key: 'codexModel', label: 'Codex Model', type: 'text', required: false },
    ],
    adapterPath: 'src/lib/pipeline/processors/videoContext.js',
  },
  {
    id: 'ocrContext',
    label: 'On-screen Text OCR (local, dense sampling)',
    credentialFields: [
      { key: 'ocrBackend', label: 'OCR Backend', type: 'text', required: false, placeholder: 'rapidocr' },
      { key: 'pythonBin', label: 'Python Binary', type: 'text', required: false },
      { key: 'ocrLangs', label: 'OCR Languages', type: 'text', required: false, placeholder: 'ch,en' },
    ],
    adapterPath: 'src/lib/pipeline/processors/ocrContext.js',
  },
  {
    id: 'voiceover',
    label: 'AI Voiceover (Whisper → translate → Kimi re-script → TTS)',
    // Automated dub: transcribe → translate (+transliterate) → Kimi re-script →
    // ElevenLabs OR CosyVoice(local) TTS → ffmpeg duck+overlay. Server-side.
    // Only the fields for the chosen tts/translation backend need filling.
    credentialFields: [
      // -- transcription --
      { key: 'sttBackend', label: 'STT Backend', type: 'text', required: false, placeholder: 'openaiWhisper | localWhisper' },
      { key: 'sttQuality', label: 'Local STT Quality', type: 'text', required: false, placeholder: 'fast | balanced | best' },
      { key: 'transcribeApiKey', label: 'Whisper API Key (OpenAI-compatible)', type: 'secret', required: false },
      { key: 'transcribeBaseUrl', label: 'Whisper Base URL', type: 'text', required: false, placeholder: 'https://api.openai.com/v1 (or Groq / self-hosted)' },
      { key: 'transcribeModel', label: 'Whisper Model', type: 'text', required: false, placeholder: 'whisper-1' },
      // -- translation + re-scripting --
      { key: 'translationBackend', label: 'Translation Backend', type: 'text', required: false, placeholder: 'aiProvider | liveTranslation | googleFree | gemini' },
      { key: 'geminiApiKey', label: 'Gemini API Key', type: 'secret', required: false },
      { key: 'geminiModel', label: 'Gemini Model', type: 'text', required: false, placeholder: 'gemini-1.5-flash' },
      { key: 'geminiRefine', label: 'Gemini Refine (on/off)', type: 'text', required: false, placeholder: 'off' },
      { key: 'rescript', label: 'Kimi Re-script (on/off)', type: 'text', required: false, placeholder: 'on' },
      { key: 'rescriptStyle', label: 'Re-script Voice/Style', type: 'text', required: false, placeholder: 'e.g. calm, documentary narrator' },
      // -- tts selection --
      { key: 'ttsBackend', label: 'TTS Backend', type: 'text', required: false, placeholder: 'elevenlabs | cosyvoice | qwen3' },
      // -- elevenlabs --
      { key: 'elevenApiKey', label: 'ElevenLabs API Key', type: 'secret', required: false },
      { key: 'voiceId', label: 'ElevenLabs Voice ID', type: 'text', required: false },
      { key: 'modelId', label: 'ElevenLabs Model', type: 'text', required: false, placeholder: 'eleven_multilingual_v2' },
      // -- cosyvoice (Alibaba, local) --
      { key: 'cosyEndpoint', label: 'CosyVoice Endpoint (local)', type: 'text', required: false, placeholder: 'http://127.0.0.1:50000' },
      { key: 'cosyMode', label: 'CosyVoice Mode', type: 'text', required: false, placeholder: 'zero_shot | sft | cross_lingual | instruct' },
      { key: 'cosySpeakerId', label: 'CosyVoice Speaker (sft)', type: 'text', required: false },
      { key: 'cosyPromptWav', label: 'CosyVoice Reference WAV path (zero_shot)', type: 'text', required: false },
      { key: 'cosyPromptText', label: 'CosyVoice Reference Transcript', type: 'text', required: false },
      // -- qwen3-tts (Alibaba: DashScope cloud OR local server) --
      { key: 'qwenApiKey', label: 'Qwen3-TTS DashScope API Key', type: 'secret', required: false },
      { key: 'qwenVoice', label: 'Qwen3-TTS Voice', type: 'text', required: false, placeholder: 'Cherry / Ethan / Serena …' },
      { key: 'qwenModel', label: 'Qwen3-TTS Model', type: 'text', required: false, placeholder: 'qwen3-tts-flash' },
      { key: 'qwenBaseUrl', label: 'DashScope Base URL', type: 'text', required: false, placeholder: 'https://dashscope-intl.aliyuncs.com for intl' },
      { key: 'qwenLocalEndpoint', label: 'Qwen3-TTS Local Server (optional)', type: 'text', required: false, placeholder: 'http://127.0.0.1:8000' },
      { key: 'maxDailySeconds', label: 'Daily API Cap (seconds)', type: 'text', required: false, placeholder: '21600' },
    ],
    adapterPath: 'src/lib/pipeline/processors/voiceover.js',
  },
  {
    id: 'faceFusion',
    label: 'FaceFusion (automated targeted face swap)',
    // Wraps the FaceFusion headless CLI. Install the isolated runtime once.
    credentialFields: [
      { key: 'facefusionDir', label: 'FaceFusion Repo Path', type: 'text', placeholder: '/path/to/facefusion' },
      { key: 'sourcePaths', label: 'Replacement Face Image(s) — ; separated', type: 'text' },
      { key: 'pythonBin', label: 'Python Binary', type: 'text', required: false, placeholder: '/path/to/facefusion/.venv/bin/python' },
      { key: 'executionProviders', label: 'Execution Provider', type: 'text', required: false, placeholder: 'auto | cpu | coreml | cuda' },
      { key: 'downloadProviders', label: 'Model Download Providers', type: 'text', required: false, placeholder: 'huggingface github' },
      { key: 'faceSwapperModel', label: 'Face Swapper Model', type: 'text', required: false, placeholder: 'inswapper_128_fp16' },
      { key: 'faceEnhancer', label: 'Face Enhancer (on/off)', type: 'text', required: false, placeholder: 'off' },
      { key: 'faceSelectorMode', label: 'Face Selector Mode', type: 'text', required: false, placeholder: 'reference | one | many' },
      { key: 'faceSelectorGender', label: 'Target Gender (optional)', type: 'text', required: false, placeholder: 'male | female' },
      { key: 'referenceFacePosition', label: 'Reference Face Position', type: 'text', required: false, placeholder: '0' },
      { key: 'referenceFaceDistance', label: 'Reference Face Distance', type: 'text', required: false, placeholder: '0.6' },
      { key: 'referenceFrameNumber', label: 'Reference Frame Number', type: 'text', required: false, placeholder: '0' },
    ],
    adapterPath: 'src/lib/pipeline/processors/faceFusion.js',
  },
  {
    id: 'metadata',
    label: 'AI Metadata (title, description, tags)',
    credentialFields: [
      { key: 'provider', label: 'Primary Provider', type: 'text', required: false, placeholder: 'kimi | codex | gemini' },
      { key: 'metadataStyle', label: 'Metadata Style', type: 'text', required: false, placeholder: 'professional | educational | asmr' },
      { key: 'kimiApiKey', label: 'Kimi API Key', type: 'secret', required: false },
      { key: 'kimiModel', label: 'Kimi Model', type: 'text', required: false, placeholder: 'moonshot-v1-32k' },
      { key: 'geminiApiKey', label: 'Gemini API Key', type: 'secret', required: false },
      { key: 'geminiModel', label: 'Gemini Model', type: 'text', required: false, placeholder: 'gemini-2.0-flash' },
    ],
    adapterPath: 'src/lib/pipeline/processors/metadata.js',
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
    adapterPath: 'src/lib/pipeline/processors/sceneCut.js',
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

export const PROCESSOR_ORDER = [
  'sceneCut', 'faceFusion', 'videoContext', 'ocrContext', 'voiceover', 'metadata', 'aiEditor',
];

export const PROCESSOR_REQUIRES = {
  ocrContext: ['videoContext'],
};

export function validateProcessorChain(processorIds = []) {
  const ids = Array.isArray(processorIds) ? processorIds.map(String) : [];
  const errors = [];
  const seen = new Set();
  let lastOrder = -1;
  for (const id of ids) {
    if (!getProcessor(id)) {
      errors.push(`Unknown processor "${id}".`);
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
      lastError: conn?.lastError || '',
    };
  });
}
