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

def authenticate(id):
    credentials = None
    path_to_pickle = f'./{id}_token.pickle'  # Use the id to define a specific token path

    if os.path.exists(path_to_pickle):
        print('Loading credentials from file...')
        with open(path_to_pickle, 'rb') as token:
            credentials = pickle.load(token)

    if not credentials or not credentials.valid:
        if credentials and credentials.expired and credentials.refresh_token:
            print('Refreshing access token...')
            credentials.refresh(Request())
        else:
            print('Fetching new tokens...')
            # Use the id to load the specific client_secret.json file
            flow = InstalledAppFlow.from_client_secrets_file(
                f'./{id}_client_secret.json',  # Dynamically load client_secret.json using id
                scopes=['https://www.googleapis.com/auth/youtube.upload']
            )
            flow.run_local_server(port=8080, prompt='consent', authorization_prompt_message='')

            credentials = flow.credentials

            # Save credentials for future use
            with open(path_to_pickle, 'wb') as f:
                print('Saving credentials for future use...')
                pickle.dump(credentials, f)

    return credentials

def uploads_video_initialisation(id, video_to_upload, title, description, tags):
    credentials = authenticate(id)
    tag_list = tags if isinstance(tags, list) else [tag for tag in str(tags).split() if tag]

    youtube = build('youtube', 'v3', credentials=credentials)

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
    id = sys.argv[5]  # New id parameter

    video_id = uploads_video_initialisation(id, video_path, title, description, tags)
    if video_id:
        print(video_id)
