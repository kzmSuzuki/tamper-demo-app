# shellcheck shell=bash
# 各スクリプトから読み込む共通処理。単体では実行しない。

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="$ROOT_DIR/worker"
FRONTEND_DIR="$ROOT_DIR/frontend"
PROD_CONFIG="$WORKER_DIR/wrangler.production.jsonc"
CONFIG_JS="$FRONTEND_DIR/js/config.js"

if [[ -t 1 ]]; then
  C_INFO=$'\033[1;34m'; C_OK=$'\033[1;32m'; C_WARN=$'\033[1;33m'; C_ERR=$'\033[1;31m'; C_END=$'\033[0m'
else
  C_INFO=''; C_OK=''; C_WARN=''; C_ERR=''; C_END=''
fi

info() { printf '%s==>%s %s\n' "$C_INFO" "$C_END" "$*"; }
ok()   { printf '%s✔%s %s\n' "$C_OK" "$C_END" "$*"; }
warn() { printf '%s!%s %s\n' "$C_WARN" "$C_END" "$*" >&2; }
die()  { printf '%s✘ %s%s\n' "$C_ERR" "$*" "$C_END" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 が見つかりません。$2"
}

# Node.js 24.15 以降の 24 系、または 26 以上
check_node() {
  require_cmd node "Node.js 24.15 以降（24 系）または 26 以上をインストールしてください。"
  local ver major minor
  ver="$(node -p 'process.versions.node')"
  major="${ver%%.*}"; minor="$(echo "$ver" | cut -d. -f2)"
  if (( major >= 26 )) || (( major == 24 && minor >= 15 )); then
    ok "Node.js $ver"
  else
    die "Node.js $ver は非対応です。24.15 以降の 24 系、または 26 以上を使ってください。"
  fi
  require_cmd npm "Node.js と一緒に npm をインストールしてください。"
}

check_port_free() {
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then
    die "ポート $1 は使用中です。使っているプロセスを止めてから再実行してください（確認: lsof -iTCP:$1 -sTCP:LISTEN）。"
  fi
}

ensure_worker_deps() {
  if [[ ! -d "$WORKER_DIR/node_modules" ]]; then
    info "worker の依存パッケージをインストールします（npm ci）"
    (cd "$WORKER_DIR" && npm ci)
  fi
}

wrangler() { (cd "$WORKER_DIR" && npx --no-install wrangler "$@"); }

confirm() {
  local answer
  read -r -p "$1 [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]]
}
