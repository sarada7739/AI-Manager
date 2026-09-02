# ADR-0005 Codex は Claude と同じ Session 抽象に載せる「従」のデータソースとする

- 日付: 2026-09-02
- 状態: 採用
- 関連: harness.md §1.2 F-1 / docs/RESEARCH.md §3

## 文脈

実機には Codex の rollout が 3 本（いずれも `codex exec` 由来、各 8 行）しか無く、利用者からも「インストールはしたが未使用・未契約」との申告があった。
対話モードの rollout や `function_call` 系レコードの実物は無い。

## 決定

- 両ツール共通の `Session` 型（id, tool, title, cwd, branch, model, lastMessage, lastUpdatedAt, logSizeBytes, state, accountKey）を定義し、Codex はこの型へのアダプタとして実装する。
- Codex パーサは `session_meta` / `turn_context` / `event_msg` / `response_item` の 4 種のみを解釈し、未知の `type` は無視する。
- Codex のテストは、実ファイルの構造を写した **合成フィクスチャ** で担保する。実データはコミットしない。
- SQLite（`state_N.sqlite` 等）は第 1 段階で読まない。必要になった時点で ADR を起票する。

## 結果

- Claude 側の実装・テストを先に完成させ、Codex 側はスキーマの網羅性不足を「未知レコードを無視する」設計で吸収する。
- Codex の対話モードで新しいレコード型が見つかった場合は、フィクスチャを追加して対応する。
