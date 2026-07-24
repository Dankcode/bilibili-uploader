import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { parseTranscriptMarkdown } from './markdown';

function providers() {
  return [
    {
      id: 'kimi',
      label: 'Kimi',
      configured: Boolean(process.env.KIMI_API_KEY),
      apiKey: process.env.KIMI_API_KEY || '',
      baseURL: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
      model: process.env.KIMI_MODEL || 'moonshot-v1-32k',
    },
    {
      id: 'gemini',
      label: 'Gemini',
      configured: Boolean(process.env.GEMINI_API_KEY),
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    },
  ];
}

function selectedProvider(requested) {
  const available = providers();
  const selectedId = requested || process.env.STUDIO_ANALYSIS_PROVIDER || available.find((item) => item.configured)?.id || '';
  return { available, selected: available.find((item) => item.id === selectedId) || null };
}

export function getTranscriptAnalysisStatus(requested) {
  const { available, selected } = selectedProvider(requested);
  return {
    configured: Boolean(selected?.configured),
    selected: selected?.id || null,
    model: selected?.model || null,
    providers: available.map(({ id, label, configured, model }) => ({ id, label, configured, model })),
  };
}

function parseJsonResponse(value) {
  const text = String(value || '').trim();
  const unfenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() || text;
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The analysis provider did not return JSON.');
  return JSON.parse(unfenced.slice(start, end + 1));
}

function transcriptForPrompt(transcriptMd, maxCharacters = 70000) {
  const { segments } = parseTranscriptMarkdown(transcriptMd);
  const text = segments.map((segment) => `[${segment.index}] ${segment.text}`).join('\n');
  if (text.length <= maxCharacters) return text;
  const slice = Math.floor(maxCharacters / 3);
  const middle = Math.max(0, Math.floor((text.length - slice) / 2));
  return `${text.slice(0, slice)}\n[...middle sample...]\n${text.slice(middle, middle + slice)}\n[...final sample...]\n${text.slice(-slice)}`;
}

function analysisPrompt(transcriptMd) {
  return `Analyze this complete timestamped transcript as an editorial strategist. Do not rewrite any subtitle lines.

Return only JSON with this exact shape:
{"tone":"A concise description of voice, formality, energy, and emotional register.","schema":"A concise description of audience, purpose, narrative structure, pacing, terminology conventions, and subtitle style.","summary":"A short overview of the transcript's content."}

Transcript:
${transcriptForPrompt(transcriptMd)}`;
}

function validateAnalysis(payload) {
  const result = {
    tone: String(payload?.tone || '').trim(),
    schema: String(payload?.schema || '').trim(),
    summary: String(payload?.summary || '').trim(),
  };
  if (!result.tone || !result.schema) throw new Error('The analysis provider returned an incomplete tone or schema.');
  return result;
}

export async function analyzeTranscript(transcriptMd, { provider, temperature = 0.1 } = {}) {
  if (!String(transcriptMd || '').trim()) throw new Error('A transcript is required for analysis.');
  const status = selectedProvider(provider);
  const selected = status.selected;
  if (!selected) throw new Error('No transcript analysis provider is selected.');
  if (!selected.configured) throw new Error(`${selected.label} is selected for transcript analysis but its API key is not configured.`);
  const prompt = analysisPrompt(transcriptMd);
  let content = '';
  if (selected.id === 'gemini') {
    const client = new GoogleGenerativeAI(selected.apiKey);
    const response = await client.getGenerativeModel({ model: selected.model }).generateContent(prompt);
    content = response.response.text();
  } else {
    const client = new OpenAI({ apiKey: selected.apiKey, baseURL: selected.baseURL });
    const completion = await client.chat.completions.create({
      model: selected.model,
      temperature: Math.max(0, Math.min(1, Number(temperature) || 0.1)),
      messages: [
        { role: 'system', content: 'Return strict JSON only. Analyze the document globally and never rewrite subtitle lines.' },
        { role: 'user', content: prompt },
      ],
    });
    content = completion.choices?.[0]?.message?.content || '';
  }
  return {
    ...validateAnalysis(parseJsonResponse(content)),
    provider: selected.id,
    providerLabel: selected.label,
    model: selected.model,
    generatedAt: new Date().toISOString(),
  };
}
