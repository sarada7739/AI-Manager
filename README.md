# AI-Manager

ローカルで稼働している **Claude Code / Codex CLI のセッションを一覧・監視するダッシュボード**です。
`~/.claude/projects/**/*.jsonl` と `~/.codex/sessions/**/*.jsonl` を読み取り、稼働状態・作業ディレクトリ・
最終メッセージをボード（列）／リスト形式で表示します。第 1 段階は **読み取り専用**（一覧・並べ方・
絞り込み・詳細表示・稼働状態・更新）です。第 2 段階として、稼働中の Claude Code セッションへの
指示送信（下記「指示送信（第 2 段階）」節）を追加しました。既定は読み取り専用のままです。
対象 OS は Windows 11 のみです。

## 前提

- Windows 11
- Node.js 22 以上（開発・品質ゲートの動作確認は v25.2 で実施。`package.json` に `engines.node` の指定は無い）
- pnpm 11.24.0（`package.json` の `packageManager` で固定。無い場合は `corepack` 等で用意してください）
- あらかじめ Claude Code または Codex CLI を一度起動しており、`%USERPROFILE%\.claude` /
  `%USERPROFILE%\.codex` にセッションログが作成されていること（無い場合の挙動は
  [トラブルシュート](#トラブルシュート) を参照）

## セットアップ

```powershell
pnpm install
```

E2E（Playwright）を実行する場合のみ、追加でブラウザ本体を取得してください。

```powershell
pnpm exec playwright install chromium
```

## 起動

### 開発モード

```powershell
pnpm dev
```

サーバ（Hono、既定ポート 4317）とクライアント（Vite、既定ポート 5173）が同時に起動します。
ブラウザで `http://localhost:5173` を開いてください（クライアントの `/api/*` はサーバへプロキシされます）。
Vite の既定設定はホストを明示していないため、環境によっては `127.0.0.1` ではなく `localhost`
（`::1` を含む）でのみ待ち受けることがあります。`http://127.0.0.1:5173` で繋がらない場合は
`http://localhost:5173` を試してください。

個別に起動する場合は `pnpm dev:server` / `pnpm dev:client` を使ってください。

### 本番ビルド

```powershell
pnpm build
```

`vite build`（クライアントを `dist/client` に出力）と、サーバの `tsc`（`tsconfig.server.json`）を実行します。
現時点の `package.json` の `scripts` には `start` は無く、サーバが `dist/client` を静的配信する仕組みも
実装されていません。ビルド後にサーバ本体だけを起動する場合は次のようになります。

```powershell
node dist/server/index.js
```

この場合、クライアント（`dist/client`）を配信する経路が無いため、UI を見るには `pnpm dev` の開発モードを
使うか、別途静的ファイルサーバーを用意してください。

## 設定

既定では `local-data/config.json`（無ければ既定値）を読み込みます。パスは環境変数
`AI_MANAGER_CONFIG_PATH` で差し替え可能です。`local-data/` は `.gitignore` 済みのため、実環境の設定を
リポジトリにコミットする心配はありません。

`local-data/config.json` の例（JSON にコメントは書けないため、各キーの意味は下の一覧を参照）:

```json
{
  "roots": ["C:/Users/me/.claude", "C:/Users/me/.codex"],
  "activeWindowMinutes": 5,
  "pollIntervalSec": 10,
  "port": 4317,
  "accounts": {
    "claude:cli": "個人用",
    "claude:00000000-0000-4000-8000-000000000001": "サブアカウント"
  }
}
```

- `roots`: 読み取り対象のルート。省略時は既定で `~/.claude` と `~/.codex`。バックスラッシュ区切りで書く場合は JSON のため `"C:\\Users\\me\\.claude"` のように二重にする（スラッシュ区切りでも可）
- `activeWindowMinutes`: この分数以内に更新があれば「作業中」とみなす窓（既定 5）
- `pollIntervalSec`: ポーリングによる再走査の間隔・秒（既定 10）
- `port`: サーバの待受ポート（既定 4317）
- `accounts`: アカウントキーごとの表示名の上書き（UUID をそのまま画面に出さないための設定）

## 指示送信（第 2 段階）

第 2 段階として、**稼働中の Claude Code セッション**へ指示を送信できます（ADR-0009、
`docs/adr/0009-f7-send-instruction.md`）。既定は読み取り専用のままで、明示的にトグルを OFF に
したときだけ送信できます。

### 前提

- 送信先の Claude Code が **v2.1.234 以上**で起動していること（ネイティブ Windows の
  クロスセッションメッセージング機能を使う）
- 配信されるか、保留されて受信側の人間の承認を待つかは、受信側の `crossSessionInbound` 設定に
  従います
- 送信できるのは **稼働中の Claude セッションのみ**です。Codex は対象外のため宛先セレクトには
  出ません

### 操作

1. 読み取り専用トグル（「読むだけ・送信はしない」）を **OFF** にする
2. 宛先セレクトから稼働中の Claude セッションを選ぶ
3. 指示入力欄に本文を書く
4. 「送る」を押すと確認ダイアログが開くので、宛先・本文を確認したうえで、もう一度「送る」を押す

### 注意

- ダッシュボードが表示できるのは「投函できたかどうか」までです。実際に配信されるか保留されるかは
  受信側の設定に従い、ダッシュボード側では判別できません
- 配信されたメッセージは、受信側では利用者が直接打った指示と同じ扱いになり、**使用量（課金）が
  発生します**
- 送信本文・宛先の内容はサーバのログに出しません（件数と成否のみ記録します）

## 読み取り専用について

このダッシュボードは既定では読み取り専用です。ファイルへの書き込みは行いません。ネットワーク越しの
外部への送信も行いません（上記の指示送信は、同一マシン上の別セッションへ名前付きパイプで投函する
ものでネットワーク送信ではありません）。`POST /api/refresh`（再走査の要求）はファイルシステムには
書き込みません。画面の「指示入力」欄は、読み取り専用トグルが ON（既定）の間は無効化されています。

### 読まないファイル

次のファイルは秘密情報・巨大データとして扱い、内容を一切読みません（サーバ側で列挙・除外しています）。

- `.credentials.json`（Claude の資格情報）
- `auth.json`（Codex の資格情報）
- `*.sqlite*`（Codex の SQLite 本体・WAL・SHM・journal・バックアップ）
- `settings*.json`（`settings.json` / `settings.local.json` など）
- `history.jsonl`（CLI 起動分の入力履歴。主データとしては使わない）
- `memory/*.md`、`tool-results/*.txt`（プロジェクト記憶・巨大なツール出力の退避先）

上の 4 件（`.credentials.json` 〜 `settings*.json`）は除外パターン（`src/server/sources/fs/safe-path.ts`）で開かないようにしており、`history.jsonl` / `memory/` / `tool-results/` はそもそも走査対象のディレクトリ階層（`projects/<dir>/` 直下と `<sessionId>/subagents/`）に含まれないため読みません。

`sessions/*.key`（メッセージング用の鍵ファイル）も、一覧・詳細・稼働状態の表示では読みません。ただし第 2 段階の指示送信を実行する瞬間だけ、宛先セッションの `sessions/<pid>.<64桁の16進>.key` を送信経路（`src/server/sources/claude/messaging.ts`）が認証トークン（`peerToken`）の取得のために例外的に読みます。読み取った値はログ・API 応答・エラーメッセージに一切出さず、送信処理を抜けた時点で保持しません（ADR-0009）。

### マスクの方針

セッション本文を画面に出す際は、`sk-ant-` や `ghp_` などの API キー・トークンらしき文字列、
`Bearer <token>`、メールアドレスなどをサーバ側で伏せ字（`••••`）に置換してからクライアントへ渡します
（`src/shared/masking.ts` の `SECRET_PATTERNS`）。

## 画面の説明

- **ヘッダ**: タイトル・時計・Claude/Codex の件数・表示切替（ボード/リスト）・更新ボタン
- **指示入力**: 読み取り専用トグルが ON（既定）の間は無効化されています。OFF にすると、稼働中の
  Claude セッションへ指示を送れます（上記「指示送信（第 2 段階）」節）
- **アカウント帯**: Claude Desktop / Claude CLI / Codex のアカウント単位の稼働状況
- **絞り込み帯**: 並べ方の軸、ツール種別、アカウント、フォルダ、期間、稼働中のみ、検索
- **ボード / リスト**: 並べ方の軸ごとの列表示、または一覧表のグリッド表示
- **詳細パネル**: セッションを選ぶと開く。作業ディレクトリ・ブランチ・モデル・ログサイズ・最終更新・
  直近メッセージ（マスク済み・最大 20 件）を表示

### キーボード操作

- ボード: `←` `→` で列移動、`↑` `↓` でカード移動、`Enter` で選択
- リスト: `↑` `↓` `Home` `End` で行移動、`Enter` / `Space` で選択
- 詳細パネル: `Esc` で閉じる（検索欄などにフォーカスがある場合を除く）

## トラブルシュート

- **`projects` ディレクトリが見つからない**: Claude Code を一度起動するとセッションログが作成されます。
  Codex 側も同様に、一度 `codex` を実行すると `~/.codex/sessions/` が作成されます。
- **プロセス情報が取得できない（`processInfo: false`）**: プロセス列挙は PowerShell の子プロセス
  （`Get-Process` / `Get-CimInstance`）で行っています。実行ポリシーや権限の都合で失敗した場合は、
  ファイルの更新時刻（mtime）だけで稼働状態を判定します。画面には「プロセス情報なし」と表示されます。
- **ポートが使用中**: `local-data/config.json` の `port` を変更するか、使用中のプロセスを終了してください。
- **`http://127.0.0.1:5173` に繋がらない**: Vite の既定設定はホストを明示していないため、環境によっては
  `127.0.0.1` ではなく `localhost`（`::1` を含む）でのみ待ち受けることがあります。その場合は
  `http://localhost:5173` を開いてください。
- **日本語パスが文字化けする**: 発生しません。ファイル読み取り・API 応答はすべて UTF-8 固定です。

- **`pnpm e2e` が `browserType.launch: Executable doesn't exist` で失敗する**: ブラウザ本体が未取得です。`pnpm exec playwright install chromium` を一度実行してください。
- **`pnpm e2e` を実行すると `local-data/e2e/` の中身が変わる**: 仕様です。E2E は利用者の `local-data/config.json` や実ログには触れず、`local-data/e2e/` の合成データを毎回削除・再生成し、環境変数 `AI_MANAGER_CONFIG_PATH` でその設定だけを読ませます。
- **`pnpm e2e` が「ポートが使用中」で止まる**: 前回のサーバ（4317）や Vite（5173）が残っています。該当プロセスを終了してから再実行してください。

## 品質ゲート・テスト構成

```powershell
pnpm gate   # typecheck → lint → test → build を順に実行
```

- **単体**（`pnpm test` / Vitest）: `src/shared/**`（純粋関数）、`src/server/sources/**`（合成フィクスチャ）
- **統合**（`tests/integration/`）: `src/server/routes/**` を Hono の `app.request()` で検証
- **E2E**（`pnpm e2e` / Playwright）: `e2e/setup/build-fixtures.mjs` が `local-data/e2e/` に合成データを毎回削除・再生成してから
  サーバ・クライアントを起動し、主要導線（ボード表示 → リスト切替 → 絞り込み → 詳細パネル）を検証します。
  実行前に `pnpm exec playwright install chromium` が必要です。
