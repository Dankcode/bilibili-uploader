import db from '../db/sqlite';

function nowIso() {
  return new Date().toISOString();
}

function ensureSceneTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_zh TEXT NOT NULL,
      title_en TEXT DEFAULT '',
      kind TEXT DEFAULT 'drama',
      source_hint TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scene_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id INTEGER NOT NULL,
      site TEXT NOT NULL,
      post_id TEXT NOT NULL,
      url TEXT,
      author TEXT,
      content TEXT,
      engagement_json TEXT DEFAULT '{}',
      episode_hint TEXT DEFAULT '',
      timestamp_hint TEXT DEFAULT '',
      scraped_at TEXT NOT NULL,
      UNIQUE(site, post_id)
    );

    CREATE TABLE IF NOT EXISTS scene_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      episode TEXT DEFAULT '',
      time_start TEXT DEFAULT '',
      time_end TEXT DEFAULT '',
      heat_score REAL DEFAULT 0,
      why_hot TEXT DEFAULT '',
      mention_ids_json TEXT DEFAULT '[]',
      status TEXT DEFAULT 'candidate',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scene_scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL,
      script_json TEXT NOT NULL,
      model TEXT DEFAULT '',
      prompt_version INTEGER DEFAULT 1,
      approved INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

ensureSceneTables();

export function upsertShow(show) {
  const titleZh = String(show?.titleZh || show?.title_zh || '').trim();
  if (!titleZh) throw new Error('titleZh is required');
  const now = nowIso();
  const existing = db.prepare('SELECT * FROM shows WHERE title_zh = ?').get(titleZh);
  if (existing) {
    db.prepare(`
      UPDATE shows SET title_en = ?, kind = ?, source_hint = ?, status = ?
      WHERE id = ?
    `).run(
      show.titleEn ?? show.title_en ?? existing.title_en ?? '',
      show.kind ?? existing.kind ?? 'drama',
      show.sourceHint ?? show.source_hint ?? existing.source_hint ?? '',
      show.status ?? existing.status ?? 'active',
      existing.id
    );
    return { id: existing.id };
  }
  const result = db.prepare(`
    INSERT INTO shows (title_zh, title_en, kind, source_hint, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    titleZh,
    show.titleEn || show.title_en || '',
    show.kind || 'drama',
    show.sourceHint || show.source_hint || '',
    show.status || 'active',
    now
  );
  return { id: result.lastInsertRowid };
}

export function listShows() {
  return db.prepare('SELECT * FROM shows ORDER BY created_at DESC').all().map((row) => ({
    id: row.id,
    titleZh: row.title_zh,
    titleEn: row.title_en,
    kind: row.kind,
    sourceHint: row.source_hint,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export function saveMentions(showId, mentions = []) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO scene_mentions (
      show_id, site, post_id, url, author, content, engagement_json,
      episode_hint, timestamp_hint, scraped_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  for (const mention of mentions) {
    const result = stmt.run(
      showId,
      mention.site,
      mention.postId || mention.post_id,
      mention.url || '',
      mention.author || '',
      String(mention.content || '').slice(0, 4000),
      JSON.stringify(mention.engagement || {}),
      mention.episodeHint || mention.episode_hint || '',
      mention.timestampHint || mention.timestamp_hint || '',
      nowIso()
    );
    inserted += result.changes;
  }
  return { inserted, skipped: mentions.length - inserted };
}

export function listMentions(showId) {
  return db.prepare('SELECT * FROM scene_mentions WHERE show_id = ? ORDER BY scraped_at DESC').all(showId).map((row) => ({
    id: row.id,
    site: row.site,
    postId: row.post_id,
    url: row.url,
    author: row.author,
    content: row.content,
    engagement: parseJson(row.engagement_json, {}),
    episodeHint: row.episode_hint,
    timestampHint: row.timestamp_hint,
    scrapedAt: row.scraped_at,
  }));
}

export function listSceneCandidates(showId) {
  if (!showId) return [];
  return db.prepare('SELECT * FROM scene_candidates WHERE show_id = ? ORDER BY heat_score DESC, created_at DESC').all(showId).map((row) => ({
    id: row.id,
    showId: row.show_id,
    title: row.title,
    episode: row.episode,
    timeStart: row.time_start,
    timeEnd: row.time_end,
    heatScore: row.heat_score,
    whyHot: row.why_hot,
    mentionIds: parseJson(row.mention_ids_json, []),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function saveSceneCandidates(showId, candidates = []) {
  const now = nowIso();
  const stmt = db.prepare(`
    INSERT INTO scene_candidates (
      show_id, title, episode, time_start, time_end, heat_score,
      why_hot, mention_ids_json, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ids = [];
  for (const candidate of candidates) {
    const result = stmt.run(
      showId,
      candidate.title,
      candidate.episode || '',
      candidate.timeStart || candidate.time_start || '',
      candidate.timeEnd || candidate.time_end || '',
      Number(candidate.heatScore ?? candidate.heat_score ?? 0),
      candidate.whyHot || candidate.why_hot || '',
      JSON.stringify(candidate.mentionIds || candidate.mention_ids || []),
      candidate.status || 'candidate',
      now,
      now
    );
    ids.push(result.lastInsertRowid);
  }
  return { ids };
}

export function updateCandidateStatus(candidateId, status) {
  db.prepare('UPDATE scene_candidates SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), candidateId);
  return { id: Number(candidateId), status };
}

export function saveSceneScript(candidateId, script) {
  const result = db.prepare(`
    INSERT INTO scene_scripts (candidate_id, script_json, model, prompt_version, approved, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    candidateId,
    JSON.stringify(script),
    script.model || '',
    Number(script.promptVersion || 1),
    script.approved ? 1 : 0,
    nowIso()
  );
  db.prepare("UPDATE scene_candidates SET status = 'scripted', updated_at = ? WHERE id = ?").run(nowIso(), candidateId);
  return { id: result.lastInsertRowid };
}

export function approveSceneScript(candidateId) {
  db.prepare('UPDATE scene_scripts SET approved = 1 WHERE candidate_id = ?').run(candidateId);
  return updateCandidateStatus(candidateId, 'approved');
}

export function computeHeatScore(mentions = []) {
  const sites = new Set();
  const now = Date.now();
  const raw = mentions.reduce((total, mention) => {
    sites.add(mention.site || '');
    const engagement = mention.engagement || {};
    const likes = Number(engagement.likes || 0);
    const comments = Number(engagement.comments || 0);
    const shares = Number(engagement.shares || 0);
    const scrapedAt = new Date(mention.scrapedAt || mention.scraped_at || now).getTime();
    const ageHours = Math.max(0, (now - scrapedAt) / 36e5);
    const decay = Math.pow(0.5, ageHours / 72);
    return total + ((Math.log10(likes + 1) * 1.0) + (Math.log10(comments + 1) * 1.5) + (Math.log10(shares + 1) * 2.0)) * decay;
  }, 0);
  return Number((raw * (sites.size >= 2 ? 1.3 : 1)).toFixed(3));
}
