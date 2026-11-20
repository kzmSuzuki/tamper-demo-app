#!/usr/bin/env bash
# GitHub Pages の公開元を「GitHub Actions」に設定し、公開ワークフローを実行する。
# GitHub CLI (gh) でログイン済みで、リポジトリの管理者権限が必要。
source "$(dirname "$0")/lib.sh"

require_cmd gh "GitHub CLI をインストールし、gh auth login でログインしてください（https://cli.github.com/）。"
gh auth status >/dev/null 2>&1 || die "gh auth login で GitHub にログインしてください。"

cd "$ROOT_DIR" || exit 1
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)" || die "GitHub リポジトリを判定できません。git remote を確認してください。"
info "対象リポジトリ: $REPO"

if [[ "$(gh repo view --json visibility -q .visibility)" != "PUBLIC" ]]; then
  warn "非公開リポジトリで Pages を使うには GitHub の有料プランが必要です。"
fi

if gh api "repos/$REPO/pages" >/dev/null 2>&1; then
  gh api -X PUT "repos/$REPO/pages" -f build_type=workflow >/dev/null
  ok "Pages の公開元を GitHub Actions に設定しました"
else
  gh api -X POST "repos/$REPO/pages" -f build_type=workflow >/dev/null
  ok "Pages を有効化しました（公開元: GitHub Actions）"
fi

if [[ -n "$(git status --porcelain -- frontend)" ]]; then
  warn "frontend/ に未コミットの変更があります。公開されるのは push 済みの内容です。"
fi

info "公開ワークフローを実行します"
gh workflow run pages.yml --ref main
sleep 5
run_id="$(gh run list --workflow pages.yml -L1 --json databaseId -q '.[0].databaseId')"
gh run watch "$run_id" --exit-status || die "公開に失敗しました: gh run view $run_id --log-failed"

url="$(gh api "repos/$REPO/pages" -q .html_url)"
cat <<EOF

${C_OK}GitHub Pages を公開しました${C_END}
  教員画面   ${url}admin.html
  投稿画面   ${url}
  掲示板     ${url}board.html
EOF
