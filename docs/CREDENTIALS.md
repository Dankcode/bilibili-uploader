# Credentials

Keep provider keys in an ignored `.env.local` or the worker's environment.
Connection secrets in SQLite are encrypted using `STUDIO_SECRET_KEY`; no new
plaintext service secret can be saved without that key. Codex text generation
uses the CLI's own authentication store and never imports its tokens.

The October 2026 cleanup removes tracked `.fuse_hidden*` SQLite remnants,
`node_modules`, and Python bytecode from the Git index while retaining local
files. Ignore rules also cover nested databases and credential backups.
Environment, OAuth, and secrets archive files already ignored by Git remain
local; do not attach or commit them. Use owner-only permissions (`0600`) for
credential files and private backup archives.

Run `npm run secrets:check` to check tracked files without printing secret
values. It rejects known credential signatures and tracked local-state files.
Deliberately fake test credentials must be clearly marked as test fixtures.
This check is a guard, not proof that arbitrary passwords or all historic
credentials have been detected.

If a real key was ever committed, revoke or rotate it at the provider first.
For exposed OAuth refresh tokens, revoke the authorization and sign in again.
Deleting a working-tree file does not remove old commits, forks, caches, or
backups. Coordinate any history rewrite with collaborators and rescan before
pushing; this change does not rewrite or force-push shared history.
