# Project Context

## Overview
Automated Youtube video uploader and management suite. Replaced Notion with a local SQLite engine and a LAN-accessible management dashboard.

## Tech Stack
- **Frontend**: Next.js (App Router), React, CSS Modules.
- **Database**: SQLite via `better-sqlite3`.
- **State Management**: React Hooks (`useState`, `useEffect`) and Server Actions.
- **Video Processing**: FFmpeg and Python core logic.
- **AI Integration**: Kimi 2.5 API for high-quality text translation and metadata generation.
- **Networking**: Configured for LAN access on port **4455**.

## Core Features
1. **Automated Workflow**:
    - **Scraping**: Fetches new video data from Bilibili space URLs.
    - **AI Metadata**: Translates Chinese titles and generates catchy English names and descriptions.
    - **Download/Merge**: Automated acquisition of video/audio streams and merging via FFmpeg.
    - **Uploading**: Integration with Python-based YouTube uploader.

2. **Studio Suite Dashboard**:
    - **Real-time Monitoring**: Table view of all video statuses (Not started, In progress, Done).
    - **Manual Modification**: Ability to edit titles and descriptions before upload.
    - **Remote Control**: LAN-optimized UI for management from mobile devices on the local network.

3. **Robust Lifecycle**:
    - Persistent local storage in `config/bilibili.db`.
    - Graceful database shutdown on application termination (SIGINT/SIGTERM).

## Core Goal
Streamline the creation and promotion of marketing-focused video content through high-automation and centralized local control.
