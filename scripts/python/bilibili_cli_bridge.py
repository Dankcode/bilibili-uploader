"""Read-only JSON bridge to bilibili-cli's SDK; never loads login credentials."""
import asyncio
import contextlib
import io
import json
import re
import sys


async def query(request):
    # Import the same SDK client used by public-clis/bilibili-cli. Deliberately
    # never import bili_cli.auth or call get_credential (even optional mode).
    from bili_cli import client

    operation = request.get('operation')
    if operation == 'creator-page':
        uid = str(request.get('creatorId', ''))
        page = request.get('page', 1)
        if not re.fullmatch(r'\d{1,20}', uid) or type(page) is not int or not 1 <= page <= 1000:
            raise ValueError('Invalid creator page')
        # Fetch exactly one page: the CLI's aggregated list may silently stop
        # after a later-page failure and discards the upstream total count.
        return await client.user.User(uid=int(uid), credential=None).get_videos(pn=page, ps=30)

    video_id = str(request.get('videoId', ''))
    if re.fullmatch(r'BV[0-9A-Za-z]{10}', video_id):
        video = client.video.Video(bvid=video_id, credential=None)
    elif re.fullmatch(r'av\d+', video_id):
        video = client.video.Video(aid=int(video_id[2:]), credential=None)
    else:
        raise ValueError('Invalid video ID')
    if operation not in ('metadata', 'streams'):
        raise ValueError('Invalid operation')
    view = await video.get_info()
    page_number = request.get('page', 1)
    if type(page_number) is not int or page_number < 1:
        raise ValueError('Invalid video page')
    pages = view.get('pages') or [{'page': 1, 'cid': view.get('cid'), 'part': view.get('title')}]
    selected = next((page for page in pages if page.get('page') == page_number), None)
    if selected is None:
        raise ValueError('Video page does not exist')
    play = await video.get_download_url(cid=selected['cid']) if operation == 'streams' else None
    return {'view': view, 'play': play}


def main():
    try:
        request = json.load(sys.stdin)
        # Keep SDK diagnostics off the machine-readable protocol.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            data = asyncio.run(asyncio.wait_for(query(request), timeout=60))
        result = {'ok': True, 'data': data}
    except Exception as error:
        # Never forward SDK exception objects, headers, or request URLs.
        result = {'ok': False, 'error': type(error).__name__}
    print(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__':
    main()
