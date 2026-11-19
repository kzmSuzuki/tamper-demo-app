# Cloudflare Worker API

Node.js 24.15以降の24系、または26以上で `npm ci` を実行します。`npm test` はWorkers AIをモックし、D1向けSQLをメモリ上のSQLiteで実行します。`npm run typecheck` と `npm run lint` で静的検査を実行します。

このワークスペースでの起動は[ルートREADME](../README.md#ローカルで動かす)、本番D1・Workers AI・Secretの設定は[デプロイ手順](../docs/09_deploy.md)を参照してください。`wrangler.jsonc` はローカル専用です。`wrangler.jsonc.example` が本番向けのテンプレートです。
