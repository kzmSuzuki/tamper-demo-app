#!/usr/bin/env bash
# ローカル開発環境を準備する。何度実行しても安全（既存の .dev.vars は上書きしない）。
# Cloudflare アカウントは不要。AI は使わず定型文で動作する。
source "$(dirname "$0")/lib.sh"

info "必要なツールを確認します"
check_node
require_cmd python3 "フロントエンドの配信に Python 3 を使います。"
require_cmd openssl "ローカル用トークンの生成に OpenSSL を使います。"
ok "python3 / openssl"

info "worker の依存パッケージをインストールします（npm ci）"
(cd "$WORKER_DIR" && npm ci)

if [[ -f "$WORKER_DIR/.dev.vars" ]]; then
  ok "worker/.dev.vars は作成済みです（そのまま使います）"
else
  info "ローカル用の教員トークンを worker/.dev.vars に作成します"
  (umask 077; printf 'ADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)" > "$WORKER_DIR/.dev.vars")
  ok "worker/.dev.vars を作成しました"
fi

info "ローカル D1 にスキーマを適用します"
(cd "$WORKER_DIR" && npm run --silent db:local >/dev/null)
ok "ローカル D1 の準備ができました"

echo
ok "セットアップ完了。次は ./scripts/dev.sh で起動してください。"
