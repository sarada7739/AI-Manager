// クライアント・サーバ共有のデータモデル。
// ARCHITECTURE.md §3 のデータモデルをそのままコード化したもの。
// node:* / react への依存禁止（副作用なしの純粋な型定義のみ）。

/** セッションの種別。Claude Code か Codex CLI か。 */
export type ToolKind = "claude" | "codex";

/** セッションの稼働状態。 */
export type SessionState = "running" | "active" | "idle" | "error";

/** 稼働状態を判定した根拠。 */
export type StateReason = "process" | "mtime" | "none" | "no-process-info";

/** セッションの起動経路。 */
export type Entrypoint = "cli" | "claude-desktop" | "codex-exec" | "codex-tui" | "unknown";

/** 詳細画面に表示する直近メッセージ 1 件。 */
export interface RecentMessage {
  /** 発言者。ユーザーかアシスタントか。 */
  role: "user" | "assistant";
  /** 発言時刻（ISO 文字列）。 */
  at: string;
  /** マスク済みの本文。 */
  text: string;
}

/** 一覧・ボードに表示するセッションの要約情報。 */
export interface SessionSummary {
  /** 一意キー。`${tool}:${id}` の形式。 */
  key: string;
  /** セッションの種別。 */
  tool: ToolKind;
  /** セッション ID。Claude は sessionId（uuid）、Codex は threadId。 */
  id: string;
  /** タイトル。決定順は DESIGN.md §8 / RESEARCH.md §2.5 を参照。 */
  title: string;
  /** 最終メッセージ。マスク済み、先頭 200 文字。 */
  lastMessage: string;
  /** 最終メッセージの発言者。 */
  lastRole: "user" | "assistant" | null;
  /** 作業ディレクトリの実パス。API はそのまま返し、UI が ~ 置換と先頭省略を行う。ログには出さない。 */
  cwd: string;
  /** Git ブランチ名。"HEAD" は null に正規化する。 */
  branch: string | null;
  /** 使用モデル名。 */
  model: string | null;
  /** セッションの起動経路。 */
  entrypoint: Entrypoint;
  /** アカウント識別キー（ADR-0004）。 */
  accountKey: string;
  /** 稼働状態。 */
  state: SessionState;
  /** 稼働状態の判定根拠。 */
  stateReason: StateReason;
  /** プロセス ID。取得できない場合は null。 */
  pid: number | null;
  /** 開始時刻（ISO）。running のときのみ値を持つ。 */
  startedAt: string | null;
  /** 最初のレコードのタイムスタンプ。 */
  firstAt: string | null;
  /** ログファイルの mtime（ISO）。 */
  updatedAt: string;
  /** ログファイルのサイズ（バイト）。 */
  logSizeBytes: number;
  /** サブエージェントの件数。 */
  subagentCount: number;
  /** `<sessionId>.desktop-released.json` の有無。 */
  released: boolean;
}

/** セッション詳細画面用の情報。要約に加えて直近メッセージと警告を持つ。 */
export interface SessionDetail extends SessionSummary {
  /** 直近メッセージ一覧。マスク済み、最大 20 件。 */
  recentMessages: RecentMessage[];
  /** パース中に発生した警告（途中で切れた行の数など）。 */
  parseWarnings: string[];
}

/** アカウント単位の集計情報。 */
export interface Account {
  /** アカウント識別キー。"claude:<uuid>" | "claude:cli" | "codex:<provider>"。 */
  key: string;
  /** 表示ラベル。設定で上書き可能。既定は "Claude Desktop 1" など。 */
  label: string;
  /** アカウントが属するツール種別。 */
  tool: ToolKind;
  /** 稼働中のセッションが 1 件でもあるか。 */
  running: boolean;
  /** 稼働中のセッション数。 */
  runningCount: number;
  /** 全セッション数。 */
  sessionCount: number;
  /** 最古の running セッションの startedAt。 */
  startedAt: string | null;
}

/** API のエラーレスポンス形式。 */
export interface ApiError {
  error: {
    /** エラーコード。 */
    code: string;
    /** エラーメッセージ。 */
    message: string;
    /** 次に何をすべきかのヒント。 */
    hint: string;
  };
}
