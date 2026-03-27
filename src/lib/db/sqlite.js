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

/**
 * Initialize the database schema and ensure connection is open.
 */
export function initDB() {
  if (!db) {
    db = new Database(dbPath);
    console.log('SQLite Database connected at:', dbPath);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS spaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT UNIQUE,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      auto_upload_time TEXT,  -- New column (ISO format or HH:mm)
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
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
 * Fetch all spaces for tabs.
 */
export function getSpaces() {
  return db.prepare('SELECT * FROM spaces ORDER BY id ASC').all();
}

/**
 * Add a new space (tab).
 */
export function addSpace(spaceId, name) {
  const stmt = db.prepare('INSERT INTO spaces (space_id, name) VALUES (?, ?)');
  return stmt.run(spaceId, name);
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
  return db.prepare("SELECT * FROM videos WHERE status = 'Not started' AND auto_upload_time IS NOT NULL AND auto_upload_time <= ?").all(now);
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
  const stmt = db.prepare(`
    UPDATE videos 
    SET english_name = ?, english_description = ?, edited_video_path = ?, auto_upload_time = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  return stmt.run(data.english_name, data.english_description, data.edited_video_path || null, data.auto_upload_time || null, id);
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
  const { chinese_name, english_name, english_description, status, edited_video_path, auto_upload_time } = data;
  const stmt = db.prepare(`
    UPDATE videos 
    SET chinese_name = ?, english_name = ?, english_description = ?, status = ?, edited_video_path = ?, auto_upload_time = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  return stmt.run(chinese_name, english_name, english_description, status, edited_video_path, auto_upload_time, id);
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
