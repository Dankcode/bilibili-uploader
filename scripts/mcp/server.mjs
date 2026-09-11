import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Ajv from 'ajv';
import { operations, resources } from '../../src/lib/agent/contract.js';

const base = new URL(process.env.VIDEO_AGENT_BASE_URL || 'http://127.0.0.1:4455');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('VIDEO_AGENT_BASE_URL must be an HTTP(S) server origin without credentials');
if (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && process.env.VIDEO_AGENT_ALLOW_INSECURE_REMOTE !== '1') throw new Error('Use HTTPS for remote agent access, or explicitly opt into trusted LAN/Tailscale HTTP with VIDEO_AGENT_ALLOW_INSECURE_REMOTE=1');
const token = process.env.VIDEO_AGENT_TOKEN;
if (!token) throw new Error('Set VIDEO_AGENT_TOKEN to the separate agent token from mcp:setup');
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map(operations.map((op) => [op.name, ajv.compile(op.inputSchema)]));
const server = new Server({ name: 'videops', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } });
async function api(path, method = 'GET', args) {
  const url = new URL(`/api/agent/v1${path}`, base);
  const headers = { Authorization: `Bearer ${token}` };
  const options = { method, headers, redirect: 'error', signal: AbortSignal.timeout(120000) };
  if (method === 'GET' && args) for (const [key, value] of Object.entries(args)) url.searchParams.set(key, String(value));
  else if (args) {
    headers['Content-Type'] = 'application/json';
    if (args.idempotencyKey) headers['Idempotency-Key'] = args.idempotencyKey;
    if (args.ifMatch) headers['If-Match'] = args.ifMatch;
    options.body = JSON.stringify(args);
  }
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) return { error: body.error || { code: 'RETRYABLE', message: `Backend returned ${response.status}` } };
  return body;
}
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: operations.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const op = operations.find((item) => item.name === params.name);
    const args = params.arguments || {};
    if (!op || !validators.get(op.name)(args)) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'Unknown tool or invalid arguments' } }) }] };
    const result = await api(op.path, op.method, args);
    return { isError: Boolean(result.error), content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'RETRYABLE', message: String(error.message).split(token).join('[redacted]') } }) }] }; }
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [{ uriTemplate: 'videops://job/{id}/log', name: 'Job log', mimeType: 'application/json' }] }));
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => ({ contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(await api('/resource', 'GET', { uri: params.uri })) }] }));
// stdout belongs exclusively to MCP framing. This process never imports SQLite or workers.
await server.connect(new StdioServerTransport());
