# TASKS.md — タスク台帳（進捗の唯一の真実）

## 進捗サマリ
- 全 29 件 / 完了 29 件 / 進行中 0 件 / 未着手 0 件
- 現在のタスク: **すべて完了**（第 1 段階 read-only + 実機確認の修正 T-027 / T-028 + 配色変更 T-029。第 2 段階 F-7 は ADR 起票と人間の承認が前提）
- 最終更新: 2026-09-03T22:00:00+09:00

## フェーズ進捗

| Phase | 内容 | 状態 | PR |
|---|---|---|---|
| 0 | 実機調査 | done | #1 |
| 1 | ハーネス文書生成 | done | #2 |
| 2 | タスク分解 | done | #3 |
| 3 | タスク実行ループ | done | #4〜#29 |
| 4 | 最終レビュー | done | #30 |

## タスク一覧

状態: `todo` / `in_progress` / `blocked` / `review` / `done` / `escalated`

| ID | タイトル | 依存 | 状態 | ループ回数 | PR |
|---|---|---|---|---|---|
| T-001 | プロジェクト初期化（pnpm / Vite / Hono / Biome / Vitest / scripts） | - | done | 1 | #4 |
| T-002 | 共有型定義と Result 型 | T-001 | done | 1 | #5 |
| T-003 | 秘密情報マスク関数 | T-002 | done | 2 | #7 |
| T-004 | 稼働状態の判定関数 | T-002 | done | 1 | #6 |
| T-005 | 相対時刻とパス短縮の整形関数 | T-002 | done | 2 | #8 |
| T-006 | サーバ設定の読込と安全パス検証 | T-002 | done | 3 | #12 |
| T-007 | ファイル先頭 / 末尾の部分読み取り | T-002 | done | 2 | #10 |
| T-008 | Claude セッションの探索（locator） | T-006 | done | 1 | #13 |
| T-009 | Claude JSONL のサマリ解析（parser） | T-007, T-008 | done | 1 | #17 |
| T-010 | Claude 稼働メタとプロセス列挙 | T-004, T-006 | done | 2 | #16 |
| T-011 | Codex rollout の探索と解析 | T-007, T-006 | done | 2 | #15 |
| T-012 | セッション索引とアカウント合成 | T-009, T-010, T-011 | done | 2 | #18 |
| T-013 | Hono API: sessions / accounts / health | T-012 | done | 1 | #19 |
| T-014 | セッション詳細 API とメッセージ抽出 | T-003, T-013 | done | 1 | #20 |
| T-015 | ファイル監視・ポーリング・SSE・refresh | T-013 | done | 3 | #25 |
| T-016 | デザイントークンとグローバルスタイル | T-001 | done | 1 | #9 |
| T-017 | 汎用 UI コンポーネント | T-016 | done | 1 | #14 |
| T-018 | グルーピング・絞り込み・並べ替えの純粋関数 | T-002, T-005 | done | 3 | #11 |
| T-019 | クライアント基盤（API クライアント / ストア / URL 同期） | T-013, T-018 | done | 2 | #21 |
| T-020 | App シェルとヘッダ帯 | T-017, T-019 | done | 1 | #22 |
| T-021 | フィルタバーと読み取り専用トグル | T-020 | done | 3 | #24 |
| T-022 | アカウント帯 | T-020 | done | 2 | #23 |
| T-023 | ボード表示（列・カード・仮想スクロール） | T-021 | done | 3 | #27 |
| T-024 | リスト表示（テーブル・並べ替え・仮想スクロール） | T-021 | done | 3 | #26 |
| T-025 | 詳細パネル・指示入力欄（無効）・自動更新・キーボード操作 | T-014, T-015, T-023, T-024 | done | 2 | #28 |
| T-026 | E2E と README | T-022, T-025 | done | 3 | #29 |
| T-027 | 稼働メタの procStart が文字列でも読めるようにする | T-010 | done | 2 | #31 |
| T-028 | 詳細パネルで直近メッセージが 0 件のときの案内表示 | T-025 | done | 2 | #31 |
| T-029 | 配色をインディゴ基調に変更（光彩・グラデーション・見出し書体） | T-016 | done | 3 | #32 |

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
- **T-002 レビューからの引き継ぎ（tester）**: `tests/unit/shared/no-runtime-imports.test.ts` を強化する。`node:` 接頭辞なしの組み込み（`path`, `fs`, `os`, `child_process` など）、副作用 import（`import "node:fs"`）、動的 import（`import("node:fs")`）も検出すること

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
  - [ ] `formatBytes(n)` が `512 B`, `12.0 KB`, `3.8 MB` の形式を返す（KB 以上は小数 1 桁、1024 基準。丸めで 1024 に達したら単位を繰り上げる）
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
  - [ ] ファイルサイズが maxBytes 以下なら全行を返す（head は末尾改行なしの最終行も含む。tail は書き込み途中の可能性があるため末尾改行なしの最終行を常に捨てる）
  - [ ] 空ファイル → 空配列。存在しない・ディレクトリ → `Result` の err（例外を投げない）。`maxBytes` は `MAX_READ_BYTES`（8MB）でクランプ
  - [ ] UTF-8 のマルチバイト境界で切れても壊れた文字を含む行は捨てられる（JSON パース失敗として扱える）
  - [ ] 読み取り中にロックを取らない（`fs.open` の読み取り専用）
- **参照**: ARCHITECTURE.md §4.1 / CLAUDE.md §4
- **触ってよい範囲**: `src/server/sources/fs/head.ts`, `src/server/sources/fs/tail.ts`, `src/server/sources/fs/lines.ts`, `src/server/sources/fs/errors.ts`

### T-008 Claude セッションの探索（locator）
- **目的**: `projects/**/*.jsonl` と付随ファイルを列挙する
- **受け入れ条件**:
  - [x] `locateClaudeSessions(root)` が `projects/<dir>/<sessionId>.jsonl` を列挙し、各件の `{ id, jsonlPath, projectDir, sizeBytes, mtime, hasCustomTitleFile, released, subagentCount }` を返す
  - [x] `<sessionId>/custom-title.json`, `<sessionId>.desktop-released.json`, `<sessionId>/subagents/agent-*.jsonl` の有無・件数を stat だけで取る（本文は読まない）
  - [x] `sessionId` が UUID 形式でないファイルは無視する。`memory/`, `tool-results/` を辿らない
  - [x] `projects/` が無ければ空配列 + 警告（例外を投げない）
  - [x] 除外ファイル（T-006）を開かない
- **参照**: RESEARCH.md §2.1 / ARCHITECTURE.md §4.1
- **触ってよい範囲**: `src/server/sources/claude/locator.ts`
- **T-008 レビューからの引き継ぎ（T-009 / T-012）**: `CLAUDE_SESSION_ID_PATTERN` を locator から再利用する。`ClaudeSessionFile.mtime` は epoch ms、`projectDir` は絶対パス（ログに出さない）。警告は固定文言 + 件数のみ。`<dir>` の readdir 失敗分岐と `isUnderRoot` false 分岐は未検証（防御として残置）。全走査の I/O は逐次なので、数百件規模で遅ければ `<dir>` 単位の `Promise.all` を検討（T-012）

### T-009 Claude JSONL のサマリ解析（parser）
- **目的**: 先頭 / 末尾だけから `SessionSummary` の材料を作る
- **受け入れ条件**:
  - [x] `parseClaudeSummary(headLines, tailLines)` が `{ cwd, version, entrypoint, gitBranch, firstAt, lastAt, model, title, lastMessage, lastRole, ownerAccountUuid }` を返す
  - [x] タイトルは custom-title → ai-title → 最初の user の本文先頭 1 行 → `null` の順（custom-title.json の値は呼び出し側が優先して上書きする）
  - [x] `user` の `message.content` が文字列でも配列（`text` / `image` ブロック）でも本文を取り出せる。画像しか無ければ「(画像)」
  - [x] `assistant` の `content` から `text` ブロックだけを取り、`tool_use` は無視。`<synthetic>` モデルは無視
  - [x] JSON パース失敗行はスキップして件数を返す
  - [x] `isSidechain: true` の行は無視する
  - [x] `bridge-session` があれば `ownerAccountUuid` を取る
  - [x] 先頭・末尾が空でも例外を投げず、すべて `null` のサマリを返す
- **参照**: RESEARCH.md §2.3, §2.5 / ARCHITECTURE.md §4.1
- **触ってよい範囲**: `src/server/sources/claude/parser.ts`
- **T-009 レビューからの引き継ぎ（T-012）**: parser は生の断片を返す。索引側で (a) title 候補が `<command-name>` / `<local-command-stdout>` / `<system-reminder>` / `<bash-input>` など `<` で始まる既知のシステムタグなら除外し、候補が尽きたら「(無題)」、(b) lastMessage は tail → `last-prompt` → head の順で決まるので、head 由来（古い本文）の場合があることを踏まえて表示する（当面はそのまま「最終メッセージ」として出してよい）、(c) `parseFailures` は head + tail の合計なので小ファイルでは丸める、(d) `CLAUDE_SESSION_ID_PATTERN` を `shared` から参照したくなったら定数を `src/shared/` へ移す（locator は node:fs を import するため）

### T-010 Claude 稼働メタとプロセス列挙
- **目的**: `sessions/<pid>.json` とプロセス一覧から running を判定する材料を集める
- **受け入れ条件**:
  - [x] `readRunningMeta(root)` が `sessions/*.json` を読み、型ガードを通った `{ pid, sessionId, cwd, startedAt, procStart, entrypoint, version }` の配列を返す。`.key` は開かない。壊れた json は警告してスキップ
  - [x] `listProcesses()` が PowerShell（`Get-CimInstance Win32_Process`）を固定引数で 1 回だけ起動し、`{ pid, name, creationFileTime, commandLine }` の配列を返す。名前が `claude` / `codex` で始まるものだけに絞る
  - [x] 結果を 2 秒キャッシュする。子プロセス起動に失敗したら `{ available: false }` を返し例外を投げない
  - [x] `matchRunning(meta, processes)` が pid 一致かつ `procStart === creationFileTime` のときだけ `alive: true, procStartMatches: true` を返す
  - [x] コマンドライン中の `--resume=<id>` を抽出できる（補助情報）
- **参照**: RESEARCH.md §2.2, §5 / ADR-0003
- **触ってよい範囲**: `src/server/sources/claude/running.ts`, `src/server/sources/process/list.ts`
- **T-010 レビューからの引き継ぎ（T-012 / T-013）**: `procStart` の突合は 1 秒の許容差（ADR-0003 追記）。`ProcessInfo.commandLine` には `codex exec "<プロンプト>"` の本文やトークンが入り得るので、API 応答・ログに載せる場合は必ず `shared/masking.ts` を通す（索引では `--resume` の id 抽出と Codex threadId 突合にだけ使い、そのまま返さない）。`listProcesses` の `available: false` は `stateReason: "no-process-info"` と `health.processInfo: false` に反映する

### T-011 Codex rollout の探索と解析
- **目的**: Codex を同じ Session 抽象に載せる
- **受け入れ条件**:
  - [x] `locateCodexSessions(root)` が `sessions/YYYY/MM/DD/rollout-*.jsonl` を列挙し `{ id(threadId), jsonlPath, sizeBytes, mtime }` を返す。ファイル名から threadId を取れないものは無視
  - [x] `parseCodexSummary(headLines, tailLines)` が `session_meta` から `cwd, originator, cli_version, model_provider, git.branch`、`turn_context` から `model`、`event_msg.user_message` から title、`event_msg.task_complete.last_agent_message` または末尾 `response_item` から lastMessage を返す
  - [x] 未知の `type` / `payload.type` は無視する
  - [x] `sessions/` が無ければ空配列 + 警告
  - [x] `thread-writer-locks` は読まない
- **参照**: RESEARCH.md §3 / ADR-0005
- **触ってよい範囲**: `src/server/sources/codex/locator.ts`, `src/server/sources/codex/parser.ts`
- **T-011 レビューからの引き継ぎ（T-012）**: `parseCodexSummary` / `parseClaudeSummary` の `parseFailures` は head + tail の合計で、小ファイル（head と tail が重なる）では最大 2 倍になる。索引側で head / tail の範囲が重なる場合は tail だけを渡すか、`min(parseFailures, 実行数)` に丸めてから `parseWarnings` に出す。`response_item.content` の `type` 無し要素は本文として採用している（実データが得られたら見直す）。集約警告の文言「セッションディレクトリのうち」は stat 失敗（ファイル単位）も含むので次に触るとき「セッションログのうち」に直す

### T-012 セッション索引とアカウント合成
- **目的**: sources の結果を `SessionSummary[]` / `Account[]` に組み立てる
- **受け入れ条件**:
  - [x] `SessionIndex` クラスが `rebuild()`（全走査）と `refreshFiles(paths)`（差分）と `getAll()`, `get(key)`, `getAccounts()` を持つ
  - [x] `SessionSummary` の全フィールドを埋める（`branch: "HEAD" → null`、`title` 無し → `"(無題)"`、`lastMessage` はマスク済み 200 文字）
  - [x] `accountKey` を ADR-0004 の規則で合成し、`config.accounts` の表示名で `Account.label` を上書きする。既定名は `Claude Desktop N`（N は出現順）、`Claude CLI`、`Codex`
  - [x] `Account.running`, `runningCount`, `sessionCount`, `startedAt` を集計する
  - [x] 状態判定は `shared/state.ts` を使う。プロセス情報が無い場合は `stateReason: "no-process-info"`
  - [x] 同じ sessionId が複数 root に出た場合は mtime の新しい方を採用
- **参照**: ARCHITECTURE.md §3, §4.1 / ADR-0004
- **触ってよい範囲**: `src/server/store/index.ts`
- **T-012 レビューからの引き継ぎ（T-013 / T-014 / T-015 / Phase 4）**: `getAll()` は配列のみコピーで `SessionSummary` は索引と共有参照なので routes で加工しない。`POST /api/refresh` の連打では `listProcesses` の 2 秒キャッシュにより最大 2 秒古いプロセス一覧を使う（ADR-0003 の範囲内）。読み取り失敗セッションの `accountKey` は `claude:cli` 固定（Desktop 起動でも）。`refreshFiles` のパス照合は総当たり（数百件で遅ければ正規化パス → key の Map にする）。「両方を試す」root では `sessions/` 配下がすべて Claude 稼働メタ扱いになり、新規 Codex rollout が rebuild にフォールバックしない（既定 roots では起きない）。警告の除去が文言マッチなので sources の警告に `code` を持たせる案は Phase 4 で検討。`index.ts` の `computeAccounts` / `mapWithConcurrency` は `store/accounts.ts` / `store/concurrency.ts` へ分割候補。`truncateEnd` は UTF-16 単位で切る（`format.ts` の `truncateStart` と同じ注意）。`refreshFiles` は複数 root に同じ id がある場合や locator の一時的な readdir 失敗でも該当キーを削除するが、次の変更イベントで未知パス → rebuild により自己修復する。T-015 の watcher でこの復帰経路が通ることを 1 度確認する

### T-013 Hono API: sessions / accounts / health
- **目的**: クライアントが使う読み取り API
- **受け入れ条件**:
  - [x] `GET /api/sessions` → `{ sessions, generatedAt }`。`GET /api/accounts` → `{ accounts }`
  - [x] `GET /api/health` → `{ ok, version, roots(~置換), watcher, processInfo }`
  - [x] エラー時は `{ error: { code, message, hint } }` で、`message` に何が起きたか、`hint` に次にどうするかが入る
  - [x] サーバは `127.0.0.1` にバインドし、CORS は `http://localhost:*` / `http://127.0.0.1:*` のみ許可
  - [x] `src/server/index.ts` が config → index.rebuild → serve の順で起動し、起動時間と件数をログに出す（パスは出さない）
  - [x] `app.request()` で統合テストできるよう `createApp(deps)` を分離する
- **参照**: ARCHITECTURE.md §5
- **触ってよい範囲**: `src/server/app.ts`, `src/server/index.ts`, `src/server/routes/sessions.ts`, `src/server/routes/accounts.ts`, `src/server/routes/health.ts`
- **T-006 レビューからの引き継ぎ（log.ts）**: `maskDeep` が `Date` / `Map` / `Error` を `{}` に潰す（`Date` は ISO 文字列に、非プレーンは `String()` に）。`fields` が `level` / `at` / `message` を上書きできる（予約キーを後ろに）。循環参照で RangeError（深さ上限 + write 全体の try/catch）。`~/.claude/projects/C--Users-<name>-…` のダッシュ符号化ディレクトリ名がマスクされない（homeDir をダッシュ化した形も置換規則に加える）。`path.isAbsolute("/x")` が Windows で true（ドライブレターまたは UNC を要求）
- **T-018 レビューからの引き継ぎ（下流全般）**: `SessionGroup.key` は folder 軸だけ正規化済み小文字。表示には必ず `label` を使う。URL 同期で `folder=""` は `null` に落とす（T-019）
- **T-002 レビューからの引き継ぎ**: `AppError`（hint 任意）→ `ApiError`（hint 必須）の変換 `toApiError()` を `src/server/errors.ts` に 1 か所だけ置き、hint 未設定時の既定文言（「時間をおいて「更新」を押してください」）を決める
- **T-001 レビューからの引き継ぎ**: `/api/health` を `index.ts` から `routes/health.ts` へ移す。`serve()` 失敗（EADDRINUSE 等）時に `log.error` で「何が起きたか + 次にどうするか」を出す。`createApp()` を export して `app.request()` の統合テストを必ず追加する。サーバ側の相対 import は `.js` 拡張子付き（`tsconfig.server.json` が NodeNext のため）
- **T-013 レビューからの引き継ぎ（T-014 / T-015 / Phase 4）**: `createApp(deps)` の `index` は `Pick<SessionIndex, …>`。T-014 は `routes/sessions.ts` に `GET /sessions/:tool/:id` を足す際 `index.get(key)` と detail 用の依存を `AppDeps` に追加する。T-015 は `watcherMode` を `AppDeps` に渡し `index.ts` に監視・SSE を足す。`health.warnings` は ARCHITECTURE §5 の表に無い追加フィールド（Phase 4 で表を更新）。`version` は `process.env.npm_package_version` なので `node dist/server/index.js` 直起動では `0.0.0`（README で `pnpm start` を案内）

### T-014 セッション詳細 API とメッセージ抽出
- **目的**: 詳細パネル用に最近のメッセージを返す
- **受け入れ条件**:
  - [x] `GET /api/sessions/:tool/:id` が `SessionDetail` を返す。`tool` は `claude|codex`、`id` は UUID / threadId 形式のみ受け付け、それ以外は 400
  - [x] 索引に無い id は 404。**パラメータからパスを組み立てない**（索引の `jsonlPath` を使う）
  - [x] 末尾 256KB から `user` / `assistant` を最大 20 件、時系列順で返す。各 `text` はマスク済み・先頭 500 文字
  - [x] `parseWarnings` に捨てた行数を入れる
  - [x] Codex は `response_item(message)` と `event_msg.user_message` から同様に抽出
- **参照**: ARCHITECTURE.md §4.3, §5 / T-003
- **触ってよい範囲**: `src/server/sources/claude/detail.ts`, `src/server/sources/codex/detail.ts`, `src/server/routes/sessions.ts`
- **T-014 レビューからの引き継ぎ（T-015 / T-025 / Phase 4）**: `routes/sessions.ts` が `sources/*/detail.ts` を既定 import している（ARCHITECTURE §2.1 の字面に反する）。T-015 の配線で `index.ts` から `AppDeps.readClaudeDetail` / `readCodexDetail` に実物を注入し、route の既定 import を消して必須にする。detail の定数・切り詰め（`finalizeDetailText` / `truncateEnd` / `truncateStart`）は 3 か所で重複しているので `shared/format.ts` へ集約する候補。Codex は `user_message` と `response_item(user)` で同じ本文が 2 件並ぶ可能性がある（T-025 で実データ確認）。`parseWarnings` の文言には「次にどうするか」が無いので詳細パネルで補足を添える。ARCHITECTURE §4.3 の「UUID v4」は実装（汎用 UUID）に合わせて直す（Phase 4）

### T-015 ファイル監視・ポーリング・SSE・refresh
- **目的**: F-9 の自動更新をサーバ側で成立させる
- **受け入れ条件**:
  - [x] `startWatcher(roots, onChange)` が `fs.watch({ recursive: true })` を試み、失敗したらポーリングのみで動く。成功しても `pollIntervalSec` ごとに stat 再走査する
  - [x] 変更は 300ms で debounce し、変更ファイルの集合を `onChange(paths)` に渡す。`sessions/` 配下の変化は稼働状態の再計算だけを起こす
  - [x] `GET /api/events` が SSE で `sessions-changed`（payload: `{ changed: number, at }`）と 30 秒ごとの `heartbeat` を送る。切断時に購読者を外す
  - [x] `POST /api/refresh` が `rebuild()` を実行し `{ ok, scanned, durationMs }` を返す。同時実行は 1 つに直列化する
  - [x] `/api/health` の `watcher` が `fs` / `poll` / `both` を返す
- **参照**: ARCHITECTURE.md §4.2, §5 / RESEARCH.md §7
- **触ってよい範囲**: `src/server/store/watcher.ts`, `src/server/store/events.ts`, `src/server/routes/events.ts`, `src/server/routes/health.ts`, `src/server/index.ts`
- **T-015 レビューからの引き継ぎ（T-025 / Phase 4）**: `WatcherMode` の `"fs"` は実装上返らない（`both` / `poll` のみ。ポーリングは常時動く）。`routes/events.ts` の `Promise.race` で `stream.sleep` のタイマーが取り消されない（接続 1 本あたり最大 1 秒残る。`AbortSignal` 付き sleep に差し替え候補）。`closeAllConnections()` は graceful な `stream.close()` 前のソケットを破壊し得る（ローカル専用なので許容）。テスト側の型シム（`SubscriberWithClose` / `AppDepsWithEvents`）は不要になったので整理。`SessionsChangedPayload.changed` は `rebuild` では走査件数。`server-entry.test.ts` はテキスト照合なので `startHeartbeat` の呼び忘れ等は検知しない（route 側の保険あり）。クライアント（T-025）は `sessions-changed` を受けて `load()`、`heartbeat` 途絶で 10 秒ポーリングにフォールバック

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
  - [x] `Dot`（state → 色 + 形 + `aria-label`。`running ●` / `active ◐` / `idle ○` / `error ▲`）
  - [x] `Pill`（`tool` / `state` / `filter` の 3 種。輪郭のみ。`filter` は `selected` で背景変化）
  - [x] `Button`（`primary` / `ghost`。`disabled` 時は `reason` を隣に表示し `aria-disabled`）
  - [x] `Toggle`（ラベル必須。`aria-checked`。キーボードで切替）
  - [x] `EmptyState`（メッセージ + 次の行動）、`Loading`（スケルトン 3 行、アニメーションなし）、`ErrorBanner`（message + hint）
  - [x] すべて CSS Modules。トークン以外の値なし。各コンポーネントに表示テストが書ける props 設計
- **参照**: DESIGN.md §6.3, §6.5〜§6.10, §7
- **触ってよい範囲**: `src/client/components/**`, `vitest.config.ts`（setupFiles と client プロジェクトの include 拡張のみ）, `tests/setup/**`
- **T-001 レビューからの引き継ぎ**: `vitest.config.ts` の client プロジェクトに `@testing-library/jest-dom` の `setupFiles` を追加し、include を `src/client/**/*.test.{ts,tsx}` と `tests/**/*.tsx` に広げ、node 側から `src/client` を除く
- **T-017 レビューからの引き継ぎ（下流 UI 全般）**: `components/index.ts` から import する。`Pill` は全種別に `--tracking-wide` が乗る（DESIGN.md §3.2「英字ラベルのみ」と §6.3 の記述揺れ。文書側で要整理）。`tests/unit/client/components-css-tokens.test.ts` は `calc()` 内に `var()` を含まない生値（`calc(100% - 5px)`）や `rgba()` / 名前付き色を検出できないので、feature の CSS を足す際は検査を強化する。`Toggle` は `<form>` 内で Enter のフォーム送信を抑止する（第 1 段階は送信なしなので影響なし）

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
  - [x] `api/client.ts` が `getSessions`, `getAccounts`, `getSession(tool, id)`, `getHealth`, `postRefresh` を持ち、HTTP エラーを `ApiError`（message + hint）に変換する
  - [x] `store/useSessionStore.ts` が ARCHITECTURE.md §6 の状態と `load()`, `refresh()`, `setView`, `setGroupBy`, `setFilter`, `setSort`, `select`, `setReadOnly` を持つ。`readOnly` の既定は `true`
  - [x] `store/url-sync.ts` が `view`, `groupBy`, `filters` を URL クエリと双方向同期する（初期化時に URL → ストア、変更時にストア → `history.replaceState`）
  - [x] 派生データ（絞り込み後・グループ後）はセレクタ関数として提供し、ストアに保存しない
  - [x] fetch 失敗時は `status.error` に `ApiError` を入れ、既存データは保持する
- **参照**: ARCHITECTURE.md §5, §6
- **触ってよい範囲**: `src/client/api/**`, `src/client/store/**`
- **T-019 レビューからの引き継ぎ（T-020 以降 / T-025 / T-026）**: セレクタ（`selectFilteredSessions` / `selectGroups` / `selectSortedSessions` / `selectCounts`）は毎回新しい配列を返すので `useSessionStore(selector)` に渡さず必ず `useMemo` で使い、`nowMs` は分単位に丸めた値を明示的に渡して依存配列に含める（ヘッダの 1 分時計を `useNowMinute()` 相当の単一供給源にしてボード / リスト / 件数で共有）。全呼び出し側が渡すようになったら `nowMs` の既定値 `Date.now()` を外す。`popstate`（戻る / 進む）は未対応。`networkError` の hint「pnpm dev で…」は README の起動手段と揃える（T-026）。`refresh_failed` は固定文言なのでサーバ固有の message を包む余地あり。`ApiClient` の実装は例外を投げない契約（`runLoad` が前提にしている）

### T-020 App シェルとヘッダ帯
- **目的**: ページ骨格、ボード / リスト切替、更新ボタン、件数表示
- **受け入れ条件**:
  - [x] ヘッダ帯に「AI-Manager」、現在時刻（`HH:mm 現在`、1 分ごと更新）、「Claude N / Codex N 件」、`[ボード][リスト]` セグメント、`[更新]` ghost ボタン。`position: sticky`
  - [x] 起動時に `load()` を呼び、`Loading` → 本体、エラー時は `ErrorBanner`
  - [x] レイアウトは ヘッダ帯 → 指示入力（プレースホルダ領域）→ アカウント帯 → フィルタバー → 本体 の縦積み。各領域は feature コンポーネントを差し込むスロットにする（この時点では空のスロットでよい）
  - [x] `view` の切替で `BoardView` / `ListView` のプレースホルダが切り替わる
  - [x] タイトルバー `document.title` が「AI-Manager · N 稼働」になる
- **参照**: DESIGN.md §5.1, §6.6 / ARCHITECTURE.md §2
- **触ってよい範囲**: `src/client/app/**`, `src/client/features/refresh/RefreshButton.tsx`
- **T-020 レビューからの引き継ぎ（T-023 / T-024 / T-025 / Phase 4）**: 表示切替セグメントは `Pill.filter`（`Button` が `aria-pressed` を持たないため）。DESIGN.md §6.6 の「ghost は『ボード / リスト』に使う」を §6.4 に寄せて修正する（Phase 4）。`Header` の `selectCounts` は `sessions` だけを deps にしている（表示値は `claude` / `codex` のみなので正しいが、`visible` を使うなら `filters` も購読）。`useSessionStore.getState()` を render 中に読む idiom は `useShallow` で必要フィールドだけ購読する形に統一する候補。絞り込みで 0 件のときの空状態（DESIGN §6.8「条件に合うセッションがありません」）は T-023 / T-024 側で出す。`features/refresh/index.ts` は T-025 で作る。`z-index` は `--z-*` トークンを DESIGN.md §9 に追加して一元化（T-025 でヘッダとフィルタバーの sticky が重なるとき）。`main` の `margin-top: --space-6` の持ち主を T-021 組み込み時に再確認。空スロットの `<section aria-label>` は中身が入るまでランドマークにしない選択もある。`App.test.tsx` の `vi.resetModules` は T-019 で fetch が呼び出し時参照になったので `vi.stubGlobal` だけに戻せる

### T-021 フィルタバーと読み取り専用トグル
- **目的**: F-3 の軸切替、F-4 の絞り込み、F-8 のトグル
- **受け入れ条件**:
  - [x] 「並べ方」セグメント（アカウント / フォルダ / 状態 / 種類）と「絞り込み」セグメント（すべて / Claude / Codex）が `Pill.filter` で切り替わり、ストアに反映される
  - [x] アカウント・フォルダのセレクト、期間セレクト（1日 / 3日 / 1週間 / 2週間 / 1か月 / すべて）、「稼働中だけ」チェック、フリーワード検索（300ms debounce）
  - [x] 「読むだけ・送信はしない」トグル（既定 ON）。OFF にすると隣に「第 1 段階では送信できません」を表示
  - [x] 「表示 N 件」を右端に出す。絞り込みで 0 件のとき「絞り込みを解除」リンクを出す
  - [x] すべてキーボード操作可能。`position: sticky`
- **参照**: DESIGN.md §5.1, §6.4, §6.5, §8
- **触ってよい範囲**: `src/client/features/filters/**`
- **T-021 レビューからの引き継ぎ（T-025 / Phase 4）**: フォルダの `~` 置換と先頭省略はクライアントが homeDir を知らないため未実施（`/api/health` から配布してストアに置く案）。ヘッダ帯とフィルタバーが共に `top: 0` の sticky で重なる（`--header-height` 相当のトークン追加 = DESIGN.md 変更が必要）。`z-index: 1` は `--z-*` トークン化候補。Layout 側 `.filters` の左右パディングと二重（Layout 側を削る）。Layout の `<section aria-label="絞り込み">` と FilterBar 内 `role="group" aria-label="絞り込み"` の入れ子。固定 id（`filter-account` 等）は同一画面に 2 つ置かない前提。`useMemo` 内の `getState()` スプレッド idiom と `Date.now()` は `useNowMinute()` に置き換える。ストアの初期値と `MODULE_DEFAULTS.filters` は `DEFAULT_FILTERS` の参照共有のまま（`resetFilters` だけスプレッド）

### T-022 アカウント帯
- **目的**: F-6 のアカウント（ウィンドウ）単位の稼働表示
- **受け入れ条件**:
  - [x] `accounts` を `AccountChip` で横並び表示。ドット + 表示名 + 「稼働中 HH:mm〜」（`startedAt`、等幅）または「停止」
  - [x] 右端に「Claude Code N · Codex N 稼働」ではなく `Claude Code N  Codex N  稼働` の形式（中黒を使わない）
  - [x] チップをクリックすると `filters.accountKey` がそのアカウントになる（再クリックで解除）。選択中は境界 `--color-border-strong`
  - [x] アカウントが 0 件のとき「アカウント情報がありません。Claude Code を起動すると表示されます」
- **参照**: DESIGN.md §5.1, §6.7 / ADR-0004
- **触ってよい範囲**: `src/client/features/accounts/**`
- **T-022 レビューからの引き継ぎ（T-025 / Phase 4）**: `data-account-key` と URL の `?account=` に `claude:<uuid>` が載る（ADR-0004 の趣旨との境界事例。露出を絞るなら url-sync と合わせて別 ADR）。24 時間超前に起動したセッションは「稼働中 HH:mm〜」だけでは日付が分からない（`title` 属性で絶対日時を補う候補）。`startedAt` が不正 ISO のときのテスト（`Date.parse` 防御）と `.time` クラスの等幅検証は未追加

### T-023 ボード表示（列・カード・仮想スクロール）
- **目的**: F-2 のカンバン表示
- **受け入れ条件**:
  - [x] `groupSessions` の結果を横並びの列で描画。列幅 `--column-width`、横スクロール可
  - [x] `ColumnHeader` にドット + 名前 + 件数（稼働があれば `1 稼働 / 40`）。稼働列は下線が `--color-signal`。`position: sticky`
  - [x] `SessionCard` が DESIGN.md §6.1 の 4 行構成。稼働中は左端バー。クリックで `select`、選択中は境界強調
  - [x] 各列の縦方向は TanStack Virtual で仮想化（500 件でスクロールが滑らか）
  - [x] 0 件の列は `EmptyState`「このグループにセッションはありません」
  - [x] `←` `→` で列間、`↑` `↓` でカード間フォーカス移動、`Enter` で選択
- **参照**: DESIGN.md §5.1, §6.1, §6.2, §7
- **触ってよい範囲**: `src/client/features/board/**`
- **T-023 レビューからの引き継ぎ（Phase 4）**: キー処理は `getFreshGroups()`（ストアの最新値から `selectGroups`）で判定し、描画は `useMemo` の groups を使う。矢印キー 1 打ごとに全件の絞り込み + グルーピングが走るので 500 件規模でキーリピートが重ければキャッシュする。`nextRequestId()` を `setFocusedCard` の updater 内で呼んでいる（StrictMode で余分に進むが単調増加しか使わないので実害なし。採番を呼び出し側に出すのが正統）。空列で `↑` `↓` を押すと最初の非空列の先頭へ飛ぶ（無反応を避ける救済。DESIGN §7 の文言からは外れる）。`scrollMargin` 未設定（sticky ヘッダ + margin 分の座標系ずれは overscan 5 で吸収）。`cardElRefs` のコールバック ref はレンダーごとに再生成。`.scroll { max-height: 100vh }` は暫定。region と focused card で Tab ストップが 2 つ（到達性を優先）

### T-024 リスト表示（テーブル・並べ替え・仮想スクロール）
- **目的**: F-2 の一覧表示
- **受け入れ条件**:
  - [x] 列: 状態（ドット）/ 種別（ピル）/ タイトル / 最終メッセージ / フォルダ（等幅・先頭省略）/ ブランチ / サイズ / 最終更新
  - [x] ヘッダクリックで `sort` を切替（同じ列で昇降反転）。並べ替え中の列に矢印と `aria-sort`
  - [x] 行高 `--row-height`、TanStack Virtual で仮想化
  - [x] 行クリック / `Enter` で `select`。選択行は背景 `--color-surface-3`
  - [x] 0 件は `EmptyState`「条件に合うセッションがありません。絞り込みを解除してください」
  - [x] `<table>` セマンティクス（`role` 付与）でスクリーンリーダーが列名を読める
- **参照**: DESIGN.md §5.2, §7
- **触ってよい範囲**: `src/client/features/list/**`
- **T-024 レビューからの引き継ぎ（Phase 4）**: `--list-columns` は `--column-width`（ボードの列幅）を分割して組んでいるので、`--list-col-*` トークンを DESIGN.md §9 / tokens.css に追加して切り離す。仮想化は `scrollMargin` 無し（ヘッダ 1 行分の可視範囲のずれは overscan 10 で吸収。`scrollMargin` を入れるなら `--virtual-offset` に `start - scrollMargin` を渡すこと）。`FOLDER_MAX_CHARS` は board と重複（`shared/format.ts` へ上げる候補）。`useMemo` 内の `getState()` スプレッドは `useShallow` へ。jsdom で仮想化を描画させるには `offsetWidth` / `offsetHeight` / `clientHeight` / `getBoundingClientRect` のパッチが必要（`@tanstack/virtual-core` 3.17 は `offsetHeight` を読む）

### T-025 詳細パネル・指示入力欄（無効）・自動更新・キーボード操作
- **目的**: F-5 詳細、F-7 の無効表示、F-9 の自動更新を繋ぐ
- **受け入れ条件**:
  - [x] `DetailPanel` が右側 `--panel-width` に開き、DESIGN.md §5.3 の項目を表示。`recentMessages` を role ラベル付きで最大 20 件。`Esc` / `×` で閉じる。読み込み中は `Loading`、失敗は `ErrorBanner`
  - [x] `ComposeBox` がテキストエリア + アカウントピル + フォルダセレクト + 「送る」`primary` ボタンを **disabled** で表示し、理由「第 1 段階では送信経路が未確認のため無効です（ADR 承認後に有効化）」を出す
  - [x] `/api/events` を購読し `sessions-changed` で `load()`（サーバ側で再走査済みのため `refresh()` ではない。ARCHITECTURE §4.2）。SSE が切れたら 10 秒ごとのポーリングにフォールバックし、ヘッダ帯右端に「更新中」/「自動更新: 接続 / ポーリング」を表示
  - [x] `prefers-reduced-motion` でパネル開閉のアニメーションが 0ms
  - [x] 詳細パネルの `secrets` マスクはサーバ側で済んでいることを前提に、クライアントは加工しない
- **参照**: DESIGN.md §5.3, §6.6, §6.9, §6.10 / ARCHITECTURE.md §4.2, §9
- **触ってよい範囲**: `src/client/features/session-detail/**`, `src/client/features/compose/**`, `src/client/features/refresh/**`, `src/client/app/**`（`App.tsx` / `App.module.css` / `Layout.*` / `Header.*` の配線と `ViewPlaceholder` の削除を含む）
- **T-025 レビューからの引き継ぎ（Phase 4）**: **ヘッダ帯は sticky にしない**（`--header-height` トークンが無く、フィルタバーの sticky と `top` を両立できないため。DESIGN.md §5.1「ヘッダ帯とフィルタバーは sticky」からの意図的な逸脱。Phase 4 で `--header-height` を DESIGN.md §9 / tokens.css に追加して両立させ、DESIGN.md に注記か ADR を残す）。`DetailPanel` の `formatFixedDateTime` / `pad2` は `shared/time.ts` に `formatDateTime(iso)` として集約する。`LiveStatus` は live region なので「更新中」の切り替えを読み上げ対象から外す案。`<section aria-label="指示入力">` と `<section aria-label="絞り込み">` は Layout 側と feature 側で入れ子（Layout 側のラベルを外す）。`DetailPanel` は取得 / スライドイン / フォーカス管理 / Esc をカスタムフックに分割候補。閉じるボタンは `components/Button` が `data-*` / `ref` を透過しないためネイティブ `<button>`（`Button` に `ref` 転送を足せば戻せる）。`HEARTBEAT_TIMEOUT_MS = 60_000` はサーバ 30 秒の 1 回分の取りこぼしを吸収（2 回目と同時刻で競合）。Codex の `user_message` と `response_item(user)` の重複は詳細パネルで実データ確認

### T-026 E2E と README
- **目的**: 主要導線の E2E と、README どおりに起動できること
- **受け入れ条件**:
  - [x] `e2e/` に Playwright テスト: フィクスチャ roots でサーバを起動 → ボードに列が出る → リストへ切替 → 「Claude」で絞り込み → 行をクリックで詳細パネルが開く → `Esc` で閉じる
  - [x] `pnpm e2e` が通る（`playwright install chromium` の手順を README に記載）
  - [x] `README.md`（日本語）: 概要、前提（Windows 11 / Node / pnpm）、セットアップ、起動、`local-data/config.json` の例（表示名の上書き、`activeWindowMinutes`）、読み取り専用である旨と読まないファイルの一覧、トラブルシュート（`~/.claude/projects` が無い、プロセス情報が取れない）
  - [x] README の手順どおりに `pnpm install` → `pnpm dev` で起動できる
- **参照**: harness.md §10 / ARCHITECTURE.md §8
- **触ってよい範囲**: `e2e/**`, `README.md`, `playwright.config.ts`, `package.json`（e2e script のみ）、`tests/unit/readme-contract.test.ts`（tester）。メインの判断で `src/server/config.ts`（`AI_MANAGER_CONFIG_PATH`）と `vite.config.ts`（`/api` プロキシの限定）も同時に変更
- **T-001 レビューからの引き継ぎ**: `playwright.config.ts` の `baseURL` は Hono のポートを指しているが静的配信をしていない。`webServer` でサーバとクライアントを起動する形に見直す
- **T-026 レビューからの引き継ぎ（Phase 4）**: README のトラブルシュートに E2E 関連（`pnpm exec playwright install chromium` 未実行時の症状、`pnpm e2e` が `local-data/e2e/` を毎回削除・再生成すること）を追記する。`README.md` の「Node.js 22 以上」は推定（`engines.node` を入れるなら揃える）。`vite.config.ts` の `/api` プロキシは API パスの正規表現に限定（`src/client/api/` と衝突するため。ARCHITECTURE §5 に API を足すときはここも更新）。`AI_MANAGER_CONFIG_PATH` はローカル環境変数で `config.json` と同じ信頼境界（`AppConfig.roots` の JSDoc に環境変数経路も追記候補）。DESIGN.md §5.1 のヘッダ帯 sticky の差分は T-025 引き継ぎと合わせて ADR 化

### T-027 稼働メタの procStart が文字列でも読めるようにする
- **目的**: 実機確認（`pnpm dev`）で「0 稼働」になり、`/api/health` の警告に「稼働メタ 4 件が不正」と出た。実機の `sessions/<pid>.json` は `procStart` を 2^53 超のため数字の文字列で書いており、Phase 0 の記録（数値）と食い違っていた（harness §9.2-4 相当だが影響は 1 フィールドの型のみ）
- **受け入れ条件**:
  - [x] `readRunningMeta` が `procStart` を数値・数字文字列のどちらでも受け付け、それ以外（空文字・`0x10`・非数字）は不正として警告に数える
  - [x] `matchRunning` が文字列由来の `procStart` でも 1 秒の許容差で一致を判定する
  - [x] RESEARCH.md §2.2 に実機の形を追記する
  - [x] 実機で `pnpm dev` を起動し `/api/health` の警告が消え、稼働中セッションが「N 稼働」と表示される
- **参照**: RESEARCH.md §2.2 / ADR-0003 / T-010
- **触ってよい範囲**: `src/server/sources/claude/running.ts`, `docs/RESEARCH.md`, `tests/unit/server/claude-running.test.ts`

### T-028 詳細パネルで直近メッセージが 0 件のときの案内表示
- **目的**: 実機確認で、ツール実行が続いているセッション（末尾 256KB がツールの入出力だけ）の詳細パネルが「最近のメッセージ」見出しだけで空になり、理由が分からなかった
- **受け入れ条件**:
  - [x] `recentMessages` が 0 件（取得成功）のとき、見出しの下に「直近のログに表示できる発言がありません。…」の案内（`--color-text-3`、`--text-sm`）を出す。取得中・失敗時は出さない
  - [x] 1 件以上あるときは案内を出さない
- **参照**: DESIGN.md §6.8, §8 / ARCHITECTURE.md §4.3
- **触ってよい範囲**: `src/client/features/session-detail/**`, `tests/unit/client/features/session-detail/**`
- **T-027 / T-028 レビューからの引き継ぎ**: 文言は DESIGN.md §8「何が起きたか + 次にどうするか」を満たすこと（Round 1 で BLOCKING）。`readRunningMeta` → `matchRunning` の合成経路は 2^53 超の奇数値で回帰テスト済み。RESEARCH.md のスキーマ記述と実機のずれを検出する手段は FINAL_REVIEW.md §4 に改善候補として記載

### T-029 配色をインディゴ基調に変更（光彩・グラデーション・見出し書体）
- **目的**: 利用者から「添付画像のような色合いに変更してほしい。パネルの位置やレイアウトは変えなくてよく、フォント・色の光り方・グラデーションに着目してほしい」との指示。ADR-0008 で DESIGN.md §1 / §2 / §3 / §4.3 / §9 を改訂し、実装をそれに合わせる
- **受け入れ条件**:
  - [x] `tokens.css` が DESIGN.md §9（改訂後）と完全一致する（`design-tokens.test.ts` が pass）
  - [x] ページ背景に `--gradient-page`、カード / パネルに `--gradient-surface` が適用される
  - [x] 稼働中のカード・列ヘッダ・ドット・アカウントチップに `--glow-signal` / `--glow-signal-dot` の光彩が付き、停止 / 作業中には付かない
  - [x] ページタイトル「AI-Manager」が `--font-display` / `--text-2xl` / `--glow-title` で描画される
  - [x] `primary` ボタンの背景が `--gradient-primary`、`Toggle` ON が `--color-signal` 系である
  - [x] CSS Modules に生の hex / px / rgba を書かない（光彩・グラデーションはトークン経由のみ）
  - [x] レイアウト・余白・角丸・状態の形とラベル・キーボード操作は変えない。既存テスト（1500 件超）と E2E が pass
- **参照**: ADR-0008 / DESIGN.md §1, §2, §3, §4.3, §6, §9
- **触ってよい範囲**: `src/client/styles/tokens.css`, `src/client/styles/global.css`, `src/client/**/*.module.css`（レイアウトに関わる宣言は変えない）、`tests/unit/client/**`（tester）。DESIGN.md / ADR はメインが先に更新する
