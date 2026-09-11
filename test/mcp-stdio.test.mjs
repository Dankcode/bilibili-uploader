import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { operations } from '../src/lib/agent/contract.js';

test('stdio MCP handshake, tools, resources and bearer forwarding use the shared REST contract', async () => {
  const requests = [];
  const backend = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, method: request.method, authorization: request.headers.authorization, key: request.headers['idempotency-key'], body: body ? JSON.parse(body) : null });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ items: [], bridgeTest: true }));
  });
  await new Promise((resolve, reject) => { backend.once('error', reject); backend.listen(0, '127.0.0.1', resolve); });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['scripts/mcp/server.mjs'],
    env: { PATH: process.env.PATH, VIDEO_AGENT_TOKEN: 'stdio-agent-fixture', VIDEO_AGENT_BASE_URL: `http://127.0.0.1:${backend.address().port}` }, stderr: 'pipe' });
  const client = new Client({ name: 'videops-test', version: '1.0.0' });
  let stderr = ''; transport.stderr?.on('data', (chunk) => { stderr += chunk; });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.deepEqual(list.tools.map((tool) => tool.name), operations.map((op) => op.name));
    const work = await client.callTool({ name: 'list_work', arguments: { state: 'failed', limit: 2 } });
    assert.equal(work.isError, false); assert.equal(JSON.parse(work.content[0].text).bridgeTest, true);
    const invalid = await client.callTool({ name: 'list_work', arguments: { limit: 26 } });
    assert.equal(invalid.isError, true); assert.equal(requests.length, 1);
    await client.callTool({ name: 'queue_batch', arguments: { planToken: 'signed-plan-fixture', idempotencyKey: 'request-once' } });
    assert.equal(requests[1].key, 'request-once'); assert.equal(requests[1].body.planToken, 'signed-plan-fixture');
    assert.equal((await client.listResources()).resources.length, 3);
    assert.equal((await client.listResourceTemplates()).resourceTemplates[0].uriTemplate, 'videops://job/{id}/log');
    const health = await client.readResource({ uri: 'videops://health' });
    assert.equal(JSON.parse(health.contents[0].text).bridgeTest, true);
    assert.ok(requests.every((request) => request.authorization === 'Bearer stdio-agent-fixture'));
    assert.match(requests[0].url, /^\/api\/agent\/v1\/work\?/);
    assert.equal(stderr.includes('SQLite'), false);
  } finally { await client.close(); await new Promise((resolve) => backend.close(resolve)); }
});
