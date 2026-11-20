# Cloudflare Worker API

Node.js 24.15 以降の 24 系、または 26 以上が必要です。

| コマンド | 内容 |
| --- | --- |
| `npm test` | テスト（Workers AI はモック、D1 向けの SQL はメモリ上の SQLite で実行） |
| `npm run typecheck` / `npm run lint` | 型チェック / Lint |
| `npm run dev` | ローカル起動（`127.0.0.1:8787`） |

- `wrangler.jsonc` はローカル専用の設定です。
- 本番用の設定 `wrangler.production.jsonc` は、`wrangler.jsonc.example` をもとに `../scripts/deploy-worker.sh` が生成します（Git 管理外）。

セットアップとデプロイの手順は[ルートの README](../README.md) を参照してください。
