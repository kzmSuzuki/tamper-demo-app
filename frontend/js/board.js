import { api } from './api.js';
import { byId, codePattern, copy, element, formatDate, prepareJoin, roomCode, roomState, roomUrl, status } from './ui.js';

const code = roomCode();
const board = byId('posts');
let timer;
let auto = true;
let loading = false;
let jumped = false;
let lastPosts;

function postCard(post, open) {
  const card = element('article', '', 'panel stack');
  card.id = `post-${post.id}`;
  const heading = element('div', '', 'row spread post-meta');
  const time = element('time', `${formatDate(post.createdAt)} JST`);
  time.dateTime = post.createdAt;
  heading.append(element('strong', post.nickname), time);
  const details = element('details');
  details.open = open;
  const button = element('button', 'SHA-256をコピー', 'secondary');
  button.type = 'button';
  button.addEventListener('click', () => copy(post.publishedSha256));
  details.append(element('summary', '受信した本文の SHA-256'),
    element('code', post.publishedSha256, 'hash'), button);
  card.append(heading, element('p', post.publishedText, 'post-text'), details);
  return card;
}

function render(posts) {
  const ids = posts.map(post => post.id).join(',');
  if (ids === lastPosts) return;
  lastPosts = ids;
  const open = new Set(Array.from(board.querySelectorAll('article:has(details[open])'), card => card.id));
  board.replaceChildren(...posts.map(post => postCard(post, open.has(`post-${post.id}`))));
  const target = byId(location.hash.slice(1));
  if (target && board.contains(target) && !jumped) {
    target.scrollIntoView({ block: 'center' });
    target.querySelector('details').open = true;
    jumped = true;
  }
}

function schedule() {
  clearTimeout(timer);
  if (auto && !document.hidden) timer = setTimeout(refresh, 5000);
}

async function refresh() {
  if (loading) return;
  loading = true;
  byId('refresh').disabled = true;
  clearTimeout(timer);
  try {
    const [room, { posts }] = await Promise.all([
      api(`/api/rooms/${code}`), api(`/api/rooms/${code}/posts`),
    ]);
    const title = byId('room-title');
    title.textContent = room.title;
    title.hidden = false;
    const state = byId('room-state');
    state.textContent = `${roomState(room)} · ${posts.length}件の投稿`;
    state.hidden = false;
    render(posts);
    status(posts.length ? '' : '表示できる投稿はまだありません。');
  } catch (error) {
    if (error.status === 404) {
      render([]);
      byId('room-state').hidden = true;
      byId('room-title').hidden = true;
    }
    status(error.message, true);
  } finally {
    loading = false;
    byId('refresh').disabled = false;
    schedule();
  }
}

if (codePattern.test(code)) {
  byId('controls').hidden = false;
  byId('student-link').href = roomUrl('./', code);
  byId('refresh').addEventListener('click', refresh);
  byId('toggle').addEventListener('click', () => {
    auto = !auto;
    byId('toggle').textContent = auto ? '自動更新を停止' : '自動更新を再開';
    if (auto) void refresh();
    else clearTimeout(timer);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && auto) void refresh();
    else clearTimeout(timer);
  });
  status('掲示板を読み込んでいます。');
  void refresh();
} else {
  prepareJoin();
  status('ルームコードを入力して掲示板を開いてください。', Boolean(code));
}
