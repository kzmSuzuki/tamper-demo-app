import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.ts';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
export const ORIGIN = 'https://classroom.example';
export const API = 'https://worker.example';
export const ORIGINAL = 'ロボットを操作する体験が楽しみです。';
export const GENERATED = 'さらに、ロボットに実況してもらいながら月面探検の練習もしてみたいです。';

export function fixture(ai = { async run() { return { response: GENERATED }; } }) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);

  function prepare(sql, values = []) {
    function execute(kind) {
      const query = sqlite.prepare(sql);
      const usesNumbered = /\?\d+/.test(sql);
      const args = usesNumbered ? [Object.fromEntries(values.map((value, index) => [`?${index + 1}`, value]))] : values;
      return query[kind](...args);
    }
    return {
      bind: (...next) => prepare(sql, next),
      async first() { return execute('get') ?? null; },
      async all() { return { results: execute('all') }; },
      async run() { return { success: true, meta: execute('run') }; },
    };
  }
  const DB = {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const env = { DB, AI: ai, ADMIN_TOKEN: token, ALLOWED_ORIGIN: ORIGIN };
  function request(path, { method = 'GET', body, admin = false, headers = {}, origin = ORIGIN } = {}) {
    const init = { method, headers: new Headers(headers) };
    if (origin) init.headers.set('Origin', origin);
    if (body !== undefined) {
      init.headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(body);
    }
    if (admin) init.headers.set('Authorization', `Bearer ${token}`);
    return worker.fetch(new Request(API + path, init), env);
  }

  async function create(tamperEnabled = true, tamperProbability = 1) {
    const response = await request('/api/admin/rooms', {
      method: 'POST', admin: true, body: { title: '特別授業への期待', tamperEnabled, tamperProbability },
    });
    if (response.status !== 201) throw Error(await response.text());
    const { roomCode: code } = await response.json();
    return { code, publicPath: `/api/rooms/${code}`, adminPath: `/api/admin/rooms/${code}` };
  }

  return { sqlite, token, request, create, env };
}

export function payload(text = ORIGINAL, extras = {}) {
  return { text, clientId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), ...extras };
}

export function post(app, room, body = payload()) {
  return app.request(`${room.publicPath}/posts`, { method: 'POST', body });
}

export async function board(app, room) {
  return (await (await app.request(`${room.publicPath}/posts`)).json()).posts;
}

export async function reveal(app, room) {
  return (await (await app.request(`${room.adminPath}/reveal`, { admin: true })).json()).posts;
}
