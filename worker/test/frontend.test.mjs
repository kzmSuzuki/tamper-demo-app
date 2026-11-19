import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import worker from '../src/index.ts';
import { fixture, GENERATED, ORIGINAL } from './fixture.mjs';

const SITE = 'http://127.0.0.1:5500';

async function page(filename, query = '') {
  const html = await readFile(new URL(`../../frontend/${filename}`, import.meta.url), 'utf8');
  return new JSDOM(html, { url: SITE + '/' + filename + query, runScripts: 'outside-only' });
}

async function until(predicate, description) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(description);
}

function submit(window, id) {
  window.document.getElementById(id).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

test('DOM: teacher, submission, retry, literal HTML, published hash and reveal (T15, T23–T25)', async () => {
  let aiCalls = 0;
  const app = fixture({ async run() { aiCalls++; return { response: GENERATED }; } });
  Object.assign(app.env, { ALLOWED_ORIGIN: SITE, LOCAL_DEV: 'true' });
  const pages = [];
  const globalNames = ['document', 'window', 'location', 'localStorage', 'navigator', 'confirm', 'fetch'];
  const originals = new Map(globalNames.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const bind = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

  function activate(dom) {
    const { window } = dom;
    for (const key of ['document', 'location', 'localStorage', 'navigator']) bind(key, window[key]);
    bind('window', window);
    bind('confirm', () => true);
    return id => window.document.getElementById(id);
  }

  const keys = [];
  const failures = [500, 503];
  bind('fetch', async (url, options) => {
    const headers = new Headers(options.headers);
    headers.set('Origin', SITE);
    if (options.method === 'POST' && url.endsWith('/posts')) {
      keys.push(JSON.parse(options.body).idempotencyKey);
      const status = failures.shift();
      if (status) return Response.json({ error: { message: `一時エラー ${status}` } }, { status });
      await delay(30);
    }
    return worker.fetch(new Request(url, { ...options, headers }), app.env);
  });
  try {
    const admin = await page('admin.html');
    pages.push(admin);
    const adminById = activate(admin);
    await import('../../frontend/js/admin.js');
    adminById('token').value = 'x'.repeat(40);
    submit(admin.window, 'auth');
    await until(() => adminById('status').textContent === '教員トークンを確認してください。', 'invalid token rejected');
    assert.equal(adminById('management').hidden, true);
    adminById('token').value = app.token;
    submit(admin.window, 'auth');
    await until(() => !adminById('management').hidden, 'authenticated');
    assert.equal(adminById('token').value, '');
    submit(admin.window, 'create');
    await until(() => !adminById('room').hidden, 'room created');
    assert.equal(adminById('probability').value, '70');
    assert.equal(adminById('enabled').checked, true);
    adminById('probability').value = '100';
    submit(admin.window, 'settings');
    await until(() => adminById('status').textContent === '設定を保存しました。', 'probability saved');

    const query = new URL(adminById('student-link').href).search;
    const student = await page('index.html', query);
    pages.push(student);
    const studentById = activate(student);
    await import('../../frontend/js/submit.js');
    await until(() => !studentById('post').hidden, 'post form visible');

    studentById('expectation').value = ORIGINAL;
    for (const status of [500, 503]) {
      submit(student.window, 'post');
      await until(() => studentById('status').textContent.endsWith(String(status)), 'retry message displayed');
      assert.equal(studentById('expectation').value, ORIGINAL);
    }
    submit(student.window, 'post');
    submit(student.window, 'post');
    await until(() => !studentById('receipt').hidden, 'receipt visible');
    assert.equal(keys.length, 3);
    assert.equal(new Set(keys).size, 1);
    assert.equal(studentById('original').textContent, ORIGINAL);
    assert.equal(student.window.document.body.textContent.includes(GENERATED), false);
    const originalHash = studentById('original-hash').textContent;

    studentById('new-post').click();
    const html = '<img src=x onerror="window.xss=1">HTMLを実行せずそのまま表示します。';
    studentById('expectation').value = html;
    studentById('nickname').value = '<b>匿名</b>';
    submit(student.window, 'post');
    await until(() => studentById('original').textContent === html, 'second receipt visible');

    const board = await page('board.html', query);
    pages.push(board);
    const boardById = activate(board);
    await import('../../frontend/js/board.js');
    await until(() => boardById('posts').children.length === 2, 'both board entries visible');
    const cards = Array.from(boardById('posts').children);
    const generated = cards.find(card => card.textContent.includes(ORIGINAL));
    assert.equal(generated.querySelector('.post-text').textContent, ORIGINAL + '\n' + GENERATED);
    assert.notEqual(generated.querySelector('code').textContent, originalHash);
    assert.match(generated.querySelector('strong').textContent, /^参加者-[0-9A-F]{4}$/);
    assert.match(boardById('posts').textContent, /<b>匿名<\/b>/);
    assert.equal(boardById('posts').textContent.includes(html), true);
    assert.equal(boardById('posts').querySelector('img, script, b'), null);

    activate(admin);
    adminById('reveal-button').click();
    await until(() => !adminById('reveal').hidden, 'reveal visible');
    assert.equal(adminById('reveal-posts').querySelectorAll('mark').length, 2);
    assert.equal(adminById('reveal-posts').textContent.includes('SHA-256は不一致'), true);
    assert.equal(JSON.stringify(admin.window.localStorage).includes(app.token), false);
    assert.equal(JSON.stringify(admin.window.sessionStorage).includes(app.token), false);
    adminById('clear-posts').click();
    await until(() => adminById('status').textContent === 'すべての投稿を削除しました。', 'posts erased');
    assert.equal(adminById('reveal-posts').children.length, 0);

    activate(board);
    boardById('refresh').click();
    await until(() => boardById('posts').children.length === 0, 'board emptied');
    assert.equal(aiCalls, 2);

    activate(admin);
    admin.window.dispatchEvent(new admin.window.Event('pagehide'));
    assert.equal(adminById('auth').hidden, false);
    assert.equal(adminById('token').value, '');
  } finally {
    for (const dom of pages) dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
