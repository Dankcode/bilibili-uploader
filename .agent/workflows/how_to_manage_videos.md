---
description: how to manage videos using the LAN dashboard
---

1. Ensure the app is running with `npm run dev`.
2. Find the host machine's LAN IP address (e.g., `192.168.1.5`).
3. Connect from any device on the same local network at `http://<lan-ip>:4455`.
4. The dashboard will automatically refresh with latest SQLite data from `config/bilibili.db`.
5. For any video record, click **"Edit"** to manually modify:
    - Chinese Name (scraped)
    - English Name (AI translated)
    - Status (Not started, In progress, Done)
6. Click **"Submit"** to persist your changes to the SQLite database.
7. Click **"Manual Execute"** to trigger a single run of the automated `WorkflowService`.
8. Click **"Continuous Loop"** to start the background automation that periodically scrapes and uploads content.
