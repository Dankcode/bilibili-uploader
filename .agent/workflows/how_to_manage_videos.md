---
description: manage videos locally, with optional Tailscale sharing
---

1. Run `npm run dev` and open `http://127.0.0.1:4455` on this computer. Local mode is the default; it does not listen on the LAN.
2. Configure source URLs and connections in the console. Private cookies, OAuth tokens and database files stay on the backend computer and must not be committed.
3. Review the catalog and queue before starting uploads. Use a private upload for connection tests.
4. For Tailscale access, run `npm run dev:tailscale` (or `npm run build` and `npm run start:tailscale`). No app sign-in or access token is required. The Tailscale CLI must be available and connected.
5. Connect to the device's Tailscale IP on port 4455. Every reachable client has full workspace authority; this is not multi-tenant hosting. MCP clients only need `VIDEO_AGENT_BASE_URL`; owner-requested uploads and resumes do not need a second human approval. Platform login, file validation and duplicate receipts still apply.
6. Stop shared mode and restart with `npm run dev` / `npm start` to return to local-only operation. Never expose the console directly to the public internet.
