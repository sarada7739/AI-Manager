import { describe, expect, it } from "vitest";
import {
  DETAIL_MAX_MESSAGES,
  DETAIL_TAIL_BYTES,
  DETAIL_TEXT_MAX_CHARS,
  readCodexDetail,
} from "../../../src/server/sources/codex/detail";
import type { Result } from "../../../src/shared/result";
import { err, ok } from "../../../src/shared/result";

// T-014: readCodexDetail の受け入れ条件を検証する。
// フィクスチャ・パスはすべて合成値。実際のファイル I/O はしない（readTailLines をフェイクに差し替える）。

const SYNTHETIC_PATH =
  "C:\\synthetic\\home\\.codex\\sessions\\2026\\01\\01\\rollout-00000000-0000-4000-8000-000000000001.jsonl";

function line(timestamp: string, type: string, payload: unknown): string {
  return JSON.stringify({ timestamp, type, payload });
}

function responseItemLine(timestamp: string, role: string, content: unknown): string {
  return line(timestamp, "response_item", { type: "message", role, content });
}

function userMessageLine(timestamp: string, message: string): string {
  return line(timestamp, "event_msg", { type: "user_message", message });
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

describe("readCodexDetail: 正常系", () => {
  it("response_item(message) の user / assistant が時系列順（role / at / text）で返る", async () => {
    const lines = [
      responseItemLine("2026-01-01T00:00:00Z", "user", "こんにちは"),
      responseItemLine("2026-01-01T00:00:01Z", "assistant", [
        { type: "output_text", text: "応答です" },
      ]),
    ];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([
      { role: "user", at: "2026-01-01T00:00:00Z", text: "こんにちは" },
      { role: "assistant", at: "2026-01-01T00:00:01Z", text: "応答です" },
    ]);
  });

  it("event_msg.user_message からも user メッセージが取れる", async () => {
    const lines = [userMessageLine("2026-01-01T00:00:00Z", "user_message からの入力")];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([
      { role: "user", at: "2026-01-01T00:00:00Z", text: "user_message からの入力" },
    ]);
  });

  it("developer ロールの response_item は除外される", async () => {
    const lines = [responseItemLine("2026-01-01T00:00:00Z", "developer", "システム指示")];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([]);
  });

  it("task_complete は仕様外のため含まれない", async () => {
    const lines = [
      line("2026-01-01T00:00:00Z", "event_msg", {
        type: "task_complete",
        last_agent_message: "完了しました",
      }),
    ];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([]);
  });

  it("content 配列の text が連結される", async () => {
    const lines = [
      responseItemLine("2026-01-01T00:00:00Z", "assistant", [
        { type: "output_text", text: "1行目" },
        { type: "output_text", text: "2行目" },
      ]),
    ];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages[0]?.text).toBe("1行目\n2行目");
  });

  it("25 件あれば末尾 20 件（DETAIL_MAX_MESSAGES）だけが返る", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 25; i++) {
      lines.push(
        responseItemLine(`2026-01-01T00:00:${String(i).padStart(2, "0")}Z`, "user", `本文${i}`),
      );
    }
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toHaveLength(DETAIL_MAX_MESSAGES);
    expect(result.value.recentMessages[0]?.text).toBe("本文5");
    expect(result.value.recentMessages.at(-1)?.text).toBe("本文24");
  });

  it("readTailLines が DETAIL_TAIL_BYTES で呼ばれる", async () => {
    const { fn, calls } = makeFakeReadTailLines(ok([]));

    await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(calls).toEqual([{ filePath: SYNTHETIC_PATH, maxBytes: DETAIL_TAIL_BYTES }]);
  });

  it("空配列が渡されたとき recentMessages: [] になる", async () => {
    const { fn } = makeFakeReadTailLines(ok([]));

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentMessages).toEqual([]);
    expect(result.value.parseWarnings).toEqual([]);
  });
});

describe("readCodexDetail: マスク・切り詰め", () => {
  it("sk-ant-... がマスクされる", async () => {
    const lines = [
      responseItemLine("2026-01-01T00:00:00Z", "user", "鍵は sk-ant-abcdefghijklmnop123 です"),
    ];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = result.value.recentMessages[0]?.text ?? "";
    expect(text).not.toContain("sk-ant-abcdefghijklmnop123");
    expect(text).toContain("••••");
  });

  it("501 文字以上の本文は 500 文字以内 + 「…」に切り詰められる", async () => {
    const longText = "あ".repeat(600);
    const lines = [responseItemLine("2026-01-01T00:00:00Z", "user", longText)];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = result.value.recentMessages[0]?.text ?? "";
    expect(text.length).toBeLessThanOrEqual(DETAIL_TEXT_MAX_CHARS);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("readCodexDetail: parseWarnings", () => {
  it("壊れた行が 3 行あれば parseWarnings が ['3 件の行を解釈できませんでした。']", async () => {
    const lines = [
      "not a json line 1",
      "not a json line 2",
      "not a json line 3",
      responseItemLine("2026-01-01T00:00:00Z", "user", "正常な行"),
    ];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parseWarnings).toEqual(["3 件の行を解釈できませんでした。"]);
  });

  it("壊れた行が 0 行なら parseWarnings は []", async () => {
    const lines = [responseItemLine("2026-01-01T00:00:00Z", "user", "正常な行")];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parseWarnings).toEqual([]);
  });

  it("未知の type の行は parseWarnings に数えない", async () => {
    const lines = [
      line("2026-01-01T00:00:00Z", "unknown_type", {}),
      responseItemLine("2026-01-01T00:00:01Z", "user", "正常な行"),
    ];
    const { fn } = makeFakeReadTailLines(ok(lines));

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parseWarnings).toEqual([]);
  });
});

describe("readCodexDetail: 読み取り失敗", () => {
  it("readTailLines が err を返すとき、その err がそのまま返る", async () => {
    const failure = err<string[]>({
      code: "file_unreadable",
      message: "ファイルを読み取れませんでした: C:\\synthetic\\secret.jsonl",
      hint: "ファイルが存在し、読み取り権限があるか確認してください。",
    });
    const { fn } = makeFakeReadTailLines(failure);

    const result = await readCodexDetail(SYNTHETIC_PATH, { readTailLines: fn });

    expect(result).toEqual(failure);
  });
});
