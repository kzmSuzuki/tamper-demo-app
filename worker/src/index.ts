import { DAY, ROOM_LIMIT, adminRoom, cleanup, getRoom, iso, listPosts, publicRoom, type Room } from './db.ts';
import { ApiError, authorize, checkedText, closed, invalid, missing, optionalBoolean, optionalProbability, readJson } from './http.ts';
import { submit } from './posts.ts';
import { type AiBinding } from './tamper.ts';

interface Env {
  DB: D1Database;
  AI?: AiBinding;
  ADMIN_TOKEN?: string;
  ALLOWED_ORIGIN: string;
  LOCAL_DEV?: string;
}

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codePattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{8,24}$/;

async function createRoom(request: Request, db: D1Database) {
  const body = await readJson(request, ['title', 'tamperEnabled', 'tamperProbability']);
  const title = checkedText(body.title, 1, 80, 'タイトル');
  const enabled = optionalBoolean(body, 'tamperEnabled') ?? true;
  const probability = optionalProbability(body) ?? 0.7;
  const now = Date.now();
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => alphabet[byte & 31]).join('');
    const room = await db.prepare(`
      INSERT INTO rooms (id, code, title, tamper_enabled, tamper_probability, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO NOTHING RETURNING *
    `).bind(crypto.randomUUID(), code, title, Number(enabled), probability, iso(now), iso(now + DAY)).first<Room>();
    if (room) return Response.json(await adminRoom(db, room, now), { status: 201 });
  }
  throw new ApiError(503, 'STORAGE_UNAVAILABLE', '時間をおいてルームを作成してください。');
}

async function updateRoom(request: Request, db: D1Database, room: Room) {
  const body = await readJson(request, ['open', 'tamperEnabled', 'tamperProbability']);
  const open = optionalBoolean(body, 'open');
  const enabled = optionalBoolean(body, 'tamperEnabled');
  const probability = optionalProbability(body);
  const now = Date.now();
  const updated = await db.prepare(`
    UPDATE rooms SET is_open = COALESCE(?1, is_open),
      tamper_enabled = COALESCE(?2, tamper_enabled),
      tamper_probability = COALESCE(?3, tamper_probability)
    WHERE id = ?4 AND (COALESCE(?1, 0) = 0 OR expires_at > ?5) RETURNING *
  `).bind(open === undefined ? null : Number(open), enabled === undefined ? null : Number(enabled),
    probability ?? null, room.id, iso(now)).first<Room>();
  if (!updated) {
    if (!await getRoom(db, room.code, now)) missing();
    closed();
  }
  return Response.json(await adminRoom(db, updated, now));
}

function methods(path: string) {
  if (path === '/api/health' || path === '/api/admin/session') return 'GET';
  if (path === '/api/admin/rooms') return 'POST';
  if (/^\/api\/rooms\/[^/]+$/.test(path)) return 'GET';
  if (/^\/api\/rooms\/[^/]+\/posts$/.test(path)) return 'GET, POST';
  if (/^\/api\/admin\/rooms\/[^/]+$/.test(path)) return 'GET, PATCH, DELETE';
  if (/^\/api\/admin\/rooms\/[^/]+\/reveal$/.test(path)) return 'GET';
  if (/^\/api\/admin\/rooms\/[^/]+\/posts$/.test(path)) return 'DELETE';
  return '';
}

async function route(request: Request, url: URL, env: Env) {
  const { pathname } = url;
  const method = request.method;
  const isAdmin = pathname === '/api/admin' || pathname.startsWith('/api/admin/');
  if (isAdmin) await authorize(request, env.ADMIN_TOKEN);
  const allowed = methods(pathname);
  if (!allowed) throw new ApiError(404, 'NOT_FOUND', 'このAPIは見つかりません。');
  if (!allowed.split(', ').includes(method)) {
    return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'この操作は利用できません。' } },
      { status: 405, headers: { Allow: allowed } });
  }
  if (pathname === '/api/health') return Response.json({ status: 'ok' });
  if (pathname === '/api/admin/session') return new Response(null, { status: 204 });
  if (pathname === '/api/admin/rooms') return createRoom(request, env.DB);

  const parts = pathname.split('/');
  const [code, resource] = parts.slice(isAdmin ? 4 : 3);
  if (!codePattern.test(code)) invalid('ルームコードの形式を確認してください。');
  if (!isAdmin && method === 'POST') return submit(request, env.DB, env.AI, code);

  const { DB: db } = env;
  const now = Date.now();
  const room = await getRoom(db, code, now);
  if (!room) missing();
  if (!isAdmin) {
    if (!resource) return Response.json(publicRoom(room, now));
    const limits = url.searchParams.getAll('limit');
    const limit = limits.length ? Number(limits[0]) : ROOM_LIMIT;
    if (limits.length > 1 || (limits.length === 1 && !/^[0-9]{1,3}$/.test(limits[0]))
        || limit < 1 || limit > ROOM_LIMIT) invalid('取得件数は1〜120で指定してください。');
    return Response.json(await listPosts(db, room, limit, false));
  }
  if (method === 'PATCH') return updateRoom(request, db, room);
  if (method === 'DELETE') {
    if (resource === 'posts') {
      await db.prepare('DELETE FROM posts WHERE room_id = ?').bind(room.id).run();
    } else {
      await db.prepare('DELETE FROM rooms WHERE id = ?').bind(room.id).run();
    }
    return new Response(null, { status: 204 });
  }
  if (resource === 'reveal') return Response.json(await listPosts(db, room, ROOM_LIMIT, true));
  return Response.json(await adminRoom(db, room, now));
}

function preflight(request: Request, path: string, originAllowed: boolean) {
  const allow = methods(path);
  const method = request.headers.get('Access-Control-Request-Method');
  const headers = request.headers.get('Access-Control-Request-Headers')?.toLowerCase().split(',') ?? [];
  if (!originAllowed || !method || !allow.split(', ').includes(method)
      || headers.some(header => !['content-type', 'authorization'].includes(header.trim()))) {
    throw new ApiError(403, 'CORS_DENIED', 'このサイトからの操作は許可されていません。');
  }
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Methods': allow,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
  } });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const local = env.LOCAL_DEV === 'true' && url.hostname === '127.0.0.1';
    const originAllowed = Boolean(origin && origin === env.ALLOWED_ORIGIN && (local || origin.startsWith('https://')));
    let response: Response;
    try {
      if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
        throw new ApiError(403, 'HTTPS_REQUIRED', 'HTTPSでアクセスしてください。');
      }
      if (origin && !originAllowed) {
        throw new ApiError(403, 'CORS_DENIED', 'このサイトからの操作は許可されていません。');
      }
      response = request.method === 'OPTIONS'
        ? preflight(request, url.pathname, originAllowed)
        : await route(request, url, env);
    } catch (error) {
      const failure = error instanceof ApiError ? error
        : error instanceof Error && /(?:^|\b)(?:D1_|D1 |SQLITE_)/i.test(error.message)
          ? new ApiError(503, 'STORAGE_UNAVAILABLE', '保存先を利用できません。少し時間をおいてお試しください。')
          : new ApiError(500, 'INTERNAL_ERROR', '処理に失敗しました。少し時間をおいてお試しください。');
      if (!(error instanceof ApiError)) console.error(failure.code);
      response = Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status });
    }
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Vary', request.method === 'OPTIONS'
      ? 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers' : 'Origin');
    if (originAllowed && origin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      if (response.headers.has('Retry-After')) response.headers.set('Access-Control-Expose-Headers', 'Retry-After');
    }
    return response;
  },
  scheduled(_event: ScheduledController, env: Env) {
    return cleanup(env.DB, Date.now()).catch(() => { throw new Error('CLEANUP_FAILED'); });
  },
} satisfies ExportedHandler<Env>;
