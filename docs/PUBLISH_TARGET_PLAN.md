# Publish target selection — Implementation Plan

Status: **plan only, nothing built yet.**
Scope: keep the original input flow (paste a Bilibili identifier → SESSDATA scrape
→ download), and add a **publish target** step: choose which authorized YouTube
channel the video lands on, with an in-flow path to authorize a channel that does
not exist yet.

Decisions taken with Leon before writing:

| Question | Decision |
|---|---|
| Input | Unchanged. Paste a BV id, a `bilibili.com/video/…` URL, or a `b23.tv/…` share link. The scrape still uses the Playwright-captured SESSDATA. |
| "New username" | A **new YouTube channel**, not a new Google account. One Google account can own several channels, so this needs no signup, no CAPTCHA, no second inbox. |
| Who creates the channel | The operator, in YouTube's own UI. The API cannot create channels (§2). The app deep-links, waits, then authorizes. |
| Selection model | One authorization row = one channel. The picker selects an authorization; the job binds to it immutably, as `youtube_upload_bindings` already enforces. |
| Auto-binding | **Removed** once the picker ships. The current "bind automatically when exactly one account is authorized" branch exists only because no UI could set a target (F9 in the audit). |
| Deliverable | This document, in `docs/`, matching the existing `docs/*_PLAN.md` convention. |

---

## 0. The one-paragraph version

**The half Leon described as the requirement is the half that already works.**
Paste an identifier, the Bilibili adapter validates it, `parseBilibiliVideoInfo`
fetches the DASH manifest with the stored SESSDATA, and `Downloader` merges audio
and video through ffmpeg. Nothing in that path needs redesign. Everything this
plan proposes lives on the publish side, and even there the *backend* is largely
built: `youtubeAuthorizationId` flows through `validateJobInput` →
`bindJobToYouTubeAuthorization` → the uploader, and
`youtube_video_and_thumbnail_uploader.py` already refuses to publish if the
OAuth-authorized channel does not match the one the job selected. What is missing
is a **picker** — no component in the app has ever set that field — plus one
schema change, because `credential_ref` currently conflates *which OAuth client*
with *which channel identity*, and that conflation is exactly what makes adding a
second channel awkward. So this is mostly wiring, with one migration and one
guided external step.

**The one place this is genuinely blocked, not just unbuilt:** creating a channel.
Google exposes no API for it. §2 covers what the app can and cannot do there.

---

## 1. What already works (verified against the code, 2026-08-24)

| Capability | Where | Note |
|---|---|---|
| Identifier → canonical URL | `src/lib/video/bilibiliUrl.js` | Accepts `BV…`, `av…`, numeric, canonical URLs, `b23.tv` links. Rejects foreign hosts and traversal. |
| SESSDATA-authenticated scrape | `src/lib/video/bilibili.js` → `parseBilibiliVideoInfo` | Cookie attached only after a host assert; redirects re-checked. |
| Download + merge | `src/lib/video/downloader.js` | DASH audio/video → ffmpeg `-c copy` merge. Sends no cookie. |
| Job carries a channel choice | `src/lib/pipeline/pipeline.js` → `validateJobInput` | `youtubeAuthorizationId`, validated usable at queue time. |
| Immutable job↔channel link | `src/lib/youtube/authorizations.js` | `youtube_upload_bindings`; rebinding throws. Covered by tests. |
| Upload refuses the wrong channel | `scripts/python/youtube_video_and_thumbnail_uploader.py:115` | `verify_authorized_channel()` compares `channels.list(mine=True)` against the selected id and aborts on mismatch. |
| OAuth registers a channel | `scripts/python/authorize_youtube.py` | Desktop `InstalledAppFlow`; returns only email, subject, channel id, channel title. Never returns a token. |
| Per-job preflight accepts a target | `src/lib/pipeline/diagnostics.js` → `runPreflight` | Already takes `youtubeAuthorizationId` and verifies that exact authorization. |

**Nothing in the table above needs rewriting.** The plan builds on it.

## 2. What Google allows, and what it does not

Verified against the current YouTube Data API v3 reference: the `channels`
resource exposes **`list` and `update` only**. `update` is further limited to
`brandingSettings` and `invideoPromotion`. **There is no `channels.insert`.**

| Operation | Possible from the app? |
|---|---|
| List the channels an authorized identity owns | Yes — `channels.list(mine=true)` |
| Upload to a chosen channel | Yes — OAuth token for that channel |
| Rename a channel / change branding | Partly — `channels.update`, branding fields only |
| **Create a channel** | **No. UI only.** |
| **Create a Google account** | **No, and out of scope** — see `YOUTUBE_AUTHORIZATION_LINKAGE.md` for why this repo rejected automated signup. |

So "let me create it under a new username" resolves to a **three-step guided
flow**, not a button that makes a channel:

1. The app opens `youtube.com/channel_switcher` in the operator's browser.
2. The operator creates the channel there and names it — seconds of work, no new
   Google account required, since one account can own multiple channels.
3. The operator returns to the app and hits **Authorize**, which runs the
   existing OAuth flow. Google's consent screen shows a channel picker; whichever
   channel they select becomes the authorization the app stores.

This is the honest maximum. A "Create channel" button that silently drove
YouTube's web UI would be the `gmail-account-creator` mistake in a new costume,
and this repo already decided against that.

**Feature limits worth surfacing in the UI:** a brand-new channel is capped at
15-minute uploads until it is phone-verified. The 19-minute test video will be
rejected by the API until then. §4.3 puts this in the picker rather than letting
it surface as an opaque upload failure.

## 3. The gap

### 3.1 No UI ever sets `youtubeAuthorizationId` (audit finding F9)

`grep -rn youtubeAuthorizationId src/` returns `pipeline.js` and
`diagnostics.js` and nothing else. The field is honoured end to end and reachable
only by hand-crafting an API call. `resolveYouTubeAuthorizationId()` currently
papers over this by auto-binding when exactly one account is authorized — a
deliberate stopgap that this plan deletes.

### 3.2 `credential_ref` means two different things

Today one string is used as:

- the OAuth **client** file name — `<ref>_client_secret.json`
- the OAuth **token** file name — `<ref>_token.json`
- the `UNIQUE` key on `youtube_authorizations`

One Google Cloud project can and should serve every channel. But because the ref
is unique per authorization *and* names the client file, registering a second
channel forces the operator to duplicate the same `client_secret.json` under a
second name. That is a filing-cabinet problem masquerading as a security
boundary.

**Fix:** add a `client_ref` column. `client_ref` names the shared OAuth client
file; `credential_ref` keeps naming the per-channel token and stays unique.
Existing rows migrate with `client_ref = credential_ref`, so nothing breaks and
current files keep working.

### 3.3 `authorize_youtube.py` silently takes `channels[0]`

```python
channels = youtube.channels().list(part='id,snippet', mine=True).execute().get('items') or []
channel = channels[0]
```

For a normal consent this is the channel the operator picked, so it is usually
right. But "usually right, silently" is how the wrong channel gets published to.
The script should return **every** channel it sees and let the app record the
selection explicitly, erroring if the count is unexpected.

### 3.4 The catalog title is a slugified URL

`sources/bilibili.js` sets `meta.title` from `safeName(input)`, so a job started
from a URL is catalogued — and uploaded — as
`https-www.bilibili.com-video-BV1Rd8B6VEQx`. `parseBilibiliVideoInfo` already
fetches the real title and `processBilibiliUrl` discards it. Small fix, included
here because the resolve-preview in §4.1 needs the real title anyway.

## 4. Design

### 4.1 Resolve before queue

The planner gains a resolve step between input and dispatch. Paste an identifier,
press **Resolve**, and the app shows what it actually found: title, uploader,
duration, thumbnail. This is where the earlier audit's "source preflight accepts
arbitrary identifiers" finally closes — the operator confirms the *video*, not a
string that parsed.

```
[ b23.tv/B2J2aDS            ] (Resolve)
  ✓ ASMR | Gentle Doctor Piercing Your Ears — Rheaye · 18:59 · BV1Rd8B6VEQx
```

New endpoint: `POST /api/pipeline/source/resolve { sourceId, sourceInput }` →
`{ items: [{ title, url, durationSeconds, uploader, thumbnailUrl }] }`. It calls
the adapter's existing `resolveInput`, plus a metadata read for Bilibili. It is
read-only and queues nothing.

`processBilibiliUrl` returns `info.title` so the download path and the preview
agree on one title (fixes §3.4).

### 4.2 The picker

A new `src/components/PublishTarget.js`, used by the batch planner and Source
tools:

```
Publish to
( ) Rheaye Reuploads      UC7fx…  ✓ verified · 3 published
(•) ASMR Test Channel     UCab1…  ⚠ not phone-verified — 15 min limit
( ) + Add a channel…
```

- Rows come from `listYouTubeAuthorizations()`, which already returns public
  fields only and never the credential ref.
- Disabled or unusable authorizations render greyed with their status, not hidden
   — a missing channel is more confusing than a disabled one.
- Selecting a row sets `youtubeAuthorizationId` on both the preflight request and
  the create request.
- The uploader step in the preflight then verifies *that* authorization, which it
  already supports.

### 4.3 "Add a channel…"

Opens a three-step panel implementing §2:

1. **Name it** — brief copy explaining this creates a channel on the Google
   account they are about to sign in as, then a button opening
   `youtube.com/channel_switcher` in the default browser.
2. **Authorize** — a `client_ref` selector (defaulting to the one client file
   already present) and a `credential_ref` field for the new token, then
   **Open Google sign-in**, which runs the existing
   `startYouTubeAuthorization()` flow. Copy tells them to pick the new channel on
   Google's consent screen.
3. **Confirm** — shows the channel the OAuth flow reported, with an explicit
   "this is the channel that will receive uploads" confirmation before the row is
   written.

Step 3 matters: it is the only moment the operator can catch having picked the
wrong channel on Google's screen, and it costs one click.

**Phone-verification state.** After registering, call `channels.list` for
`status.longUploadsStatus`. `allowed` means the 15-minute cap is lifted;
anything else renders the warning in §4.2 and blocks queueing a longer video with
a message naming the actual limit — rather than letting the YouTube API reject
the upload after a full download and re-encode.

### 4.4 Backend changes

| File | Change |
|---|---|
| `src/lib/db/sqlite.js` | Migration: `ALTER TABLE youtube_authorizations ADD COLUMN client_ref TEXT DEFAULT ''`, backfilled from `credential_ref`. |
| `src/lib/youtube/authorizations.js` | Accept and return `clientRef`; keep it out of `publicYouTubeAuthorization` alongside `credentialRef`. |
| `src/lib/youtube/oauth.js` | `youtubeClientSecretPath(clientRef)` — resolve the client file by `client_ref`, not the token ref. |
| `scripts/python/authorize_youtube.py` | Take `client_ref` and `token_ref` separately; return every channel from `channels.list`, plus `longUploadsStatus`. |
| `src/lib/pipeline/pipeline.js` | Delete the auto-bind branch of `resolveYouTubeAuthorizationId()`; require an explicit id whenever `uploaderId === 'youtube'` (env default and `pygui` still exempt). |
| `src/lib/pipeline/uploaders/youtube.js` | Resolve the client file through `client_ref` in `testConnection`. |
| `src/app/api/pipeline/source/resolve/route.js` | New, read-only. |

### 4.5 What does not change

The adapter contracts, the job schema, `youtube_upload_bindings`, the
publication lineage, and every guard added in the fix pass. The picker is a new
producer of a field the pipeline already consumes.

## 5. Phases

**Phase 1 — backend, no UI.** §4.4 migration and the `client_ref` split;
`authorize_youtube.py` returning all channels and `longUploadsStatus`; the
resolve endpoint; the §3.4 title fix. Testable entirely through the API.

**Phase 2 — picker.** `PublishTarget.js`, wired into the batch planner and Source
tools. Auto-bind deleted at the end of this phase, not before — deleting it
earlier leaves a window where no YouTube job can be queued at all.

**Phase 3 — add-a-channel flow.** The three-step panel, the confirmation step,
and the phone-verification warning.

**Phase 4 — the real run.** Paste `b23.tv/B2J2aDS`, resolve it, select the new
channel, queue, publish private. Then the debug pass this was always for.

## 6. Tests

| Test | Asserts |
|---|---|
| `resolve` returns real metadata | Title is the Bilibili title, not a slugified URL (§3.4). |
| `resolve` queues nothing | No `video_jobs` row is created by a resolve call. |
| A YouTube job without a target is refused | The auto-bind branch is really gone. |
| A job with a disabled target is refused | Existing behaviour still holds through the picker path. |
| Two channels, one client file | Two authorizations sharing a `client_ref` both register and both resolve their own token. |
| Long video + unverified channel | Refused at queue time with the 15-minute limit named. |
| Channel mismatch still aborts | `verify_authorized_channel` is unchanged and still fires. |

## 7. Risks and open questions

- **The consent-screen channel picker is Google's UI, not ours.** If the operator
  picks the wrong channel there, the app cannot tell until step 3 of §4.3. The
  confirmation step is the mitigation; there is no way to preselect.
- **`longUploadsStatus` is advisory.** It reflects channel state at registration
  time. A channel verified later will read stale until re-checked; the picker
  should offer a refresh rather than caching forever.
- **Deleting auto-bind is a breaking change** for any API caller currently
  relying on it — only this repo's own tests, as far as the code shows, but worth
  a line in the README.
- **Open:** should an authorization be selectable as a *preset* default, so a
  recurring batch does not re-pick every time? Probably yes, stored on
  `pipeline_presets.template_json`, but it is additive and deliberately not in
  Phase 1–3.
- **Unchanged and still true:** the console has no authentication and binds
  `0.0.0.0`. A channel picker makes publishing targets easier to reach for
  anyone on the network, which raises the value of putting auth in front of it.

## 8. Sources

- [Channels | YouTube Data API](https://developers.google.com/youtube/v3/docs/channels) — `list` and `update` only; no `insert`.
- [Implementation: Channels | YouTube Data API](https://developers.google.com/youtube/v3/guides/implementation/channels)
