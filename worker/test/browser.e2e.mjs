import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import worker from '../src/index.ts';
import { fixture, GENERATED, ORIGINAL } from './fixture.mjs';

const SITE = 'http://127.0.0.1:5500';
const API = 'http://127.0.0.1:8787';
const types = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript' };
let browser;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test('T15, T23–T25: teacher, student and board with mocked AI and D1', async () => {
  let aiCalls = 0;
  const app = fixture({ async run() { aiCalls++; return { response: GENERATED }; } });
  Object.assign(app.env, { ALLOWED_ORIGIN: SITE, LOCAL_DEV: 'true' });
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  let failingStatus = 500;
  let posts = 0;
  const keys = [];
  try {
    await context.route(`${SITE}/**`, async route => {
      const url = new URL(route.request().url());
      const filename = url.pathname.slice(1) || 'index.html';
      if (!/^(?:css\/|js\/)?[a-z.-]+\.(?:html|css|js)$/.test(filename)) {
        await route.fulfill({ status: 404 });
        return;
      }
      await route.fulfill({
        contentType: types[filename.split('.').at(-1)],
        body: await readFile(new URL(`../../frontend/${filename}`, import.meta.url)),
      });
    });
    await context.route(`${API}/**`, async route => {
      const incoming = route.request();
      const headers = await incoming.allHeaders();
      const body = incoming.postData() ?? undefined;
      let response;
      if (incoming.method() === 'POST' && new URL(incoming.url()).pathname.endsWith('/posts')) {
        posts++;
        keys.push(JSON.parse(body).idempotencyKey);
        if (failingStatus) {
          response = Response.json({ error: { message: '少し時間をおいてお試しください。' } }, {
            status: failingStatus, headers: { 'Access-Control-Allow-Origin': SITE },
          });
          failingStatus = failingStatus === 500 ? 503 : 0;
        } else {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      response ??= await worker.fetch(new Request(incoming.url(), {
        headers, method: incoming.method(), body,
      }), app.env);
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    });

    const admin = await context.newPage();
    await admin.goto(SITE + '/admin.html');
    await admin.locator('#token').fill(app.token);
    await admin.getByRole('button', { name: '管理操作を開く' }).click();
    await admin.getByRole('button', { name: '作成する' }).click();
    await admin.locator('#room').waitFor();
    assert.equal(await admin.locator('#probability').inputValue(), '70');
    await admin.locator('#probability').fill('100');
    await admin.getByRole('button', { name: '設定を保存' }).click();
    await admin.getByText('設定を保存しました。').waitFor();
    const studentLink = await admin.locator('#student-link').getAttribute('href');

    const student = await context.newPage();
    await student.goto(studentLink);
    await student.locator('#post').waitFor();
    await student.locator('#expectation').fill(ORIGINAL);
    await student.locator('#send').click();
    await student.getByText('少し時間をおいてお試しください。').waitFor();
    assert.equal(await student.locator('#expectation').inputValue(), ORIGINAL);
    await student.locator('#send').click();
    await student.getByText('少し時間をおいてお試しください。').waitFor();
    assert.equal(await student.locator('#expectation').inputValue(), ORIGINAL);
    await student.locator('#send').evaluate(button => { button.click(); button.click(); });
    await student.getByRole('heading', { name: '投稿を受け付けました' }).waitFor();
    assert.equal(posts, 3);
    assert.equal(new Set(keys).size, 1);
    const originalHash = createHash('sha256').update(ORIGINAL).digest('hex');
    assert.equal(await student.locator('#original-hash').textContent(), originalHash);
    assert.equal(await student.locator('#original').textContent(), ORIGINAL);
    assert.equal(await student.getByText(GENERATED, { exact: true }).count(), 0);
    assert.equal(await student.evaluate(() => document.documentElement.scrollWidth <= 360), true);

    const board = await context.newPage();
    await board.goto(await student.locator('#board-link').getAttribute('href'));
    await board.locator('article details[open]').waitFor();
    assert.equal(await board.locator('article .post-text').textContent(), ORIGINAL + '\n' + GENERATED);
    assert.notEqual(await board.locator('article code').textContent(), originalHash);
    assert.match(await board.locator('article strong').textContent(), /^参加者-[0-9A-F]{4}$/);

    const html = '<img src=x onerror="window.xss=1">実行せずに文字のまま表示します。';
    await student.getByRole('button', { name: '続けて投稿' }).click();
    await student.locator('#nickname').fill('<b>匿名</b>');
    await student.locator('#expectation').fill(html);
    await student.locator('#send').click();
    await student.getByRole('heading', { name: '投稿を受け付けました' }).waitFor();
    await board.getByRole('button', { name: '今すぐ更新' }).click();
    await board.getByText(html, { exact: false }).waitFor();
    assert.equal(await board.locator('article img, article script, article b').count(), 0);
    assert.equal(await board.evaluate(() => window.xss), undefined);

    await admin.getByRole('button', { name: '種明かしを表示' }).click();
    await admin.getByRole('heading', { name: '種明かし' }).waitFor();
    assert.equal(await admin.locator('mark').count(), 2);
    assert.equal(await admin.getByText('SHA-256は不一致 · AIで追記').count(), 2);
    const storage = await admin.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
    assert.equal(storage.includes(app.token), false);
    admin.once('dialog', dialog => dialog.accept());
    await admin.getByRole('button', { name: '投稿を全件削除' }).click();
    await admin.getByText('すべての投稿を削除しました。').waitFor();
    await board.getByRole('button', { name: '今すぐ更新' }).click();
    await board.getByText('表示できる投稿はまだありません。').waitFor();
    assert.equal(aiCalls, 2);
    await admin.reload();
    await admin.locator('#token').waitFor();
    assert.equal(await admin.locator('#token').inputValue(), '');
  } finally {
    await context.close();
  }
});
