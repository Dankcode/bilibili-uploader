# Project Context

## Overview
Automated Youtube video uploader

## Tech Stack
- **Frontend**: Next.js, React.
- **State Management**: React Hooks (`useState`, `useEffect`).
- **VideoStitching**: Uses Python.
- **AI Integration**: Kimi 2.5 API for text generation and email personalization.
- **Data Scraping**: Integrated Notion API as a dashboard to manage video upload tasks.

## Core Features
1. **Automated Outreach (Email Robot)**:
    - **Data Input**: Supports gathering video information from Notion database. Then downloads the video from bilibili. Then converts the video using AI to modify the video using FFMPEG
    - **Research Discovery**: Automatically scrapes Videos of interest
    - **Personalized Email Generation**: Uses Kimi API to draft titles and descriptions 

2. **Thumbnail Builder**: Using a frame of the video and generating an engaging thumbnail designed to attract clicks using AI. 

3. **Video Builder**: Uses DeepFaceLab to replace the face of the original video with a generated face using AI.

## Core Goal
Promote marketing products by leveraging research expertise and automated ad creation. The system ensures high conversion rates by matching tailored ads with the video content
