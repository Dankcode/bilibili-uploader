import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(process.cwd(), 'config', 'bilibili.db');

// Ensure config directory exists
const configDir = path.dirname(dbPath);
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

let db = null;

function hasColumn(tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
}

function addColumnIfMissing(tableName, columnName, definition) {
  if (!hasColumn(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
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
  if (!db) {
    db = new Database(dbPath);
    console.log('SQLite Database connected at:', dbPath);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS youtube_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT UNIQUE,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      finished_at TEXT
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
      last_tested_at TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
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

    CREATE INDEX IF NOT EXISTS idx_video_jobs_status_created ON video_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_video_job_steps_job_id ON video_job_steps(job_id);
    CREATE INDEX IF NOT EXISTS idx_video_assets_job_id ON video_assets(job_id);
    CREATE INDEX IF NOT EXISTS idx_studio_projects_updated ON studio_projects(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_usage_day_service ON api_usage(day, service);
    CREATE INDEX IF NOT EXISTS idx_pipeline_presets_updated ON pipeline_presets(updated_at DESC);
  `);
  addColumnIfMissing('videos', 'tags', "TEXT DEFAULT '[]'");
  addColumnIfMissing('studio_projects', 'analysis_json', "TEXT DEFAULT '{}'");
  console.log('SQLite Database initialized at:', dbPath);
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

// Handle graceful shutdown
const closeDB = () => {
  if (db && db.open) {
    console.log('Closing SQLite Database...');
    db.close();
  }
};

process.on('SIGINT', () => {
  closeDB();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDB();
  process.exit(0);
});

export default db;
