import { describe, expect, it } from "vitest";
import type {
  Account,
  ApiError,
  Entrypoint,
  RecentMessage,
  SessionDetail,
  SessionState,
  SessionSummary,
  StateReason,
  ToolKind,
} from "../../../src/shared/types";

// T-002: src/shared/types.ts に必要な型が揃っていることをコンパイル時チェックで検証する。
// 型の存在確認が目的のため、代入した変数を実行時に検証することで
// noUnusedLocals（tsconfig.json）にも抵触しないようにする。

describe("型定義の存在確認（コンパイル時チェック）", () => {
  it("ToolKind: 'claude' | 'codex'", () => {
    const claude: ToolKind = "claude";
    const codex: ToolKind = "codex";
    expect([claude, codex]).toEqual(["claude", "codex"]);
  });

  it("SessionState: running | active | idle | error", () => {
    const states: SessionState[] = ["running", "active", "idle", "error"];
    expect(states).toHaveLength(4);
  });

  it("StateReason: process | mtime | none | no-process-info", () => {
    const reasons: StateReason[] = ["process", "mtime", "none", "no-process-info"];
    expect(reasons).toHaveLength(4);
  });

  it("Entrypoint: cli | claude-desktop | codex-exec | codex-tui | unknown", () => {
    const entrypoints: Entrypoint[] = [
      "cli",
      "claude-desktop",
      "codex-exec",
      "codex-tui",
      "unknown",
    ];
    expect(entrypoints).toHaveLength(5);
  });

  it("RecentMessage: role / at / text を持つ", () => {
    const message: RecentMessage = {
      role: "user",
      at: "2026-01-01T00:00:00.000Z",
      text: "こんにちは",
    };
    expect(message.role).toBe("user");
  });

  it("SessionSummary: 一覧・ボード表示に必要なフィールドを持つ", () => {
    const summary: SessionSummary = {
      key: "claude:session-1",
      tool: "claude",
      id: "session-1",
      title: "テストセッション",
      lastMessage: "最後のメッセージ",
      lastRole: "assistant",
      cwd: "~/work/project",
      branch: "main",
      model: "claude-test-model",
      entrypoint: "cli",
      accountKey: "claude:cli",
      state: "idle",
      stateReason: "mtime",
      pid: null,
      startedAt: null,
      firstAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
      logSizeBytes: 1024,
      subagentCount: 0,
      released: false,
    };
    expect(summary.key).toBe("claude:session-1");
  });

  it("SessionDetail: SessionSummary を拡張し recentMessages / parseWarnings を持つ", () => {
    const summary: SessionSummary = {
      key: "codex:thread-1",
      tool: "codex",
      id: "thread-1",
      title: "詳細テスト",
      lastMessage: "",
      lastRole: null,
      cwd: "~/work/other",
      branch: null,
      model: null,
      entrypoint: "unknown",
      accountKey: "codex:provider",
      state: "error",
      stateReason: "none",
      pid: null,
      startedAt: null,
      firstAt: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      logSizeBytes: 0,
      subagentCount: 0,
      released: true,
    };
    const detail: SessionDetail = {
      ...summary,
      recentMessages: [],
      parseWarnings: ["途中で切れた行が 2 件あります"],
    };
    expect(detail.parseWarnings).toHaveLength(1);
  });

  it("Account: アカウント単位の集計フィールドを持つ", () => {
    const account: Account = {
      key: "claude:cli",
      label: "Claude Desktop 1",
      tool: "claude",
      running: true,
      runningCount: 2,
      sessionCount: 5,
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(account.runningCount).toBe(2);
  });

  it("ApiError: error.code / message / hint を持つ", () => {
    const apiError: ApiError = {
      error: {
        code: "E_NOT_FOUND",
        message: "セッションが見つかりません",
        hint: "一覧から再度選択してください",
      },
    };
    expect(apiError.error.code).toBe("E_NOT_FOUND");
  });
});
