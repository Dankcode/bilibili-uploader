// Agent input holds: the few moments a job genuinely needs an agent (today:
// translating one subtitle file). The processor throws agentInputRequired();
// the worker parks the job in `review:<kind>` with the request saved as an
// asset, optionally pings a callback URL, and moves on to other jobs. The
// agent answers through MCP (submit_translation), which requeues the job; the
// processor resumes from its checkpoint and applies the answer.
import { createHmac } from 'node:crypto';

export const AGENT_INPUT_CODE = 'AGENT_INPUT_REQUIRED';
export const AGENT_INPUT_KINDS = new Set(['translation']);

export function agentInputRequired(kind, detail = {}) {
  if (!AGENT_INPUT_KINDS.has(kind)) throw new Error(`Unknown agent input kind: ${kind}`);
  const error = new Error(detail.message || `Waiting for agent ${kind}`);
  error.code = AGENT_INPUT_CODE;
  error.kind = kind;
  error.detail = detail;
  return error;
}

/**
 * POST a small JSON event to VIDEO_AGENT_CALLBACK_URL (e.g. a Hermes webhook)
 * so the agent does not have to poll. Signed with VIDEO_AGENT_CALLBACK_SECRET
 * when set. Never throws: the hold itself is the source of truth and MCP
 * list_agent_requests always shows it.
 */
export async function notifyAgent(event, { env = process.env, fetcher = fetch } = {}) {
  const url = String(env.VIDEO_AGENT_CALLBACK_URL || '').trim();
  if (!url) return { delivered: false, reason: 'VIDEO_AGENT_CALLBACK_URL is not set' };
  const body = JSON.stringify({ schema: 'videops.agent-event/v1', sentAt: new Date().toISOString(), ...event });
  const headers = { 'Content-Type': 'application/json' };
  if (env.VIDEO_AGENT_CALLBACK_SECRET) headers['X-Videops-Signature'] = `sha256=${createHmac('sha256', env.VIDEO_AGENT_CALLBACK_SECRET).update(body).digest('hex')}`;
  try {
    const response = await fetcher(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000), redirect: 'error' });
    return { delivered: response.ok, status: response.status };
  } catch (error) {
    return { delivered: false, reason: error.message };
  }
}
