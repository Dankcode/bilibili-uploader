import os
import re
import sys
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


def authenticate(token_ref, client_ref=None):
    token_ref = normalize_credential_ref(token_ref)
    client_ref = normalize_credential_ref(client_ref or token_ref)
    credentials = None
    token_path = f'./{token_ref}_token.json'
    legacy_pickle_path = f'./{token_ref}_token.pickle'
    client_secret_path = f'./{client_ref}_client_secret.json'

    if os.path.exists(token_path):
        print('Loading OAuth credentials from JSON...')
        credentials = Credentials.from_authorized_user_file(token_path, SCOPES)
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


def uploads_video_initialisation(token_ref, video_to_upload, title, description, tags, expected_channel_id='', client_ref=None):
    credentials = authenticate(token_ref, client_ref)
    tag_list = tags if isinstance(tags, list) else [tag for tag in str(tags).split() if tag]

    youtube = build('youtube', 'v3', credentials=credentials)
    verify_authorized_channel(youtube, expected_channel_id)

    request = youtube.videos().insert(
        part="snippet,status",
        body={
            "snippet": {
                "categoryId": "22",  # You can change the category ID if needed
                "description": description,
                "title": title,
                "tags": tag_list
            },
            "status": {
                "privacyStatus": "private"
            }
        },
        media_body=MediaFileUpload(video_to_upload, chunksize=-1, resumable=True)
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

    video_id = uploads_video_initialisation(
        credential_ref,
        video_path,
        title,
        description,
        tags,
        expected_channel_id,
        client_ref,
    )
    if video_id:
        print(video_id)
