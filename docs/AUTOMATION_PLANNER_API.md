# Automation planner API

The planner’s per-video fields are available to local API clients through the
same control route used by the console. This is intended for an operator using
Codex, Claude, or another approved local agent to prepare a scraped catalog;
it does not expose provider keys, OAuth tokens, or YouTube credentials.

## Read the scraped catalog

`GET /api/control/operations/bilibili-scrapes?creatorId=123456&limit=100`

Each video includes `selected`, `scheduledFor`, `scheduleDays` (`0` is Sunday),
`copyPrompt`, `tags`, `generationFields`, its persisted `aiPreview`, and any
row-specific `youtubeOptions`. The response compares each BV ID with the SQL
operations and YouTube-publication history, exposing `deliveryState`,
`isCompleted`, and `isUploaded`. Already uploaded rows are omitted by default;
pass `includeUploaded=1` to inspect them with their persisted `uploadedUrl`.

## Update a video’s delivery plan

`PATCH /api/control/operations/bilibili-scrapes`

```json
{
  "creatorId": "123456",
  "bvid": "BV1xx411c7mD",
  "selected": true,
  "scheduledFor": "2026-09-08T01:00:00.000Z",
  "scheduleDays": [1, 3, 5],
  "copyPrompt": "Write an informative Xiaoyu-style title and a three-part English description. Keep claims grounded in the video.",
  "tags": ["xiaoyu", "bilibili", "calm"],
  "generationFields": { "title": true, "description": true, "tags": true },
  "youtubeOptions": {
    "privacyStatus": "private",
    "defaultLanguage": "en",
    "embeddable": true
  }
}
```

Only those planning fields and the delivery title/description are writable.
The API keeps scraped source facts intact, validates date values and weekday
numbers, and filters YouTube options to the supported upload fields.

## Test an AI metadata draft without dispatching

`POST /api/control/operations/bilibili-scrapes/preview`

```json
{
  "creatorId": "123456",
  "bvid": "BV1xx411c7mD",
  "copyPrompt": "Prioritize a useful, grounded English title.",
  "generationFields": { "title": true, "description": true, "tags": true },
  "provider": "codex"
}
```

This calls the configured Codex-compatible AI provider, creates no upload job,
and persists the result on the source row as `aiPreview`. The supplied brief
and selected generated fields are saved with that test run, so a later agent
or operator can review or apply the same result.

## Queue selected videos

`POST /api/control/operations/batches` already accepts an `items` array. Pass
each item’s `scheduledFor`, metadata `copyPrompt`, and YouTube options. The
console does this automatically after applying its row settings.

Keep the console on a trusted local network: this installation has no built-in
user authentication, so API access is intentionally limited to environments
you already trust.
