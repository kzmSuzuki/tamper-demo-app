# 特別授業への期待が勝手に変わる — セキュリティ改ざんデモ

情報セキュリティの授業で「通信の途中で内容が書き換えられる」体験をするための Web アプリです。

1. 学生は「後半の特別授業に期待すること」を投稿します。投稿画面には本人の原文がそのまま表示されます。
2. 中継役の Cloudflare Worker が、一部の投稿に Workers AI で「ちょっと無茶で笑える要望」を 1 文だけ足します。
3. 教室に投影する掲示板には**改ざん後**の文章が表示されます。学生が自分の投稿との違いに気づいたら、教員画面で原文・追記文・SHA-256 を並べて種明かしします。

> [!IMPORTANT]
> このアプリは、専用の Worker が**中継者による改ざんを模擬**するものです。HTTPS などの暗号化を破るものではなく、第三者のサイトや通信には一切介入しません。

## 目次

- [仕組み](#仕組み)
- [ローカルで試す（5 分）](#ローカルで試す5-分)
- [授業での使い方](#授業での使い方)
- [自分の環境に公開する](#自分の環境に公開する)
- [更新したときのデプロイ](#更新したときのデプロイ)
- [スクリプト一覧](#スクリプト一覧)
- [設定値](#設定値)
- [制限とデータの扱い](#制限とデータの扱い)
- [トラブルシュート](#トラブルシュート)
- [未確認事項](#未確認事項)
- [ファイル構成](#ファイル構成)

## 仕組み

```
 学生のブラウザ ──HTTPS──▶ Cloudflare Worker ──▶ D1（原文・改ざん文・SHA-256 を保存）
 (GitHub Pages)              │  改ざん ON のとき
                             └─▶ Workers AI（追記する 1 文だけを生成）
 掲示板 ◀──HTTPS── Worker が「原文＋改行＋追記 1 文」を返す
```

| 部分 | 技術 | 備考 |
| --- | --- | --- |
| `frontend/` | 素の HTML / CSS / JavaScript | ビルド不要。GitHub Pages で配信します。 |
| `worker/` | Cloudflare Workers（TypeScript） | API、改ざん処理、15 分ごとの定期削除（Cron）を担当します。 |
| 推論 | Workers AI `@cf/google/gemma-4-26b-a4b-it` | Worker の中からだけ呼び出します。失敗したときは定型文を使います。 |
| DB | Cloudflare D1 | |
| 教員認証 | Worker Secret `ADMIN_TOKEN`（Bearer） | フロントエンドやリポジトリには秘密情報を含めません。 |

すべて **Cloudflare Workers の無料プランと GitHub の無料プラン**で動きます。クレジットカードの登録は不要です。

## ローカルで試す（5 分）

Cloudflare アカウントがなくても動きます。ローカルでは AI を呼ばず、追記には定型文を使います。

### 必要なもの

| ツール | バージョン | 確認コマンド |
| --- | --- | --- |
| Node.js | 24.15 以降の 24 系、または 26 以上 | `node -v` |
| Python 3 | 3.8 以上 | `python3 --version` |
| OpenSSL | 任意 | `openssl version` |
| Git | 任意 | `git --version` |

macOS と Linux の bash で動作を想定しています。Windows では WSL2 を使ってください。

### 手順

```bash
git clone https://github.com/<GitHubユーザー名>/tamper-demo-app.git
cd tamper-demo-app
./scripts/setup-local.sh   # 初回だけ。依存のインストール、ローカル用トークンの作成、ローカル D1 の初期化
./scripts/dev.sh           # Worker（:8787）とフロント（:5500）を起動
```

`dev.sh` は起動後に、各画面の URL とローカル用の教員トークンを表示します。`Ctrl+C` で両方とも止まります。

1. http://127.0.0.1:5500/admin.html を開き、表示された教員トークンを入力して「管理操作を開く」を押します。
   - `localhost` で開くと接続先がローカルに切り替わりません。必ず `127.0.0.1` で開いてください。
2. 「新しいルーム」で改ざん確率を **100%** にして「作成する」を押します。
3. 「学生用URLをコピー」で得た URL を別のタブで開き、1 件投稿します。
4. 「掲示板URLをコピー」で得た URL を開き、本文の末尾に 1 文が追加されていることを確認します。
5. 教員画面の「種明かしを表示」で、原文・追記文・SHA-256 の違いを確認します。

### テスト

```bash
./scripts/check.sh            # 単体・統合テスト、型チェック、Lint（worker / frontend）
./scripts/check.sh --browser  # 上記に加えて Chromium の E2E（初回は Chromium をダウンロードします）
```

テストは Workers AI をモックし、D1 向けの SQL はメモリ上の SQLite で実行します。外部サービスには接続しません。

## 授業での使い方

1. 教員画面でトークンを入力し、授業用のルームを作ります（初期値: 受付 OPEN、改ざん ON、確率 70%）。
2. 学生用 URL を QR コードなどで配ります。**実名・学籍番号・連絡先は書かせないでください**（ニックネームは任意で、空欄なら匿名名を割り当てます）。
3. 掲示板 URL をプロジェクターに映します。種明かしを含む教員画面は映さないでください。
4. 全員が投稿したら、投稿画面の原文と掲示板の違いを学生に探させます。
5. 教員画面の「種明かし」で、原文・追記文・SHA-256 の比較を見せます。
6. 解説のポイント
   - 受信したデータが送った内容と同じかどうか（完全性）は、ハッシュ値の比較で確かめられます。
   - ただし、本文とハッシュ値が同じ経路で届くと、両方まとめて差し替えられる可能性があります。比較の基準値は、信頼できる別の経路で受け取る必要があります。
7. 授業が終わったらルームを CLOSE します。不要になったら投稿とルームを削除します（自動削除については[制限とデータの扱い](#制限とデータの扱い)を参照）。

## 自分の環境に公開する

GitHub Pages（フロント）と Cloudflare Workers（API）に、自分のアカウントで公開する手順です。所要時間は初回で 15 分ほどです。

### 事前に用意するもの

- **GitHub アカウント**と、このリポジトリの **Fork**（または自分の公開リポジトリへのコピー）。
  - 無料プランで Pages を使うには、リポジトリを**公開**にする必要があります。
- **Cloudflare アカウント**（無料。https://dash.cloudflare.com/sign-up ）。
  - ダッシュボードの **Workers & Pages** を一度開き、`workers.dev` のサブドメインを登録しておきます。
- **GitHub CLI** `gh`（任意。Pages の設定を自動化する場合に使います）。https://cli.github.com/ からインストールし、`gh auth login` でログインします。
- ローカルの準備（`./scripts/setup-local.sh`）が済んでいること。

### 手順 1. Worker・D1・教員トークンを作る

```bash
./scripts/deploy-worker.sh
```

このスクリプトが行う処理は次のとおりです。何度実行しても、既存のデータを壊さない作りにしています。

1. Wrangler で Cloudflare にログインします。未ログインのときはブラウザが開きます。
2. D1 データベース `tamper-classroom` を作ります。すでにあれば再利用します。
3. `worker/wrangler.production.jsonc` を生成します。このファイルは Git の管理対象外です。
4. D1 にスキーマを適用します。`IF NOT EXISTS` を使っているので、既存のデータは消えません。
5. Worker `tamper-classroom-api` をデプロイします。
6. 教員トークン `ADMIN_TOKEN` を生成し、Worker Secret に登録します。
7. `frontend/js/config.js` の本番 API URL を、デプロイした Worker の URL に書き換えます。

許可する Origin（CORS）は、`git remote` から `https://<GitHubユーザー名>.github.io` と自動で判定します。独自ドメインで公開する場合は、次のように指定してください。

```bash
./scripts/deploy-worker.sh --origin https://demo.example.ac.jp
```

> [!WARNING]
> 最後に表示される**本番の教員トークン**は、このとき一度しか表示されません。パスワード管理ツールなどに保管してください。なくした場合は `./scripts/deploy-worker.sh --rotate-token` で再発行できます（古いトークンは使えなくなります）。

複数の Cloudflare アカウントに所属している場合は、対象のアカウント ID を指定して実行します。

```bash
CLOUDFLARE_ACCOUNT_ID=<アカウントID> ./scripts/deploy-worker.sh
```

### 手順 2. 接続先をコミットする

```bash
git diff frontend/js/config.js     # 自分の Worker の URL になっているか確認
git add frontend/js/config.js
git commit -m "chore: set production api url"
git push origin main
```

> [!CAUTION]
> 公開リポジトリでは、ソースも Git の履歴も誰でも閲覧できます。push の前に、`worker/.dev.vars`・`worker/wrangler.production.jsonc`・教員トークン・学生の投稿データが含まれていないことを確認してください（これらは `.gitignore` で除外済みです）。

### 手順 3. GitHub Pages を有効にする（初回のみ）

**自動（gh を使う場合）**

```bash
./scripts/setup-pages.sh
```

このスクリプトは、Pages の公開元を「GitHub Actions」に設定し、公開用のワークフローを実行して、公開 URL を表示します。

**手動で設定する場合**

1. GitHub のリポジトリで **Settings → Pages → Build and deployment → Source** を開き、**GitHub Actions** を選びます。
2. **Actions → Deploy frontend to GitHub Pages → Run workflow** で `main` を選んで実行します。
3. 完了すると `https://<GitHubユーザー名>.github.io/<リポジトリ名>/` で公開されます。

### 手順 4. 動作を確認する

1. `https://<GitHubユーザー名>.github.io/<リポジトリ名>/admin.html` を開き、本番の教員トークンを入力します。
2. テスト用のルームを作り、改ざん確率を 100% にして 1 件投稿します。掲示板と種明かしを確認したら、そのルームは削除します。
3. 本番では Workers AI が実際に追記文を作ります。授業の前に、匿名の例文を 20 件ほど投稿し、追記の内容を目で確認してください。

## 更新したときのデプロイ

| 変更した場所 | デプロイ方法 |
| --- | --- |
| `frontend/` | `main` に push すると、GitHub Actions が自動で Pages に公開します。 |
| `worker/` | `./scripts/deploy-worker.sh` を再実行します。D1 とトークンはそのまま引き継がれます。 |
| `worker/db/schema.sql` | `./scripts/deploy-worker.sh` を再実行すると、スキーマを再適用します。列の変更が必要な場合は、別途マイグレーション SQL を用意してください。 |

## スクリプト一覧

| スクリプト | 用途 | 必要な認証 |
| --- | --- | --- |
| `scripts/setup-local.sh` | 依存のインストール、`worker/.dev.vars` の作成、ローカル D1 の初期化 | なし |
| `scripts/dev.sh` | Worker とフロントをまとめて起動。未セットアップなら `setup-local.sh` も実行します | なし |
| `scripts/check.sh [--browser]` | テスト、型チェック、Lint（`--browser` を付けると E2E も実行） | なし |
| `scripts/deploy-worker.sh [--origin URL] [--rotate-token]` | Cloudflare の D1・Worker・Secret の構築とデプロイ、`config.js` の更新 | Cloudflare |
| `scripts/setup-pages.sh` | Pages の公開元を GitHub Actions に設定し、公開を実行 | GitHub（`gh`） |

`worker/` で `npm test`・`npm run typecheck`・`npm run lint`・`npm run lint:frontend`・`npm run dev` を直接実行することもできます。

## 設定値

| 名前 | 場所 | 内容 |
| --- | --- | --- |
| `ADMIN_TOKEN` | ローカル: `worker/.dev.vars`、本番: Worker Secret | 教員 API の Bearer トークン。ブラウザには保存せず、教員画面のメモリにだけ保持します（再読み込みで消えます）。 |
| `ALLOWED_ORIGIN` | `worker/wrangler.production.jsonc` の `vars` | CORS で許可する Origin。パスを含めない `https://<user>.github.io` の形式で、小文字で書きます。 |
| `API_BASE_URL` | `frontend/js/config.js` | フロントの接続先。`127.0.0.1` ではローカルの Worker、それ以外では本番の Worker を使います。 |
| `CLOUDFLARE_ACCOUNT_ID` | 環境変数（任意） | 複数のアカウントに所属している場合のデプロイ先。 |
| `D1_DATABASE_NAME` | 環境変数（任意） | D1 の名前。既定は `tamper-classroom` です。 |

`worker/wrangler.jsonc` はローカル専用の設定です。本番用の設定は `worker/wrangler.jsonc.example` をもとに、スクリプトが生成します。

## 制限とデータの扱い

- **ルーム**: コードは暗号学的乱数から作る 12 文字です。作成時の初期値は、受付 OPEN・改ざん ON・確率 70% です。
- **受付**: ルーム作成から 24 時間です。投稿は 1 ルームあたり 120 件、1 ブラウザあたり 2 件までです。1 ブラウザの制限は匿名 UUID による簡易的なもので、ブラウザの保存データを消すとリセットされます。
- **AI**: 1 投稿につき 1 回、アプリ全体で 1 日 120 回まで、待ち時間は 8 秒です。日次の枠は UTC 0 時（日本時間 9 時）に切り替わります。同じ投稿を再送しても AI は再実行しません。次の場合は定型文を使います。
  - AI の呼び出しが失敗したとき
  - 投稿に連絡先らしき文字列や命令文が含まれるとき
  - 生成された文が安全確認を通らなかったとき
- **AI に渡す範囲**: AI には「追記する 1 文」だけを作らせます。本文全体は書き換えさせません。原文はサーバー側でそのまま保存します。
- **表示**: 投稿本文は HTML として解釈せず、テキストとして表示します（XSS 対策）。
- **削除**: 掲示板はルーム作成から 7 日で閲覧できなくなります。15 分ごとの Cron が D1 からデータを削除します。ただし、D1 Free の Time Travel（復旧用の履歴）にはデータが残る場合があります。[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- **個人情報**: 実名・学籍番号・メールアドレスは収集しません。原文と改ざん結果は授業の中だけで使ってください。
- **無料枠**（2026-11 時点）: 上限に達しても課金はされず、制限がかかります。AI の枠が足りないときは定型文で動き続けます。授業の前に Cloudflare ダッシュボードで使用量を確認してください。[Workers AI の料金](https://developers.cloudflare.com/workers-ai/platform/pricing/) / [D1 の料金](https://developers.cloudflare.com/d1/platform/pricing/)

  | サービス | 無料枠 |
  | --- | --- |
  | Workers | 1 日 100,000 リクエスト |
  | Workers AI | 1 日 10,000 Neurons（アカウント全体で共有） |
  | D1 | 1 日 500 万行の読み取り、10 万行の書き込み |

  掲示板の自動更新は、1 画面を開いている間 1 時間あたり最大で約 1,440 リクエストを使います。授業が終わったら投影タブを閉じてください。

## トラブルシュート

| 症状 | 主な原因 | 対処 |
| --- | --- | --- |
| `setup-local.sh` で Node.js のエラーが出る | バージョンが対象外 | 24.15 以降の 24 系、または 26 以上に更新します（`nvm install 24` など）。 |
| `dev.sh` で「ポートは使用中」と出る | 前回のプロセスが残っている | `lsof -iTCP:8787 -sTCP:LISTEN` で PID を調べ、`kill <PID>` で止めます。 |
| ローカルで「このサイトからの操作は許可されていません」と出る | `localhost` で開いている | `http://127.0.0.1:5500/` で開き直します。 |
| 教員画面で 401 になる | トークンが違う | ローカルでは `worker/.dev.vars` の値を使います。本番では `deploy-worker.sh --rotate-token` で再発行します。 |
| 本番で画面は表示されるが API が使えない | `ALLOWED_ORIGIN` が Pages の Origin と一致していない | パスを含めず、小文字の `https://<user>.github.io` を `--origin` に指定して再デプロイします。 |
| 本番で通信エラーになる | `config.js` を push していない | 手順 2 を実行し、Actions の成功を確認します。 |
| `deploy-worker.sh` で workers.dev の URL を取得できない | workers.dev のサブドメインが未登録 | ダッシュボードの Workers & Pages でサブドメインを登録してから再実行します。 |
| ルーム作成で 500 / 503 になる | D1 の未初期化、またはバインディングの不一致 | `deploy-worker.sh` を再実行します（スキーマを再適用します）。 |
| 改ざんされない | 改ざんが OFF、または確率による判定 | 教員画面で改ざん ON・確率 100% にして試します。 |
| AI の追記が定型文ばかりになる | AI の枠の上限、またはモデルのエラー | 種明かしの各投稿に出る「AIで追記 / 定型文で追記」を確認します。日次の枠は UTC 0 時に戻ります。 |
| `setup-pages.sh` が 403 / 404 で失敗する | リポジトリの管理者権限がない、または非公開リポジトリ | 公開リポジトリの管理者が実行するか、[手動の手順](#手順-3-github-pages-を有効にする初回のみ)で設定します。 |

## 未確認事項

次の項目は、公開先のアカウントで確認が必要です。

- Workers Free での実際の推論結果（日本語の追記文の自然さ・安全性の目視確認）
- 本番の Pages と Worker の接続、Cron による定期削除の実行
- `scripts/deploy-worker.sh` と `scripts/setup-pages.sh` を、新しく作った Cloudflare / GitHub アカウントで最初から通しで実行すること

## ファイル構成

| パス | 内容 |
| --- | --- |
| `frontend/index.html` | 学生の投稿画面 |
| `frontend/board.html` | 投影用の掲示板 |
| `frontend/admin.html` | 教員画面（ルーム管理・種明かし・削除） |
| `frontend/js/config.js` | API の接続先 |
| `worker/src/` | Worker の本体（ルーティング、改ざん処理、DB アクセス） |
| `worker/db/schema.sql` | D1 のスキーマ |
| `worker/test/` | テスト（Node test runner、jsdom、Playwright） |
| `worker/wrangler.jsonc` | ローカル開発用の Wrangler 設定 |
| `worker/wrangler.jsonc.example` | 本番用の Wrangler 設定テンプレート |
| `contracts/openapi.yaml` | API 仕様（OpenAPI） |
| `scripts/` | セットアップとデプロイのスクリプト |
| `.github/workflows/pages.yml` | `frontend/` を GitHub Pages に公開するワークフロー |
