import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { readRuntimeSettings, resolveDatabasePath } from '../runtime/settings.js';

let db = null;
let activeDbPath = '';

function selectedDbPath() {
  return resolveDatabasePath(readRuntimeSettings());
}

function getDatabase() {
  const nextPath = selectedDbPath();
  if (!db || activeDbPath !== nextPath) initDB();
  return db;
}

const databaseFacade = new Proxy({}, {
  get(_target, property) {
    const database = getDatabase();
    const value = database[property];
    return typeof value === 'function' ? value.bind(database) : value;
  },
});

function hasColumn(tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
}

function addColumnIfMissing(tableName, columnName, definition) {
  if (!hasColumn(tableName, columnName)) {
    try {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    } catch (error) {
      // Next can evaluate independent route bundles in parallel during a
      // production build. A second process may add the same additive column
      // after the PRAGMA check but before this ALTER reaches SQLite.
      if (!/duplicate column name/i.test(String(error?.message || error))) throw error;
    }
  }
}

function normalizeAutoUploadTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('auto_upload_time must be a valid ISO datetime');
  }
  return parsed.toISOString();
}

function coalesceValue(nextValue, previousValue, fallback = null) {
  return nextValue === undefined ? (previousValue ?? fallback) : (nextValue ?? fallback);
}

/**
 * Initialize the database schema and ensure connection is open.
 */
export function initDB() {
  const dbPath = selectedDbPath();
  if (db && activeDbPath !== dbPath) {
    db.close();
    db = null;
  }
  if (!db) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    activeDbPath = dbPath;
    console.log('SQLite Database connected at:', dbPath);
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS youtube_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT UNIQUE,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS youtube_authorizations (
      id TEXT PRIMARY KEY,
      google_subject TEXT DEFAULT '',
      email_address TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_title TEXT DEFAULT '',
      credential_ref TEXT NOT NULL UNIQUE,
      client_ref TEXT DEFAULT '',
      long_uploads_status TEXT DEFAULT 'unknown',
      scopes_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'configured',
      enabled INTEGER NOT NULL DEFAULT 1,
      authorized_at TEXT DEFAULT '',
      verified_at TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(email_address, channel_id)
    );

    CREATE TABLE IF NOT EXISTS spaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      youtube_channel_id INTEGER, -- Link to youtube_channels table
      space_id TEXT UNIQUE,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (youtube_channel_id) REFERENCES youtube_channels(id)
    );

    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT, -- Link to spaces table
      chinese_name TEXT,
      chinese_description TEXT,
      bilibili_url TEXT UNIQUE,
      status TEXT DEFAULT 'Not started',
      valid_upload TEXT DEFAULT 'Valid',
      english_name TEXT,
      english_description TEXT,
      release_date TEXT,
      youtube_url TEXT,
      edited_video_path TEXT, -- New column
      auto_upload_time TEXT,  -- ISO datetime
      tags TEXT DEFAULT '[]',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS video_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      source_input TEXT NOT NULL,
      processor_ids_json TEXT DEFAULT '[]',
      uploader_id TEXT DEFAULT '',
      options_json TEXT DEFAULT '{}',
      status TEXT DEFAULT 'queued',
      current_step TEXT DEFAULT '',
      error TEXT DEFAULT '',
      video_row_id INTEGER,
      scene_script_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS video_job_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      step TEXT NOT NULL,
      attempt INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      progress REAL DEFAULT 0,
      progress_note TEXT DEFAULT '',
      log TEXT DEFAULT '',
      started_at TEXT,
      finished_at TEXT,
      metrics_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS video_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      meta_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS service_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL UNIQUE,
      credentials_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER DEFAULT 0,
      status TEXT DEFAULT 'untested',
      auth_state TEXT DEFAULT 'unknown',
      checked_at TEXT DEFAULT '',
      last_tested_at TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Mail remains a projection of operations state: these rows are durable
    -- evidence and queues, never prerequisites for media processing.
    CREATE TABLE IF NOT EXISTS mail_accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'gmail',
      email_address TEXT NOT NULL UNIQUE,
      display_name TEXT DEFAULT '',
      youtube_channel_id TEXT DEFAULT '',
      label_prefix TEXT NOT NULL DEFAULT 'Studio',
      credential_ref TEXT NOT NULL DEFAULT '',
      scopes_json TEXT NOT NULL DEFAULT '[]',
      labels_json TEXT NOT NULL DEFAULT '{}',
      history_id TEXT DEFAULT '',
      last_sync_at TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'untested',
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS video_mail_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      gmail_thread_id TEXT DEFAULT '',
      rfc822_root_id TEXT DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      label_path TEXT NOT NULL DEFAULT '',
      message_count INTEGER NOT NULL DEFAULT 0,
      last_status TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(video_id) REFERENCES video_records(id) ON DELETE CASCADE,
      FOREIGN KEY(account_id) REFERENCES mail_accounts(id) ON DELETE CASCADE,
      UNIQUE(video_id, account_id)
    );

    CREATE TABLE IF NOT EXISTS mail_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      thread_row_id INTEGER,
      video_id TEXT DEFAULT '',
      direction TEXT NOT NULL,
      gmail_message_id TEXT DEFAULT '',
      gmail_thread_id TEXT DEFAULT '',
      rfc822_id TEXT DEFAULT '',
      from_addr TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      snippet TEXT DEFAULT '',
      body_text TEXT DEFAULT '',
      labels_json TEXT NOT NULL DEFAULT '[]',
      event_kind TEXT DEFAULT '',
      sent_at TEXT DEFAULT '',
      received_at TEXT DEFAULT '',
      raw_headers_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES mail_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY(thread_row_id) REFERENCES video_mail_threads(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS mail_ingest_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_row_id INTEGER NOT NULL,
      account_id TEXT NOT NULL,
      video_id TEXT DEFAULT '',
      publication_id INTEGER,
      parser_id TEXT NOT NULL,
      parser_version INTEGER NOT NULL DEFAULT 1,
      category TEXT NOT NULL DEFAULT 'other',
      severity TEXT NOT NULL DEFAULT 'info',
      title TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      remote_video_id TEXT DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      acknowledged_at TEXT DEFAULT '',
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(message_row_id) REFERENCES mail_messages(id) ON DELETE CASCADE,
      FOREIGN KEY(account_id) REFERENCES mail_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY(publication_id) REFERENCES video_publications(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS mail_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      video_id TEXT DEFAULT '',
      job_id INTEGER,
      event_kind TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_retry_at TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      claimed_at TEXT DEFAULT '',
      worker_id TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES mail_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mail_oauth_states (
      state TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studio_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      video_path TEXT NOT NULL,
      transcript_md TEXT DEFAULT '',
      subtitle_text TEXT DEFAULT '',
      format TEXT DEFAULT 'ass',
      chat_history_json TEXT DEFAULT '[]',
      frame_manifest_json TEXT DEFAULT '[]',
      context_md TEXT DEFAULT '',
      context_manifest_json TEXT DEFAULT '[]',
      context_settings_json TEXT DEFAULT '{}',
      stage_status_json TEXT DEFAULT '{}',
      analysis_json TEXT DEFAULT '{}',
      source_lang TEXT DEFAULT 'zh',
      target_lang TEXT DEFAULT 'en',
      quality TEXT DEFAULT 'fast',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_usage (
      day TEXT NOT NULL,
      service TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      seconds REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (day, service, key_hash)
    );

    CREATE TABLE IF NOT EXISTS pipeline_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template_json TEXT NOT NULL DEFAULT '{}',
      built_in INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS video_records (
      id TEXT PRIMARY KEY,
      legacy_video_id INTEGER,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'localFile',
      source_ref TEXT NOT NULL DEFAULT '',
      source_path TEXT DEFAULT '',
      source_url TEXT DEFAULT '',
      campaign TEXT DEFAULT '',
      language TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      priority INTEGER NOT NULL DEFAULT 0,
      preset_id TEXT DEFAULT '',
      scheduled_at TEXT DEFAULT '',
      published_at TEXT DEFAULT '',
      current_version_id INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      context_summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- A creator scrape is source research, not a queued upload. Keep it in a
    -- separate durable catalog so operators can review and re-use it without
    -- accidentally creating jobs for every discovered video.
    CREATE TABLE IF NOT EXISTS bilibili_scraped_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id TEXT NOT NULL,
      bvid TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_title TEXT NOT NULL DEFAULT '',
      source_description TEXT NOT NULL DEFAULT '',
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      uploaded_at TEXT NOT NULL DEFAULT '',
      thumbnail_url TEXT NOT NULL DEFAULT '',
      uploader_name TEXT NOT NULL DEFAULT '',
      selected_for_upload INTEGER NOT NULL DEFAULT 1,
      long_video_enabled INTEGER NOT NULL DEFAULT 1,
      delivery_title TEXT NOT NULL DEFAULT '',
      delivery_description TEXT NOT NULL DEFAULT '',
      delivery_tags_json TEXT NOT NULL DEFAULT '[]',
      generation_fields_json TEXT NOT NULL DEFAULT '["title","description","tags"]',
      ai_preview_json TEXT NOT NULL DEFAULT '{}',
      ai_previewed_at TEXT NOT NULL DEFAULT '',
      last_scraped_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(creator_id, bvid)
    );

    CREATE TABLE IF NOT EXISTS video_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      job_id INTEGER,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT DEFAULT '',
      bytes INTEGER NOT NULL DEFAULT 0,
      duration_seconds REAL NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      fps REAL NOT NULL DEFAULT 0,
      checksum_sha256 TEXT DEFAULT '',
      validation_status TEXT NOT NULL DEFAULT 'pending',
      validation_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(video_id) REFERENCES video_records(id) ON DELETE CASCADE,
      FOREIGN KEY(job_id) REFERENCES video_jobs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS video_publications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      job_id INTEGER,
      platform_id TEXT NOT NULL,
      channel_id TEXT DEFAULT '',
      remote_id TEXT DEFAULT '',
      url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'scheduled',
      scheduled_at TEXT DEFAULT '',
      published_at TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(video_id) REFERENCES video_records(id) ON DELETE CASCADE,
      FOREIGN KEY(job_id) REFERENCES video_jobs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS video_metric_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publication_id INTEGER NOT NULL,
      captured_at TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      watch_time_seconds REAL NOT NULL DEFAULT 0,
      average_view_duration_seconds REAL NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      subscribers_gained INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      conversions INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(publication_id) REFERENCES video_publications(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS youtube_upload_bindings (
      job_id INTEGER PRIMARY KEY,
      authorization_id TEXT NOT NULL,
      publication_id INTEGER UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES video_jobs(id) ON DELETE RESTRICT,
      FOREIGN KEY(authorization_id) REFERENCES youtube_authorizations(id) ON DELETE RESTRICT,
      FOREIGN KEY(publication_id) REFERENCES video_publications(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS automation_batches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      preset_id TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      total_items INTEGER NOT NULL DEFAULT 0,
      completed_items INTEGER NOT NULL DEFAULT 0,
      failed_items INTEGER NOT NULL DEFAULT 0,
      options_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Reusable automation configurations are intentionally separate from a
    -- dispatched batch: editing a saved configuration must never rewrite the
    -- immutable settings of jobs that are already running or completed.
    CREATE TABLE IF NOT EXISTS automation_settings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automation_batch_items (
      batch_id TEXT NOT NULL,
      job_id INTEGER NOT NULL,
      video_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(batch_id, job_id),
      FOREIGN KEY(batch_id) REFERENCES automation_batches(id) ON DELETE CASCADE,
      FOREIGN KEY(job_id) REFERENCES video_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY(video_id) REFERENCES video_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS face_swap_proofs (
      id TEXT PRIMARY KEY,
      engine TEXT NOT NULL DEFAULT 'facefusion',
      engine_version TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      source_image_path TEXT NOT NULL,
      target_video_path TEXT NOT NULL,
      output_video_path TEXT DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      input_probe_json TEXT NOT NULL DEFAULT '{}',
      output_probe_json TEXT NOT NULL DEFAULT '{}',
      validation_json TEXT NOT NULL DEFAULT '{}',
      error TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      completed_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS runtime_workers (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'pipeline',
      host TEXT NOT NULL DEFAULT '',
      pid INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'online',
      started_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_video_jobs_status_created ON video_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_video_job_steps_job_id ON video_job_steps(job_id);
    CREATE INDEX IF NOT EXISTS idx_video_assets_job_id ON video_assets(job_id);
    CREATE INDEX IF NOT EXISTS idx_studio_projects_updated ON studio_projects(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_usage_day_service ON api_usage(day, service);
    CREATE INDEX IF NOT EXISTS idx_pipeline_presets_updated ON pipeline_presets(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_records_status_updated ON video_records(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_records_schedule ON video_records(scheduled_at, status);
    CREATE INDEX IF NOT EXISTS idx_bilibili_scraped_creator_updated ON bilibili_scraped_videos(creator_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bilibili_scraped_selected ON bilibili_scraped_videos(creator_id, selected_for_upload);
    CREATE INDEX IF NOT EXISTS idx_video_versions_video_created ON video_versions(video_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_publications_video ON video_publications(video_id, published_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_video_publications_remote ON video_publications(platform_id, remote_id) WHERE remote_id != '';
    CREATE INDEX IF NOT EXISTS idx_video_metrics_publication_captured ON video_metric_snapshots(publication_id, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_youtube_authorizations_channel ON youtube_authorizations(channel_id);
    CREATE INDEX IF NOT EXISTS idx_youtube_authorizations_status ON youtube_authorizations(enabled, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_youtube_upload_bindings_authorization ON youtube_upload_bindings(authorization_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_batch_items_status ON automation_batch_items(batch_id, status);
    CREATE INDEX IF NOT EXISTS idx_automation_settings_updated ON automation_settings(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_face_swap_proofs_created ON face_swap_proofs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runtime_workers_heartbeat ON runtime_workers(heartbeat_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_messages_gmail_id ON mail_messages(account_id, gmail_message_id) WHERE gmail_message_id != '';
    CREATE INDEX IF NOT EXISTS idx_mail_messages_video ON mail_messages(video_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mail_ingest_unack ON mail_ingest_events(acknowledged_at, severity, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mail_outbox_dispatch ON mail_outbox(status, next_retry_at, created_at ASC);
  `);
  addColumnIfMissing('videos', 'tags', "TEXT DEFAULT '[]'");
  addColumnIfMissing('studio_projects', 'analysis_json', "TEXT DEFAULT '{}'");
  addColumnIfMissing('studio_projects', 'context_md', "TEXT DEFAULT ''");
  addColumnIfMissing('studio_projects', 'context_manifest_json', "TEXT DEFAULT '[]'");
  addColumnIfMissing('studio_projects', 'context_settings_json', "TEXT DEFAULT '{}'");
  addColumnIfMissing('video_jobs', 'video_record_id', "TEXT DEFAULT ''");
  addColumnIfMissing('video_jobs', 'batch_id', "TEXT DEFAULT ''");
  addColumnIfMissing('video_jobs', 'priority', 'INTEGER DEFAULT 0');
  addColumnIfMissing('video_jobs', 'scheduled_for', "TEXT DEFAULT ''");
  addColumnIfMissing('video_jobs', 'claimed_at', "TEXT DEFAULT ''");
  addColumnIfMissing('video_jobs', 'heartbeat_at', "TEXT DEFAULT ''");
  addColumnIfMissing('video_jobs', 'worker_id', "TEXT DEFAULT ''");
  addColumnIfMissing('video_jobs', 'max_attempts', 'INTEGER DEFAULT 3');
  addColumnIfMissing('video_jobs', 'agent_principal', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('video_jobs', 'metadata_approved_by', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('video_jobs', 'cancel_requested', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_idempotency (
      principal TEXT NOT NULL, key TEXT NOT NULL, tool TEXT NOT NULL,
      request_hash TEXT NOT NULL, response_json TEXT, created_at TEXT NOT NULL,
      PRIMARY KEY (principal, key)
    );
    CREATE TABLE IF NOT EXISTS agent_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, principal TEXT NOT NULL,
      tool TEXT NOT NULL, arguments_json TEXT NOT NULL, result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_actions_created ON agent_actions(created_at);
  `);
  addColumnIfMissing('video_job_steps', 'metrics_json', "TEXT DEFAULT '{}'");
  // Connection outcomes are shared by the Connections screen, overview rail,
  // and diagnostics. Keep these additive for installations created before the
  // health model existed.
  addColumnIfMissing('service_connections', 'auth_state', "TEXT DEFAULT 'unknown'");
  addColumnIfMissing('service_connections', 'checked_at', "TEXT DEFAULT ''");
  addColumnIfMissing('video_records', 'context_summary_json', "TEXT DEFAULT '{}'");
  // Per-video delivery planning belongs to the scrape catalog. These are
  // operator/AI-authored preferences only; source facts remain immutable on
  // every re-scrape.
  addColumnIfMissing('bilibili_scraped_videos', 'scheduled_for', "TEXT DEFAULT ''");
  addColumnIfMissing('bilibili_scraped_videos', 'schedule_days_json', "TEXT DEFAULT '[]'");
  addColumnIfMissing('bilibili_scraped_videos', 'copy_prompt', "TEXT DEFAULT ''");
  addColumnIfMissing('bilibili_scraped_videos', 'youtube_options_json', "TEXT DEFAULT '{}'");
  addColumnIfMissing('bilibili_scraped_videos', 'delivery_tags_json', "TEXT DEFAULT '[]'");
  addColumnIfMissing('bilibili_scraped_videos', 'generation_fields_json', "TEXT DEFAULT '[\"title\",\"description\",\"tags\"]'");
  addColumnIfMissing('bilibili_scraped_videos', 'ai_preview_json', "TEXT DEFAULT '{}'");
  addColumnIfMissing('bilibili_scraped_videos', 'ai_previewed_at', "TEXT DEFAULT ''");
  // Videos over YouTube's unverified-channel limit must receive an explicit
  // operator opt-in before the automation can queue them. Existing short rows
  // remain ready; existing long rows start disabled after this migration.
  const hadLongVideoEnabled = hasColumn('bilibili_scraped_videos', 'long_video_enabled');
  addColumnIfMissing('bilibili_scraped_videos', 'long_video_enabled', 'INTEGER NOT NULL DEFAULT 1');
  if (!hadLongVideoEnabled) {
    db.prepare('UPDATE bilibili_scraped_videos SET long_video_enabled = 0, selected_for_upload = 0 WHERE duration_seconds > ?').run(15 * 60);
  }
  // Keep the stored selection aligned with the opt-in even for databases that
  // were opened by an earlier development build before the migration landed.
  db.prepare('UPDATE bilibili_scraped_videos SET selected_for_upload = 0 WHERE duration_seconds > ? AND long_video_enabled = 0').run(15 * 60);
  // An OAuth client belongs to the Google Cloud project, while each selected
  // channel needs its own refresh token. Existing installations used one name
  // for both; retain that working layout until an operator intentionally shares
  // a client secret across more than one channel.
  addColumnIfMissing('youtube_authorizations', 'client_ref', "TEXT DEFAULT ''");
  addColumnIfMissing('youtube_authorizations', 'long_uploads_status', "TEXT DEFAULT 'unknown'");
  db.exec(`
    UPDATE youtube_authorizations
    SET client_ref = credential_ref
    WHERE client_ref IS NULL OR client_ref = '';
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_video_jobs_dispatch
      ON video_jobs(status, scheduled_for, priority DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_video_jobs_video_record
      ON video_jobs(video_record_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_jobs_batch
      ON video_jobs(batch_id, status);
  `);
  console.log('SQLite Database initialized at:', dbPath);
  return databaseFacade;
}

export function reopenDatabase() {
  if (db?.open) db.close();
  db = null;
  activeDbPath = '';
  return initDB();
}

export function getDatabaseStatus() {
  const database = getDatabase();
  const stats = fs.statSync(activeDbPath);
  const workers = database.prepare(`
    SELECT id, role, host, pid, status, started_at AS startedAt,
           heartbeat_at AS heartbeatAt, metadata_json AS metadataJson
    FROM runtime_workers
    ORDER BY heartbeat_at DESC
    LIMIT 10
  `).all().map((worker) => ({
    ...worker,
    metadata: (() => {
      try {
        return JSON.parse(worker.metadataJson || '{}');
      } catch {
        return {};
      }
    })(),
  })).map((worker) => ({
    ...worker,
    online: Date.now() - new Date(worker.heartbeatAt).getTime()
      < Math.max(30000, (Number(worker.metadata.pollSeconds) || 5) * 2500),
  }));
  return {
    path: activeDbPath,
    bytes: stats.size,
    journalMode: database.pragma('journal_mode', { simple: true }),
    workers,
  };
}

/**
 * Fetch all videos, optionally filtered by space_id.
 */
export function getVideos(spaceId = null) {
  if (spaceId) {
    return db.prepare('SELECT * FROM videos WHERE space_id = ? ORDER BY created_at DESC').all(spaceId);
  }
  return db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all();
}

/**
 * Fetch all YouTube Channels.
 */
export function getYouTubeChannels() {
  return db.prepare('SELECT * FROM youtube_channels ORDER BY id ASC').all();
}

/**
 * Add a new YouTube Channel.
 */
export function addYouTubeChannel(channelId, name) {
  const stmt = db.prepare('INSERT INTO youtube_channels (channel_id, name) VALUES (?, ?)');
  return stmt.run(channelId, name);
}

/**
 * Delete a YouTube Channel and its associated spaces/videos.
 */
export function deleteYouTubeChannel(id) {
  const spaces = db.prepare('SELECT id FROM spaces WHERE youtube_channel_id = ?').all(id);
  for (const space of spaces) {
    deleteSpace(space.id);
  }
  db.prepare('DELETE FROM youtube_channels WHERE id = ?').run(id);
}

/**
 * Fetch spaces for a specific YouTube Channel.
 */
export function getSpaces(youtubeChannelId = null) {
  if (youtubeChannelId) {
    return db.prepare('SELECT * FROM spaces WHERE youtube_channel_id = ? ORDER BY id ASC').all(youtubeChannelId);
  }
  return db.prepare('SELECT * FROM spaces ORDER BY id ASC').all();
}

/**
 * Add a new space (tab) linked to a YouTube Channel.
 */
export function addSpace(youtubeChannelId, spaceId, name) {
  const stmt = db.prepare('INSERT INTO spaces (youtube_channel_id, space_id, name) VALUES (?, ?, ?)');
  return stmt.run(youtubeChannelId, spaceId, name);
}

/**
 * Update a space ID or name.
 */
export function updateSpace(id, spaceId, name) {
  const stmt = db.prepare('UPDATE spaces SET space_id = ?, name = ? WHERE id = ?');
  return stmt.run(spaceId, name, id);
}

/**
 * Delete a space and its associated videos.
 */
export function deleteSpace(id) {
  const space = db.prepare('SELECT space_id FROM spaces WHERE id = ?').get(id);
  if (space) {
    db.prepare('DELETE FROM videos WHERE space_id = ?').run(space.space_id);
    db.prepare('DELETE FROM spaces WHERE id = ?').run(id);
  }
}

/**
 * Get a single video by ID.
 */
export function getVideoById(id) {
  return db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
}

/**
 * Find the first pending video for the workflow, prioritizing by space_id.
 */
export function getValidUploadSearch(spaceId = null) {
  if (spaceId) {
    return db.prepare("SELECT * FROM videos WHERE space_id = ? AND status IN ('Not started', 'In progress') AND valid_upload = 'Valid' LIMIT 1").get(spaceId);
  }
  return db.prepare("SELECT * FROM videos WHERE status IN ('Not started', 'In progress') AND valid_upload = 'Valid' LIMIT 1").get();
}

/**
 * Find videos due for auto-upload based on current time.
 */
export function getDueUploads() {
  const now = new Date().toISOString();
  return db.prepare(`
    SELECT * FROM videos
    WHERE status = 'Not started'
      AND auto_upload_time IS NOT NULL
      AND auto_upload_time LIKE '____-__-__T%'
      AND auto_upload_time <= ?
  `).all(now);
}

/**
 * Add a new video record (Scraped content).
 */
export function addVideo(data) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO videos (space_id, chinese_name, chinese_description, bilibili_url)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(data.space_id, data.chinese_name, data.chinese_description || '', data.bilibili_url);
}

/**
 * Update video metadata (AI generated info).
 */
export function updateVideoMetadata(id, data) {
  const existing = getVideoById(id);
  if (!existing) throw new Error(`Video not found: ${id}`);
  const nextAutoUploadTime = data.auto_upload_time === undefined
    ? existing.auto_upload_time
    : normalizeAutoUploadTime(data.auto_upload_time);
  const nextTags = Array.isArray(data.tags)
    ? JSON.stringify(data.tags)
    : (data.tags === undefined ? (existing.tags || '[]') : JSON.stringify([]));
  const stmt = db.prepare(`
    UPDATE videos 
    SET english_name = ?, english_description = ?, tags = ?, edited_video_path = ?, auto_upload_time = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  return stmt.run(
    coalesceValue(data.english_name, existing.english_name),
    coalesceValue(data.english_description, existing.english_description),
    nextTags,
    coalesceValue(data.edited_video_path, existing.edited_video_path),
    nextAutoUploadTime,
    id
  );
}

/**
 * Update video status.
 */
export function updateVideoStatus(id, status) {
  const stmt = db.prepare('UPDATE videos SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  return stmt.run(status, id);
}

/**
 * Update YouTube URL and completion.
 */
export function finalizeUpload(id, youtubeUrl, releaseDate) {
  const stmt = db.prepare(`
    UPDATE videos 
    SET youtube_url = ?, release_date = ?, status = 'Done', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  return stmt.run(youtubeUrl, releaseDate, id);
}

/**
 * Log error.
 */
export function logError(id, error) {
  const stmt = db.prepare('UPDATE videos SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  return stmt.run(error, id);
}

/**
 * Manual edit from the dashboard.
 */
export function manualEdit(id, data) {
  const existing = getVideoById(id);
  if (!existing) throw new Error(`Video not found: ${id}`);
  const stmt = db.prepare(`
    UPDATE videos 
    SET chinese_name = ?, english_name = ?, english_description = ?, status = ?, edited_video_path = ?, auto_upload_time = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  return stmt.run(
    coalesceValue(data.chinese_name, existing.chinese_name),
    coalesceValue(data.english_name, existing.english_name),
    coalesceValue(data.english_description, existing.english_description),
    coalesceValue(data.status, existing.status, 'Not started'),
    coalesceValue(data.edited_video_path, existing.edited_video_path),
    data.auto_upload_time === undefined ? existing.auto_upload_time : normalizeAutoUploadTime(data.auto_upload_time),
    id
  );
}

// Auto-initialize on import
initDB();

export const closeDB = () => {
  if (db && db.open) {
    console.log('Closing SQLite Database...');
    db.close();
    db = null;
    activeDbPath = '';
  }
};

process.once('exit', closeDB);

export default databaseFacade;
