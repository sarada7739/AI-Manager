# ADR-0004 「アカウント（ウィンドウ）」軸は合成キーで表し、表示名はローカル設定で上書きする

- 日付: 2026-09-02
- 状態: 採用
- 関連: harness.md §1.2 F-2/F-3/F-6 / docs/RESEARCH.md §4

## 文脈

参考画像の「アカウント（Claude のウィンドウ）」に直接対応する概念は、実機では次の要素に分散している。
- Desktop 起動セッションの JSONL にある `bridge-session.ownerAccountUuid`
- `sessions/<pid>.json` の `entrypoint`（`claude-desktop` / `cli`）
- Codex の `session_meta.model_provider`

本環境ではアカウントは 1 つだが、複数アカウント運用に耐える形にしておく必要がある。

## 決定

- アカウントキーを次の形式で合成する。
  - Claude Desktop 起動: `claude:<ownerAccountUuid>`
  - Claude CLI 起動: `claude:cli`
  - Codex: `codex:<model_provider>`
- 表示名は `local-data/accounts.json`（`.gitignore` 済み）の `{ "<key>": "<表示名>" }` で上書きする。未設定時は `Claude Desktop 1`、`Claude CLI`、`Codex` のような既定名を使い、UUID を画面に出さない。
- アカウントの「起動中 / 停止」と「起動時刻」は、そのキーに属する `running` セッションの有無と最古の `startedAt` から導く。

## 結果

- グルーピング軸「アカウント」が 1 アカウント環境でも空にならず、複数アカウント環境でも列が増えるだけで済む。
- UUID や組織 ID を UI・ログ・リポジトリに出さない。
