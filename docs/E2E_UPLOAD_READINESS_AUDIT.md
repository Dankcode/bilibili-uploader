# E2E upload readiness audit — Bilibili `B2J2aDS` → YouTube

**Run date:** 2026-08-24  
**Objective:** Download the supplied Bilibili video, process it through the app, and upload it privately to a newly created Google/YouTube identity.

## Observed process

1. Opened the running local application at `http://localhost:4455`.
2. Confirmed the existing web control plane and worker are online; the app database is available at `config/bilibili.db`.
3. Inspected the Automation planner. Its intended route is **Bilibili URL → processors → Publish to YouTube**.
4. Inspected Connections. There are **0 authorized YouTube accounts**. The Bilibili source is shown as “Needs config / untested.”
5. Performed a read-only request to `https://www.bilibili.com/video/B2J2aDS`; it returned HTTP 200. This alone is not proof that it is a playable video because the current source adapter does not validate page metadata or a Bilibili video identifier before queueing.

No job was queued, no remote account was created, and no video was uploaded during this readiness check.

## Live-test blockers

1. A Google account must be created and verified, then a YouTube channel must exist for that account. Google may require a CAPTCHA or phone verification; those steps need operator participation.
2. The API uploader needs a local OAuth client file named `<credential-ref>_client_secret.json`. Its first run opens Google OAuth consent and writes `<credential-ref>_token.json` with local-only permissions.
3. After OAuth has identified the channel, the account must be registered in **Connections** using its email, channel ID, channel title, and credential reference. The application deliberately refuses passwords, cookies, SMS codes, and OAuth tokens in its UI.
4. The final remote upload needs an explicit confirmation immediately before dispatch. The uploader creates a private YouTube video by default.
5. Provide the canonical Bilibili URL or verify that `B2J2aDS` is the intended video identifier before dispatch. A 200 response alone can be an error or login page.

## Audit findings

### Resolved — OAuth onboarding is now available in Connections

Connections now provides a **Sign in for automated delivery** section. Given a locally stored Google desktop-client file named `<credential-ref>_client_secret.json`, it opens the normal Google OAuth browser flow, verifies the selected YouTube channel, and registers the public email/channel metadata automatically. Token and client-secret files remain local and ignored by Git.

### Resolved — Bilibili login was not an explicit operator flow

The earlier adapter declared a `SESSDATA` credential but did not use it consistently; its downloader only inspected an existing `config/storage.json` file with a headless browser. That gave the operator no supported way to create or refresh the session.

**Resolution:** Connections now opens a visible Playwright Bilibili login window. After the operator signs in and chooses **Check sign-in**, Playwright stores `config/storage.json` with local-only permissions. Downloads read `SESSDATA` from that state without returning, logging, or accepting the cookie through the app UI.

### P1 — Source preflight accepts arbitrary identifiers

`resolveInput()` turns any non-empty text into `https://www.bilibili.com/video/<value>` and reports success before validating Bilibili metadata, availability, duration, or downloadable streams.

**Improve:** Require a canonical Bilibili URL or valid BV/AV identifier, resolve title/duration before queueing, and show a clear preflight error for unavailable/restricted content.

### P1 — Upload readiness is a false positive

`youtube.testConnection()` only checks that the Python script exists. It does not check that an authorization is selected, that the client-secret file exists, that a token can refresh, or that the selected channel matches the OAuth identity.

**Improve:** Make selected-job preflight require a usable authorization and perform a non-mutating channel identity check before a job can be queued.

### P1 — Upload retry is not idempotent

If YouTube accepts an upload but the local process fails before the returned video ID is recorded, retrying the job may create a duplicate private video.

**Improve:** Persist an upload intent/idempotency key before the network call; reconcile a possibly-completed upload using the intended title/time/channel before retrying.

### P2 — Operations visibility is insufficient for live triage

The Python uploader buffers stdout/stderr until exit. A long OAuth or resumable upload provides no structured progress in the Process page, and worker logs omit a correlation ID for external operations.

**Improve:** Stream redacted uploader progress into `video_job_steps.log`, record OAuth/channel verification as a distinct preflight step, and include the job ID in all worker messages.
