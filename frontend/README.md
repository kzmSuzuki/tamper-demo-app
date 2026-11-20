# GitHub Pages フロントエンド

`index.html` が学生の投稿画面、`board.html` が掲示板、`admin.html` が教員画面です。ビルドは不要です。

- ローカルで起動する: リポジトリのルートで `./scripts/dev.sh` を実行し、http://127.0.0.1:5500/ を開きます。
- 本番の接続先: `js/config.js` の `API_BASE_URL` に設定します。`./scripts/deploy-worker.sh` が自動で書き換えます。
- 公開: `main` に push すると、GitHub Actions がこのディレクトリを Pages に公開します。

詳しくは[ルートの README](../README.md#自分の環境に公開する)を参照してください。
