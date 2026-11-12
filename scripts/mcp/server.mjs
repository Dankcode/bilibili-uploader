// VideoOps stdio MCP server: a thin adapter over /api/agent/v1.
// Tools, schemas and resources all come from src/lib/agent/contract.js, so adding
// a tool there (plus its handler in service.js) exposes it here automatically.
// stdout belongs exclusively to MCP framing. This process never imports SQLite or workers.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, McpError, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Ajv from 'ajv';
import { operations, resources } from '../../src/lib/agent/contract.js';

const base = new URL(process.env.VIDEO_AGENT_BASE_URL || 'http://127.0.0.1:4455');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('VIDEO_AGENT_BASE_URL must be an HTTP(S) server origin without credentials');
const token = process.env.VIDEO_AGENT_TOKEN || '';
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map(operations.map((op) => [op.name, ajv.compile(op.inputSchema)]));
const byName = new Map(operations.map((op) => [op.name, op]));
const server = new Server({ name: 'videops', version: '1.1.0' }, { capabilities: { tools: {}, resources: {} } });

const redact = (text) => (token ? String(text).split(token).join('[redacted]') : String(text));
const STATUS_CODES = { 400: 'INVALID_INPUT', 404: 'NOT_FOUND', 409: 'PRECONDITION_FAILED', 413: 'INVALID_INPUT' };
const toolResult = (body, isError) => ({ isError, content: [{ type: 'text', text: JSON.stringify(body) }] });
// Ajv errors as short "path: problem" lines the model can act on.
const describeErrors = (errors = []) => errors.slice(0, 10).map((e) => `${e.instancePath || '(arguments)'} ${e.message}${e.params?.additionalProperty ? `: ${e.params.additionalProperty}` : ''}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''}`);

async function api(path, method = 'GET', args) {
  const url = new URL(`/api/agent/v1${path}`, base);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const options = { method, headers, redirect: 'error', signal: AbortSignal.timeout(120000) };
  if (method === 'GET') {
    for (const [key, value] of Object.entries(args || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  } else {
    headers['Content-Type'] = 'application/json';
    if (args?.idempotencyKey) headers['Idempotency-Key'] = args.idempotencyKey;
    if (args?.ifMatch) headers['If-Match'] = args.ifMatch;
    options.body = JSON.stringify(args || {});
  }
  let response;
  try { response = await fetch(url, options); }
  catch (error) { return { error: { code: 'RETRYABLE', message: `VideoOps backend unreachable at ${base.origin}: ${redact(error.cause?.code || error.message)}. Is the app running?` } }; }
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); }
  catch {
    // An HTML page here usually means a wrong VIDEO_AGENT_BASE_URL or a crashed route.
    return { error: { code: response.status >= 500 ? 'RETRYABLE' : STATUS_CODES[response.status] || 'PRECONDITION_FAILED', message: `Backend returned ${response.status} with a non-JSON body; check VIDEO_AGENT_BASE_URL (${base.origin}) points at the VideoOps backend` } };
  }
  if (!response.ok) return { error: body?.error || { code: response.status >= 500 ? 'RETRYABLE' : STATUS_CODES[response.status] || 'PRECONDITION_FAILED', message: `Backend returned ${response.status}` } };
  return body;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: operations.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const op = byName.get(params.name);
  if (!op) return toolResult({ error: { code: 'NOT_FOUND', message: `Unknown tool ${params.name}` } }, true);
  const args = params.arguments || {};
  const validate = validators.get(op.name);
  if (!validate(args)) return toolResult({ error: { code: 'INVALID_INPUT', message: 'Invalid arguments', details: describeErrors(validate.errors) } }, true);
  try {
    const result = await api(op.path, op.method, args);
    return toolResult(result, Boolean(result?.error));
  } catch (error) { return toolResult({ error: { code: 'RETRYABLE', message: redact(error.message) } }, true); }
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [{ uriTemplate: 'videops://job/{id}/log', name: 'Job log', mimeType: 'application/json' }] }));
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
  const body = await api('/resource', 'GET', { uri: params.uri });
  if (body?.error) throw new McpError(body.error.code === 'NOT_FOUND' ? ErrorCode.InvalidParams : ErrorCode.InternalError, `${body.error.code}: ${body.error.message}`);
  return { contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(body) }] };
});
await server.connect(new StdioServerTransport());
