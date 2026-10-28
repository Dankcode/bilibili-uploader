import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export function editorConfig(credentials = {}) {
  const endpoint = new URL(credentials.endpoint || process.env.VIDEO_EDITOR_MCP_URL || 'http://127.0.0.1:4560/mcp');
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Video editor MCP URL must be HTTP(S), without embedded credentials, query or fragment.');
  }
  const token = credentials.apiKey || process.env.VIDEO_EDITOR_MCP_TOKEN || '';
  return { endpoint, headers: token ? { Authorization: `Bearer ${token}` } : {}, token };
}

export function redactEditorError(error, token) {
  return token ? String(error?.message || error).split(token).join('[redacted]') : String(error?.message || error);
}

export async function withEditor(credentials, action) {
  const config = editorConfig(credentials);
  const client = new Client({ name: 'bilibili-uploader', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(config.endpoint, { requestInit: { headers: config.headers, redirect: 'error' } });
  try {
    await client.connect(transport, { timeout: 15000 });
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
      const content = result.content?.find((item) => item.type === 'text')?.text;
      let data;
      try { data = JSON.parse(content || '{}'); } catch { throw new Error(`Video editor ${name} returned invalid JSON.`); }
      if (result.isError || data.error) throw new Error(data.error?.message || content || `Video editor ${name} failed.`);
      return data;
    };
    return await action({ client, call, ...config });
  } catch (error) {
    throw new Error(redactEditorError(error, config.token));
  } finally {
    await client.close().catch(() => {});
  }
}
