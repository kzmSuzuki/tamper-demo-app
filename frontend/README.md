# GitHub Pages フロントエンド

`index.html` が学生投稿、`board.html` が掲示板、`admin.html` が教員画面です。

ローカルでは `python3 -m http.server 5500 --bind 127.0.0.1` をこのディレクトリで実行します。Workerのローカル設定は `http://127.0.0.1:8787` です。

本番では同じGitHubリポジトリからこのディレクトリをGitHub Actionsで公開し、`js/config.js` にWorkerのHTTPS URLを設定します。[デプロイ手順](../docs/09_deploy.md#d-1つのgithubリポジトリからgithub-pagesを公開)
