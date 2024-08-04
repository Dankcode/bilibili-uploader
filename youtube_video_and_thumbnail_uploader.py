import os
import sys
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.discovery import HttpError
from googleapiclient.http import MediaFileUpload
import pickle
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
                    print("Video id '%s' was successfully uploaded." % response['id'])
                else:
                    exit("The upload failed with an unexpected response: %s" % response)
        except HttpError as e:
            if e.resp.status in RETRIABLE_STATUS_CODES:
                error = "A retriable HTTP error %d occurred:\n%s" % (e.resp.status, e.content)
            else:
                raise
        except RETRIABLE_EXCEPTIONS as e:
            error = "A retriable error occurred: %s" % e

        if error is not None:
            print(error)
            retry += 1
            if retry > MAX_RETRIES:
                exit("No longer attempting to retry.")

            max_sleep = 2 ** retry
            sleep_seconds = random.random() * max_sleep
            print("Sleeping %f seconds and then retrying..." % sleep_seconds)
            time.sleep(sleep_seconds)

    return response

def authenticate():
    credentials = None

    path_to_pickle = './token.pickle'
    if os.path.exists(path_to_pickle):
        print('loading credentials from file..')
        with open(path_to_pickle, 'rb') as token:
            credentials = pickle.load(token)

    if not credentials or not credentials.valid:
        if credentials and credentials.expired and credentials.refresh_token:
            print('refreshing access token...')
            credentials.refresh(Request())
        else:
            print('fetching new tokens...')
            flow = InstalledAppFlow.from_client_secrets_file(
                './client_secret.json',
                scopes=['https://www.googleapis.com/auth/youtube.upload']
            )
            flow.run_local_server(port=8080, prompt='consent', authorization_prompt_message='')

            credentials = flow.credentials

            with open(path_to_pickle, 'wb') as f:
                print('saving credentials for the future use...')
                pickle.dump(credentials, f)

    return credentials

def uploads_video_initialisation(video_to_upload, title, description):
    credentials = authenticate()

    youtube = build('youtube', 'v3', credentials=credentials)
    request = youtube.videos().insert(
        part="snippet,status",
        body={
            "snippet": {
                "categoryId": "22",
                "description": description,
                "title": title
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
    if len(sys.argv) != 4:
        print("Usage: python upload_video.py <video_path> <title> <description>")
        sys.exit(1)

    video_path = sys.argv[1]
    title = sys.argv[2]
    description = sys.argv[3]

    uploads_video_initialisation(video_path, title, description)