/**
 * AI VIDEO EDITOR PROCESSOR — vid2vid restyling on your HuggingFace LAN
 * box. Example: "turn this video into cats".
 *
 * Two integration shapes — detect which your box runs, both behind this adapter:
 *  A) Gradio app: @gradio/client (📋 npm dep) — Client.connect(endpoint) →
 *     client.predict('/generate', { video, prompt }).
 *  B) Plain REST: POST {endpoint}/edit { video, prompt, model, strength, seed }
 *     → job id → poll {endpoint}/status/{id} → download result.
 *
 * Candidate open-source models for the LAN box (pick at impl):
 *   vid2vid restyle: AnimateDiff+ControlNet, RAVE, TokenFlow
 *   text-to-video inserts: LTX-Video, CogVideoX, Wan2.1
 * Long clips: split ~4s chunks (fluent-ffmpeg segment) → process → concat;
 * persist per-chunk progress so retries resume.
 *
 * options: { prompt, model?, strength?: 0..1, seed? }
 * Returns { outputPath, artifacts: { model, prompt, seed } }.
 */

export const id = 'aiEditor';

/** Health check + confirm defaultModel loaded/loadable. */
export async function testConnection(credentials = {}) {
  if (!credentials.endpoint) return { ok: false, error: 'HF editor endpoint is not configured' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${String(credentials.endpoint).replace(/\/$/, '')}/health`, {
      signal: controller.signal,
      headers: credentials.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {},
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `HF editor service is unreachable: ${error.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

export async function process(_inputPath, _options, _onProgress) {
  throw new Error('AI editor processing requires a compatible LAN Gradio/REST vid2vid service.');
}
