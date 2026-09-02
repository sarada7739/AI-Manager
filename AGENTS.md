# AGENTS.md — AI-Manager プロジェクト規約（Codex 向け）

> 本ファイルは Codex 向けのプロジェクト規約。`CLAUDE.md`（Claude Code 向け）と**内容を同期**させる。片方だけ更新しない。
> 以下の本文は CLAUDE.md §1 以降と同一。差分が出たら両方を直す。
> 開発体制そのものの定義は `harness.md`。本ファイルは harness.md の規約を実装作業向けに転記したもの。

## 1. プロジェクト概要

ローカルで稼働している **Claude Code / Codex CLI のセッションを一覧・監視するダッシュボード**。
`~/.claude/projects/**/*.jsonl` と `~/.codex/sessions/**/*.jsonl` を読み取り、稼働状態・作業ディレクトリ・最終メッセージをボード / リスト形式で表示する。
第 1 段階は **read-only**（一覧・グルーピング・フィルタ・詳細・稼働状態・更新）。指示送信（F-7）は第 2 段階で ADR と人間の承認を経てから着手する。
対象 OS は **Windows 11 のみ**。

## 2. コマンド（品質ゲートの唯一の参照先）

PowerShell でそのまま動く形。`&&` は使わない。

```powershell
pnpm install                 # 依存インストール
pnpm dev                     # サーバ (Hono) + クライアント (Vite) を同時起動
pnpm dev:server              # サーバのみ
pnpm dev:client              # クライアントのみ
pnpm typecheck               # tsc --noEmit（strict）
pnpm lint                    # biome check .
pnpm lint:fix                # biome check --write .
pnpm test                    # vitest run
pnpm test:watch              # vitest
pnpm e2e                     # playwright test（主要導線のみ）
pnpm build                   # vite build + サーバの tsc
pnpm gate                    # typecheck → lint → test → build を順に実行（reviewer に渡す前に必ず通す）
```

**品質ゲート（harness.md §5.5）**: `pnpm gate` がエラー 0 で通ること。新規の警告を増やさないこと。

## 3. ディレクトリ構成

```
src/
  shared/         クライアント・サーバ共有の型と純粋関数（Session 型、状態判定、マスク、グルーピング）
  server/         Hono サーバ。ファイル読み取り・プロセス列挙・索引・API
    sources/      claude/ codex/ process/ — 各データソースのリーダ
    store/        インメモリ索引と監視（watcher + polling）
    routes/       /api/* のハンドラ
  client/         React + Vite
    app/          App シェル、レイアウト
    features/     機能単位（board, list, filters, session-detail, accounts, compose, refresh）
    components/   汎用 UI（Card, Badge, Toggle, EmptyState, ...）
    store/        Zustand ストア
    api/          fetch クライアント
    styles/       tokens.css（デザイントークン）, global.css
tests/
  fixtures/       匿名化した合成データのみ
  unit/ integration/
e2e/              Playwright
docs/             RESEARCH.md, adr/, FINAL_REVIEW.md, reference/
local-data/       実ログのコピーや個人設定（.gitignore 済み。コミット禁止）
```

どこに何を書くか:
- ファイルを読む・プロセスを見る処理は `src/server/sources/` にのみ書く。クライアントは API 経由でしか触れない。
- 2 か所以上で使う型・純粋ロジックは `src/shared/` に置く。
- 機能固有の UI・状態は `src/client/features/<feature>/` に閉じる。feature 間の直接 import は禁止。共有が必要なら `components/` か `store/` に上げる。

詳細は `ARCHITECTURE.md`。

## 4. コーディング規約

- **TypeScript `strict: true`**。`any` 禁止。外部入力（JSONL、プロセス出力、設定ファイル）は必ず型ガードで検証してから使う。
- **命名**: ファイルは kebab-case（`session-parser.ts`）。React コンポーネントは PascalCase（`BoardColumn.tsx`）。型は PascalCase、関数・変数は camelCase、定数は UPPER_SNAKE。
- **エラーハンドリング**: 読み取り失敗は握りつぶさず `Result` 型（`{ ok: true, value } | { ok: false, error }`）で返す。
  ユーザーに見せるエラーは「何が起きたか + 次にどうするか」を必ず含める。
- **ログ**: サーバは `console` を直接呼ばず `src/server/log.ts` の `log.info/warn/error` を使う。**セッションログの本文・実パスをログに出さない**。
- **パス**: 必ず `node:path` で組み立てる。ホームは `os.homedir()`。区切り文字・`%USERPROFILE%` の直書き禁止。比較は大文字小文字を無視する。
- **相対 import は `.js` 拡張子付き**（`import { x } from "./types.js"`）。`src/shared` と `src/server` はサーバの tsc（NodeNext）でもビルドされるため、拡張子なしだと `pnpm build` で落ちる。Vite / Vitest も `.js` → `.ts` を解決する。
- **lint の実行**: Bash 経由の `pnpm lint` はユーザー環境のフックに横取りされることがある。その場合は `./node_modules/.bin/biome check .` を直接実行する。
- **ファイル読み取り**: ロックしない。JSON パース失敗行は捨てる。大きいファイルは全文を読まず、先頭 / 末尾の必要な範囲だけ読む。
- **コメント・ドキュメント・コミットメッセージ・UI 文言**: 日本語。
- **依存の追加禁止**: 新しいパッケージが必要なら理由を添えてメインセッションに報告して止まる。

## 5. デザインの規約

**`DESIGN.md` に定義されていない色・サイズ・フォント・余白・角丸・影を使ってはならない。**
- 色・余白・角丸・タイポは `src/client/styles/tokens.css` の CSS カスタムプロパティを経由する。
- CSS Modules 内に生の hex / px を書いたら reviewer が BLOCKING にする（`0` と `1px` の境界線幅、`100%` などの比率は除く）。
- Tailwind は使わない。インラインスタイルも使わない（動的な幅・高さを CSS 変数で渡す場合のみ可）。
- 状態（稼働中 / 作業中 / 停止 / エラー）は色だけで区別しない。形とラベルを併用する。

## 6. Git / PR 運用（harness.md §7）

- ブランチ: `task/T-013-board-columns`。フェーズ成果物は `phase/1-harness-docs`。
- `main` への直接コミット禁止。force push 禁止。
- コミット: Conventional Commits + タスク ID。`feat(board): グルーピング軸ごとの列描画を実装 (T-013)`
- PR 本文は `.github/pull_request_template.md` の形式。UTF-8（BOM なし）で書き出す。
- APPROVE 後、メインセッションが `gh pr merge --squash --delete-branch` で自動マージする。
- **git / gh を実行できるのはメインセッションのみ**。サブエージェントは実行しない。

## 7. タスクループ（harness.md §5）

`TASKS.md` が進捗の唯一の真実。1 タスク = 1 ブランチ = 1 PR = 変更 300 行以内が目安。

1. メインが `TASKS.md` からタスクカードを作り implementer（sonnet）に渡す
2. tester（sonnet）がテストを書いて実行し、`pnpm gate` を通す
3. reviewer（opus）が `VERDICT: APPROVE | REQUEST_CHANGES` を返す
4. REQUEST_CHANGES なら指摘を implementer に戻す。**最大 3 round**。3 回で収束しなければ `escalated` にしてメインが方針を変える

各エージェントの定義は `.claude/agents/`。

## 8. してはならないこと（harness.md §9.1）

- `harness.md` の無断編集
- `main` への直接コミット、force push、履歴の書き換え
- テストを通すためにテストを緩める・スキップする・削除する
- 受け入れ条件に無い機能の追加
- DESIGN.md に無い値のハードコード
- 依存パッケージの無断追加
- reviewer がコードを書くこと
- サブエージェントが git / gh を実行すること
- 同じタスクを 4 回以上、同じやり方でループさせること
- 読み取ったセッションログの内容を外部へ送信すること
- **実際のセッションログ・実パス・個人情報・UUID をリポジトリにコミットすること**（public のため）
- テストフィクスチャに実データを使うこと
- スクリーンショットやログ抜粋を PR 本文に貼ること

## 9. 必ず停止して人間に報告する条件（harness.md §9.2）

1. 破壊的操作が必要になったとき（ファイル削除、プロセス kill、`~/.claude` / `~/.codex` への書き込み）
2. セッションログ内に API キー・トークン・個人情報を検出したとき
3. 課金・外部送信が発生する実装が必要になったとき
4. 仕様と実機調査結果が食い違うとき
5. 同一原因のエスカレーションが 2 タスク以上連続したとき
6. `gh` の認証不可、リポジトリ不在など環境が前提を満たさないとき

## 10. コンテキスト喪失時の復帰手順（harness.md §8）

```powershell
Get-Content harness.md, CLAUDE.md          # 1. ハーネスと規約
Get-Content TASKS.md                       # 2. 進捗サマリ → 現在のタスク
gh pr list --state merged --limit 5        # 3. 直近の作業
gh pr view <番号>                          #    「残課題 / 次にやること」「復旧用メモ」
Get-Content ARCHITECTURE.md, DESIGN.md     # 4. 設計の前提
Get-ChildItem docs/adr
git status; git log --oneline -10          # 5. 作業ツリー
```

再開用プロンプトは harness.md 付録 A。
