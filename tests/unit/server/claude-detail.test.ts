import { describe, expect, it } from "vitest";
import {
  DETAIL_MAX_MESSAGES,
  DETAIL_TAIL_BYTES,
  DETAIL_TEXT_MAX_CHARS,
  readClaudeDetail,
} from "../../../src/server/sources/claude/detail";
import type { Result } from "../../../src/shared/result";
import { err, ok } from "../../../src/shared/result";

// T-014: readClaudeDetail の受け入れ条件を検証する。
// フィクスチャ・パスはすべて合成値。実際のファイル I/O はしない（readTailLines をフェイクに差し替える）。

const SYNTHETIC_PATH =
  "C:\\synthetic\\home\\.claude\\projects\\p1\\00000000-0000-4000-8000-000000000001.jsonl";

/** 合成の user 行を組み立てる。 */
function userLine(
  timestamp: string | undefined,
  content: unknown,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: "user",
    timestamp,
    message: { role: "user", content },
    ...overrides,
  });
}

/** 合成の assistant 行を組み立てる。 */
function assistantLine(timestamp: string | undefined, content: unknown): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    message: { role: "assistant", content },
  });
}

/** readTailLines をフェイクした Result を返す関数を作る。呼び出された引数を記録する。 */
function makeFakeReadTailLines(result: Result<string[]>): {
  fn: (filePath: string, maxBytes: number) => Promise<Result<string[]>>;
  calls: Array<{ filePath: string; maxBytes: number }>;
} {
  const calls: Array<{ filePath: string; maxBytes: number }> = [];
  const fn = async (filePath: string, maxBytes: number): Promise<Result<string[]>> => {
    calls.push({ filePath, maxBytes });
    return result;
  };
  return { fn, calls };
}

describe("readClaudeDetail: 正常系", () => {
  it("user / assistant の行が時系列順（role / at / text）で返る", async () => {
    const lines = [
      userLine("2026-01-01T00:00:00Z", "1件目のユーザー入力"),
      assistantLine("2026-01-01T00:00:01Z", [{ type: "text", text: "1件目の応答" }]),
    ];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([
      { role: "user", at: "2026-01-01T00:00:00Z", text: "1件目のユーザー入力" },
      { role: "assistant", at: "2026-01-01T00:00:01Z", text: "1件目の応答" },
    ]);
    expect(result.value.parseWarnings).toEqual([]);
  });

  it("25 件あれば末尾 20 件（DETAIL_MAX_MESSAGES）だけが返る", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 25; i++) {
      lines.push(userLine(`2026-01-01T00:00:${String(i).padStart(2, "0")}Z`, `本文${i}`));
    }
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toHaveLength(DETAIL_MAX_MESSAGES);
    expect(result.value.recentMessages[0]?.text).toBe("本文5");
    expect(result.value.recentMessages.at(-1)?.text).toBe("本文24");
  });

  it("空配列が渡されたとき recentMessages: [] になる", async () => {
    const { fn } = makeFakeReadTailLines(ok([]));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([]);
    expect(result.value.parseWarnings).toEqual([]);
  });

  it("readTailLines が DETAIL_TAIL_BYTES で呼ばれる", async () => {
    const { fn, calls } = makeFakeReadTailLines(ok([]));

    await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(calls).toEqual([{ filePath: SYNTHETIC_PATH, maxBytes: DETAIL_TAIL_BYTES }]);
  });
});

describe("readClaudeDetail: 除外規則", () => {
  it("tool_result のみの user 行は除外される（本文なし）", async () => {
    const lines = [
      userLine("2026-01-01T00:00:00Z", [
        { type: "tool_result", tool_use_id: "t1", content: "結果" },
      ]),
    ];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([]);
  });

  it("tool_use のみの assistant 行は除外される（本文なし）", async () => {
    const lines = [
      assistantLine("2026-01-01T00:00:00Z", [
        { type: "tool_use", id: "t1", name: "Bash", input: {} },
      ]),
    ];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([]);
  });

  it("isSidechain: true の行は除外される", async () => {
    const lines = [userLine("2026-01-01T00:00:00Z", "サブエージェント入力", { isSidechain: true })];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([]);
  });

  it("isMeta: true の user 行は除外される", async () => {
    const lines = [userLine("2026-01-01T00:00:00Z", "システム注入", { isMeta: true })];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([]);
  });

  it("message.model が '<synthetic>' の assistant 行は除外される", async () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "assistant",
          model: "<synthetic>",
          content: [{ type: "text", text: "内部生成" }],
        },
      }),
    ];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([]);
  });

  it("timestamp を持たない行は除外される", async () => {
    const lines = [userLine(undefined, "タイムスタンプ無し")];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([]);
  });
});

describe("readClaudeDetail: マスク・切り詰め", () => {
  it("sk-ant-... がマスクされる", async () => {
    const lines = [userLine("2026-01-01T00:00:00Z", "鍵は sk-ant-abcdefghijklmnop123 です")];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = result.value.recentMessages[0]?.text ?? "";
    expect(text).not.toContain("sk-ant-abcdefghijklmnop123");
    expect(text).toContain("••••");
  });

  it("改行が保たれる", async () => {
    const lines = [userLine("2026-01-01T00:00:00Z", "1行目\n2行目\n3行目")];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages[0]?.text).toBe("1行目\n2行目\n3行目");
  });

  it("501 文字以上の本文は 500 文字以内 + 「…」に切り詰められる", async () => {
    const longText = "あ".repeat(600);
    const lines = [userLine("2026-01-01T00:00:00Z", longText)];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = result.value.recentMessages[0]?.text ?? "";
    expect(text.length).toBeLessThanOrEqual(DETAIL_TEXT_MAX_CHARS);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("readClaudeDetail: parseWarnings", () => {
  it("壊れた行が 3 行あれば parseWarnings が ['3 件の行を解釈できませんでした。']", async () => {
    const lines = [
      "not a json line 1",
      "not a json line 2",
      "not a json line 3",
      userLine("2026-01-01T00:00:00Z", "正常な行"),
    ];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parseWarnings).toEqual(["3 件の行を解釈できませんでした。"]);
  });

  it("壊れた行が 0 行なら parseWarnings は []", async () => {
    const lines = [userLine("2026-01-01T00:00:00Z", "正常な行")];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parseWarnings).toEqual([]);
  });

  it("未知の type の行は parseWarnings に数えない", async () => {
    const lines = [
      JSON.stringify({ type: "unknown-type", timestamp: "2026-01-01T00:00:00Z" }),
      userLine("2026-01-01T00:00:01Z", "正常な行"),
    ];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parseWarnings).toEqual([]);
  });
});

describe("readClaudeDetail: 読み取り失敗", () => {
  it("readTailLines が err を返すとき、その err がそのまま返る", async () => {
    const failure = err<string[]>({
      code: "file_unreadable",
      message: "ファイルを読み取れませんでした: C:\\synthetic\\secret.jsonl",
      hint: "ファイルが存在し、読み取り権限があるか確認してください。",
    });
    const { fn } = makeFakeReadTailLines(failure);

    const result = await readClaudeDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result).toEqual(failure);
  });
});
