import os
import re
import sys
import json
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.discovery import HttpError
from googleapiclient.http import MediaFileUpload
import http.client
import httplib2
import random
import time

RETRIABLE_EXCEPTIONS = (httplib2.HttpLib2Error, IOError, http.client.NotConnected,
                        http.client.IncompleteRead, http.client.ImproperConnectionState,
                        http.client.CannotSendRequest, http.client.CannotSendHeader,
                        http.client.ResponseNotReady, http.client.BadStatusLine)
httplib2.RETRIES = 1
RETRIABLE_STATUS_CODES = [500, 502, 503, 504]
MAX_RETRIES = 10
SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
]

def resumable_upload(insert_request):
    response = None
    error = None
    retry = 0
    while response is None:
        try:
            print("Uploading file...")
            status, response = insert_request.next_chunk()
            if response is not None:
                if 'id' in response:
                    print(f"Video id '{response['id']}' was successfully uploaded.")
                    return response['id']  # Return the video id instead of response
                else:
                    exit(f"The upload failed with an unexpected response: {response}")
        except HttpError as e:
            if e.resp.status in RETRIABLE_STATUS_CODES:
                error = f"A retriable HTTP error {e.resp.status} occurred:\n{e.content}"
            else:
                raise
        except RETRIABLE_EXCEPTIONS as e:
            error = f"A retriable error occurred: {e}"

        if error is not None:
            print(error)
            retry += 1
            if retry > MAX_RETRIES:
                exit("No longer attempting to retry.")

            max_sleep = 2 ** retry
            sleep_seconds = random.random() * max_sleep
            print(f"Sleeping {sleep_seconds:.2f} seconds and then retrying...")
            time.sleep(sleep_seconds)

    return None  # Explicitly return None if no response after retries

def normalize_credential_ref(value):
    credential_ref = str(value or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', credential_ref) or '..' in credential_ref:
        raise ValueError('OAuth credential reference must be a simple local name without paths')
    return credential_ref


def load_saved_credentials(token_path, client_secret_path):
    """Load a refresh token, filling client metadata from its local OAuth client.

    The web OAuth callback intentionally saves only token fields.  The Python
    Google client, unlike the Node client used for that callback, insists that
    authorized-user JSON also repeats the OAuth client ID and secret.  Keep
    those values in the owner-only client file and combine them in memory.
    """
    with open(token_path, 'r', encoding='utf-8') as token_file:
        token_data = json.load(token_file)

    if not token_data.get('client_id') or not token_data.get('client_secret'):
        if not os.path.exists(client_secret_path):
            raise FileNotFoundError(f'Missing OAuth client file: {client_secret_path}')
        with open(client_secret_path, 'r', encoding='utf-8') as client_file:
            client_document = json.load(client_file)
        client = client_document.get('web') or client_document.get('installed') or {}
        if not client.get('client_id') or not client.get('client_secret'):
            raise ValueError('OAuth client file is missing its client ID or client secret')
        token_data = {
            **token_data,
            'client_id': client['client_id'],
            'client_secret': client['client_secret'],
        }

    return Credentials.from_authorized_user_info(token_data, SCOPES)


def authenticate(token_ref, client_ref=None):
    token_ref = normalize_credential_ref(token_ref)
    client_ref = normalize_credential_ref(client_ref or token_ref)
    credentials = None
    token_path = f'./{token_ref}_token.json'
    legacy_pickle_path = f'./{token_ref}_token.pickle'
    client_secret_path = f'./{client_ref}_client_secret.json'

    if os.path.exists(token_path):
        print('Loading OAuth credentials from JSON...')
        credentials = load_saved_credentials(token_path, client_secret_path)
        if not credentials.has_scopes(SCOPES):
            print('Saved token lacks channel-verification scope; requesting OAuth consent again.')
            credentials = None
    elif os.path.exists(legacy_pickle_path):
        print(
            f'Ignoring unsafe legacy pickle token {legacy_pickle_path}; OAuth consent will create a JSON token.',
            file=sys.stderr,
        )

    if not credentials or not credentials.valid:
        if credentials and credentials.expired and credentials.refresh_token:
            print('Refreshing access token...')
            credentials.refresh(Request())
        else:
            print('Fetching new tokens...')
            if not os.path.exists(client_secret_path):
                raise FileNotFoundError(f'Missing OAuth client file: {client_secret_path}')
            flow = InstalledAppFlow.from_client_secrets_file(
                client_secret_path,
                scopes=SCOPES,
            )
            flow.run_local_server(port=8080, prompt='consent', authorization_prompt_message='')

            credentials = flow.credentials

        with open(token_path, 'w', encoding='utf-8') as token_file:
            print('Saving OAuth credentials as JSON for future use...')
            token_file.write(credentials.to_json())
        try:
            os.chmod(token_path, 0o600)
        except OSError:
            pass

    return credentials


def verify_authorized_channel(youtube, expected_channel_id):
    response = youtube.channels().list(part='id,snippet', mine=True).execute()
    channels = response.get('items') or []
    if not channels:
        raise RuntimeError('OAuth authorization does not expose an owned YouTube channel')
    channel = channels[0]
    actual_channel_id = channel.get('id', '')
    if expected_channel_id and actual_channel_id != expected_channel_id:
        raise RuntimeError(
            f'OAuth channel mismatch: selected {expected_channel_id}, authorized {actual_channel_id}'
        )
    print(f"Verified YouTube channel '{actual_channel_id}'.")
    return actual_channel_id


def clean_upload_options(value):
    raw = value if isinstance(value, dict) else {}
    privacy = raw.get('privacyStatus', 'private')
    if privacy not in ('private', 'unlisted', 'public'):
        privacy = 'private'
    license_name = raw.get('license', '')
    if license_name not in ('youtube', 'creativeCommon'):
        license_name = ''
    return {
        'privacyStatus': privacy,
        'categoryId': str(raw.get('categoryId', '')).strip(),
        'defaultLanguage': str(raw.get('defaultLanguage', '')).strip(),
        'license': license_name,
        'madeForKids': bool(raw.get('madeForKids', False)),
        'embeddable': raw.get('embeddable', True) is not False,
        'notifySubscribers': bool(raw.get('notifySubscribers', False)),
    }


def uploads_video_initialisation(token_ref, video_to_upload, title, description, tags, expected_channel_id='', client_ref=None, upload_options=None):
    credentials = authenticate(token_ref, client_ref)
    tag_list = tags if isinstance(tags, list) else [tag for tag in str(tags).split() if tag]

    youtube = build('youtube', 'v3', credentials=credentials)
    verify_authorized_channel(youtube, expected_channel_id)

    settings = clean_upload_options(upload_options)
    snippet = {"description": description, "title": title, "tags": tag_list}
    if settings['categoryId']:
        snippet['categoryId'] = settings['categoryId']
    if settings['defaultLanguage']:
        snippet['defaultLanguage'] = settings['defaultLanguage']
        snippet['defaultAudioLanguage'] = settings['defaultLanguage']
    status = {
        "privacyStatus": settings['privacyStatus'],
        "selfDeclaredMadeForKids": settings['madeForKids'],
        "embeddable": settings['embeddable'],
    }
    if settings['license']:
        status['license'] = settings['license']
    request = youtube.videos().insert(
        part="snippet,status",
        body={
            "snippet": snippet,
            "status": status,
        },
        media_body=MediaFileUpload(video_to_upload, chunksize=-1, resumable=True),
        notifySubscribers=settings['notifySubscribers'],
    )
    response = resumable_upload(request)
    return response

if __name__ == '__main__':
    video_path = sys.argv[1]
    title = sys.argv[2]
    description = sys.argv[3]
    tags = sys.argv[4]
    credential_ref = sys.argv[5]
    expected_channel_id = sys.argv[6] if len(sys.argv) > 6 else ''
    client_ref = sys.argv[7] if len(sys.argv) > 7 else credential_ref
    try:
        upload_options = json.loads(sys.argv[8]) if len(sys.argv) > 8 else {}
    except (TypeError, ValueError):
        raise ValueError('Upload options must be valid JSON')

    video_id = uploads_video_initialisation(
        credential_ref,
        video_path,
        title,
        description,
        tags,
        expected_channel_id,
        client_ref,
        upload_options,
    )
    if video_id:
        print(video_id)
