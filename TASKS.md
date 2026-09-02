# TASKS.md — タスク台帳（進捗の唯一の真実）

## 進捗サマリ
- 全 26 件 / 完了 1 件 / 進行中 0 件 / 未着手 25 件
- 現在のタスク: T-002
- 最終更新: 2026-09-02T23:40:00+09:00

## フェーズ進捗

| Phase | 内容 | 状態 | PR |
|---|---|---|---|
| 0 | 実機調査 | done | #1 |
| 1 | ハーネス文書生成 | done | #2 |
| 2 | タスク分解 | done | #3 |
| 3 | タスク実行ループ | in_progress | - |
| 4 | 最終レビュー | todo | - |

## タスク一覧

状態: `todo` / `in_progress` / `blocked` / `review` / `done` / `escalated`

| ID | タイトル | 依存 | 状態 | ループ回数 | PR |
|---|---|---|---|---|---|
| T-001 | プロジェクト初期化（pnpm / Vite / Hono / Biome / Vitest / scripts） | - | done | 1 | #4 |
| T-002 | 共有型定義と Result 型 | T-001 | todo | 0 | - |
| T-003 | 秘密情報マスク関数 | T-002 | todo | 0 | - |
| T-004 | 稼働状態の判定関数 | T-002 | todo | 0 | - |
| T-005 | 相対時刻とパス短縮の整形関数 | T-002 | todo | 0 | - |
| T-006 | サーバ設定の読込と安全パス検証 | T-002 | todo | 0 | - |
| T-007 | ファイル先頭 / 末尾の部分読み取り | T-002 | todo | 0 | - |
| T-008 | Claude セッションの探索（locator） | T-006 | todo | 0 | - |
| T-009 | Claude JSONL のサマリ解析（parser） | T-007, T-008 | todo | 0 | - |
| T-010 | Claude 稼働メタとプロセス列挙 | T-004, T-006 | todo | 0 | - |
| T-011 | Codex rollout の探索と解析 | T-007, T-006 | todo | 0 | - |
| T-012 | セッション索引とアカウント合成 | T-009, T-010, T-011 | todo | 0 | - |
| T-013 | Hono API: sessions / accounts / health | T-012 | todo | 0 | - |
| T-014 | セッション詳細 API とメッセージ抽出 | T-003, T-013 | todo | 0 | - |
| T-015 | ファイル監視・ポーリング・SSE・refresh | T-013 | todo | 0 | - |
| T-016 | デザイントークンとグローバルスタイル | T-001 | todo | 0 | - |
| T-017 | 汎用 UI コンポーネント | T-016 | todo | 0 | - |
| T-018 | グルーピング・絞り込み・並べ替えの純粋関数 | T-002, T-005 | todo | 0 | - |
| T-019 | クライアント基盤（API クライアント / ストア / URL 同期） | T-013, T-018 | todo | 0 | - |
| T-020 | App シェルとヘッダ帯 | T-017, T-019 | todo | 0 | - |
| T-021 | フィルタバーと読み取り専用トグル | T-020 | todo | 0 | - |
| T-022 | アカウント帯 | T-020 | todo | 0 | - |
| T-023 | ボード表示（列・カード・仮想スクロール） | T-021 | todo | 0 | - |
| T-024 | リスト表示（テーブル・並べ替え・仮想スクロール） | T-021 | todo | 0 | - |
| T-025 | 詳細パネル・指示入力欄（無効）・自動更新・キーボード操作 | T-014, T-015, T-023, T-024 | todo | 0 | - |
| T-026 | E2E と README | T-022, T-025 | todo | 0 | - |

依存グラフは DAG（循環なし）。実行順は ID 順で依存を満たす。

---

## タスク詳細

### T-001 プロジェクト初期化
- **目的**: CLAUDE.md §2 のコマンドがすべて動く土台を作る
- **受け入れ条件**:
  - [ ] `package.json` に `dev`, `dev:server`, `dev:client`, `typecheck`, `lint`, `lint:fix`, `test`, `test:watch`, `e2e`, `build`, `gate` の scripts がある（`gate` は typecheck → lint → test → build を順に実行し、途中で失敗したら止まる。PowerShell でも動く）
  - [ ] `tsconfig.json` は `strict: true`、`noUncheckedIndexedAccess: true`。`src/shared`, `src/server`, `src/client` を含む
  - [ ] Vite（React）が `src/client` をルートに起動し、`/api` を `http://127.0.0.1:4317` へプロキシする
  - [ ] Hono サーバの最小エントリ `src/server/index.ts` が `GET /api/health` で `{ ok: true }` を返す（127.0.0.1 バインド）
  - [ ] Biome の設定があり `pnpm lint` がエラー 0 で通る
  - [ ] Vitest の設定があり、ダミーテスト 1 件が通る
  - [ ] Playwright の設定ファイルがある（テストは T-026）
  - [ ] `pnpm gate` が通る
- **依存パッケージ（この時点で追加してよいもの）**: react, react-dom, hono, @hono/node-server, zustand, @tanstack/react-virtual, vite, @vitejs/plugin-react, typescript, @biomejs/biome, vitest, @testing-library/react, @testing-library/jest-dom, jsdom, @playwright/test, tsx, concurrently, @types/react, @types/react-dom, @types/node
- **参照**: CLAUDE.md §2, §3 / ARCHITECTURE.md §2
- **触ってよい範囲**: ルート直下の設定ファイル、`src/server/index.ts`, `src/client/main.tsx`, `src/client/app/App.tsx`, `src/client/index.html`, `tests/unit/smoke.test.ts`

### T-002 共有型定義と Result 型
- **目的**: ARCHITECTURE.md §3 のデータモデルをコードにする
- **受け入れ条件**:
  - [ ] `src/shared/types.ts` に `ToolKind`, `SessionState`, `StateReason`, `SessionSummary`, `SessionDetail`, `Account`, `ApiError` がある（ARCHITECTURE.md §3 と一致）
  - [ ] `src/shared/result.ts` に `Result<T, E>` と `ok()`, `err()`, `isOk()` がある
  - [ ] `src/shared/guards.ts` に `isRecord`, `isString`, `isNumber`, `asString(obj, key)` などの型ガードがある
  - [ ] `shared` は `node:*` / `react` を import していない
- **参照**: ARCHITECTURE.md §2.1, §3
- **触ってよい範囲**: `src/shared/types.ts`, `src/shared/result.ts`, `src/shared/guards.ts`

### T-003 秘密情報マスク関数
- **目的**: ログ本文を API に載せる前に秘密情報らしき文字列を隠す
- **受け入れ条件**:
  - [ ] `maskSecrets(text: string): string` が `sk-ant-…`, `sk-…`(20 文字以上), `ghp_…`, `gho_…`, `github_pat_…`, `AKIA…`(16 文字), `xoxb-…`, `Bearer <token>` を `••••` に置換する（先頭 4 文字だけ残す）
  - [ ] メールアドレスを `***@***` に置換する
  - [ ] 該当しない文字列は変更しない。空文字は空文字を返す
  - [ ] 置換した件数を返す `maskSecretsWithCount` もある
- **参照**: DESIGN.md §8 / ARCHITECTURE.md §7
- **触ってよい範囲**: `src/shared/masking.ts`

### T-004 稼働状態の判定関数
- **目的**: ADR-0003 の 3 段階判定を純粋関数にする
- **受け入れ条件**:
  - [ ] `resolveState({ hasProcessMeta, processAlive, procStartMatches, mtime, now, activeWindowMinutes, processInfoAvailable }): { state, reason }` がある
  - [ ] メタあり + プロセス生存 + procStart 一致 → `running` / `process`
  - [ ] メタあり + プロセス不在 → mtime 判定へ（`active` または `idle`）
  - [ ] メタあり + procStart 不一致 → mtime 判定へ（PID 再利用）
  - [ ] mtime が window 内 → `active` / `mtime`。それ以外 → `idle` / `none`
  - [ ] `processInfoAvailable: false` のときは `running` にならず、reason は `no-process-info`
  - [ ] 未来の mtime（時計ずれ）は `active` 扱いにする
- **参照**: ADR-0003 / ARCHITECTURE.md §3
- **触ってよい範囲**: `src/shared/state.ts`

### T-005 相対時刻とパス短縮の整形関数
- **目的**: DESIGN.md §8 の文言規則を関数にする
- **受け入れ条件**:
  - [ ] `formatRelative(iso, now)` が「たった今」(60 秒未満)、「N分前」、「N時間前」、「N日前」(7 日未満)、それ以降は `YYYY-MM-DD` を返す。未来は「たった今」
  - [ ] `shortenPath(path, homeDir)` がホーム配下を `~/` に置換し、区切りを `/` に統一する。大文字小文字を無視して一致させる
  - [ ] `truncateStart(text, max)` が先頭を `…` で省略する（フォルダ表示用）
  - [ ] `formatBytes(n)` が `12 KB`, `3.8 MB` の形式を返す（小数 1 桁、1024 基準）
  - [ ] `normalizeBranch("HEAD")` が `null` を返す
- **参照**: DESIGN.md §6.1, §8
- **触ってよい範囲**: `src/shared/time.ts`, `src/shared/format.ts`

### T-006 サーバ設定の読込と安全パス検証
- **目的**: 読み取り対象を roots に限定し、設定を 1 か所に集める
- **受け入れ条件**:
  - [ ] `loadConfig(opts?)` が `local-data/config.json` を読み、無ければ既定値（`roots: [~/.claude, ~/.codex]`, `activeWindowMinutes: 5`, `pollIntervalSec: 10`, `port: 4317`, `accounts: {}`）を返す。JSON が壊れていれば `Result` の err
  - [ ] `roots` は `os.homedir()` と `node:path` で組み立て、環境変数や区切り文字を直書きしない
  - [ ] `isUnderRoot(candidate, roots)` が `path.resolve` 後に大文字小文字を無視して前方一致で判定し、`..` を含む相対パスや別ドライブを拒否する
  - [ ] `EXCLUDED_FILES`（`.credentials.json`, `auth.json`, `*.key`, `*.sqlite*`, `settings*.json`）を判定する `isExcludedFile(name)` がある
  - [ ] `log.ts` が `info/warn/error` を持ち、引数に含まれる `roots` 配下のパスを `~` 置換して出す
- **参照**: ARCHITECTURE.md §2, §7 / ADR-0002
- **触ってよい範囲**: `src/server/config.ts`, `src/server/log.ts`, `src/server/sources/fs/safe-path.ts`

### T-007 ファイル先頭 / 末尾の部分読み取り
- **目的**: 25 MB 級ファイルでも全文を読まない
- **受け入れ条件**:
  - [ ] `readHeadLines(path, maxBytes)` が先頭 maxBytes を読み、完全な行だけを返す（最後の不完全行は捨てる）
  - [ ] `readTailLines(path, maxBytes)` が末尾 maxBytes を読み、最初の不完全行を捨てて完全な行だけを返す
  - [ ] ファイルサイズが maxBytes 以下なら全行を返す
  - [ ] 空ファイル → 空配列。存在しない → `Result` の err（例外を投げない）
  - [ ] UTF-8 のマルチバイト境界で切れても壊れた文字を含む行は捨てられる（JSON パース失敗として扱える）
  - [ ] 読み取り中にロックを取らない（`fs.open` の読み取り専用）
- **参照**: ARCHITECTURE.md §4.1 / CLAUDE.md §4
- **触ってよい範囲**: `src/server/sources/fs/head.ts`, `src/server/sources/fs/tail.ts`

### T-008 Claude セッションの探索（locator）
- **目的**: `projects/**/*.jsonl` と付随ファイルを列挙する
- **受け入れ条件**:
  - [ ] `locateClaudeSessions(root)` が `projects/<dir>/<sessionId>.jsonl` を列挙し、各件の `{ id, jsonlPath, projectDir, sizeBytes, mtime, hasCustomTitleFile, released, subagentCount }` を返す
  - [ ] `<sessionId>/custom-title.json`, `<sessionId>.desktop-released.json`, `<sessionId>/subagents/agent-*.jsonl` の有無・件数を stat だけで取る（本文は読まない）
  - [ ] `sessionId` が UUID 形式でないファイルは無視する。`memory/`, `tool-results/` を辿らない
  - [ ] `projects/` が無ければ空配列 + 警告（例外を投げない）
  - [ ] 除外ファイル（T-006）を開かない
- **参照**: RESEARCH.md §2.1 / ARCHITECTURE.md §4.1
- **触ってよい範囲**: `src/server/sources/claude/locator.ts`

### T-009 Claude JSONL のサマリ解析（parser）
- **目的**: 先頭 / 末尾だけから `SessionSummary` の材料を作る
- **受け入れ条件**:
  - [ ] `parseClaudeSummary(headLines, tailLines)` が `{ cwd, version, entrypoint, gitBranch, firstAt, lastAt, model, title, lastMessage, lastRole, ownerAccountUuid }` を返す
  - [ ] タイトルは custom-title → ai-title → 最初の user の本文先頭 1 行 → `null` の順（custom-title.json の値は呼び出し側が優先して上書きする）
  - [ ] `user` の `message.content` が文字列でも配列（`text` / `image` ブロック）でも本文を取り出せる。画像しか無ければ「(画像)」
  - [ ] `assistant` の `content` から `text` ブロックだけを取り、`tool_use` は無視。`<synthetic>` モデルは無視
  - [ ] JSON パース失敗行はスキップして件数を返す
  - [ ] `isSidechain: true` の行は無視する
  - [ ] `bridge-session` があれば `ownerAccountUuid` を取る
  - [ ] 先頭・末尾が空でも例外を投げず、すべて `null` のサマリを返す
- **参照**: RESEARCH.md §2.3, §2.5 / ARCHITECTURE.md §4.1
- **触ってよい範囲**: `src/server/sources/claude/parser.ts`

### T-010 Claude 稼働メタとプロセス列挙
- **目的**: `sessions/<pid>.json` とプロセス一覧から running を判定する材料を集める
- **受け入れ条件**:
  - [ ] `readRunningMeta(root)` が `sessions/*.json` を読み、型ガードを通った `{ pid, sessionId, cwd, startedAt, procStart, entrypoint, version }` の配列を返す。`.key` は開かない。壊れた json は警告してスキップ
  - [ ] `listProcesses()` が PowerShell（`Get-CimInstance Win32_Process`）を固定引数で 1 回だけ起動し、`{ pid, name, creationFileTime, commandLine }` の配列を返す。名前が `claude` / `codex` で始まるものだけに絞る
  - [ ] 結果を 2 秒キャッシュする。子プロセス起動に失敗したら `{ available: false }` を返し例外を投げない
  - [ ] `matchRunning(meta, processes)` が pid 一致かつ `procStart === creationFileTime` のときだけ `alive: true, procStartMatches: true` を返す
  - [ ] コマンドライン中の `--resume=<id>` を抽出できる（補助情報）
- **参照**: RESEARCH.md §2.2, §5 / ADR-0003
- **触ってよい範囲**: `src/server/sources/claude/running.ts`, `src/server/sources/process/list.ts`

### T-011 Codex rollout の探索と解析
- **目的**: Codex を同じ Session 抽象に載せる
- **受け入れ条件**:
  - [ ] `locateCodexSessions(root)` が `sessions/YYYY/MM/DD/rollout-*.jsonl` を列挙し `{ id(threadId), jsonlPath, sizeBytes, mtime }` を返す。ファイル名から threadId を取れないものは無視
  - [ ] `parseCodexSummary(headLines, tailLines)` が `session_meta` から `cwd, originator, cli_version, model_provider, git.branch`、`turn_context` から `model`、`event_msg.user_message` から title、`event_msg.task_complete.last_agent_message` または末尾 `response_item` から lastMessage を返す
  - [ ] 未知の `type` / `payload.type` は無視する
  - [ ] `sessions/` が無ければ空配列 + 警告
  - [ ] `thread-writer-locks` は読まない
- **参照**: RESEARCH.md §3 / ADR-0005
- **触ってよい範囲**: `src/server/sources/codex/locator.ts`, `src/server/sources/codex/parser.ts`

### T-012 セッション索引とアカウント合成
- **目的**: sources の結果を `SessionSummary[]` / `Account[]` に組み立てる
- **受け入れ条件**:
  - [ ] `SessionIndex` クラスが `rebuild()`（全走査）と `refreshFiles(paths)`（差分）と `getAll()`, `get(key)`, `getAccounts()` を持つ
  - [ ] `SessionSummary` の全フィールドを埋める（`branch: "HEAD" → null`、`title` 無し → `"(無題)"`、`lastMessage` はマスク済み 200 文字）
  - [ ] `accountKey` を ADR-0004 の規則で合成し、`config.accounts` の表示名で `Account.label` を上書きする。既定名は `Claude Desktop N`（N は出現順）、`Claude CLI`、`Codex`
  - [ ] `Account.running`, `runningCount`, `sessionCount`, `startedAt` を集計する
  - [ ] 状態判定は `shared/state.ts` を使う。プロセス情報が無い場合は `stateReason: "no-process-info"`
  - [ ] 同じ sessionId が複数 root に出た場合は mtime の新しい方を採用
- **参照**: ARCHITECTURE.md §3, §4.1 / ADR-0004
- **触ってよい範囲**: `src/server/store/index.ts`

### T-013 Hono API: sessions / accounts / health
- **目的**: クライアントが使う読み取り API
- **受け入れ条件**:
  - [ ] `GET /api/sessions` → `{ sessions, generatedAt }`。`GET /api/accounts` → `{ accounts }`
  - [ ] `GET /api/health` → `{ ok, version, roots(~置換), watcher, processInfo }`
  - [ ] エラー時は `{ error: { code, message, hint } }` で、`message` に何が起きたか、`hint` に次にどうするかが入る
  - [ ] サーバは `127.0.0.1` にバインドし、CORS は `http://localhost:*` / `http://127.0.0.1:*` のみ許可
  - [ ] `src/server/index.ts` が config → index.rebuild → serve の順で起動し、起動時間と件数をログに出す（パスは出さない）
  - [ ] `app.request()` で統合テストできるよう `createApp(deps)` を分離する
- **参照**: ARCHITECTURE.md §5
- **触ってよい範囲**: `src/server/app.ts`, `src/server/index.ts`, `src/server/routes/sessions.ts`, `src/server/routes/accounts.ts`, `src/server/routes/health.ts`
- **T-001 レビューからの引き継ぎ**: `/api/health` を `index.ts` から `routes/health.ts` へ移す。`serve()` 失敗（EADDRINUSE 等）時に `log.error` で「何が起きたか + 次にどうするか」を出す。`createApp()` を export して `app.request()` の統合テストを必ず追加する。サーバ側の相対 import は `.js` 拡張子付き（`tsconfig.server.json` が NodeNext のため）

### T-014 セッション詳細 API とメッセージ抽出
- **目的**: 詳細パネル用に最近のメッセージを返す
- **受け入れ条件**:
  - [ ] `GET /api/sessions/:tool/:id` が `SessionDetail` を返す。`tool` は `claude|codex`、`id` は UUID / threadId 形式のみ受け付け、それ以外は 400
  - [ ] 索引に無い id は 404。**パラメータからパスを組み立てない**（索引の `jsonlPath` を使う）
  - [ ] 末尾 256KB から `user` / `assistant` を最大 20 件、時系列順で返す。各 `text` はマスク済み・先頭 500 文字
  - [ ] `parseWarnings` に捨てた行数を入れる
  - [ ] Codex は `response_item(message)` と `event_msg.user_message` から同様に抽出
- **参照**: ARCHITECTURE.md §4.3, §5 / T-003
- **触ってよい範囲**: `src/server/sources/claude/detail.ts`, `src/server/sources/codex/detail.ts`, `src/server/routes/sessions.ts`

### T-015 ファイル監視・ポーリング・SSE・refresh
- **目的**: F-9 の自動更新をサーバ側で成立させる
- **受け入れ条件**:
  - [ ] `startWatcher(roots, onChange)` が `fs.watch({ recursive: true })` を試み、失敗したらポーリングのみで動く。成功しても `pollIntervalSec` ごとに stat 再走査する
  - [ ] 変更は 300ms で debounce し、変更ファイルの集合を `onChange(paths)` に渡す。`sessions/` 配下の変化は稼働状態の再計算だけを起こす
  - [ ] `GET /api/events` が SSE で `sessions-changed`（payload: `{ changed: number, at }`）と 30 秒ごとの `heartbeat` を送る。切断時に購読者を外す
  - [ ] `POST /api/refresh` が `rebuild()` を実行し `{ ok, scanned, durationMs }` を返す。同時実行は 1 つに直列化する
  - [ ] `/api/health` の `watcher` が `fs` / `poll` / `both` を返す
- **参照**: ARCHITECTURE.md §4.2, §5 / RESEARCH.md §7
- **触ってよい範囲**: `src/server/store/watcher.ts`, `src/server/store/events.ts`, `src/server/routes/events.ts`, `src/server/routes/health.ts`, `src/server/index.ts`

### T-016 デザイントークンとグローバルスタイル
- **目的**: DESIGN.md §9 を `tokens.css` にし、以降の UI の唯一の参照先にする
- **受け入れ条件**:
  - [ ] `src/client/styles/tokens.css` が DESIGN.md §9 と **完全一致**する（`prefers-reduced-motion` 含む）
  - [ ] `src/client/styles/global.css` が `body` の背景 `--color-bg`、文字 `--color-text`、フォント `--font-ui`、`--text-md` を設定し、`*:focus-visible` に `--color-focus` のリングを付ける。`box-sizing: border-box`
  - [ ] `main.tsx` が両 CSS を読み込む
  - [ ] `tokens.css` 以外の CSS に生の hex / px（`0`, `1px`, `2px` の境界線幅・比率を除く）が無い
  - [ ] `index.html` に `<meta name="color-scheme" content="dark">` と `lang="ja"`
- **参照**: DESIGN.md §2〜§4, §9
- **触ってよい範囲**: `src/client/styles/**`, `src/client/main.tsx`, `src/client/index.html`

### T-017 汎用 UI コンポーネント
- **目的**: DESIGN.md §6 の部品を先に揃える
- **受け入れ条件**:
  - [ ] `Dot`（state → 色 + 形 + `aria-label`。`running ●` / `active ◐` / `idle ○` / `error ▲`）
  - [ ] `Pill`（`tool` / `state` / `filter` の 3 種。輪郭のみ。`filter` は `selected` で背景変化）
  - [ ] `Button`（`primary` / `ghost`。`disabled` 時は `reason` を隣に表示し `aria-disabled`）
  - [ ] `Toggle`（ラベル必須。`aria-checked`。キーボードで切替）
  - [ ] `EmptyState`（メッセージ + 次の行動）、`Loading`（スケルトン 3 行、アニメーションなし）、`ErrorBanner`（message + hint）
  - [ ] すべて CSS Modules。トークン以外の値なし。各コンポーネントに表示テストが書ける props 設計
- **参照**: DESIGN.md §6.3, §6.5〜§6.10, §7
- **触ってよい範囲**: `src/client/components/**`, `vitest.config.ts`（setupFiles と client プロジェクトの include 拡張のみ）, `tests/setup/**`
- **T-001 レビューからの引き継ぎ**: `vitest.config.ts` の client プロジェクトに `@testing-library/jest-dom` の `setupFiles` を追加し、include を `src/client/**/*.test.{ts,tsx}` と `tests/**/*.tsx` に広げ、node 側から `src/client` を除く

### T-018 グルーピング・絞り込み・並べ替えの純粋関数
- **目的**: F-3 / F-4 のロジックを UI から切り離す
- **受け入れ条件**:
  - [ ] `applyFilters(sessions, filters, now)` が `tool`, `accountKey`, `folder`（cwd の前方一致・大文字小文字無視）, `sinceDays`（updatedAt）, `runningOnly`（running または active）, `query`（title / lastMessage / cwd / branch の部分一致・大文字小文字無視）を AND で適用する
  - [ ] `groupSessions(sessions, groupBy, accounts)` が `account` / `folder`（cwd）/ `state` / `tool` の 4 軸で `{ key, label, state, sessions, runningCount }[]` を返す。列の順序は: account = accounts の順、folder = 稼働数降順→名前、state = running → active → idle → error、tool = claude → codex
  - [ ] 各グループ内は `updatedAt` 降順
  - [ ] `sortSessions(sessions, { key, dir })` が `updatedAt` / `title` / `logSizeBytes` / `state` で並べ替える（安定ソート）
  - [ ] 空配列・全件除外でも例外なし
  - [ ] `folderOptions(sessions)` が絞り込み用のフォルダ候補（重複なし・件数付き）を返す
- **参照**: ARCHITECTURE.md §6 / DESIGN.md §5
- **触ってよい範囲**: `src/shared/grouping.ts`

### T-019 クライアント基盤（API クライアント / ストア / URL 同期）
- **目的**: 画面が共通で使う状態と通信
- **受け入れ条件**:
  - [ ] `api/client.ts` が `getSessions`, `getAccounts`, `getSession(tool, id)`, `getHealth`, `postRefresh` を持ち、HTTP エラーを `ApiError`（message + hint）に変換する
  - [ ] `store/useSessionStore.ts` が ARCHITECTURE.md §6 の状態と `load()`, `refresh()`, `setView`, `setGroupBy`, `setFilter`, `setSort`, `select`, `setReadOnly` を持つ。`readOnly` の既定は `true`
  - [ ] `store/url-sync.ts` が `view`, `groupBy`, `filters` を URL クエリと双方向同期する（初期化時に URL → ストア、変更時にストア → `history.replaceState`）
  - [ ] 派生データ（絞り込み後・グループ後）はセレクタ関数として提供し、ストアに保存しない
  - [ ] fetch 失敗時は `status.error` に `ApiError` を入れ、既存データは保持する
- **参照**: ARCHITECTURE.md §5, §6
- **触ってよい範囲**: `src/client/api/**`, `src/client/store/**`

### T-020 App シェルとヘッダ帯
- **目的**: ページ骨格、ボード / リスト切替、更新ボタン、件数表示
- **受け入れ条件**:
  - [ ] ヘッダ帯に「AI-Manager」、現在時刻（`HH:mm 現在`、1 分ごと更新）、「Claude N / Codex N 件」、`[ボード][リスト]` セグメント、`[更新]` ghost ボタン。`position: sticky`
  - [ ] 起動時に `load()` を呼び、`Loading` → 本体、エラー時は `ErrorBanner`
  - [ ] レイアウトは ヘッダ帯 → 指示入力（プレースホルダ領域）→ アカウント帯 → フィルタバー → 本体 の縦積み。各領域は feature コンポーネントを差し込むスロットにする（この時点では空のスロットでよい）
  - [ ] `view` の切替で `BoardView` / `ListView` のプレースホルダが切り替わる
  - [ ] タイトルバー `document.title` が「AI-Manager · N 稼働」になる
- **参照**: DESIGN.md §5.1, §6.6 / ARCHITECTURE.md §2
- **触ってよい範囲**: `src/client/app/**`, `src/client/features/refresh/RefreshButton.tsx`

### T-021 フィルタバーと読み取り専用トグル
- **目的**: F-3 の軸切替、F-4 の絞り込み、F-8 のトグル
- **受け入れ条件**:
  - [ ] 「並べ方」セグメント（アカウント / フォルダ / 状態 / 種類）と「絞り込み」セグメント（すべて / Claude / Codex）が `Pill.filter` で切り替わり、ストアに反映される
  - [ ] アカウント・フォルダのセレクト、期間セレクト（1日 / 3日 / 1週間 / 2週間 / 1か月 / すべて）、「稼働中だけ」チェック、フリーワード検索（300ms debounce）
  - [ ] 「読むだけ・送信はしない」トグル（既定 ON）。OFF にすると隣に「第 1 段階では送信できません」を表示
  - [ ] 「表示 N 件」を右端に出す。絞り込みで 0 件のとき「絞り込みを解除」リンクを出す
  - [ ] すべてキーボード操作可能。`position: sticky`
- **参照**: DESIGN.md §5.1, §6.4, §6.5, §8
- **触ってよい範囲**: `src/client/features/filters/**`

### T-022 アカウント帯
- **目的**: F-6 のアカウント（ウィンドウ）単位の稼働表示
- **受け入れ条件**:
  - [ ] `accounts` を `AccountChip` で横並び表示。ドット + 表示名 + 「稼働中 HH:mm〜」（`startedAt`、等幅）または「停止」
  - [ ] 右端に「Claude Code N · Codex N 稼働」ではなく `Claude Code N  Codex N  稼働` の形式（中黒を使わない）
  - [ ] チップをクリックすると `filters.accountKey` がそのアカウントになる（再クリックで解除）。選択中は境界 `--color-border-strong`
  - [ ] アカウントが 0 件のとき「アカウント情報がありません。Claude Code を起動すると表示されます」
- **参照**: DESIGN.md §5.1, §6.7 / ADR-0004
- **触ってよい範囲**: `src/client/features/accounts/**`

### T-023 ボード表示（列・カード・仮想スクロール）
- **目的**: F-2 のカンバン表示
- **受け入れ条件**:
  - [ ] `groupSessions` の結果を横並びの列で描画。列幅 `--column-width`、横スクロール可
  - [ ] `ColumnHeader` にドット + 名前 + 件数（稼働があれば `1 稼働 / 40`）。稼働列は下線が `--color-signal`。`position: sticky`
  - [ ] `SessionCard` が DESIGN.md §6.1 の 4 行構成。稼働中は左端バー。クリックで `select`、選択中は境界強調
  - [ ] 各列の縦方向は TanStack Virtual で仮想化（500 件でスクロールが滑らか）
  - [ ] 0 件の列は `EmptyState`「このグループにセッションはありません」
  - [ ] `←` `→` で列間、`↑` `↓` でカード間フォーカス移動、`Enter` で選択
- **参照**: DESIGN.md §5.1, §6.1, §6.2, §7
- **触ってよい範囲**: `src/client/features/board/**`

### T-024 リスト表示（テーブル・並べ替え・仮想スクロール）
- **目的**: F-2 の一覧表示
- **受け入れ条件**:
  - [ ] 列: 状態（ドット）/ 種別（ピル）/ タイトル / 最終メッセージ / フォルダ（等幅・先頭省略）/ ブランチ / サイズ / 最終更新
  - [ ] ヘッダクリックで `sort` を切替（同じ列で昇降反転）。並べ替え中の列に矢印と `aria-sort`
  - [ ] 行高 `--row-height`、TanStack Virtual で仮想化
  - [ ] 行クリック / `Enter` で `select`。選択行は背景 `--color-surface-3`
  - [ ] 0 件は `EmptyState`「条件に合うセッションがありません。絞り込みを解除してください」
  - [ ] `<table>` セマンティクス（`role` 付与）でスクリーンリーダーが列名を読める
- **参照**: DESIGN.md §5.2, §7
- **触ってよい範囲**: `src/client/features/list/**`

### T-025 詳細パネル・指示入力欄（無効）・自動更新・キーボード操作
- **目的**: F-5 詳細、F-7 の無効表示、F-9 の自動更新を繋ぐ
- **受け入れ条件**:
  - [ ] `DetailPanel` が右側 `--panel-width` に開き、DESIGN.md §5.3 の項目を表示。`recentMessages` を role ラベル付きで最大 20 件。`Esc` / `×` で閉じる。読み込み中は `Loading`、失敗は `ErrorBanner`
  - [ ] `ComposeBox` がテキストエリア + アカウントピル + フォルダセレクト + 「送る」`primary` ボタンを **disabled** で表示し、理由「第 1 段階では送信経路が未確認のため無効です（ADR 承認後に有効化）」を出す
  - [ ] `/api/events` を購読し `sessions-changed` で `refresh()`。SSE が切れたら 10 秒ごとのポーリングにフォールバックし、ヘッダ帯右端に「更新中」/「自動更新: 接続 / ポーリング」を表示
  - [ ] `prefers-reduced-motion` でパネル開閉のアニメーションが 0ms
  - [ ] 詳細パネルの `secrets` マスクはサーバ側で済んでいることを前提に、クライアントは加工しない
- **参照**: DESIGN.md §5.3, §6.6, §6.9, §6.10 / ARCHITECTURE.md §4.2, §9
- **触ってよい範囲**: `src/client/features/session-detail/**`, `src/client/features/compose/**`, `src/client/features/refresh/**`, `src/client/app/App.tsx`

### T-026 E2E と README
- **目的**: 主要導線の E2E と、README どおりに起動できること
- **受け入れ条件**:
  - [ ] `e2e/` に Playwright テスト: フィクスチャ roots でサーバを起動 → ボードに列が出る → リストへ切替 → 「Claude」で絞り込み → 行をクリックで詳細パネルが開く → `Esc` で閉じる
  - [ ] `pnpm e2e` が通る（`playwright install chromium` の手順を README に記載）
  - [ ] `README.md`（日本語）: 概要、前提（Windows 11 / Node / pnpm）、セットアップ、起動、`local-data/config.json` の例（表示名の上書き、`activeWindowMinutes`）、読み取り専用である旨と読まないファイルの一覧、トラブルシュート（`~/.claude/projects` が無い、プロセス情報が取れない）
  - [ ] README の手順どおりに `pnpm install` → `pnpm dev` で起動できる
- **参照**: harness.md §10 / ARCHITECTURE.md §8
- **触ってよい範囲**: `e2e/**`, `README.md`, `playwright.config.ts`, `package.json`（e2e script のみ）
- **T-001 レビューからの引き継ぎ**: `playwright.config.ts` の `baseURL` は Hono のポートを指しているが静的配信をしていない。`webServer` でサーバとクライアントを起動する形に見直す
