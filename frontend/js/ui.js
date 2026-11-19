export const byId = id => document.getElementById(id);
export const codePattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{8,24}$/;
const time = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short',
});

export const formatDate = value => time.format(new Date(value));
export const roomCode = () => (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase();

export function roomUrl(page, code) {
  const url = new URL(page, location.href);
  url.searchParams.set('room', code);
  return url;
}

export function status(message = '', error = false, id = 'status') {
  const node = byId(id);
  if (node.textContent !== message) node.textContent = message;
  node.dataset.error = String(error);
}

export async function copy(value, id = 'copy-status') {
  try {
    await navigator.clipboard.writeText(value);
    status('コピーしました。', false, id);
  } catch {
    status('コピーできませんでした。表示されている文字列を選択してコピーしてください。', true, id);
  }
}

export function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function roomState(room) {
  if (new Date(room.expiresAt).getTime() <= Date.now()) return '期限終了';
  return room.open ? '投稿受付中' : '投稿受付終了';
}

export function prepareJoin() {
  byId('join').hidden = false;
  byId('code').value = roomCode().slice(0, 24);
  byId('join').addEventListener('submit', event => {
    event.preventDefault();
    const code = byId('code').value.trim().toUpperCase();
    if (!codePattern.test(code)) {
      status('8〜24文字のルームコードを確認してください。', true);
      return;
    }
    location.assign(roomUrl(location.pathname, code));
  });
}

export function preventImeSubmit(form) {
  form.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
  });
}
