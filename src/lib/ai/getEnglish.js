const OpenAI = require("openai");

const PROVIDERS = {
  codex: {
    apiKeyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-5.5",
  },
  kimi: {
    apiKeyEnv: "KIMI_API_KEY",
    modelEnv: "KIMI_MODEL",
    defaultModel: "moonshot-v1-8k",
    baseURL: process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1",
  },
};

function getProviderConfig(overrideProvider) {
  const providerName = (overrideProvider || process.env.AI_PROVIDER || "codex").toLowerCase();
  const provider = PROVIDERS[providerName];

  if (!provider) {
    throw new Error(`Unsupported AI provider "${providerName}". Use "codex" or "kimi".`);
  }

  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing ${provider.apiKeyEnv} for provider "${providerName}".`);
  }

  return {
    providerName,
    apiKey,
    baseURL: provider.baseURL,
    model: process.env[provider.modelEnv] || provider.defaultModel,
  };
}

/** True when a specific provider is usable (key present). */
function hasProvider(name) {
  const provider = PROVIDERS[String(name || "").toLowerCase()];
  return Boolean(provider && process.env[provider.apiKeyEnv]);
}

function createClient(config) {
  return new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
}

function buildMetadataPrompt(chineseName, chineseDesc) {
  return `Create YouTube metadata for an English-speaking ASMR audience from this Chinese source material.

Return only valid JSON with this exact shape:
{
  "Title": "short translated English YouTube title",
  "Description": "warm first-person English description",
  "Tags": ["tag one", "tag two"]
}

Rules:
- Keep the title concise and natural for YouTube.
- Write the description as one independent ASMR creator.
- Keep the tone calm, casual, and sleep-focused.
- Do not include hashtags in the title.
- Return exactly 10 English tags.

Chinese title:
${chineseName}

Reference description:
${chineseDesc || ""}`;
}

async function getEnglishData(chineseName, chineseDesc) {
  const config = getProviderConfig();
  const client = createClient(config);

  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "You generate concise, safe YouTube metadata and return valid JSON only.",
        },
        {
          role: "user",
          content: buildMetadataPrompt(chineseName, chineseDesc),
        },
      ],
      temperature: 0.3,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`No AI metadata returned from ${config.providerName}.`);
    }

    return content;
  } catch (error) {
    console.error(`Error creating ${config.providerName} completion:`, error);
    throw error;
  }
}

/**
 * Robust JSON extraction from an LLM response. Strips ```json fences and any
 * prose around the object/array before parsing (fixes debug report B1 — bare
 * JSON.parse on model output throws mid-pipeline).
 */
function parseAiJson(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("AI response was not valid JSON.");
  }
}

/**
 * Generic "return me JSON" completion used by the pipeline (voiceover, scenes).
 * Retries once on a parse failure before giving up loudly.
 */
async function completeJson(prompt, { system = "Return valid JSON only.", temperature = 0.2, provider } = {}) {
  const config = getProviderConfig(provider);
  const client = createClient(config);
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const completion = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature,
    });
    const content = completion.choices?.[0]?.message?.content;
    try {
      return parseAiJson(content);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("completeJson failed.");
}

/**
 * AI-provider translation backend for the voiceover pipeline.
 * Translates timestamped source segments into natural, timing-friendly English
 * meant to be SPOKEN, staying close to the original length so each TTS clip
 * lands inside its segment window.
 *
 * @param {Array<{index:number,start:number,end:number,text:string}>} segments
 * @param {object} options { sourceLang?, targetLang?, style? }
 * @returns {Promise<Array<{index:number, textEn:string}>>}
 */
async function translateSegments(segments, options = {}) {
  const items = (segments || []).map((s) => ({ index: s.index, text: s.text }));
  if (items.length === 0) return [];
  const sourceLang = options.sourceLang || "the source language";
  const targetLang = options.targetLang || "English";
  const style = options.style
    ? `Style guidance: ${options.style}.`
    : "Keep it natural, conversational, and safe for a general audience.";

  const prompt = `Translate each numbered subtitle segment from ${sourceLang} into ${targetLang}.
${style}
Match the spoken length of the original as closely as possible so it can be voiced within the same time window.
Do not merge or split segments. Preserve the "index" of every segment.

Return ONLY JSON of this exact shape:
{ "segments": [ { "index": 0, "textEn": "..." } ] }

Segments:
${JSON.stringify(items, null, 2)}`;

  const parsed = await completeJson(prompt, {
    system: "You are a professional subtitle translator. You return valid JSON only.",
    temperature: 0.3,
  });
  const out = Array.isArray(parsed?.segments) ? parsed.segments : [];
  return out
    .filter((s) => s && s.index !== undefined && s.textEn)
    .map((s) => ({ index: Number(s.index), textEn: String(s.textEn).trim() }));
}

/**
 * KIMI RE-SCRIPTING STAGE.
 * Takes the literal English translation and rewrites it into a polished,
 * broadcast-style narration script — smoother phrasing, natural connective
 * tissue, consistent voice — WITHOUT changing the segment count, order, or
 * timing windows (so it still lands on the video). Prefers the Kimi provider
 * (per the user's request); falls back to the default provider if no Kimi key.
 *
 * @param {Array<{index:number,start:number,end:number,textEn:string}>} segments
 * @param {object} options { style?, targetLang?, provider? }
 * @returns {Promise<Array<{index:number, textEn:string}>>} re-scripted lines
 */
async function rescriptSegments(segments, options = {}) {
  const items = (segments || [])
    .map((s) => ({ index: s.index, text: s.textEn || s.text || "" }))
    .filter((s) => s.text);
  if (items.length === 0) return [];

  const provider = options.provider || (hasProvider("kimi") ? "kimi" : undefined);
  const targetLang = options.targetLang || "English";
  const style = options.style
    ? `Voice & style: ${options.style}.`
    : "Voice & style: clear, engaging, natural spoken narration for a general audience.";

  const prompt = `You are a scriptwriter polishing a machine translation into a ${targetLang} voiceover script.
${style}
Rewrite each numbered segment so it reads as fluent, spoken narration — fix awkward literal phrasing, keep meaning faithful, keep it clean and safe.
HARD RULES:
- Return exactly one rewritten line per input segment. Do NOT merge, split, add, or drop segments.
- Preserve every "index".
- Keep each line's spoken length close to the original so it fits the same on-screen time window.

Return ONLY JSON: { "segments": [ { "index": 0, "textEn": "..." } ] }

Segments:
${JSON.stringify(items, null, 2)}`;

  const parsed = await completeJson(prompt, {
    system: "You are a professional voiceover scriptwriter. You return valid JSON only.",
    temperature: 0.4,
    provider,
  });
  const out = Array.isArray(parsed?.segments) ? parsed.segments : [];
  return out
    .filter((s) => s && s.index !== undefined && s.textEn)
    .map((s) => ({ index: Number(s.index), textEn: String(s.textEn).trim() }));
}

export {
  getEnglishData,
  parseAiJson,
  completeJson,
  translateSegments,
  rescriptSegments,
  hasProvider,
};
