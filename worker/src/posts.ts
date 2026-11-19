import { CLIENT_LIMIT, RECOVERY, ROOM_LIMIT, getRoom, iso } from './db.ts';
import { ApiError, checkedText, closed, missing, readJson, sha256, uuid } from './http.ts';
import { type AiBinding, chooseTheme, generate, maySendToAi, randomUnit } from './tamper.ts';

interface Receipt {
  id: string;
  created_at: string;
  status: 'processing' | 'complete';
}
interface StoredPost extends Receipt {
  client_id: string;
  original_text: string;
  nickname: string;
}

function receipt(post: Receipt, status: number) {
  if (post.status === 'processing') {
    return Response.json({ postId: post.id, status: 'processing' }, {
      status: 202, headers: { 'Retry-After': '2' },
    });
  }
  return Response.json({ postId: post.id, createdAt: post.created_at, status: 'accepted' }, { status });
}

export async function submit(request: Request, db: D1Database, ai: AiBinding | undefined, code: string) {
  const body = await readJson(request, ['nickname', 'text', 'clientId', 'idempotencyKey']);
  const text = checkedText(body.text, 10, 400, '本文', true);
  const clientId = uuid(body.clientId);
  const key = uuid(body.idempotencyKey);
  const nickname = (Object.hasOwn(body, 'nickname') ? checkedText(body.nickname, 0, 20, 'ニックネーム') : '')
    || `参加者-${clientId.slice(0, 4).toUpperCase()}`;
  const room = await getRoom(db, code, Date.now());
  if (!room) missing();

  async function retry(post: StoredPost) {
    if (post.client_id !== clientId || post.original_text !== text || post.nickname !== nickname) {
      throw new ApiError(409, 'DUPLICATE_OR_LIMIT', '送信内容が以前の送信と異なります。');
    }
    const now = Date.now();
    if (post.status === 'processing' && post.created_at <= iso(now - RECOVERY)) {
      const saved = await db.prepare(`
        UPDATE posts SET status = 'complete', completed_at = ? WHERE id = ?
        RETURNING id, created_at, status`).bind(iso(now), post.id).first<Receipt>();
      if (!saved) missing();
      return receipt(saved, 200);
    }
    return receipt(post, 200);
  }
  const findExisting = () => db.prepare(`
    SELECT id, created_at, status, client_id, original_text, nickname
    FROM posts WHERE room_id = ? AND idempotency_key = ?`).bind(room.id, key).first<StoredPost>();

  const existing = await findExisting();
  if (existing) return retry(existing);
  if (!room.is_open || room.expires_at <= iso(Date.now())) closed();

  const theme = chooseTheme();
  const fallbackText = `${text}\n${theme.fallback}`;
  const [originalHash, fallbackHash] = await Promise.all([sha256(text), sha256(fallbackText)]);
  const createdAt = iso(Date.now());
  const useAi = Boolean(ai) && maySendToAi(text);
  const reservation = await db.prepare(`
    WITH eligible AS (
      SELECT id, (tamper_enabled = 1 AND tamper_probability > ?1) AS tamper
      FROM rooms WHERE id = ?2 AND is_open = 1 AND expires_at > ?3
        AND submission_count < ?4
        AND (SELECT count(*) FROM posts WHERE room_id = ?2 AND client_id = ?5) < ?6
    )
    INSERT INTO posts (
      id, room_id, nickname, client_id, idempotency_key, original_text,
      original_sha256, published_text, published_sha256, appended_text,
      tamper_applied, generation_source, status, created_at, completed_at
    )
    SELECT ?7, id, ?8, ?5, ?9, ?10, ?11,
      CASE WHEN tamper THEN ?12 ELSE ?10 END,
      CASE WHEN tamper THEN ?13 ELSE ?11 END,
      CASE WHEN tamper THEN ?14 END,
      tamper, CASE WHEN tamper THEN 'fallback' ELSE 'none' END,
      CASE WHEN tamper AND ?15 THEN 'processing' ELSE 'complete' END,
      ?3, CASE WHEN NOT (tamper AND ?15) THEN ?3 END
    FROM eligible WHERE 1 ON CONFLICT(room_id, idempotency_key) DO NOTHING
    RETURNING id, created_at, status
  `).bind(randomUnit(), room.id, createdAt, ROOM_LIMIT, clientId, CLIENT_LIMIT,
    crypto.randomUUID(), nickname, key, text, originalHash, fallbackText, fallbackHash, theme.fallback,
    Number(useAi)).first<Receipt>();

  if (!reservation) {
    const duplicate = await findExisting();
    if (duplicate) return retry(duplicate);
    const current = await getRoom(db, code, Date.now());
    if (current?.id !== room.id) missing();
    if (!current.is_open || current.expires_at <= iso(Date.now())) closed();
    if (current.submission_count >= ROOM_LIMIT) {
      throw new ApiError(429, 'ROOM_CAPACITY_REACHED', 'この授業ルームの投稿数が上限に達しました。');
    }
    throw new ApiError(409, 'DUPLICATE_OR_LIMIT', 'このブラウザから投稿できるのは2件までです。');
  }

  if (reservation.status === 'complete') return receipt(reservation, 201);

  // Only the request that reserved the post may acquire an inference slot.
  // A failure after reservation leaves the precomputed fallback available for recovery.
  const slot = await db.prepare(`
    INSERT INTO ai_budget (utc_day, attempts) VALUES (?, 1)
    ON CONFLICT(utc_day) DO UPDATE SET attempts = attempts + 1 WHERE attempts < 120
    RETURNING attempts`).bind(iso(Date.now()).slice(0, 10)).first();
  const extra = ai && slot ? await generate(ai, text, theme.direction) : null;
  const published = extra ? `${text}\n${extra}` : fallbackText;
  const saved = await db.prepare(`
    UPDATE posts SET published_text = ?, published_sha256 = ?, appended_text = ?,
      generation_source = ?, status = 'complete', completed_at = ?
    WHERE id = ? AND status = 'processing' RETURNING id, created_at, status
  `).bind(published, extra ? await sha256(published) : fallbackHash, extra ?? theme.fallback,
    extra ? 'ai' : 'fallback', iso(Date.now()), reservation.id).first<Receipt>();
  if (saved) return receipt(saved, 201);
  const recovered = await findExisting();
  if (recovered?.id !== reservation.id) missing();
  return receipt(recovered, 200);
}
