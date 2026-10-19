---
description: manage videos locally, with optional authenticated sharing
---

1. Run `npm run dev` and open `http://127.0.0.1:4455` on this computer. Local mode is the default; it does not listen on the LAN.
2. Configure source URLs and connections in the console. Private cookies, OAuth tokens and database files stay on the backend computer and must not be committed.
3. Review the catalog and queue before starting uploads. Use a private upload for connection tests.
4. Optional trusted sharing only: run `npm run mcp:setup` once to generate private credentials, then `npm run dev:shared` (or `npm run build` and `npm run start:shared`). Shared startup requires a distinct operator token of at least 32 characters.
5. Connect through a trusted LAN/Tailscale or HTTPS endpoint and enter the operator token once per browser. Automatic localhost pairing is disabled in shared mode. All collaborators share full workspace authority; this is not multi-tenant hosting.
6. Stop shared mode and restart with `npm run dev` / `npm start` to return to local-only operation. Never expose the console directly to the public internet.
