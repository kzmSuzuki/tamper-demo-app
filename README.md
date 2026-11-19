# 特別授業への期待が勝手に変わる — セキュリティ改ざんデモ

## 何を作るか

学生は「後半の特別授業に期待すること」を文章で投稿します。GitHub Pages の入力画面では本人の原文をそのまま確認できますが、Cloudflare Workers AI が一部の投稿に「ちょっと無茶で笑える要望」を自然に1文追加し、クラス全体に投影する掲示板には**改ざん後**の文章が表示されます。教員は管理画面で設定・閉室・種明かし・削除ができます。

この演習では、専用Workerが中継者役になって本文に1文を足します。HTTPSの暗号化は維持されたまま、原文と受信側のSHA-256を照合してデータの完全性を学びます。

## 採用技術

- `frontend/`：素の HTML / CSS / JavaScript（GitHub Pages 公開・ビルド不要）
- `worker/`：Cloudflare Workers（TypeScript・`fetch` API）
- 推論：Workers AI `@cf/google/gemma-4-26b-a4b-it`（AI binding）
- DB：Cloudflare D1（原文、改ざん文、ハッシュを保存）
- 教員認証：Workers secret `ADMIN_TOKEN`。フロントエンドには秘密を埋め込まない。
- 原則として**Cloudflare Workers 無料プランを維持**し、クレジットカード必須サービスや従量課金APIには依存しない。

## ファイル案内

| ファイル | 内容 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | Codex が最初に読むプロジェクト指示 |
| [`CODEX_PROMPT.md`](CODEX_PROMPT.md) | Codex への貼り付け用依頼文 |
| [`TASKS.md`](TASKS.md) | 実装フェーズと完了条件 |
| [`docs/01_requirements.md`](docs/01_requirements.md) | プロダクト要件、非対象、受け入れ条件 |
| [`docs/02_user_experience.md`](docs/02_user_experience.md) | 学生・掲示板・教員の画面フロー |
| [`docs/03_architecture.md`](docs/03_architecture.md) | 通信経路、データフロー、ディレクトリ構造 |
| [`docs/04_api.md`](docs/04_api.md) | エンドポイント契約とエラー規約 |
| [`docs/05_ai_tamper.md`](docs/05_ai_tamper.md) | AI追記プロンプト、バリエーション、フェイルセーフ |
| [`docs/06_security_privacy.md`](docs/06_security_privacy.md) | 公開API保護、学校・学生データの扱い |
| [`docs/07_data_model.md`](docs/07_data_model.md) | D1 DBとハッシュの扱い |
| [`docs/08_tests.md`](docs/08_tests.md) | 単体/統合/E2E/40人同時投稿の試験 |
| [`docs/09_deploy.md`](docs/09_deploy.md) | GitHub Pages / Cloudflare 公開手順 |
| [`docs/10_lesson_plan.md`](docs/10_lesson_plan.md) | 授業内のデモ進行と種明かし |
| [`docs/11_references.md`](docs/11_references.md) | 公式ドキュメントと確認日 |
| [`contracts/openapi.yaml`](contracts/openapi.yaml) | OpenAPIの契約書 |
| [`worker/db/schema.sql`](worker/db/schema.sql) | D1初期スキーマ（例示兼ベース） |
| [`worker/wrangler.jsonc.example`](worker/wrangler.jsonc.example) | 本番用 Workers 設定テンプレート |
| [`worker/.dev.vars.example`](worker/.dev.vars.example) | ローカル用秘密情報の名前のみ |
| [`frontend/config.example.js`](frontend/config.example.js) | GitHub Pages から叩くAPIの公開URLの例 |

## ローカルで動かす

Node.js 24.15以降の24系、または26以上とPython 3を使います。ローカル構成は定型文で追記し、Cloudflare認証と推論枠なしで動きます。

```bash
cd worker
npm ci
(umask 077; printf 'ADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)" > .dev.vars)
npm run db:local
npm run dev
```

別のターミナルで起動する手順です。

```bash
python3 -m http.server 5500 --bind 127.0.0.1 --directory frontend
```

[教員画面](http://127.0.0.1:5500/admin.html)を開き、`worker/.dev.vars` のローカル用トークンを入力します。ルームを作り、改ざん確率を100%にすると1件で原文・掲示板・種明かしの違いを確認できます。

## テスト

`worker/` で `npm test`、`npm run typecheck`、`npm run lint` を実行します。同じワークスペースのフロントJSは `npm run lint:frontend` で確認します。Chromiumを使う自動試験は `npx playwright install chromium` の後、`npm run test:browser` を実行します。[テスト結果と受け入れ条件](docs/08_tests.md)

## 実装と運用上の決定

- ルーム作成時は受付OPEN・改ざんON・確率70%です。TASKS.mdのM1にあるOFFはAIなしでAPIを検証する段階の設定として扱い、通常利用の初期値は要件書に合わせました。
- コードは暗号学的乱数から生成する12文字です。受付は24時間、投稿は1ルーム120件・1ブラウザ2件です。匿名UUIDによる簡易制限は、ブラウザの保存データを消すとリセットされます。
- D1で投稿枠を原子的に確保し、同じキーの再送はAIを再実行しません。AIには1投稿1回・アプリの日次120回の上限と8秒の待ち時間を設定しています。UTC 0時で日次枠が切り替わります。失敗、明らかな連絡先や命令文、生成文の検査不合格では定型文を使います。
- 24時間で受付を終了します。掲示板はルーム作成から7日で閲覧不可になり、15分間隔のCronがD1の現行データを削除します。D1 FreeのTime Travel履歴には復旧用データが残る場合があります。[D1の復旧履歴](https://developers.cloudflare.com/d1/reference/time-travel/)
- 学生の確認画面に表示する原文とSHA-256はブラウザで保持・計算します。掲示板で同じ投稿の受信側ハッシュを開けます。同じ経路で本文とハッシュを差し替えられる場合、比較には信頼できる別経路で得た基準値が必要です。

## 公開前に行う設定

GitHubとCloudflareには指定の `suzuki.kazuma@kamiyama.ac.jp` でログインし、対象のGitHubユーザー名とCloudflareアカウントを確認します。D1の作成と初期化、`ADMIN_TOKEN` のWorker Secret登録、Pagesの公開、Worker URLと許可Originの設定は[デプロイ手順](docs/09_deploy.md)に沿って行います。

Workers Freeでの実推論、日本語20例の目視確認、本番PagesとWorkerの接続・Cron実行は公開先で確認が必要です。Workers AIの日次無料枠はアカウント全体で10,000 Neuronsです。AIの上限到達時は定型文に切り替わります。WorkersやD1の枠に達したときは投稿を受け付けられない場合があります。[Workers AI料金](https://developers.cloudflare.com/workers-ai/platform/pricing/) ・ [D1料金](https://developers.cloudflare.com/d1/platform/pricing/)
