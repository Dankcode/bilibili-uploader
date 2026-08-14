# Mail Integration Plan — Studio Suite

**Adding a Gmail-backed tracking layer to the bilibili-uploader pipeline**

Status: proposal · Target repo: `bilibili-uploader` · Depends on: `src/lib/pipeline/registry.js`, `src/lib/db/sqlite.js`, `src/lib/operations/store.js`

---

## 0. Scope decision (read this first)

The `gmail-account-creator` repo was reviewed and **is not being integrated**. Two independent reasons:

1. **It doesn't contain a program.** The repo holds only `config/config.py`, `config/5sim_config.txt`, `config/user_agents.txt`, `config/password.txt`, `data/names.txt`, and a README. The creation script itself is absent (the README says it is distributed obfuscated). There is no code to integrate or improve — only settings for a binary you don't have.

2. **What it describes is not safe to depend on.** The README documents bulk automated Gmail signup built on anti-abuse evasion: rotating browser fingerprints, human-typing simulation, free-proxy IP rotation, "phone verification bypass," and 5sim disposable-SMS purchase. Google's Terms of Service prohibit account creation by automated means, and accounts created this way are detected and terminated in waves. **The operational risk is the part that matters here:** this pipeline publishes to YouTube. A YouTube channel is bound to a Google account. If that account is terminated for abuse, the channel and every video on it go with it, and the termination can propagate to other accounts sharing the same device fingerprint, recovery phone, or payment method. Building your video catalogue on disposable accounts means building it on accounts designed to be deleted.

**What this plan does instead:** treats a Gmail account you already own and control as a *connected service*, exactly like the existing `youtube` uploader and `douyin` source — authenticated via Google OAuth, registered in `service_connections`, and used as a durable tracking and notification substrate. No account provisioning of any kind appears anywhere in this plan. You create the account normally, once, by hand; the app connects to it.

The three tracking behaviors requested are all in scope:

| Requested behavior | Plan section |
|---|---|
| Outbound: labeled tracking email per video | §3.2, §4.3 |
| Per-video thread as a status log | §3.2, §4.4 |
| Inbound: ingest YouTube/platform mail into SQL | §3.3, §4.5 |

---

## 1. What the app already gives us

The architecture is in good shape for this. Three existing facts drive every design choice below.

**1.1 — The pipeline is already an adapter registry.** `src/lib/pipeline/registry.js` defines three slots (`SOURCES` → `PROCESSORS` → `UPLOADERS`), each entry declaring `{ id, label, credentialFields[], adapterPath }`. `connections.js` maps ids to adapter modules in `ADAPTERS`, persists credentials in `service_connections`, and drives a `configured → tested → enabled` lifecycle with `saveConnection` / `testService`. **Mail should not be a fourth ad-hoc subsystem.** It should be a fourth slot: `NOTIFIERS`. That gets us the settings UI, the connection test, the credential storage, and the enable/disable toggle for free, and it means adding Outlook or a Slack notifier later is one registry entry.

**1.2 — There is already a canonical video identity.** `video_records.id` (TEXT PK) is the modern catalogue row, with `video_versions`, `video_publications`, and `video_metric_snapshots` hanging off it via `ON DELETE CASCADE`. The legacy `videos` table is bridged through `video_records.legacy_video_id` and `backfillOperationsCatalog()`. **All mail state must key on `video_records.id`, never on the legacy `videos.id`**, or the mail layer inherits the old table's drift.

**1.3 — The job lifecycle has exactly the hook points we need.** `pipeline.js` has `setStepStatus(stepId, status, patch)` as the single choke point for every step transition, and `runNextQueuedJob()` wraps terminal outcomes. Emitting mail events from `setStepStatus` and the terminal handler covers the full status log with two call sites, not twenty.

---

## 2. Architecture

```
                      ┌──────────────────────────────────────┐
                      │  registry.js   NOTIFIERS[]           │
                      │    gmail  →  adapterPath …/gmail.js  │
                      └──────────────┬───────────────────────┘
                                     │ credentialFields
                      ┌──────────────▼───────────────────────┐
   pipeline.js  ──────►  lib/mail/events.js  (emitMailEvent) │
   setStepStatus()     │   enqueue, never block the pipeline │
   runNextQueuedJob()  └──────────────┬───────────────────────┘
                                      │
   ┌──────────────────────────────────▼──────────────────────────────┐
   │  mail_outbox  (SQL queue)                                       │
   │  ─ drained by scripts/server_worker.mjs tick                    │
   └──────────────────────────────────┬──────────────────────────────┘
                                      │
   ┌──────────────────────────────────▼──────────────────────────────┐
   │  lib/pipeline/notifiers/gmail.js                                │
   │  testConnection() · send() · sync()                             │
   │  ─ googleapis OAuth2, refresh-token flow                        │
   └───────┬───────────────────────────────────────────┬─────────────┘
           │ outbound                                  │ inbound (historyId cursor)
           ▼                                           ▼
   ┌───────────────────┐                    ┌──────────────────────────┐
   │ Gmail: label tree │                    │ Gmail: YouTube notices   │
   │ Studio/<channel>/ │                    │ parsed → mail_ingest_    │
   │ one thread/video  │                    │ events → video_records   │
   └───────────────────┘                    └──────────────────────────┘
```

**Two hard rules.**

- **Mail is never in the critical path.** `emitMailEvent` writes a row to `mail_outbox` and returns synchronously. A Gmail outage, a revoked token, or a rate limit must never fail a video job. The worker drains the outbox out-of-band with backoff.
- **SQL is the source of truth; Gmail is a projection.** Every thread, message, and parsed notice is mirrored in SQL with its Gmail id. If the mailbox is wiped, the catalogue is intact and re-projectable. This is what makes the mail layer safe to depend on and cheap to rebuild.

---

## 3. Data model

### 3.1 New tables

Added to the `db.exec()` block in `initDB()` (`src/lib/db/sqlite.js`), following the file's existing conventions: `TEXT` ISO timestamps, `*_json` columns for blobs, explicit `FOREIGN KEY … ON DELETE CASCADE`, indexes declared alongside.

```sql
-- A connected mailbox. Multiple accounts supported from day one:
-- one operator inbox, or one per YouTube channel.
CREATE TABLE IF NOT EXISTS mail_accounts (
  id                TEXT PRIMARY KEY,           -- uuid
  provider          TEXT NOT NULL DEFAULT 'gmail',
  email_address     TEXT NOT NULL UNIQUE,
  display_name      TEXT DEFAULT '',
  youtube_channel_id TEXT DEFAULT '',           -- optional link to a channel
  label_prefix      TEXT NOT NULL DEFAULT 'Studio',
  credential_ref    TEXT NOT NULL DEFAULT '',   -- pointer into secret store (§6.1)
  scopes_json       TEXT NOT NULL DEFAULT '[]',
  history_id        TEXT DEFAULT '',            -- Gmail incremental-sync cursor
  last_sync_at      TEXT DEFAULT '',
  last_error        TEXT DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'untested',
  enabled           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- One Gmail thread per video per account. This is the status-log anchor.
CREATE TABLE IF NOT EXISTS video_mail_threads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id         TEXT NOT NULL,
  account_id       TEXT NOT NULL,
  gmail_thread_id  TEXT DEFAULT '',
  rfc822_root_id   TEXT DEFAULT '',   -- our Message-ID; enables threading pre-send
  subject          TEXT NOT NULL DEFAULT '',
  label_path       TEXT NOT NULL DEFAULT '',
  message_count    INTEGER NOT NULL DEFAULT 0,
  last_status      TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  FOREIGN KEY(video_id)   REFERENCES video_records(id) ON DELETE CASCADE,
  FOREIGN KEY(account_id) REFERENCES mail_accounts(id) ON DELETE CASCADE
);

-- Every message we sent or ingested. The audit trail.
CREATE TABLE IF NOT EXISTS mail_messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id       TEXT NOT NULL,
  thread_row_id    INTEGER,                     -- null for unmatched inbound
  video_id         TEXT DEFAULT '',
  direction        TEXT NOT NULL,               -- 'outbound' | 'inbound'
  gmail_message_id TEXT DEFAULT '',
  gmail_thread_id  TEXT DEFAULT '',
  rfc822_id        TEXT DEFAULT '',
  from_addr        TEXT DEFAULT '',
  subject          TEXT DEFAULT '',
  snippet          TEXT DEFAULT '',
  body_text        TEXT DEFAULT '',
  labels_json      TEXT NOT NULL DEFAULT '[]',
  event_kind       TEXT DEFAULT '',             -- 'job.step', 'job.failed', 'publish.ok' …
  sent_at          TEXT DEFAULT '',
  received_at      TEXT DEFAULT '',
  raw_headers_json TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL,
  FOREIGN KEY(account_id)    REFERENCES mail_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(thread_row_id) REFERENCES video_mail_threads(id) ON DELETE SET NULL
);

-- Structured facts parsed out of inbound platform mail.
CREATE TABLE IF NOT EXISTS mail_ingest_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  message_row_id   INTEGER NOT NULL,
  account_id       TEXT NOT NULL,
  video_id         TEXT DEFAULT '',
  publication_id   INTEGER,
  parser_id        TEXT NOT NULL,               -- 'youtube.copyright' …
  parser_version   INTEGER NOT NULL DEFAULT 1,
  category         TEXT NOT NULL,               -- 'copyright' | 'strike' | 'comment'
                                                -- | 'monetization' | 'processing' | 'other'
  severity         TEXT NOT NULL DEFAULT 'info',-- 'info' | 'warn' | 'critical'
  title            TEXT DEFAULT '',
  detail           TEXT DEFAULT '',
  remote_video_id  TEXT DEFAULT '',             -- YouTube id scraped from the mail
  payload_json     TEXT NOT NULL DEFAULT '{}',
  acknowledged_at  TEXT DEFAULT '',
  occurred_at      TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  FOREIGN KEY(message_row_id) REFERENCES mail_messages(id) ON DELETE CASCADE,
  FOREIGN KEY(account_id)     REFERENCES mail_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(publication_id) REFERENCES video_publications(id) ON DELETE SET NULL
);

-- Durable send queue. Decouples the pipeline from Gmail availability.
CREATE TABLE IF NOT EXISTS mail_outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    TEXT NOT NULL,
  video_id      TEXT DEFAULT '',
  job_id        INTEGER,
  event_kind    TEXT NOT NULL,
  dedupe_key    TEXT NOT NULL,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'queued', -- queued|sending|sent|failed|skipped
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 5,
  next_retry_at TEXT DEFAULT '',
  last_error    TEXT DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES mail_accounts(id) ON DELETE CASCADE
);
```

**Indexes** (mirroring the file's existing style):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_threads_video_account
  ON video_mail_threads(video_id, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_messages_gmail_id
  ON mail_messages(account_id, gmail_message_id) WHERE gmail_message_id != '';
CREATE INDEX IF NOT EXISTS idx_mail_messages_video
  ON mail_messages(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_messages_thread
  ON mail_messages(thread_row_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_mail_ingest_unack
  ON mail_ingest_events(acknowledged_at, severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_ingest_video
  ON mail_ingest_events(video_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_outbox_dedupe
  ON mail_outbox(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_dispatch
  ON mail_outbox(status, next_retry_at, created_at ASC);
```

The two unique indexes on `gmail_message_id` and `dedupe_key` are the whole idempotency story. Re-running a sync can't duplicate a message; a retried job step can't double-send. `dedupe_key` is `${videoId}:${jobId}:${eventKind}:${stepId}` — deterministic from the event, so `INSERT OR IGNORE` is the entire dedupe implementation.

### 3.2 Outbound model

The label tree is derived, not stored per-message: `{label_prefix}/{channel}/{status}`, e.g. `Studio/Ops-EN/Failed`. Status labels move as the video moves; the channel label never changes. Gmail label ids are cached in `mail_accounts.scopes_json`'s sibling — actually a small `labels_json` column, added via `addColumnIfMissing` if you prefer to defer it.

Threading: the first outbound message for a video generates our own `Message-ID` and stores it in `rfc822_root_id`. Every later message sets `In-Reply-To` and `References` to that value, so Gmail threads them correctly even before we've read back the `gmail_thread_id`. This avoids a read-after-write round trip per event.

Message body: rendered from `lib/mail/templates/` as multipart (text + HTML). HTML uses the design system's palette inline (§5.4).

### 3.3 Inbound model

Gmail's `users.history.list` with a stored `historyId` gives incremental sync — full mailbox scans only on first connect or after a `404 historyId too old`, in which case fall back to `users.messages.list` bounded by `newer_than:30d`.

Parsers live in `lib/mail/parsers/` and each export `{ id, version, match(headers, body), parse(msg) -> events[] }`. Ship with:

| Parser | Matches | Extracts |
|---|---|---|
| `youtube.copyright` | `from:noreply@youtube.com`, subject contains claim language | video id, claimant, policy, disputed status |
| `youtube.strike` | community-guidelines / strike subjects | strike type, expiry, video id |
| `youtube.processing` | upload-processed / rejected notices | video id, outcome |
| `youtube.comment` | new-comment notices | video id, commenter, text |
| `youtube.monetization` | monetization status changes | video id, new state |
| `generic.unmatched` | fallback | stores raw only, `category='other'` |

**Linking inbound mail to a video** is the one genuinely hard step. Resolution order, first hit wins:

1. `remote_video_id` scraped from the mail → `video_publications.remote_id` (there's already a unique index on `(platform_id, remote_id)`) → `video_id`.
2. YouTube URL in the body → same lookup after id extraction.
3. Exact title match against `video_records.title` scoped to the account's channel.
4. Unresolved → row still written with `video_id=''` and surfaced in an "Unmatched mail" tray. **Never guess.** A wrong link silently attaches a copyright strike to the wrong video, which is worse than an unresolved row.

Parser results are versioned (`parser_version`) so improving a parser lets you re-run it over stored `body_text` and correct history without re-fetching from Gmail. This is why `mail_messages.body_text` is stored rather than discarded.

---

## 4. Code changes, file by file

### 4.1 `src/lib/pipeline/registry.js`

```js
export const NOTIFIERS = [
  {
    id: 'gmail',
    label: 'Gmail (tracking + ingest)',
    credentialFields: [
      { key: 'clientId',     label: 'Google OAuth Client ID',     type: 'text' },
      { key: 'clientSecret', label: 'Google OAuth Client Secret', type: 'secret' },
      { key: 'redirectUri',  label: 'OAuth Redirect URI', type: 'text', required: false,
        placeholder: 'http://127.0.0.1:3000/api/mail/oauth/callback' },
      { key: 'labelPrefix',  label: 'Root Label', type: 'text', required: false,
        placeholder: 'Studio' },
      { key: 'ingestEnabled',label: 'Ingest Inbound (on/off)', type: 'text', required: false,
        placeholder: 'on' },
      { key: 'syncIntervalMinutes', label: 'Sync Interval (min)', type: 'text',
        required: false, placeholder: '15' },
    ],
    adapterPath: 'src/lib/pipeline/notifiers/gmail.js',
  },
];
```

Extend the `SERVICES` array in `connections.js` with `...NOTIFIERS.map(s => ({ ...s, role: 'notifier' }))` and add `gmail: gmailNotifier` to `ADAPTERS`. Nothing else in the settings layer changes — `listConnections`, `saveConnection`, and `testService` are already generic over `role`.

Scopes: `gmail.send`, `gmail.readonly`, `gmail.labels`, `gmail.modify`. Request `modify` only if you want the app to mark ingested mail as read; otherwise drop it — narrower scopes mean a faster OAuth consent review if you ever verify the app.

### 4.2 `src/lib/pipeline/notifiers/gmail.js` (new)

Adapter contract, deliberately parallel to the uploader contract documented in `registry.js`:

```js
export const id = 'gmail';
export async function testConnection(credentials)      // → { ok, error?, profile? }
export async function send(accountId, message)         // → { gmailMessageId, gmailThreadId }
export async function sync(accountId, { since })       // → { messages[], historyId }
export async function ensureLabels(accountId, paths)   // → { [path]: labelId }
```

Token handling: store the **refresh token** only; mint access tokens per call and cache in memory with expiry. `googleapis` handles the refresh; wire its `tokens` event to persist a rotated refresh token immediately — Google does rotate them, and losing a rotation silently bricks the connection days later.

Rate limits: Gmail allows 250 quota units/user/second; `messages.send` costs 100. At one message per pipeline step this is nowhere near the ceiling, but the outbox worker should still cap at ~2 sends/sec and treat `429`/`403 rateLimitExceeded` as retryable with exponential backoff, distinct from `401` (re-auth needed) and `400` (permanent, mark `failed`).

### 4.3 `src/lib/mail/events.js` (new)

```js
export function emitMailEvent({ videoId, jobId, eventKind, stepId, payload })
```

Resolves enabled accounts, computes `dedupe_key`, `INSERT OR IGNORE INTO mail_outbox`. Synchronous, wrapped in try/catch that logs and swallows. **Never throws.** This is the contract that keeps mail off the critical path.

### 4.4 `src/lib/pipeline/pipeline.js` (modified)

Two insertion points, both minimal:

- In `setStepStatus()` (line ~130), after the existing DB write: when `status` transitions to `failed`, or to `ok` on the final step, call `emitMailEvent`. Gate intermediate steps behind a per-account verbosity setting so the default isn't one email per step per video.
- In `runNextQueuedJob()`'s terminal handler (line ~457): emit `job.completed` / `job.failed` / `job.canceled`.
- After `recordPublication(...)` (line ~374): emit `publish.ok` carrying the `remoteId`, which is what later lets inbound mail resolve back to this video via §3.3 rule 1.

### 4.5 `scripts/server_worker.mjs` (modified)

Add two ticks to the existing worker loop:

- **Outbox drain** — every ~10s: claim `queued` rows where `next_retry_at <= now` using the same claim pattern `video_jobs` already uses (`worker_id` + `claimed_at`), send, mark `sent`, write `mail_messages`, upsert `video_mail_threads`.
- **Inbound sync** — every `syncIntervalMinutes` per enabled account: `sync()`, insert messages (`INSERT OR IGNORE` on the unique gmail id index), run parsers, write `mail_ingest_events`, advance `history_id`.

Reuse `recoverStaleJobs`' pattern for outbox rows stuck in `sending` past a timeout.

### 4.6 API routes (new, following existing `src/app/api/` conventions)

| Route | Purpose |
|---|---|
| `api/mail/accounts` | GET list · POST register · PATCH enable/disable |
| `api/mail/oauth/start` | GET → Google consent URL |
| `api/mail/oauth/callback` | GET → exchange code, store refresh token, create `mail_accounts` row |
| `api/mail/sync` | POST → force a sync now |
| `api/mail/threads/[videoId]` | GET → the per-video status log |
| `api/mail/inbox` | GET → ingest events, filterable by severity / unacknowledged / unmatched |
| `api/mail/inbox/[id]/ack` | POST → acknowledge |

### 4.7 `src/lib/operations/store.js` (extended)

- `getOperationsOverview()` — add `unacknowledgedMailEvents` and `criticalMailEvents` counts so problems surface on the main dashboard rather than only inside a mail view.
- New `listVideoMailTimeline(videoId)` — merged, chronological view of `mail_messages` + `mail_ingest_events` for one video.

---

## 5. UI, against the existing design system

`docs/DESIGN_SYSTEM.md` is specific and good; the mail surfaces should read as native, not bolted on. Concretely, per its Principles §4:

**5.1 — Settings: one new Connection row.** The existing `ServiceConnections.js` renders from `listConnections()`, so a `role: 'notifier'` entry appears automatically once registered. The only bespoke addition is an **Authorize with Google** button in that row (OAuth can't be a text field), styled `buttonSecondary`, plus a mono meta line showing `account · last sync · history cursor` — matching the documented "Connection row: configured → tested → enabled, with a mono meta line."

**5.2 — New view: Mail (sidebar nav item, seventh destination).** Two sub-tabs via the existing `viewTabs` segmented control:

- **Inbox** — the primary table (sticky mono header, hairline rows). Columns: severity dot · category · video title · subject · received (mono) · ack action. Severity maps directly onto the canonical status classes: `critical → failed`, `warn → warn`, `info → ok`. Filter chips: `Unacknowledged` / `Critical` / `Unmatched` / `All`.
- **Threads** — one row per video with message count and last status.

**5.3 — Video detail: a mail timeline block.** Reuse the **job row + step grid** vocabulary — each mail event renders as a compact card with a mono timestamp and a status dot. This directly serves Principle 8, *"Show the evidence"*: the mail that caused a status change stays inspectable next to the change.

**5.4 — Email HTML template.** Dark surface `#141813`, hairline `#283025`, text `#edf1e8`, mono for ids/paths/timestamps, accent `#c7f36b` on the single primary link. Inline styles are mandatory (mail clients strip `<style>`), which is the one place the "tokens only, no literal hex" rule must be broken — so **isolate every literal into `lib/mail/templates/tokens.js`**, generated from the same values, and comment the exception. Include a plain-text alternative; a text/plain part is what makes the mail greppable in Gmail search, which is half the point of the outbound layer.

**5.5 — Accessibility carry-over.** Severity is never encoded by color alone — dot + text label, per the existing status-label component. Contrast on `--text-faint` `#727d69` over `--surface` `#141813` is ~4.3:1, below AA for body text; use it only for ≥16px or non-essential metadata in the new views, and prefer `--text-muted` for the mail snippet text.

---

## 6. Issues in the current code to fix while integrating

These are pre-existing and the mail layer makes each one materially worse. Ordered by severity.

**6.1 — `service_connections.credentials_json` stores secrets in plaintext.** `saveConnection()` writes API keys directly as JSON into the SQLite file. Git hygiene here is already correct — `.gitignore` covers `config/*.db` and `config/*.db-*`, and `git ls-files config/` confirms nothing is tracked — so this is a plaintext-at-rest problem, not a leak-to-GitHub problem. Today the exposure is ElevenLabs and Gemini keys. Adding a Gmail **refresh token** raises the stakes sharply: a refresh token is durable, silent, full mailbox access — strictly worse than an API key you can rotate from a dashboard, and it survives in any backup, Time Machine snapshot, or copied `.db` file.

*Fix:* introduce `lib/security/secrets.js` with `encrypt(value)` / `decrypt(ref)` using `node:crypto` AES-256-GCM keyed from a `STUDIO_SECRET_KEY` env var, store only the ciphertext ref in `credential_ref`, and migrate existing rows on first boot. This is ~60 lines and it is the single highest-value change in this plan.

**6.2 — Schema migration is `CREATE TABLE IF NOT EXISTS` + `addColumnIfMissing`.** This works for additive changes and has clearly served you well, but it can't express index changes, backfills, or type changes, and there's no record of what version a given `.db` file is at. Five new tables is a good moment to add a `schema_migrations(version, applied_at)` table and a numbered migration list, keeping `addColumnIfMissing` as the escape hatch. Without this, a future "which columns does this old db have?" question has no answer.

**6.3 — `testService()` rewrites credentials on every test.** In `connections.js`, `testService` re-`INSERT`s `JSON.stringify(credentials)` into the row. It's a no-op today, but it means a test operation touches secret material unnecessarily, and once credentials are encrypted it becomes a decrypt/re-encrypt cycle on every health check. Narrow that statement to `UPDATE service_connections SET status=?, last_tested_at=?, last_error=?, updated_at=? WHERE service_id=?`.

**6.4 — The `videos` / `video_records` dual-catalogue is unresolved drift.** `backfillOperationsCatalog()` bridges them, but both are still written. Every new subsystem that has to pick one deepens the split. Mail keys exclusively on `video_records.id` (§1.2). Recommend a follow-up to make `videos` a read-only compatibility view.

**6.5 — `parseJson()` swallows errors silently.** `connections.js` returns the fallback on malformed JSON with no log. Corrupt credentials will present as "not configured" rather than "broken," which is a genuinely confusing debugging session. Log at `warn` with the service id.

**6.6 — No index on `video_publications.remote_id` alone.** The existing unique index is `(platform_id, remote_id)`, which serves the §3.3 rule-1 lookup only if the query includes `platform_id`. Make sure the resolver passes it, or the inbound linker does a scan on every ingested message.

---

## 7. Phases

Each phase is independently shippable and leaves the app working.

**Phase 0 — Security + migration groundwork** *(~0.5 day, no user-visible change)*
`secrets.js`, `schema_migrations`, migrate existing `service_connections` rows, fix §6.3 and §6.5, verify `.gitignore` coverage.
*Done when:* existing connections still test green and `sqlite3 config/bilibili.db "select credentials_json from service_connections"` reveals no plaintext secrets.

**Phase 1 — Notifier slot + OAuth** *(~1 day)*
`NOTIFIERS` registry entry, `notifiers/gmail.js` with `testConnection`, OAuth start/callback routes, `mail_accounts` table, Authorize button in `ServiceConnections.js`.
*Done when:* you can connect a Gmail account in Settings, it shows `ok`, and the refresh token round-trips through a server restart.

**Phase 2 — Outbound + per-video threads** *(~1.5 days)*
`mail_outbox`, `video_mail_threads`, `mail_messages`, `emitMailEvent`, pipeline hooks, outbox drain in the worker, label tree creation, HTML/text templates.
*Done when:* running a job produces a labeled Gmail thread whose replies track the job's steps, and killing network access mid-job delays mail without failing the job.

**Phase 3 — Inbound ingest** *(~2 days)*
`sync()`, `mail_ingest_events`, the six parsers, the linker with its four-rule resolution order, worker sync tick.
*Done when:* a real YouTube notification lands in SQL, resolves to the right `video_records` row, and appears with correct severity.

**Phase 4 — UI** *(~1.5 days)*
Mail view (Inbox + Threads tabs), video-detail timeline block, overview counters.
*Done when:* the new view is indistinguishable in style from `OperationsOverview.js` and passes the §5.5 checks.

**Phase 5 — Hardening** *(~1 day)*
Parser re-run tooling (`parser_version`), stale-outbox recovery, unmatched-mail tray, backoff tuning, docs.

Roughly 7–8 focused days. Phases 0–2 deliver most of the value; 3 is the highest-risk phase because parsing third-party notification mail is inherently brittle — build the `generic.unmatched` fallback *first* so nothing is ever silently dropped while the specific parsers mature.

---

## 8. Testing

`test/` already exists. Priorities, in order of what will actually catch bugs:

1. **Parser fixtures** — save real YouTube notification emails as `.eml` fixtures; assert extracted `remote_video_id`, category, severity. This is where regressions will happen, because Google changes these templates without notice.
2. **Linker resolution** — table-driven test over the four rules, explicitly asserting that ambiguous input yields `video_id=''` rather than a guess.
3. **Outbox idempotency** — emit the same event twice, assert one row, one send.
4. **Pipeline isolation** — mock `send()` to throw; assert the job still completes. This is the single most important test in the suite.
5. **Secrets round-trip** — encrypt → restart → decrypt, plus a wrong-key failure case.

---

## 9. Open questions

1. **One mailbox or one per channel?** The schema supports both. One operator mailbox with per-channel labels is simpler and is the recommended default; per-channel mailboxes only pay off if different people own different channels.
2. **Outbound verbosity default.** Per-step emails are noisy at scale. Recommend defaulting to terminal events only (`completed`, `failed`, `publish.ok`) with per-step as an opt-in toggle.
3. **Gmail push vs. polling.** This plan polls (`history.list`). Real-time would need Cloud Pub/Sub and a public webhook endpoint — a lot of infrastructure for a LAN-hosted app. Polling at 15 min is the right call unless you need faster copyright-claim response.
4. **Retention.** `mail_messages.body_text` grows unbounded. Suggest a retention setting in `app_settings` that nulls `body_text` for messages older than N days while keeping the parsed `mail_ingest_events` forever.
