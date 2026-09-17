"""Reconcile an unconfirmed upload receipt against the channel's uploads.

Called by the release layer when a previous attempt reached state 'sent' but
never recorded a video id (the worker died mid-upload, or the uploader crashed
after YouTube accepted the file). Uploading again would cost 1,600 units and
create a duplicate; looking costs 2:

    channels.list(part=contentDetails, mine=True)     1 unit
    playlistItems.list(uploads playlist, 50 newest)   1 unit

Usage:
    youtube_reconcile_upload.py <credential_ref> <expected_channel_id> <client_ref> <title> <sent_at_iso>

Prints exactly one JSON line:
    {"found": true, "videoId": "...", "candidates": 1}
    {"found": false, "candidates": 0}
Exit 0 on a completed lookup (found or not), non-zero when the lookup itself
failed — the caller must then refuse to upload again.
"""
import json
import sys
from datetime import datetime, timedelta, timezone

from googleapiclient.discovery import build

from youtube_video_and_thumbnail_uploader import authenticate

# Clock skew between this machine and YouTube, plus time the upload spent in
# flight before the receipt's sent_at was written.
SENT_AT_TOLERANCE = timedelta(minutes=10)


def parse_iso(value):
    text = str(value or '').strip()
    if not text:
        return None
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def find_upload(youtube, expected_channel_id, title, sent_at):
    response = youtube.channels().list(part='id,contentDetails', mine=True).execute()
    channels = response.get('items') or []
    if not channels:
        raise RuntimeError('OAuth authorization does not expose an owned YouTube channel')
    channel = channels[0]
    if expected_channel_id and channel.get('id') != expected_channel_id:
        raise RuntimeError(
            f"OAuth channel mismatch: selected {expected_channel_id}, authorized {channel.get('id')}"
        )
    uploads = (channel.get('contentDetails') or {}).get('relatedPlaylists', {}).get('uploads')
    if not uploads:
        raise RuntimeError('Channel has no uploads playlist')

    items = youtube.playlistItems().list(
        part='snippet,contentDetails', playlistId=uploads, maxResults=50,
    ).execute().get('items') or []

    earliest = sent_at - SENT_AT_TOLERANCE if sent_at else None
    matches = []
    for item in items:
        snippet = item.get('snippet') or {}
        if snippet.get('title', '').strip() != title.strip():
            continue
        published = parse_iso(snippet.get('publishedAt'))
        if earliest and published and published < earliest:
            continue
        video_id = (item.get('contentDetails') or {}).get('videoId') or (snippet.get('resourceId') or {}).get('videoId')
        if video_id:
            matches.append((published or datetime.min.replace(tzinfo=timezone.utc), video_id))
    matches.sort(reverse=True)
    return matches


def main(argv):
    if len(argv) < 6:
        raise SystemExit('usage: youtube_reconcile_upload.py <credential_ref> <expected_channel_id> <client_ref> <title> <sent_at_iso>')
    credential_ref, expected_channel_id, client_ref, title, sent_at = argv[1:6]
    credentials = authenticate(credential_ref, client_ref or credential_ref)
    youtube = build('youtube', 'v3', credentials=credentials)
    matches = find_upload(youtube, expected_channel_id, title, parse_iso(sent_at))
    result = {'found': bool(matches), 'candidates': len(matches)}
    if matches:
        result['videoId'] = matches[0][1]
    print(json.dumps(result))


if __name__ == '__main__':
    main(sys.argv)
