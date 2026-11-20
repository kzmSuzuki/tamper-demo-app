#!/usr/bin/env bash
# テスト・型チェック・Lint をまとめて実行する。--browser を付けると Chromium の E2E も実行する。
source "$(dirname "$0")/lib.sh"

check_node
ensure_worker_deps
cd "$WORKER_DIR" || exit 1

info "単体・統合テスト";      npm test
info "型チェック";            npm run --silent typecheck
info "Lint（worker）";        npm run --silent lint
info "Lint（frontend）";      npm run --silent lint:frontend

if [[ "${1:-}" == "--browser" ]]; then
  info "Chromium を準備します"; npx playwright install chromium
  info "ブラウザ E2E";          npm run --silent test:browser
fi

ok "すべての確認が成功しました"
