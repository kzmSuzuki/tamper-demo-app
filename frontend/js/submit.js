import { api, ApiError } from './api.js';
import { sha256 } from './hash.js';
import { byId, codePattern, copy, prepareJoin, preventImeSubmit, roomCode, roomState, roomUrl, status } from './ui.js';

const form = byId('post');
const textInput = byId('expectation');
const nicknameInput = byId('nickname');
const code = roomCode();
let clientId;
let submitted = 0;
let busy = false;
let pending;
const count = value => Array.from(value).length;

function getClientId() {
  const key = `tamper-client-${code}`;
  try {
    const old = localStorage.getItem(key);
    if (old && /^[0-9a-f-]{36}$/i.test(old)) return old;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function updateCount() {
  byId('count').textContent = `${count(textInput.value.trim())} / 400文字（10文字以上）`;
}

function setBusy(value) {
  busy = value;
  byId('send').disabled = value;
  textInput.readOnly = value;
  nicknameInput.readOnly = value;
  form.setAttribute('aria-busy', String(value));
}

async function sendPost(body) {
  for (let attempt = 0; attempt < 18; attempt++) {
    const result = await api(`/api/rooms/${code}/posts`, { method: 'POST', body });
    if (result.status === 'accepted') return result;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new ApiError('まだ処理中です。入力をそのままにして、もう一度投稿ボタンを押してください。');
}

async function submit(event) {
  event.preventDefault();
  if (busy) return;
  const text = textInput.value.trim();
  const nickname = nicknameInput.value.trim();
  if (count(text) < 10 || count(text) > 400 || count(nickname) > 20) {
    status('本文は10〜400文字、ニックネームは20文字以内で入力してください。', true);
    return;
  }
  if (pending?.text !== text || pending.nickname !== nickname) {
    pending = { text, nickname, clientId, idempotencyKey: crypto.randomUUID() };
  }
  setBusy(true);
  status('投稿中です。少し時間がかかることがあります。');
  try {
    const hash = await sha256(text);
    const result = await sendPost(pending);
    pending = undefined;
    submitted++;
    byId('original').textContent = text;
    byId('original-hash').textContent = hash;
    const url = roomUrl('board.html', code);
    url.hash = `post-${result.postId}`;
    byId('board-link').href = url.href;
    byId('new-post').hidden = submitted >= 2;
    form.hidden = true;
    byId('receipt').hidden = false;
    byId('receipt-title').focus();
    status();
  } catch (error) {
    status(error instanceof ApiError ? error.message : '投稿処理を開始できませんでした。ページの接続設定を確認してください。', true);
  } finally {
    setBusy(false);
  }
}

async function start() {
  if (!codePattern.test(code)) {
    prepareJoin();
    if (code) status('ルームコードの形式を確認してください。', true);
    return;
  }
  byId('retry-room').hidden = true;
  status('授業ルームを確認しています。');
  try {
    const room = await api(`/api/rooms/${code}`);
    if (!room.open) {
      status(`${room.title}の${roomState(room)}。新規投稿はできません。`);
      return;
    }
    if (!globalThis.crypto?.subtle || !globalThis.crypto?.randomUUID) {
      throw new ApiError('安全な接続で画面を開き直してください。');
    }
    clientId = getClientId();
    form.hidden = false;
    status(`${room.title} · 投稿受付中`);
  } catch (error) {
    status(error.message, true);
    if (error.status === 404) prepareJoin();
    else byId('retry-room').hidden = false;
  }
}

byId('retry-room').addEventListener('click', start);
form.addEventListener('submit', submit);
preventImeSubmit(form);
textInput.addEventListener('input', updateCount);
updateCount();
byId('copy-hash').addEventListener('click', () => copy(byId('original-hash').textContent));
byId('new-post').addEventListener('click', () => {
  byId('receipt').hidden = true;
  status('', false, 'copy-status');
  textInput.value = '';
  updateCount();
  form.hidden = false;
  textInput.focus();
});
void start();
