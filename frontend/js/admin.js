import { api } from './api.js';
import { byId, codePattern, copy, element, formatDate, preventImeSubmit, roomCode, roomState, roomUrl, status } from './ui.js';

let session;
let authenticating;
let current;
let action;
const path = code => `/api/admin/rooms/${code}`;

function showRoom(room) {
  current = room;
  byId('room').hidden = !room;
  byId('reveal').hidden = true;
  byId('reveal-posts').replaceChildren();
  if (!room) {
    byId('room-title').textContent = '';
    byId('room-code').textContent = '';
    byId('room-info').textContent = '';
    byId('student-link').removeAttribute('href');
    byId('board-link').removeAttribute('href');
    return;
  }
  byId('code').value = room.roomCode;
  byId('room-title').textContent = room.title;
  byId('room-code').textContent = room.roomCode;
  byId('room-info').textContent = `${roomState(room)} · ${room.postCount}件 · AI ${room.aiCount}件 / 定型文 ${room.fallbackCount}件 · 期限 ${formatDate(room.expiresAt)} JST`;
  byId('open').checked = room.open;
  byId('open').disabled = Date.parse(room.expiresAt) <= Date.now();
  byId('enabled').checked = room.tamperEnabled;
  byId('probability').value = Number((room.tamperProbability * 100).toFixed(10));
  byId('student-link').href = roomUrl('./', room.roomCode);
  byId('board-link').href = roomUrl('board.html', room.roomCode);
}

function clearSession(message = '', error = false) {
  authenticating?.abort();
  authenticating = undefined;
  byId('authenticate').disabled = false;
  session?.controller.abort();
  session = undefined;
  action = undefined;
  byId('token').value = '';
  byId('management').hidden = true;
  byId('logout').hidden = true;
  byId('auth').hidden = false;
  showRoom(null);
  status(message, error);
}

async function run(work) {
  if (!session || action) return;
  const active = session;
  const buttons = [...byId('management').querySelectorAll('button')];
  const marker = {};
  action = marker;
  buttons.forEach(button => { button.disabled = true; });
  status('処理しています。');

  const request = async (url, options) => {
    const result = await api(url, { ...options, token: active.token, signal: active.controller.signal });
    if (session !== active) throw new Error('SESSION_ENDED');
    return result;
  };
  try {
    const message = await work(request);
    if (session === active) status(message);
  } catch (error) {
    if (session !== active) return;
    if (error.status === 401) clearSession(error.message, true);
    else status(error.message, true);
  } finally {
    if (action === marker) action = undefined;
    if (!action) buttons.forEach(button => { button.disabled = false; });
  }
}

function revealPost(post) {
  const card = element('article', '', 'panel stack');
  card.append(element('h3', `${post.nickname} · ${formatDate(post.createdAt)} JST`));
  const pair = element('div', '', 'comparison');
  const original = element('div');
  original.append(element('h3', '原文'), element('p', post.originalText, 'post-text'),
    element('code', post.originalSha256, 'hash'));
  const received = element('div');
  const text = element('p', post.publishedText, 'post-text');
  if (post.appendedText && post.publishedText.endsWith(`\n${post.appendedText}`)) {
    text.textContent = post.publishedText.slice(0, -post.appendedText.length);
    text.append(element('mark', post.appendedText));
  }
  received.append(element('h3', '掲示板に届いた本文'), text,
    element('code', post.publishedSha256, 'hash'));
  pair.append(original, received);
  const origin = { ai: 'AIで追記', fallback: '定型文で追記', none: '追記なし' }[post.generationSource];
  const result = post.originalSha256 === post.publishedSha256 ? '一致' : '不一致';
  card.append(pair, element('strong', `SHA-256は${result} · ${origin}`));
  return card;
}

byId('auth').addEventListener('submit', async event => {
  event.preventDefault();
  if (authenticating || session) return;
  const token = byId('token').value.trim();
  if (token.length < 32 || !/^[\x21-\x7e]+$/.test(token)) {
    status('教員トークンを確認してください。', true);
    return;
  }
  const controller = new AbortController();
  authenticating = controller;
  byId('authenticate').disabled = true;
  byId('token').value = '';
  status('教員トークンを確認しています。');
  try {
    await api('/api/admin/session', { token, signal: controller.signal });
    if (authenticating !== controller) return;
    session = { token, controller };
    byId('auth').hidden = true;
    byId('management').hidden = false;
    byId('logout').hidden = false;
    status();
    if (byId('code').value) byId('load').requestSubmit();
  } catch (error) {
    if (authenticating === controller) status(error.message, true);
  } finally {
    if (authenticating === controller) {
      authenticating = undefined;
      byId('authenticate').disabled = false;
    }
  }
});
byId('logout').addEventListener('click', () => clearSession('教員トークンを消去しました。'));
window.addEventListener('pagehide', () => clearSession());
byId('code').value = roomCode().slice(0, 24);
for (const id of ['auth', 'create', 'load', 'settings']) preventImeSubmit(byId(id));

byId('create').addEventListener('submit', event => {
  event.preventDefault();
  const title = byId('title').value.trim();
  void run(async request => {
    showRoom(await request('/api/admin/rooms', { method: 'POST', body: { title } }));
    return 'ルームを作成しました。';
  });
});
byId('load').addEventListener('submit', event => {
  event.preventDefault();
  const code = byId('code').value.trim().toUpperCase();
  if (!codePattern.test(code)) {
    status('ルームコードの形式を確認してください。', true);
    return;
  }
  void run(async request => {
    showRoom(await request(path(code)));
    return 'ルームを読み込みました。';
  });
});

byId('reload-room').addEventListener('click', () => run(async request => {
  showRoom(await request(path(current.roomCode)));
  return '集計を更新しました。';
}));
byId('settings').addEventListener('submit', event => {
  event.preventDefault();
  const body = {
    tamperEnabled: byId('enabled').checked,
    tamperProbability: byId('probability').valueAsNumber / 100,
  };
  if (!byId('open').disabled) body.open = byId('open').checked;
  void run(async request => {
    showRoom(await request(path(current.roomCode), { method: 'PATCH', body }));
    return '設定を保存しました。';
  });
});

byId('copy-student').addEventListener('click', () => copy(byId('student-link').href, 'status'));
byId('copy-board').addEventListener('click', () => copy(byId('board-link').href, 'status'));
byId('reveal-button').addEventListener('click', () => run(async request => {
  const { posts } = await request(`${path(current.roomCode)}/reveal`);
  byId('reveal-posts').replaceChildren(...(posts.length ? posts.map(revealPost) : [element('p', '投稿はまだありません。')]));
  byId('reveal').hidden = false;
  byId('reveal-title').focus();
}));

byId('clear-posts').addEventListener('click', () => {
  if (!confirm('このルームの投稿をすべて削除しますか？')) return;
  void run(async request => {
    const url = path(current.roomCode);
    await request(`${url}/posts`, { method: 'DELETE' });
    showRoom(null);
    showRoom(await request(url));
    return 'すべての投稿を削除しました。';
  });
});
byId('delete-room').addEventListener('click', () => {
  if (!confirm('このルームとすべての投稿を削除しますか？')) return;
  void run(async request => {
    await request(path(current.roomCode), { method: 'DELETE' });
    showRoom(null);
    byId('code').value = '';
    return 'ルームを削除しました。';
  });
});
