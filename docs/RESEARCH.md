# Phase 0 実機調査記録

- 調査日: 2026-09-02
- 調査者: メインセッション（Claude Fable 5.1）
- 対象: Windows 11 Home 10.0.26200 上の Claude Code 2.1.2xx / Codex CLI 0.152.1
- 方針: **確認できた事実**（実ファイルを読んで確かめたもの）と **推測**（未検証、または一般知識に基づくもの）を見出しで分ける。
  本書には実パス・セッション ID・アカウント ID・ログ本文を書かない（public リポジトリのため）。
  パスは `~` をユーザーホーム（`os.homedir()`）として表記する。

---

## 0. 結論サマリ

| 論点 | 結論 | 根拠区分 |
|---|---|---|
| 実行形態 | **Windows ネイティブのみ**。WSL は未インストール（`wsl -l -v` がインストール案内を返す。`\\wsl$` / `\\wsl.localhost` は到達不能） | 事実 |
| Claude Code のログ実体 | `~/.claude/projects/<エンコード済み cwd>/<sessionId>.jsonl`。1 行 1 JSON | 事実 |
| Codex CLI のログ実体 | `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO時刻>-<threadId>.jsonl`。1 行 1 JSON | 事実 |
| 稼働中判定（Claude） | `~/.claude/sessions/<pid>.json` の有無（プロセス終了時に削除される）＋ pid 生存確認 | 事実 |
| 稼働中判定（Codex） | `~/.codex/thread-writer-locks/<threadId>.lock` は終了後も残留するため単独では不可。プロセス列挙が必要 | 事実（残留）/ 推測（プロセス名） |
| 「アカウント（ウィンドウ）」 | Claude Desktop のアカウント UUID（`bridge-session` レコードの `ownerAccountUuid`）と `entrypoint`（`claude-desktop` / `cli`）の組で表現できる。本環境ではアカウントは 1 つ | 事実（構造）/ 推測（複数アカウント時の挙動） |
| 指示送信（F-7） | 稼働中セッションごとに名前付きパイプ `\\.\pipe\LOCAL\cc-msg-<hash>` が存在する。プロトコルは未公開・未確認。**第 1 段階では実装しない** | 事実（存在）/ 推測（プロトコル） |
| データ量 | Claude 側 46 セッション・約 262 MB。単一ファイルで 25 MB / 1.2 万行のものがある | 事実 |
| Codex の利用実績 | rollout 3 本（2026-08-29、`codex exec` 由来）のみ。利用者から「未使用・未契約」との申告あり | 事実 |

harness.md §1.2 / §2.3 の前提と食い違う点は無い（§9.2-4 に該当しない）。

---

## 1. 実行環境

### 1.1 確認できた事実

- OS: Windows 11 Home 10.0.26200。シェルは PowerShell 5.1 と Git Bash が利用可能。
- WSL: 未インストール。`wsl.exe -l -v` は「インストールされていません」の案内を返し、`\\wsl$\` と `\\wsl.localhost\` はどちらも存在しない。
- Node.js v25.2.1、pnpm 11.24.0、git 2.44.0.windows.1、gh 2.x（`sarada7739` でログイン済み、scope: `gist, read:org, repo, workflow`）。
- GitHub に `sarada7739/AI-Manager` は **存在しなかった**（Phase 0 で作成する）。
- Claude Code の実体は 2 系統ある。
  - PATH 上の CLI: `~/.local/bin/claude.exe`（2.1.241）
  - Claude Desktop 同梱: `%APPDATA%\Claude\claude-code\<version>\claude.exe`（2.1.247 / 2.1.255 が併存）。
    Desktop から起動されたセッションはこちらが `--output-format stream-json --input-format stream-json --resume=<sessionId> --model <model> --permission-mode auto ...` で起動される。
    親プロセスは Desktop 本体の `Claude.exe`。
- Codex CLI: npm グローバル（`%APPDATA%\npm\node_modules\@openai\codex`、ランチャは `bin/codex.js`、ネイティブ本体は `@openai/codex-win32-x64` パッケージ）。`codex --version` は 0.152.1。
- サブエージェント用モデル: 本セッションの Agent ツールが受け付けるモデル指定は `sonnet` / `opus` / `haiku` / `fable` のエイリアス。
  harness.md §3.1 の `claude-sonnet-5` / `claude-opus-5` は、それぞれ `sonnet` / `opus` に対応させる（ADR-0001）。
  実ログの `message.model` には `claude-sonnet-5`, `claude-opus-5`, `claude-fable-5-1` が出現している。

- Codex のネイティブ本体は `@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`（同梱: `codex-code-mode-host.exe`, `codex-command-runner.exe`）。プロセス名は `codex` になる。

### 1.2 推測

- 本環境では稼働中の Codex プロセスが無く、`codex.exe` の `CommandLine` に threadId が含まれるかは未確認。実装時にプロセス列挙で `codex` を前方一致させ、threadId が取れなければ「Codex が稼働中（セッション不明）」とだけ表示する。

---

## 2. Claude Code のデータソース

### 2.1 `~/.claude/` 直下の構成（事実）

| パス | 内容 | ダッシュボードでの用途 |
|---|---|---|
| `projects/<dir>/<sessionId>.jsonl` | セッション本体（JSONL） | F-1, F-5 の主データ |
| `projects/<dir>/<sessionId>/custom-title.json` | `{"customTitle": "..."}` | タイトル表示（存在すれば優先） |
| `projects/<dir>/<sessionId>/subagents/agent-<id>.jsonl` | サブエージェントの JSONL（`isSidechain: true`, `agentId` 付き） | 件数表示のみ（本文は読まない） |
| `projects/<dir>/<sessionId>/subagents/agent-<id>.meta.json` | `{agentType, description, toolUseId, spawnDepth}` | サブエージェント種別の表示 |
| `projects/<dir>/<sessionId>/tool-results/*.txt` | 巨大なツール出力の退避先 | 読まない |
| `projects/<dir>/<sessionId>.desktop-released.json` | `{v, releasedAt, reason}`。Desktop 側で解放（例: `reason: "delete"`）された印 | 「解放済み」状態の表示 |
| `projects/<dir>/memory/*.md` | プロジェクト単位の記憶 | 読まない |
| `sessions/<pid>.json` | **稼働中プロセスのメタ**。プロセス終了で削除される | F-6 稼働判定の第一手段 |
| `sessions/<pid>.<sha256>.key` | 上記と対になる鍵ファイル。**終了後も残留することがある**（json 無しの `.key` を確認） | **読まない**（秘密情報扱い） |
| `history.jsonl` | `{display, pastedContents, timestamp, project, sessionId}` の追記ログ | 補助。後述の理由で主データにしない |
| `session-env/<sessionId>/` | 空ディレクトリ（サンプル 2 件とも中身なし） | 使わない |
| `ide/<port>.lock` | IDE 連携のロック | 使わない |
| `settings.json`, `.claude.json`, `.credentials.json` | 設定・資格情報 | **読まない**（`.credentials.json` は絶対に開かない） |

`<dir>` は cwd の英数字以外を `-` に置換したもの。例: `C:\Users\<user>\<project>` → `C--Users-<user>-<project>`。
ダッシュボードでは JSONL 内の `cwd` フィールドを正とし、`<dir>` 名は補助にとどめる（ディレクトリ名からは元パスを一意に復元できない）。

### 2.2 `sessions/<pid>.json` のスキーマ（事実）

```jsonc
{
  "pid": 125364,                       // 稼働中プロセスの PID
  "sessionId": "<uuid>",               // projects/<dir>/<sessionId>.jsonl に対応
  "cwd": "C:\\Users\\<user>\\<project>",
  "startedAt": 1788354711380,          // epoch ms
  "procStart": "134328283107540222",   // Windows FILETIME。PID 再利用の検出に使える。2026-09-03 の実機では 2^53 を超えるため **数字の文字列** で書かれている（Phase 0 の記録では数値。数値・文字列の両方を受け付ける）
  "version": "2.1.255",
  "peerProtocol": 1,
  "peerFeatures": ["notify_idle", "artifact_yield"],
  "kind": "interactive",
  "entrypoint": "claude-desktop",      // "cli" もある
  "pidDomain": "win32:<hostname>",
  "messagingSocketPath": "\\\\.\\pipe\\LOCAL\\cc-msg-<hash>",  // 名前付きパイプ
  "name": "<project>-xx",              // 派生名
  "nameSource": "derived",
  "nameSince": 1788354711380,
  "bridgeSessionId": "session_..."     // Desktop 起動時のみ。無い場合もある
}
```

観測結果:
- 稼働中 `claude.exe`（Desktop 同梱）4 本に対し `sessions/*.json` が 4 本あり、PID が完全に一致した。
- 数分後に 3 本が終了すると、対応する 3 本の `.json` と `.key` が消え、1 本だけ残った。
- ただし 8/29 付の `.key` が `.json` 無しで残留していた。**`.key` の存在を稼働の根拠にしてはならない。**
- `procStart` は `Get-Process` の `StartTime.ToFileTime()` と一致した（実測で同値）。PID 再利用の誤判定を防げる。

### 2.3 セッション JSONL のスキーマ（事実）

1 行 1 JSON。行ごとに `type` が異なる。確認した `type` の一覧:

| `type` | 出現 | 主なフィールド |
|---|---|---|
| `user` | 毎ターン | `uuid, parentUuid, isSidechain, promptId, message{role, content}, timestamp, permissionMode, origin{kind}, promptSource, userType, entrypoint, cwd, sessionId, version, gitBranch` |
| `assistant` | 毎ターン（複数行に分割される） | `uuid, parentUuid, message{model, id, role, content[], stop_reason, usage{...}}, apiBlockIndex, requestId, effort, timestamp, cwd, sessionId, version, gitBranch, entrypoint` |
| `attachment` | 多数 | `attachment{type, ...}`。`type` は `hook_success, hook_cancelled, hook_non_blocking_error, hook_system_message, hook_additional_context, deferred_tools_delta, agent_listing_delta, mcp_instructions_delta, skill_listing, auto_mode, total_tokens_reminder, nested_memory` など |
| `system` | あり | 未展開（本文を読まない方針のため） |
| `queue-operation` | Desktop 起動時 | `operation: enqueue / dequeue, timestamp, sessionId` |
| `last-prompt` | ターンごと | `lastPrompt`（先頭数百文字）, `leafUuid`, `sessionId` |
| `custom-title` | 任意 | `customTitle, sessionId` |
| `ai-title` | CLI 起動時に観測 | 自動生成タイトル |
| `bridge-session` | Desktop 起動時 | `bridgeSessionId, lastSequenceNum, ownerAccountUuid, ownerOrganizationUuid, sessionId` |
| `atis-latch` | ターンごと | `atis, sessionId` |
| `mode`, `permission-mode` | CLI 起動時に観測 | モード切替の記録 |
| `file-history-snapshot`, `file-history-delta` | CLI 起動時に観測 | ファイル変更履歴 |
| `frame-link`, `artifact-comment-monitor` | Desktop 起動時に観測 | Artifact 連携 |

共通して使えるメタ情報:
- `cwd`（作業ディレクトリ）、`gitBranch`（`HEAD` になることが多い。detached または非 git）、`version`、`entrypoint`（`cli` / `claude-desktop`）、`timestamp`（ISO 8601 UTC）。
- `message.model` は `assistant` 行にのみある。`<synthetic>` という値も出現する（内部生成）。
- 「最終メッセージ」は末尾から逆走査して `type === "user" || "assistant"` の最初の行、または `last-prompt` の `lastPrompt` で取れる。
- ファイル末尾は書き込み途中で切れていることがある前提で、JSON パース失敗行は捨てる（§2.3 の規約どおり）。今回読んだ範囲では破損行は 0。

サイズ感（事実）: 46 ファイル、合計約 262 MB。最大は約 25 MB / 約 12,000 行。**全文を毎回パースする設計は成り立たない**。
ヘッダ（先頭数行）と末尾（tail 読み）だけで一覧に必要な情報が揃うので、一覧はヘッダ＋tail、詳細は必要時に本文の一部だけを読む。

### 2.4 `history.jsonl` について（事実）

- 459 行。フィールドは `display, pastedContents, timestamp(epoch ms), project(cwd), sessionId`。
- 最終行は 8/23 で止まっており、その後の Desktop 起動セッション（`entrypoint: claude-desktop`）は記録されていない。
- したがって **CLI 起動分にしか書かれない**。主データにはせず、`last-prompt` レコードで代替する。

### 2.5 タイトルの決め方（事実に基づく方針）

優先順: `projects/<dir>/<sessionId>/custom-title.json` → JSONL 内の最後の `custom-title` → 最後の `ai-title` → 最初の `user` メッセージ本文の先頭 1 行（マスク後）→ `(無題)`。

### 2.6 推測（Claude 側）

- `session-env/<sessionId>/` は環境変数の受け渡し用と思われるが、中身が空のため用途は不明。使わない。
- `sessions/<pid>.json` の `messagingSocketPath` は Claude Code 同士のローカルメッセージング（ListAgents / SendMessage 機能）用のパイプで、`.key` がその認証鍵と推測される。**プロトコルは未公開で、外部プロセスから安全に投函できる根拠は無い**。
- `gitBranch: "HEAD"` は detached HEAD または非 git ディレクトリを示すと推測する。ブランチ名は JSONL 値をそのまま表示し、`HEAD` は「（ブランチなし）」と表記する。

---

## 3. Codex CLI のデータソース

### 3.1 `~/.codex/` 直下の構成（事実）

| パス | 内容 | 用途 |
|---|---|---|
| `sessions/YYYY/MM/DD/rollout-<ISO時刻>-<threadId>.jsonl` | セッション（スレッド）本体 | F-1, F-5 |
| `thread-writer-locks/<threadId>.lock`, `.coordination.lock` | 0 バイトのロックファイル。**終了後も残留**（稼働中 Codex が無い状態で 1 本残っていた） | 稼働判定の補助のみ |
| `log/` | 空 | 使わない |
| `logs_N.sqlite`, `state_N.sqlite`, `goals_N.sqlite`, `memories_N.sqlite`, `queue_N.sqlite`（+ `-wal`, `-shm`） | SQLite。スキーマは **未調査**（本セッションの自動モード分類器が読み取りを拒否したため） | 第 1 段階では使わない |
| `config.toml` | `model`, `model_reasoning_effort`, `[projects.'<path>'] trust_level` | 既定モデル表示に使える |
| `auth.json` | 資格情報 | **絶対に読まない** |
| `version.json` | `{latest_version, last_checked_at, dismissed_version}` | バージョン表示 |
| `.codex-global-state.json` | Electron 系 UI 状態（workspace roots 等） | 使わない |
| `memories/`, `skills/`, `tmp/`, `vendor_imports/`, `sqlite/codex-dev.db` | その他 | 使わない |

### 3.2 rollout JSONL のスキーマ（事実。3 ファイル・各 8 行で確認）

全行が `{"timestamp": "<ISO>", "type": "<種別>", "payload": {...}}` の形。

| `type` | `payload` |
|---|---|
| `session_meta`（先頭行） | `id`(threadId), `timestamp`, `cwd`, `originator`(例 `codex_exec`), `cli_version`, `source`(例 `exec`), `model_provider`, `base_instructions{text}`。`git` キーは今回のサンプルには無かった |
| `turn_context` | `turn_id, cwd, current_date, timezone, approval_policy, sandbox_policy, model, personality, collaboration_mode, realtime_active, effort, summary, user_instructions, truncation_policy` |
| `response_item` | `type: "message"`, `role: developer / user / assistant`, `content` |
| `event_msg` | `type: task_started{turn_id, model_context_window, collaboration_mode_kind}` / `user_message{message, images, ...}` / `task_complete{turn_id, last_agent_message}` |

- 「最終メッセージ」は `event_msg.task_complete.last_agent_message`、無ければ末尾の `response_item`。
- 「モデル」は `turn_context.model`。「作業ディレクトリ」は `session_meta.cwd`。
- タイトル相当のフィールドは無い。最初の `event_msg.user_message.message` の先頭 1 行を使う。

### 3.3 推測（Codex 側）

- 対話モード（TUI）の rollout には `originator: codex_cli_rs` などの別値や、`function_call` 系の `response_item` が入ると思われるが、本環境に実データが無い。パーサは未知の `type` を無視する設計にする。
- `session_meta.git` は git リポジトリ内で起動したときに `{commit_hash, branch, repository_url}` が入ると推測する。あれば表示に使い、無ければ空欄。
- 利用者申告どおり Codex は未使用・未契約のため、**Codex 側は Claude 側と同じ抽象（Session モデル）に載せる「従」の扱い**とし、テストは合成フィクスチャで担保する（ADR-0005）。

---

## 4. 「アカウント（ウィンドウ）」のマッピング

### 4.1 事実

- Claude Desktop はアカウント UUID ごとに `%APPDATA%\Claude\claude-code-sessions\<accountUuid>\` と `local-agent-mode-sessions\<accountUuid>\<orgUuid>\` を持つ。本環境では 1 アカウント・1 組織。
- Desktop から起動したセッションの JSONL には `bridge-session` レコードがあり、`ownerAccountUuid` / `ownerOrganizationUuid` を含む。CLI 起動分にはこのレコードが無い。
- `sessions/<pid>.json` の `entrypoint` で `claude-desktop` / `cli` を区別できる。

### 4.2 決定（ADR-0004）

「アカウント」軸は次の合成キーで表す。
- Claude: `claude:<ownerAccountUuid>`（`bridge-session` から）。無ければ `claude:cli`。
- Codex: `codex:<model_provider>`（`session_meta` から）。
- 表示名はダッシュボード側の設定ファイル（リポジトリ外・`.gitignore` 済みの `local-data/accounts.json`）で「メイン」「サブ」のように上書きできる。UUID を UI にそのまま出さない。

添付画像の「起動中 / 停止・起動時刻」は、そのアカウントに属する稼働中プロセス（`sessions/<pid>.json`）の有無と最古の `startedAt` で表す。

---

## 5. 稼働中判定（F-6）

### 5.1 事実

- Claude: `~/.claude/sessions/<pid>.json` が存在 ⇔ そのプロセスが稼働中（実測で一致。終了時に削除される）。
- 同 json の `pid` と `procStart`（FILETIME）を `Get-Process` の値と突合すれば PID 再利用も排除できる。
- Codex: ロックファイルは残留するため、それ単独では判定できない。
- Windows のプロセス列挙は PowerShell の `Get-Process` / `Get-CimInstance Win32_Process` で取得できた（`CommandLine` に `--resume=<sessionId>` と `--model` が含まれる）。

### 5.2 決定（ADR-0003）

3 段階で判定し、UI では判定根拠を併記する。
1. **稼働中**: `sessions/<pid>.json` があり、かつ同 PID のプロセスが存在（procStart が一致）。
2. **作業中**: JSONL の mtime が直近 N 分以内（N は設定。既定 5 分）。稼働中でなくても書き込みが続いていれば作業中扱い。
3. **停止**: 上記いずれでもない。
プロセス列挙は `tasklist` / `Get-CimInstance` を子プロセスとして呼ぶ。失敗した場合は 2 のみで判定し、UI に「プロセス情報なし」と出す。

---

## 6. 指示送信（F-7）の実現手段

### 6.1 事実

- 稼働中セッションごとに名前付きパイプ `\\.\pipe\LOCAL\cc-msg-<hash>` が実在する（`sessions/<pid>.json` の `messagingSocketPath`。パイプ一覧でも確認）。
- 対になる `sessions/<pid>.<sha256>.key` がある（内容は読んでいない）。
- Claude Code 自身は ListAgents / SendMessage で「同一マシン上の他のローカルセッション」へメッセージを送れる。
- Claude Desktop の MCP（`ccd_session_mgmt`）にも他セッションへ送る `send_message` があるが、Desktop 内部からしか使えない。
- CLI には `claude -p "<prompt>" --resume <sessionId>` があり、既存セッションに続けて 1 ターン実行できる。

### 6.2 推測とリスク

- 名前付きパイプのプロトコルは未公開。誤ったフレームを送ると相手セッションを壊す可能性があり、`.key` を読む必要があるなら §9.2-2（秘密情報）に抵触する。
- `--resume` による再実行は、**稼働中の同一セッションと同じ JSONL に並行書き込みする**ため、ログ破損の危険がある。停止中セッションに対しては使える可能性があるが、課金が発生する（§9.2-3）。
- Codex は `codex exec resume <threadId>` 相当があると思われるが未確認。

### 6.3 決定

第 1 段階では F-7 を実装しない。UI に入力欄は置くが無効化し、「送信経路が未確認のため第 1 段階では無効」と明示する。
第 2 段階の着手前に ADR を起票し、人間の承認を得る（harness.md §2.4）。

---

## 7. ファイル監視と更新（F-9）

### 7.1 事実

- JSONL は稼働中に追記され続ける（本セッションのファイルが調査中に 1.0 MB → 1.3 MB に増えた）。
- `sessions/` はプロセスの起動・終了でファイルが増減する。

### 7.2 推測

- Node の `fs.watch(dir, { recursive: true })` は Windows では ReadDirectoryChangesW ベースで動作するが、大量イベント時の取りこぼしが知られている。監視を第一手段にしつつ、**一定間隔（既定 10 秒）のポーリングでフォールバック**する（harness.md §2.3）。
- 25 MB 級ファイルの変更のたびに全文を読むのは避け、`stat` のサイズ差分で末尾だけ読む。

---

## 8. 秘密情報の扱い

- 調査中、`.credentials.json`（Claude）、`auth.json`（Codex）、`sessions/*.key` は開いていない。
- ログ本文は「キー名のみ抽出」または「content を `<omitted>` に置換」して読んだ。API キーやトークンらしき文字列は本文を読んでいないため **検出していない**（§9.2-2 には該当しない）。
- ダッシュボードで本文を表示する場合は、`sk-ant-`, `ghp_`, `gho_`, `Bearer `, `AKIA` などのパターンをマスクする方針を DESIGN.md / ARCHITECTURE.md に定義する。

---

## 9. harness.md との整合確認

| harness の前提 | 実機 | 判定 |
|---|---|---|
| Windows 11 対象 | Windows 11 Home | 一致 |
| WSL 混在の可能性 | WSL 無し | 一致（単純化できる） |
| `~/.claude/` 配下にログ | `projects/<dir>/<sessionId>.jsonl` | 一致 |
| `~/.codex/` 配下にログ | `sessions/YYYY/MM/DD/rollout-*.jsonl` | 一致 |
| `ps` は使えない | `Get-Process` / `Get-CimInstance` で取得可 | 一致 |
| ファイル監視の取りこぼし | 未検証 | ポーリング併用で対応 |
| 数百〜千件規模 | 46 件（ただし 1 件 25 MB） | 件数より **1 件あたりの大きさ** が課題 |
| モデル ID（sonnet-5 / opus-5） | Agent ツールのエイリアス `sonnet` / `opus` | ADR-0001 で対応づけ |

矛盾は無し。§9.2-4 には該当しない。

---

## 10. 調査で使ったコマンドの要点（再現用）

```powershell
# 稼働中の Claude / Codex プロセスとコマンドライン
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(claude|codex)' } | Select-Object ProcessId, ParentProcessId, Name, CreationDate, CommandLine

# 名前付きパイプ一覧（cc-msg のみ）
[System.IO.Directory]::GetFiles('\\.\pipe\') | Where-Object { $_ -match 'cc-msg' }

# WSL の有無
wsl.exe -l -v
```

```bash
# JSONL のレコード型分布（本文は出力しない）
node -e "const fs=require('fs');const c={};for(const l of fs.readFileSync(process.argv[1],'utf8').split('\n')){if(!l.trim())continue;try{c[JSON.parse(l).type]=(c[JSON.parse(l).type]||0)+1}catch{c['<broken>']=(c['<broken>']||0)+1}}console.log(c)" <jsonl>
```
