import json
import os
import re
import sys
from urllib.request import Request, urlopen

from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build


SCOPES = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
]


def credential_ref(value):
    ref = str(value or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', ref) or '..' in ref:
        raise ValueError('Invalid credential reference')
    return ref


def expected_email(value):
    email = str(value or '').strip().lower()
    if email and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        raise ValueError('Invalid expected Google account email')
    return email


def write_owner_only(path, data):
    with open(path, 'w', encoding='utf-8') as output:
        output.write(data)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def user_info(access_token):
    request = Request('https://www.googleapis.com/oauth2/v2/userinfo')
    request.add_header('Authorization', f'Bearer {access_token}')
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode('utf-8'))


def authorize(client_ref, token_ref, account_email=''):
    client_path = f'./{client_ref}_client_secret.json'
    if not os.path.exists(client_path):
        raise FileNotFoundError('Missing local OAuth client file')
    flow = InstalledAppFlow.from_client_secrets_file(client_path, scopes=SCOPES)
    auth_options = {'prompt': 'consent', 'authorization_prompt_message': ''}
    if account_email:
        auth_options['login_hint'] = account_email
    credentials = flow.run_local_server(port=0, **auth_options)
    token_path = f'./{token_ref}_token.json'
    write_owner_only(token_path, credentials.to_json())

    youtube = build('youtube', 'v3', credentials=credentials)
    channels = youtube.channels().list(part='id,snippet,status', mine=True).execute().get('items') or []
    if not channels:
        raise RuntimeError('Authorized Google account has no YouTube channel')
    identity = user_info(credentials.token)
    email = str(identity.get('email') or '').strip()
    if not email:
        raise RuntimeError('Google authorization did not provide an email address')
    if account_email and email.lower() != account_email:
        try:
            os.remove(token_path)
        except OSError:
            pass
        raise RuntimeError('Selected Google account did not match the requested account')
    print(json.dumps({
        'emailAddress': email,
        'googleSubject': str(identity.get('id') or ''),
        # Do not silently select channels[0]. The app shows every returned
        # channel and requires an explicit confirmation before registration.
        'channels': [{
            'channelId': str(channel.get('id') or ''),
            'channelTitle': str(channel.get('snippet', {}).get('title') or ''),
            'longUploadsStatus': str(channel.get('status', {}).get('longUploadsStatus') or 'unknown'),
        } for channel in channels if channel.get('id')],
    }))


if __name__ == '__main__':
    try:
        client_ref = credential_ref(sys.argv[1] if len(sys.argv) > 1 else '')
        token_ref = credential_ref(sys.argv[2] if len(sys.argv) > 2 else client_ref)
        authorize(client_ref, token_ref, expected_email(sys.argv[3] if len(sys.argv) > 3 else ''))
    except Exception:
        # Keep errors non-sensitive: OAuth URLs, tokens, and client details must
        # never be surfaced by the app status endpoint.
        print('Authorization did not complete.', file=sys.stderr)
        sys.exit(1)
