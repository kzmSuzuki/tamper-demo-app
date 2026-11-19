export const DAY = 86_400_000;
export const RETENTION = 7 * DAY;
export const RECOVERY = 30_000;
export const ROOM_LIMIT = 120;
export const CLIENT_LIMIT = 2;
export const iso = (time: number) => new Date(time).toISOString();

export interface Room {
  id: string;
  code: string;
  title: string;
  is_open: number;
  tamper_enabled: number;
  tamper_probability: number;
  submission_count: number;
  created_at: string;
  expires_at: string;
}

const publicFields = `
  id, nickname, published_text AS publishedText,
  published_sha256 AS publishedSha256, created_at AS createdAt`;

export function getRoom(db: D1Database, code: string, now: number) {
  return db.prepare('SELECT * FROM rooms WHERE code = ? AND created_at > ?')
    .bind(code, iso(now - RETENTION)).first<Room>();
}

export function publicRoom(room: Room, now: number) {
  return {
    roomCode: room.code,
    title: room.title,
    open: Boolean(room.is_open) && room.expires_at > iso(now),
    expiresAt: room.expires_at,
    postCount: room.submission_count,
  };
}

export async function adminRoom(db: D1Database, room: Room, now: number) {
  const stats = await db.prepare(`
    SELECT COUNT(CASE WHEN generation_source = 'ai' THEN 1 END) AS aiCount,
           COUNT(CASE WHEN generation_source = 'fallback' THEN 1 END) AS fallbackCount
    FROM posts WHERE room_id = ? AND status = 'complete'`).bind(room.id).first();
  return {
    ...publicRoom(room, now),
    createdAt: room.created_at,
    tamperEnabled: Boolean(room.tamper_enabled),
    tamperProbability: room.tamper_probability,
    ...stats,
  };
}

export async function listPosts(db: D1Database, room: Room, limit: number, reveal: boolean) {
  const extraFields = reveal ? `, original_text AS originalText, appended_text AS appendedText,
    original_sha256 AS originalSha256, tamper_applied AS tamperApplied,
    generation_source AS generationSource` : '';
  const { results } = await db.prepare(`
    SELECT ${publicFields}${extraFields} FROM posts
    WHERE room_id = ? AND status = 'complete' ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(room.id, limit).all();
  return {
    roomCode: room.code,
    posts: reveal ? results.map(row => ({ ...row, tamperApplied: Boolean(row.tamperApplied) })) : results,
  };
}

export async function cleanup(db: D1Database, now: number) {
  await db.batch([
    db.prepare('DELETE FROM rooms WHERE created_at <= ?').bind(iso(now - RETENTION)),
    db.prepare(`UPDATE posts SET status = 'complete', completed_at = ?
                WHERE status = 'processing' AND created_at <= ?`).bind(iso(now), iso(now - RECOVERY)),
    db.prepare('DELETE FROM ai_budget WHERE utc_day < ?').bind(iso(now).slice(0, 10)),
  ]);
}
