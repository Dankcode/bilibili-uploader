# Project Rules

- **Tech Stack**: Use Next.js (App Router), React, and Tailwind CSS v4 for all frontend development.
- **Database**: Use `better-sqlite3` for local data persistence. Ensure the database connection is managed as a singleton in `src/lib/db/sqlite.js`.
- **Data Access**: Perform database updates and manual metadata edits via **Server Actions** in `src/app/actions.js`.
- **Workflow**: The core automated pipeline belongs in `src/lib/services/WorkflowService.js`. UI components should only trigger or monitor services.
- **Networking**: The app must be accessible on LAN. Ensure the `dev` script in `package.json` includes `-H 0.0.0.0 -p 4455`.
- **Components**: Keep components modular and reusable in `src/components`.
- **Styling**: Strictly use CSS Modules with a premium, high-end aesthetic (e.g., "Midnight Obsidian").
