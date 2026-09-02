# ARCHITECTURE.md — 構成・データフロー・モジュール境界

> 実装の構造に関する唯一の参照先。reviewer は本書との乖離を BLOCKING にする。
> 根拠となる実機調査は `docs/RESEARCH.md`、決定の経緯は `docs/adr/`。

---

## 1. 全体像

```
 ~/.claude/projects/**/*.jsonl ─┐
 ~/.claude/sessions/*.json      ├─▶ server/sources ─▶ server/store（インメモリ索引）─▶ server/routes (/api) ─▶ client
 ~/.codex/sessions/**/*.jsonl   │        ▲                      ▲
 プロセス一覧 (Get-CimInstance) ─┘        │                      │
                                  watcher + polling ────────────┘（変更 → 再スキャン → SSE 通知）
```

- **単一の Node プロセス**（Hono）がファイルを読み、インメモリの索引を持ち、HTTP API と SSE を提供する。
- **クライアント**（React + Vite）は API 経由でしかデータに触れない。ファイルパスを組み立てない。
- **永続化なし**。起動時に全走査し、以後は差分更新。
- **第 1 段階に書き込み系 API は存在しない**。`POST /api/refresh`（再走査の要求）のみ副作用を持つが、ファイルシステムには書かない。

## 2. ディレクトリと責務

```
src/
  shared/                       クライアント・サーバ共有。副作用なし・Node API 非依存
    types.ts                    Session, SessionSummary, SessionDetail, Account, SessionState, ToolKind, ApiError
    state.ts                    稼働状態の判定ロジック（純粋関数）
    masking.ts                  秘密情報マスク（純粋関数）
    grouping.ts                 グルーピング・フィルタ・並べ替え（純粋関数）
    time.ts                     相対時刻の整形
  server/
    index.ts                    起動。設定読込 → 索引構築 → 監視開始 → Hono 起動
    config.ts                   設定（roots, activeWindowMinutes, pollIntervalSec, accounts）の読込と既定値
    log.ts                      ログ出力（本文・実パスを出さない）
    sources/
      claude/
        locator.ts              projects/**/*.jsonl と sessions/*.json の列挙（stat のみ）
        parser.ts               JSONL のヘッダ / テイル解析 → SessionSummary 断片
        detail.ts               詳細取得（末尾 N メッセージ。マスク適用）
        running.ts              sessions/<pid>.json の読込と検証
      codex/
        locator.ts              sessions/YYYY/MM/DD/rollout-*.jsonl の列挙
        parser.ts               rollout の解析 → SessionSummary 断片
        detail.ts
      process/
        list.ts                 プロセス列挙（PowerShell 子プロセス）。キャッシュ付き
      fs/
        tail.ts                 ファイル末尾 N バイトの読み取り、途中行の切り捨て
        head.ts                 先頭 N 行の読み取り
        safe-path.ts            ルート配下であることの検証（パス走査防止）
    store/
      index.ts                  SessionIndex: Map<sessionKey, SessionSummary>。集約、アカウント合成
      watcher.ts                fs.watch（recursive）+ ポーリングのフォールバック。変更イベントを debounce
      events.ts                 SSE 購読者への通知
    routes/
      sessions.ts               GET /api/sessions, GET /api/sessions/:tool/:id
      accounts.ts               GET /api/accounts
      events.ts                 GET /api/events（SSE）, POST /api/refresh
      health.ts                 GET /api/health
  client/
    main.tsx                    エントリ
    app/                        App.tsx, Layout, キーボードナビゲーション
    features/
      board/                    BoardView, BoardColumn, SessionCard
      list/                     ListView, ListRow
      filters/                  FilterBar, GroupBySegment, ReadOnlyToggle
      session-detail/           DetailPanel
      accounts/                 AccountStrip, AccountChip
      compose/                  ComposeBox（第 1 段階は無効表示）
      refresh/                  RefreshButton, 自動更新（SSE 購読 + フォールバック）
    components/                 Pill, Toggle, Button, EmptyState, Loading, ErrorBanner, Dot
    store/                      useSessionStore（Zustand）: sessions, accounts, filters, view, selection
    api/                        client.ts（fetch ラッパ、ApiError 変換）, sse.ts
    styles/                     tokens.css, global.css
tests/
  fixtures/                     合成データ。claude/ codex/ の JSONL と sessions json
  unit/                         shared/, server/sources/ の単体テスト
  integration/                  server/routes の統合テスト（一時ディレクトリにフィクスチャを展開）
e2e/                            Playwright（ボード表示、リスト切替、絞り込み、詳細パネル）
```

### 2.1 境界のルール

| 境界 | ルール |
|---|---|
| `shared` → 他 | `shared` は `node:*` も `react` も import しない。純粋関数と型のみ |
| `client` → `server` | 直接 import 禁止。型は `shared` 経由 |
| `server/routes` → `sources` | 禁止。routes は `store` だけを見る |
| `server/store` → `sources` | 許可（唯一の呼び出し元） |
| `client/features/A` → `client/features/B` | 禁止。共有は `components/` か `store/` に上げる |
| ファイルパスの組み立て | `server/sources/**` と `server/config.ts` のみ |
| プロセス列挙 | `server/sources/process/list.ts` のみ |

## 3. データモデル（`src/shared/types.ts`）

```ts
type ToolKind = "claude" | "codex";
type SessionState = "running" | "active" | "idle" | "error";
type StateReason = "process" | "mtime" | "none" | "no-process-info";

interface SessionSummary {
  key: string;                 // `${tool}:${id}`
  tool: ToolKind;
  id: string;                  // Claude: sessionId (uuid) / Codex: threadId
  title: string;               // 決定順は DESIGN.md §8 / RESEARCH.md §2.5
  lastMessage: string;         // マスク済み、先頭 200 文字
  lastRole: "user" | "assistant" | null;
  cwd: string;                 // 実パス（API はローカル専用なのでそのまま返す。UI が ~ 置換と先頭省略を行う。ログには出さない）
  branch: string | null;       // "HEAD" は null に正規化
  model: string | null;
  entrypoint: "cli" | "claude-desktop" | "codex-exec" | "codex-tui" | "unknown";
  accountKey: string;          // ADR-0004
  state: SessionState;
  stateReason: StateReason;
  pid: number | null;
  startedAt: string | null;    // ISO。running のときのみ
  firstAt: string | null;      // 最初のレコードの timestamp
  updatedAt: string;           // ファイル mtime (ISO)
  logSizeBytes: number;
  subagentCount: number;
  released: boolean;           // <sessionId>.desktop-released.json の有無
}

interface SessionDetail extends SessionSummary {
  recentMessages: Array<{ role: "user" | "assistant"; at: string; text: string }>; // マスク済み、最大 20
  parseWarnings: string[];     // 途中で切れた行の数など
}

interface Account {
  key: string;                 // "claude:<uuid>" | "claude:cli" | "codex:<provider>"
  label: string;               // 設定で上書き。既定は "Claude Desktop 1" など
  tool: ToolKind;
  running: boolean;
  runningCount: number;
  sessionCount: number;
  startedAt: string | null;    // 最古の running セッションの startedAt
}
```

## 4. データフロー

### 4.1 起動時の全走査

1. `config.ts` が `local-data/config.json` を読む（無ければ既定値）。`roots` の既定は `[homedir/.claude, homedir/.codex]`。
2. `claude/locator` が `projects/*/*.jsonl` を列挙し、各ファイルの `stat`（size, mtime）を取る。
3. `claude/parser` が各ファイルの **先頭 64KB** から `cwd, version, entrypoint, gitBranch, 最初の user`、**末尾 64KB** から `last-prompt, custom-title, 最後の user/assistant, model, bridge-session` を取る。全文は読まない。
4. `claude/running` が `sessions/*.json` を読み、`process/list` の結果と `pid` / `procStart` を突合する。
5. `codex/locator` + `codex/parser` が同様に処理する。
6. `store/index` が `SessionSummary` に組み立て、`shared/state` で状態を決め、アカウントを合成する。

### 4.2 差分更新

- `watcher.ts` は `roots` を `fs.watch({ recursive: true })` で監視し、`pollIntervalSec`（既定 10 秒）ごとに `stat` の再走査も行う。
- 変更されたファイルだけを再解析する（mtime と size が変わったもの）。`sessions/` の増減は稼働状態だけを再計算する。
- 変更は 300ms で debounce し、`events.ts` が SSE `sessions-changed` を送る。クライアントは通知を受けて `GET /api/sessions` を再取得する（差分は送らない。単純さを優先）。

### 4.3 詳細取得

- `GET /api/sessions/:tool/:id` は `id` を厳密に検証する（Claude: UUID v4 形式、Codex: `[0-9a-f-]{36}`）。検証を通った id で索引を引き、索引に無ければ 404。**リクエストのパラメータからパスを組み立てない**。
- 末尾 256KB を読み、`user` / `assistant` を最大 20 件、`masking.ts` でマスクして返す。

## 5. API

| メソッド | パス | 応答 | 備考 |
|---|---|---|---|
| GET | `/api/health` | `{ ok, version, roots: string[], watcher: "fs" \| "poll" \| "both", processInfo: boolean }` | 実パスは `~` に置換 |
| GET | `/api/sessions` | `{ sessions: SessionSummary[], generatedAt }` | フィルタはクライアント側 |
| GET | `/api/sessions/:tool/:id` | `SessionDetail` | 404 / 400 |
| GET | `/api/accounts` | `{ accounts: Account[] }` | |
| GET | `/api/events` | SSE: `sessions-changed`, `heartbeat`（30 秒） | |
| POST | `/api/refresh` | `{ ok, scanned, durationMs }` | 全走査を再実行 |

エラー応答は `{ error: { code, message, hint } }`。`message` は「何が起きたか」、`hint` は「次にどうするか」。

サーバは `127.0.0.1` にのみバインドする（既定ポート 4317）。CORS は Vite dev の `localhost` のみ許可。

## 6. クライアント状態（Zustand）

```
useSessionStore
  sessions: SessionSummary[]        API から
  accounts: Account[]
  view: "board" | "list"
  groupBy: "account" | "folder" | "state" | "tool"
  filters: { tool, accountKey, folder, sinceDays, runningOnly, query }
  sort: { key, dir }                 リスト表示
  readOnly: boolean                  既定 true
  selectedKey: string | null
  status: { loading, error, lastFetchedAt, live: boolean }
```

- 派生データ（グルーピング結果、フィルタ結果）は `shared/grouping.ts` の純粋関数で `useMemo` 計算する。ストアに二重に持たない。
- URL クエリ（`?view=&groupBy=&tool=...`）と `filters` / `view` / `groupBy` を同期する。
- 列コンポーネントはストアを購読するだけ。列内の state は持たない。

## 7. セキュリティ

- 読み取り対象は `config.roots` 配下のみ。`safe-path.ts` が `path.resolve` 後に root との前方一致（大文字小文字無視）を検証する。
- **読まないファイル**: `.credentials.json`, `auth.json`, `sessions/*.key`, `*.sqlite*`, `settings*.json`。locator で明示的に除外する。
- 外部通信なし。フォント・スクリプトの CDN 読み込みもしない。
- 秘密情報らしき文字列は `masking.ts` でマスクしてから API に載せる（UI ではなくサーバでマスク）。
- ログ（`log.ts`）にセッション本文・実パスを出さない。パスはハッシュ化または `~` 置換で出す。
- 子プロセスは `process/list.ts` の固定コマンド（引数なし）のみ。ユーザー入力を渡さない。

## 8. テスト戦略

- `shared/**`: 単体（Vitest）。境界値・空・異常系を必須とする。
- `server/sources/**`: 単体。`tests/fixtures/` を一時ディレクトリに展開し、`roots` を差し替えて実行。`os.homedir()` に依存しない。
- `server/routes/**`: 統合。Hono の `app.request()` で実 HTTP を立てずに検証。
- `client/**`: コンポーネント単体（Vitest + Testing Library）。グルーピング・フィルタは `shared` 側でテストするので UI 側は表示の検証に絞る。
- E2E（Playwright）: フィクスチャを読むサーバを起動し、ボード表示 → リスト切替 → 絞り込み → 詳細パネルの 1 導線。

## 9. 第 2 段階（F-7）に向けた拡張点

- `server/routes/compose.ts`（未実装）。追加時は `readOnly` が false のときだけ受け付け、ADR で承認された送信経路のみを使う。
- `client/features/compose/` は UI だけ先に置き、`disabled` と理由文言を持つ。
