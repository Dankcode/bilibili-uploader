import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
const destination = path.resolve(process.env.VIDEO_AGENT_CONFIG || 'config/agent-bridge.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
// Do not rotate working credentials or silently invalidate a client configuration.
const config = { operatorToken: randomBytes(32).toString('hex'), agentToken: randomBytes(32).toString('hex') };
try { fs.writeFileSync(destination, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; console.error(`Already configured: ${destination}. Existing tokens were not changed.`); process.exit(0); }
console.error(`Created private credentials at ${destination}. Sign in to VideoOps with operatorToken; give only agentToken to your MCP client. See docs/MCP_AGENT_BRIDGE.md. Tokens are not printed to logs.`);
