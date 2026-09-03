# Phase 4 最終レビュー（第 1 段階 read-only）

- 実施日: 2026-09-03
- 実施者: メインセッション（Claude Fable 5.1）
- 対象: `main`（PR #29 マージ後、commit `1e1844d` 以降）
- 判定: **指摘なし（完了）**。乖離はすべて本レビューの PR で文書側を実装に合わせて修正した。コード変更を要する新規タスクは無い。

## 1. 検証したこと（harness.md Phase 4）

| # | 観点 | 方法 | 結果 |
|---|---|---|---|
| 1 | CLAUDE.md / DESIGN.md / ARCHITECTURE.md と実装の乖離 | 各文書の該当節と `src/**` を突き合わせ、grep で機械確認 | 下記 §2 の 9 件を発見し、文書側を修正（コードは変えない） |
| 2 | F-1〜F-9 が繋がって動くか | Playwright E2E 5 件（ボード → リスト → 絞り込み → 詳細 → Esc、キーボード操作、更新ボタン、マスク、404）+ implementer の `pnpm dev` 実機確認 | 通過。F-7 は無効表示（第 1 段階の仕様どおり） |
| 3 | 品質ゲート | `pnpm gate`（typecheck → lint → test → build） | typecheck エラー 0 / biome 182 ファイル指摘 0 / vitest 70 ファイル 1497 件 pass / build 成功。新規警告なし |
| 4 | セキュリティ | grep と各 PR のレビュー結果を再確認 | §3 のとおり問題なし |
| 5 | 構造的な問題（責務の重複、TODO、デッドコード） | grep（TODO / FIXME / console / any / 境界違反 / innerHTML）と PR の NON_BLOCKING の棚卸し | TODO / console / any / 境界違反 / innerHTML は 0 件。改善候補は §4（任意） |

## 2. 文書と実装の乖離（本 PR で修正）

| # | 文書 | 乖離 | 対応 |
|---|---|---|---|
| 1 | DESIGN.md §5.1 | 「ヘッダ帯とフィルタバーは sticky」。実装はフィルタバーのみ（`--header-height` が無く両立不可） | ADR-0007 を起票し §5.1 に参照を追記 |
| 2 | DESIGN.md §6.6 | ghost の用途に「ボード / リスト」。実装は選択状態を伝えるため `Pill.filter` | §6.6 を「更新」「閉じる」に変更し、表示切替は §6.4 のセグメントと明記 |
| 3 | DESIGN.md §3.2 | `--tracking-wide` は「英字ラベルのみ」。実装の `Pill` は種別を問わず適用 | §3.2 の用途を実装に合わせた |
| 4 | ARCHITECTURE.md §4.3 | 「Claude: UUID v4」。実装は汎用 UUID 形式（locator と同じ） | 記述を修正 |
| 5 | ARCHITECTURE.md §5 | `/api/health` に `warnings` が無い。homeDir 外の root の扱い、`watcher` が実質 2 値であることが未記載。`/api/events` のペイロード未記載 | 表と備考を修正 |
| 6 | ARCHITECTURE.md §2 | `locator.ts` が `sessions/*.json` も列挙すると記載（実装は `running.ts`）。`app.ts` / `errors.ts` / `build-summary.ts` / `selectors` / `url-sync` / `use-now-minute` が無い。キーボード操作を `app/` の責務と記載（実装は feature 側） | ツリーと説明を修正 |
| 7 | ARCHITECTURE.md §2.1 | 「ファイルパスの組み立ては sources と config のみ」。`store` に 3 か所の例外（既存パスへの `path.join`、文字列判定） | 例外を表に明記 |
| 8 | ARCHITECTURE.md §5, §7 | CORS の許可条件、Vite プロキシが API パスに限定される理由、`AI_MANAGER_CONFIG_PATH` の信頼境界が未記載 | 追記 |
| 9 | README.md | E2E のトラブルシュート（ブラウザ未取得、`local-data/e2e/` の再生成、ポート使用中）が無い | 追記 |

CLAUDE.md と AGENTS.md は Phase 1 以降変更しておらず、規約と実装に乖離は無い。

## 3. セキュリティ

- **読み取り範囲**: `config.roots` 配下のみ。locator は固定階層だけを `readdir` / `stat` し、`isUnderRoot` / `isExcludedFile` を通す。`.credentials.json` / `auth.json` / `*.key` / `*.sqlite*` / `settings*.json` は除外パターンで開かず、`history.jsonl` / `memory/` / `tool-results/` は走査階層に含まれない。
- **パス走査**: routes はリクエストのパラメータからパスを組み立てない（`tool` / `id` を検証 → 索引の `jsonlPath` のみ使用。統合テストで検証）。
- **任意コード実行**: 子プロセスは `process/list.ts` の固定引数 PowerShell 1 本のみ（`execFile`、シェル非経由、ユーザー入力なし、stdout UTF-8 固定、10 秒タイムアウト）。
- **秘密情報**: `maskSecrets` を title / lastMessage / 詳細本文に適用。ログは件数・時間のみで実パス・本文・UUID を出さない（`log.ts` が homeDir / roots / ダッシュ符号化をマスク）。エラー応答に元の `message`（実パスを含み得る）を出さない。`commandLine` は threadId の突合にだけ使い、API にもログにも載せない。
- **外部送信**: サーバ・共有コードに外部 URL / fetch は無い。CDN 読み込みも無い。サーバは `127.0.0.1` のみバインド、CORS は `localhost` / `127.0.0.1` の厳密一致。
- **リポジトリ**: 実ログ・実パス・実 UUID・ユーザー名の混入なし（E2E フィクスチャは合成、`readme-contract` が実行時に導出したユーザー名 / ホームで検査）。

## 4. 改善候補（任意。第 1 段階の完了条件には含めない）

各 PR の NON_BLOCKING を棚卸しした結果。いずれも動作・規約・安全性には影響しない。第 2 段階または保守時に扱う。

- 分割: `store/index.ts`（684 行）の `computeAccounts` / `mapWithConcurrency`、`DetailPanel.tsx` のカスタムフック分割
- 共有化: 切り詰め（`truncateEnd` / `finalizeDetailText` / `truncateStart`）と `formatDateTime`、`FOLDER_MAX_CHARS` を `src/shared/` へ。detail の定数の重複
- トークン: `--header-height`（ADR-0007）、`--z-*`、`--list-col-*`。`DESIGN.md` §9 と `tokens.css` を同時更新
- UX: `~` 置換（クライアントが homeDir を知らない。`/api/health` から配布）、`LiveStatus` の読み上げ頻度、ランドマークの入れ子（Layout と feature の `aria-label` 重複）
- 監視: `refreshFiles` のパス照合の Map 化、`scrollMargin`（overscan で吸収中）、警告の `code` 化
- 保守: `Button` の `ref` / `aria-label` 転送、`getState()` スプレッド idiom の `useShallow` 化、`README` の Node 表記と `engines.node`

## 5. 完了の定義（harness.md §10）との照合

- [x] TASKS.md の全 26 タスクが `done`（`escalated` / `blocked` なし。最大 3 ラウンドで収束）
- [x] 全タスクが PR としてマージ済み（#4〜#29）
- [x] Phase 4 の最終レビュー完了、本ファイルに指摘なしと記録
- [x] リポジトリ全体で品質ゲート通過（1497 件）
- [x] README にセットアップ手順と起動方法があり、E2E の `webServer` が同じコマンドで起動している
- [x] harness.md §8 の手順（harness / CLAUDE / TASKS / 直近 PR / ARCHITECTURE / DESIGN / ADR / git）だけで状況を再構築できる（各 PR 本文に「残課題 / 次にやること」「復旧用メモ」あり）

## 6. 第 2 段階（F-7 指示送信）に向けた前提

- RESEARCH.md §6 のとおり、名前付きパイプ `cc-msg-<hash>` のプロトコルは未公開で `.key` を読む必要がある可能性が高い（harness §9.2-2）。`--resume` 再実行は課金と JSONL 並行書き込みのリスクがある（§9.2-3）。
- 着手前に ADR を起票して人間の承認を得る。UI は `ComposeBox` が無効状態で配置済み。
