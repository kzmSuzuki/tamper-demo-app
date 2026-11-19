-- Cloudflare D1 / SQLite
-- Times: ISO-8601 UTC text; the application owns creation of timestamps.
-- Apply with `npx wrangler d1 execute tamper-classroom --local --file=./db/schema.sql`

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1)),
  tamper_enabled INTEGER NOT NULL DEFAULT 1 CHECK (tamper_enabled IN (0, 1)),
  tamper_probability REAL NOT NULL DEFAULT 0.7 CHECK (tamper_probability BETWEEN 0.0 AND 1.0),
  submission_count INTEGER NOT NULL DEFAULT 0 CHECK (submission_count >= 0),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms(created_at);
CREATE INDEX IF NOT EXISTS idx_rooms_expires_at ON rooms(expires_at);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  client_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  original_text TEXT NOT NULL,
  published_text TEXT,
  appended_text TEXT,
  original_sha256 TEXT NOT NULL,
  published_sha256 TEXT,
  tamper_applied INTEGER NOT NULL DEFAULT 0 CHECK (tamper_applied IN (0, 1)),
  generation_source TEXT NOT NULL DEFAULT 'none'
    CHECK (generation_source IN ('none', 'ai', 'fallback')),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'complete')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  UNIQUE(room_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_posts_room_created
  ON posts(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_room_client
  ON posts(room_id, client_id);
CREATE INDEX IF NOT EXISTS idx_posts_room_status
  ON posts(room_id, status, created_at DESC);

-- Consider schema migrations if later revisions change the table structures.

-- Keep the quota counter in the same SQLite statement as the reservation.
CREATE TRIGGER IF NOT EXISTS posts_count_insert AFTER INSERT ON posts
BEGIN
  UPDATE rooms SET submission_count = submission_count + 1 WHERE id = NEW.room_id;
END;

CREATE TRIGGER IF NOT EXISTS posts_count_delete AFTER DELETE ON posts
BEGIN
  UPDATE rooms SET submission_count = submission_count - 1 WHERE id = OLD.room_id;
END;

CREATE INDEX IF NOT EXISTS idx_posts_pending ON posts(created_at)
  WHERE status = 'processing';

CREATE TABLE IF NOT EXISTS ai_budget (
  utc_day TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 120)
);
