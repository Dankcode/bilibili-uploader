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

function getProviderConfig() {
  const providerName = (process.env.AI_PROVIDER || "codex").toLowerCase();
  const provider = PROVIDERS[providerName];

  if (!provider) {
    throw new Error(`Unsupported AI_PROVIDER "${providerName}". Use "codex" or "kimi".`);
  }

  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing ${provider.apiKeyEnv} for AI_PROVIDER=${providerName}.`);
  }

  return {
    providerName,
    apiKey,
    baseURL: provider.baseURL,
    model: process.env[provider.modelEnv] || provider.defaultModel,
  };
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

export {
  getEnglishData,
};
