# Project Rules

- **Tech Stack**: Use Next.js (App Router), React, and the repository's CSS Modules design system for frontend development.
- **Database**: Use `better-sqlite3` for local data persistence. Ensure the database connection is managed as a singleton in `src/lib/db/sqlite.js`.
- **Data Access**: Perform database updates and manual metadata edits via **Server Actions** in `src/app/actions.js`.
- **Workflow**: The core automated pipeline belongs in `src/lib/services/WorkflowService.js`. UI components should only trigger or monitor services.
- **Networking**: Default to loopback on port 4455. Use `dev:tailscale` / `start:tailscale` for access through the device's Tailscale IP; do not require app/operator/MCP tokens or a sign-in page. Every reachable client has full workspace authority. Explicit MCP publishing must not pause for separate human approval. Keep platform authentication, media validation and duplicate-delivery receipts.
- **Components**: Keep components modular and reusable in `src/components`.
- **Styling**: Strictly use CSS Modules and the shared tokens in `src/app/globals.css`; do not introduce Tailwind.
