import { completeText } from '../ai/getEnglish';
import { assertSameTiming, buildAss, parseAss } from './subtitles';

function stripFence(value) {
  const text = String(value || '').trim();
  return text.match(/```(?:ass|ssa)?\s*([\s\S]*?)```/i)?.[1]?.trim() || text;
}

function historySummary(history = []) {
  return history.slice(-8).map((entry, index) => `${index + 1}. ${entry.instruction}`).join('\n');
}

async function processSubtitleDocument(assText, instruction, { history = [], ...options } = {}) {
  const before = parseAss(assText);
  if (!before.length) throw new Error('No subtitle cues were found in the ASS document.');
  const temperature = Math.max(0, Math.min(1, Number(options.temperature ?? 0.25)));
  const system = 'You edit subtitle files. Return a complete ASS subtitle document only. Preserve every cue count, start time, end time, and Original line exactly. Change only Translation dialogue text. Never merge, split, reorder, or remove cues.';
  const prompt = `${instruction}\n\nPrevious edit instructions:\n${historySummary(history) || '(none)'}\n\nASS document:\n${assText}`;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const completion = await completeText(prompt, {
      system,
      temperature,
      provider: 'kimi',
      credentials: {
        kimiApiKey: options.apiKey,
        kimiBaseURL: options.baseURL,
        kimiModel: options.model,
        geminiApiKey: options.geminiApiKey,
        geminiModel: options.geminiModel,
      },
    });
    const candidate = stripFence(completion.content);
    try {
      const after = parseAss(candidate);
      assertSameTiming(before, after);
      if (after.some((segment, index) => segment.text !== before[index].text)) {
        throw new Error('The model changed source-language subtitle text.');
      }
      if (after.some((segment) => !segment.textEn)) throw new Error('The model returned empty translation lines.');
      return {
        text: buildAss(after), segments: after, model: completion.model, provider: completion.provider,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('The subtitle provider returned an invalid document.');
}

export async function translateSubtitles(assText, { from = 'zh', to = 'en', ...options } = {}) {
  return processSubtitleDocument(
    assText,
    `Translate every Original dialogue line from ${from} to ${to}. Put the natural, concise translation in its matching Translation dialogue line.`,
    options,
  );
}

export async function refineSubtitles(assText, instruction, options = {}) {
  if (!String(instruction || '').trim()) throw new Error('A refine instruction is required.');
  return processSubtitleDocument(assText, String(instruction).trim(), options);
}
