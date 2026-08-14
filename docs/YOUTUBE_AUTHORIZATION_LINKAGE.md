# Authorized YouTube account linkage

## Scope and research conclusion

The adjacent `gmail-account-creator` repository was reviewed statically. It is
not connected to this application and was not executed.

The repository does not contain auditable generator source code. Its README
references `auto_gmail_creator.py`, but that file is absent; the only tracked
implementation artifact is an opaque Windows executable that is currently
deleted from the working tree. The remaining files are configuration, sample
data, screenshots, and marketing documentation.

The README *claims* this high-level automation sequence:

1. Load names, a shared password, browser user agents, proxy settings, and a
   5sim API configuration.
2. Start Selenium/Chrome, rotate browser/network attributes, and warm a session
   by visiting unrelated sites.
3. Fill a synthetic Google signup profile with human-like timing.
4. Attempt alternate/skip paths around phone verification, otherwise purchase
   a disposable number and poll for an SMS code.
5. Save email/password/status records to `data/accounts.json` and update local
   statistics.

Those steps are documentation claims, not source-verified behavior. There is no
Gmail API, YouTube API, OAuth, SQL, video-publication linkage, or CAPTCHA solver
implementation in the repository. Its documented anti-detection, proxy
rotation, synthetic identity, and verification-bypass behavior is unsuitable
for this publishing system and is deliberately not reused.

One tracked external file, `config/password.txt`, contains a credential-like
value and is not protected by a `.gitignore`. If it was ever used, rotate it and
treat the committed value as exposed. Do not import `data/accounts.json`,
passwords, cookies, browser profiles, SMS codes, or 5sim data into this app.

## Implemented model

Only Google accounts that an operator already owns and explicitly authorizes
through OAuth can be registered.

```text
youtube_authorizations
  -> youtube_upload_bindings -> video_jobs -> video_records
                             -> video_publications -> video_metric_snapshots
```

- `youtube_authorizations` stores display identity, the real YouTube channel
  ID, OAuth lifecycle state, and a non-secret local `credential_ref`.
- `youtube_upload_bindings` immutably records which authorization a queued job
  uses and attaches the successful publication to that same authorization.
- `video_publications` remains append-only destination history. The same video
  can therefore be published by different authorized accounts without moving
  account state onto the video row.
- SQLite never accepts or stores Google passwords, cookies, SMS codes, access
  tokens, refresh tokens, or OAuth client secrets.

## Register and use an authorization

1. Create a Google OAuth desktop client. The app requests YouTube upload plus
   read-only channel identity so it can reject a token/channel mismatch before
   delivery.
2. Keep its downloaded client file local and untracked at the repository root,
   named `<credential-ref>_client_secret.json`.
3. In **Connections → Authorized YouTube accounts**, register the account email,
   actual YouTube channel ID, channel title, and the same credential reference.
4. Select the authorized account in Subtitle Studio before queueing an upload.
5. On first API upload, complete Google's normal OAuth consent. The uploader
   writes `<credential-ref>_token.json` with local-only permissions. Legacy
   pickle token files are ignored rather than deserialized.

The equivalent registration API accepts metadata only:

```http
POST /api/operations/youtube-authorizations
Content-Type: application/json

{
  "emailAddress": "owner@example.com",
  "channelId": "UCxxxxxxxxxxxxxxxxxxxxxx",
  "channelTitle": "Operations channel",
  "credentialRef": "youtube-ops"
}
```

Job input selects the returned authorization ID:

```json
{
  "action": "create",
  "sourceId": "localFile",
  "sourceInput": "/absolute/path/video.mp4",
  "uploaderId": "youtube",
  "options": {
    "youtube": {
      "authorizationId": "returned-uuid",
      "privacyStatus": "private"
    }
  }
}
```

Disabled, revoked, or reauthorization-required identities are rejected before a
job is queued. A retry keeps the original binding and cannot silently switch to
another account.

## Audit query

This query traces each YouTube publication back to the selected authorized
account and canonical video record:

```sql
SELECT
  ya.email_address,
  ya.channel_id,
  ya.channel_title,
  vr.id AS video_id,
  vr.title,
  vp.remote_id,
  vp.url,
  vp.published_at
FROM youtube_upload_bindings yub
JOIN youtube_authorizations ya ON ya.id = yub.authorization_id
JOIN video_jobs vj ON vj.id = yub.job_id
JOIN video_records vr ON vr.id = vj.video_record_id
JOIN video_publications vp ON vp.id = yub.publication_id
ORDER BY vp.published_at DESC;
```

The Library and Analytics views expose the same account/channel label without
returning the credential reference or any OAuth material.
