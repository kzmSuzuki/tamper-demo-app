#!/usr/bin/env bash
# Cloudflare に本番 Worker を構築・デプロイする。何度実行しても安全。
#
#   ./scripts/deploy-worker.sh [--origin https://<user>.github.io] [--rotate-token]
#
# 1. wrangler にログイン（未ログインならブラウザが開く）
# 2. D1 データベース tamper-classroom を作成（既存なら再利用）
# 3. worker/wrangler.production.jsonc を生成（Git 管理外）
# 4. D1 にスキーマを適用（IF NOT EXISTS なので既存データは消えない）
# 5. Worker をデプロイ
# 6. 教員トークン ADMIN_TOKEN を Secret に登録（未登録時、または --rotate-token 指定時）
# 7. frontend/js/config.js の本番 API URL を書き換え
source "$(dirname "$0")/lib.sh"

DB_NAME="${D1_DATABASE_NAME:-tamper-classroom}"
ORIGIN=""
ROTATE_TOKEN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --origin) ORIGIN="${2:-}"; shift 2 ;;
    --rotate-token) ROTATE_TOKEN=true; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) die "不明なオプション: $1（--help で使い方を表示）" ;;
  esac
done

check_node
require_cmd openssl "教員トークンの生成に OpenSSL を使います。"
ensure_worker_deps

# ---- 1. ログイン -------------------------------------------------------------
info "Cloudflare のログイン状態を確認します"
if ! wrangler whoami 2>&1 | grep -q "You are logged in"; then
  info "ブラウザで Cloudflare にログインしてください"
  wrangler login
fi
wrangler whoami 2>&1 | grep -E "logged in|Account (Name|ID)|│" | head -12 || true
if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  warn "複数の Cloudflare アカウントに所属している場合は、中断して CLOUDFLARE_ACCOUNT_ID=<ID> を付けて再実行してください。"
fi
confirm "このアカウントにデプロイしますか？" || die "中断しました。"

# ---- 2. 許可 Origin ----------------------------------------------------------
if [[ -z "$ORIGIN" && -f "$PROD_CONFIG" ]]; then
  ORIGIN="$(node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");const m=t.match(/"ALLOWED_ORIGIN"\s*:\s*"([^"]*)"/);process.stdout.write(m?m[1]:"")' "$PROD_CONFIG")"
  [[ "$ORIGIN" == *YOUR_GITHUB_USER* ]] && ORIGIN=""
fi
if [[ -z "$ORIGIN" ]]; then
  remote="$(git -C "$ROOT_DIR" remote get-url origin 2>/dev/null || true)"
  owner="$(echo "$remote" | sed -nE 's#.*github\.com[:/]([^/]+)/.*#\1#p' | tr '[:upper:]' '[:lower:]')"
  [[ -n "$owner" ]] || die "GitHub ユーザー名を判定できません。--origin https://<GitHubユーザー名>.github.io を指定してください。"
  ORIGIN="https://$owner.github.io"
fi
ORIGIN="$(echo "${ORIGIN%/}" | tr '[:upper:]' '[:lower:]')"
[[ "$ORIGIN" =~ ^https://[a-z0-9.-]+(:[0-9]+)?$ ]] || die "Origin は https://<ホスト名> の形式で、パスを含めずに指定してください: $ORIGIN"
ok "許可 Origin: $ORIGIN"

# ---- 3. D1 -------------------------------------------------------------------
d1_id() {
  wrangler d1 list --json 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{const db=JSON.parse(s).find(d=>d.name===process.argv[1]);process.stdout.write(db?db.uuid:"")}catch{}
    })' "$DB_NAME"
}

info "D1 データベース $DB_NAME を確認します"
DB_ID="$(d1_id)"
if [[ -z "$DB_ID" ]]; then
  info "D1 データベース $DB_NAME を作成します"
  wrangler d1 create "$DB_NAME" --location apac --no-update-config
  DB_ID="$(d1_id)"
  [[ -n "$DB_ID" ]] || die "D1 の ID を取得できませんでした。npx wrangler d1 list で確認してください。"
  ok "作成しました: $DB_ID"
else
  ok "既存の D1 を使います: $DB_ID"
fi

# ---- 4. 本番設定ファイル -----------------------------------------------------
info "worker/wrangler.production.jsonc を書き出します"
[[ -f "$PROD_CONFIG" ]] || cp "$WORKER_DIR/wrangler.jsonc.example" "$PROD_CONFIG"
node -e '
  const fs=require("fs");const [file,id,name,origin]=process.argv.slice(1);
  let t=fs.readFileSync(file,"utf8");
  t=t.replace(/("database_id"\s*:\s*)"[^"]*"/,`$1"${id}"`)
     .replace(/("database_name"\s*:\s*)"[^"]*"/,`$1"${name}"`)
     .replace(/("ALLOWED_ORIGIN"\s*:\s*)"[^"]*"/,`$1"${origin}"`);
  fs.writeFileSync(file,t);' "$PROD_CONFIG" "$DB_ID" "$DB_NAME" "$ORIGIN"
ok "設定を更新しました（このファイルは .gitignore 済みです）"

info "D1 にスキーマを適用します"
wrangler d1 execute DB --remote --file=db/schema.sql --config wrangler.production.jsonc -y >/dev/null
ok "スキーマを適用しました"

# ---- 5. デプロイ -------------------------------------------------------------
info "Worker をデプロイします"
deploy_log="$(mktemp)"
trap 'rm -f "$deploy_log"' EXIT
wrangler deploy --config wrangler.production.jsonc 2>&1 | tee "$deploy_log"
WORKER_URL="$(grep -Eo 'https://[a-z0-9.-]+\.workers\.dev' "$deploy_log" | head -1 || true)"
[[ -n "$WORKER_URL" ]] || die "workers.dev の URL を取得できませんでした。Cloudflare ダッシュボードで workers.dev サブドメインを有効にしてから再実行してください。"
ok "Worker URL: $WORKER_URL"

# ---- 6. 教員トークン ---------------------------------------------------------
NEW_TOKEN=""
if $ROTATE_TOKEN || ! wrangler secret list --config wrangler.production.jsonc 2>/dev/null | grep -q '"ADMIN_TOKEN"'; then
  info "教員トークン ADMIN_TOKEN を Secret に登録します"
  NEW_TOKEN="$(openssl rand -hex 32)"
  printf '%s' "$NEW_TOKEN" | wrangler secret put ADMIN_TOKEN --config wrangler.production.jsonc >/dev/null
  ok "登録しました"
else
  ok "ADMIN_TOKEN は登録済みです（変更する場合は --rotate-token）"
fi

# ---- 7. フロントエンドの接続先 -----------------------------------------------
node -e '
  const fs=require("fs");const [file,url]=process.argv.slice(1);
  const t=fs.readFileSync(file,"utf8");
  const n=t.replace(/(:\s*)'"'"'https:\/\/[^'"'"']*'"'"';/,`$1'"'"'${url}'"'"';`);
  if(n===t&&!t.includes(url)){console.error("config.js の本番 URL 行が見つかりません");process.exit(1)}
  fs.writeFileSync(file,n);' "$CONFIG_JS" "$WORKER_URL"
ok "frontend/js/config.js の接続先を $WORKER_URL にしました"

cat <<EOF

${C_OK}Worker のデプロイが完了しました${C_END}
EOF
if [[ -n "$NEW_TOKEN" ]]; then
  cat <<EOF

${C_WARN}本番の教員トークン（この画面にしか表示されません。パスワード管理ツールに保管してください）${C_END}
  $NEW_TOKEN
EOF
fi
cat <<EOF

次の手順:
  1. git diff frontend/js/config.js で接続先を確認
  2. git add frontend/js/config.js && git commit -m "chore: set production api url" && git push
  3. 初回のみ ./scripts/setup-pages.sh で GitHub Pages を有効化
EOF
