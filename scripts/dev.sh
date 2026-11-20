#!/usr/bin/env bash
# Worker (127.0.0.1:8787) とフロントエンド (127.0.0.1:5500) をまとめて起動する。
# Ctrl+C で両方を停止する。
source "$(dirname "$0")/lib.sh"

if [[ ! -d "$WORKER_DIR/node_modules" || ! -f "$WORKER_DIR/.dev.vars" || ! -d "$WORKER_DIR/.wrangler/state" ]]; then
  "$ROOT_DIR/scripts/setup-local.sh"
fi

check_port_free 8787
check_port_free 5500

pids=()
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$child"; done
  kill "$1" 2>/dev/null || true
}
cleanup() {
  trap - INT TERM EXIT
  echo
  info "停止しています"
  for pid in "${pids[@]}"; do kill_tree "$pid"; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd "$WORKER_DIR" && exec npm run --silent dev) &
pids+=($!)
python3 -m http.server 5500 --bind 127.0.0.1 --directory "$FRONTEND_DIR" >/dev/null 2>&1 &
pids+=($!)

info "Worker の起動を待っています"
for _ in $(seq 1 60); do
  curl -s -o /dev/null http://127.0.0.1:8787/ && break
  sleep 1
done
curl -s -o /dev/null http://127.0.0.1:8787/ || die "Worker が起動しませんでした。上のログを確認してください。"

token="$(sed -n 's/^ADMIN_TOKEN=//p' "$WORKER_DIR/.dev.vars")"
cat <<EOF

${C_OK}起動しました${C_END}（localhost ではなく 127.0.0.1 で開いてください）
  教員画面   http://127.0.0.1:5500/admin.html
  投稿画面   http://127.0.0.1:5500/
  掲示板     http://127.0.0.1:5500/board.html
  教員トークン（ローカル専用）
             $token

Ctrl+C で停止します。
EOF

wait
