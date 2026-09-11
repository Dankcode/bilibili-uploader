import { createHash } from 'node:crypto';
import { bearer, bridgeConfig, equalSecret, isAgent } from '../../../../../lib/agent/auth.js';
import { operations, openApiDocument } from '../../../../../lib/agent/contract.js';
import { AgentError, executeOperation, readAgentResource, sanitize } from '../../../../../lib/agent/service.js';
import { readRuntimeSettings } from '../../../../../lib/runtime/settings.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request, context) {
  const config = bridgeConfig();
  if (!config.agentToken || !config.operatorToken || equalSecret(config.agentToken, config.operatorToken)) return Response.json({ error: { code: 'PRECONDITION_FAILED', message: 'Configure distinct agent and operator tokens with npm run mcp:setup' } }, { status: 503 });
  if (!isAgent(request)) return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Agent bearer token required' } }, { status: 401 });
  if (readRuntimeSettings().connectionMode === 'remote') return Response.json({ error: { code: 'PRECONDITION_FAILED', message: 'Point the MCP bridge at the backend server, not a remote-mode frontend' } }, { status: 409 });
  try {
    const path = `/${context.params.path.join('/')}`;
    if (path === '/openapi.json' && request.method === 'GET') return Response.json(openApiDocument());
    if (path === '/resource' && request.method === 'GET') return Response.json(readAgentResource(new URL(request.url).searchParams.get('uri') || ''));
    const op = operations.find((item) => item.path === path && item.method === request.method);
    if (!op) throw new AgentError('NOT_FOUND', 'Unknown agent route or method', 404);
    let input;
    if (request.method === 'GET') {
      input = Object.fromEntries(new URL(request.url).searchParams);
      for (const [key, value] of Object.entries(input)) {
        const type = op.inputSchema.properties[key]?.type;
        if (type === 'integer' && /^\d+$/.test(value)) input[key] = Number(value);
        if (type === 'boolean' && ['true', 'false'].includes(value)) input[key] = value === 'true';
      }
    } else {
      const raw = await request.text();
      if (raw.length > 600000) throw new AgentError('INVALID_INPUT', 'Request is too large', 413);
      try { input = JSON.parse(raw); } catch { throw new AgentError('INVALID_INPUT', 'Invalid JSON'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AgentError('INVALID_INPUT', 'Arguments must be an object');
      for (const [header, key] of [['idempotency-key', 'idempotencyKey'], ['if-match', 'ifMatch']]) {
        const value = request.headers.get(header)?.replace(/^"|"$/g, '');
        if (value && input[key] && input[key] !== value) throw new AgentError('INVALID_INPUT', `Conflicting ${header} values`);
        if (value) input[key] = value;
      }
    }
    const principal = `agent:${createHash('sha256').update(bearer(request)).digest('hex').slice(0, 16)}`;
    const result = await executeOperation(op.name, input, principal);
    return Response.json(op.project(result), { headers: { 'Cache-Control': 'no-store', ...(result.updatedAt ? { ETag: `"${result.updatedAt}"` } : {}) } });
  } catch (error) {
    const known = error instanceof AgentError;
    if (!known) console.error('[Agent bridge]', error);
    return Response.json({ error: { code: known ? error.code : 'PRECONDITION_FAILED', message: known ? sanitize(error.message) : 'Operation could not be completed; inspect the console and recheck preconditions', ...(known && error.details ? { details: sanitize(error.details) } : {}) } }, { status: known ? error.status : 409 });
  }
}
export const GET = handle;
export const POST = handle;
