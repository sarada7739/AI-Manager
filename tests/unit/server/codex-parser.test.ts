import { describe, expect, it } from "vitest";
import { parseCodexSummary } from "../../../src/server/sources/codex/parser";

// T-011: parseCodexSummary の受け入れ条件を検証する。
// RESEARCH.md §3.2 の構造を写した合成行のみを使う。cwd / id / 時刻はすべて合成値。

const SYNTHETIC_CWD = "C:\\synthetic\\repo";
const ID = "00000000-0000-4000-8000-000000000001";

function line(timestamp: string, type: string, payload: unknown): string {
  return JSON.stringify({ timestamp, type, payload });
}

function sessionMetaLine(timestamp: string, overrides: Record<string, unknown> = {}): string {
  return line(timestamp, "session_meta", {
    id: ID,
    timestamp,
    cwd: SYNTHETIC_CWD,
    originator: "codex_exec",
    cli_version: "0.1.0-synthetic",
    source: "exec",
    model_provider: "synthetic-provider",
    base_instructions: { text: "synthetic instructions" },
    ...overrides,
  });
}

function turnContextLine(timestamp: string, model: string): string {
  return line(timestamp, "turn_context", {
    turn_id: "turn-1",
    cwd: SYNTHETIC_CWD,
    model,
  });
}

function taskStartedLine(timestamp: string): string {
  return line(timestamp, "event_msg", {
    type: "task_started",
    turn_id: "turn-1",
    model_context_window: 100000,
  });
}

function userMessageLine(timestamp: string, message: string): string {
  return line(timestamp, "event_msg", { type: "user_message", message, images: [] });
}

function taskCompleteLine(timestamp: string, lastAgentMessage: string): string {
  return line(timestamp, "event_msg", {
    type: "task_complete",
    turn_id: "turn-1",
    last_agent_message: lastAgentMessage,
  });
}

function responseItemLine(timestamp: string, role: string, content: unknown): string {
  return line(timestamp, "response_item", { type: "message", role, content });
}

describe("parseCodexSummary: 正常系（全フィールド）", () => {
  it("session_meta / turn_context / title / lastMessage をすべて取得する（git.branch あり）", () => {
    const head = [
      sessionMetaLine("2026-01-01T00:00:00Z", { git: { branch: "main" } }),
      turnContextLine("2026-01-01T00:00:01Z", "gpt-synthetic-1"),
      taskStartedLine("2026-01-01T00:00:02Z"),
      userMessageLine("2026-01-01T00:00:03Z", "こんにちは\n2 行目"),
    ];
    const tail = [taskCompleteLine("2026-01-01T00:05:00Z", "完了しました")];

    const result = parseCodexSummary(head, tail);

    expect(result.cwd).toBe(SYNTHETIC_CWD);
    expect(result.originator).toBe("codex_exec");
    expect(result.cliVersion).toBe("0.1.0-synthetic");
    expect(result.modelProvider).toBe("synthetic-provider");
    expect(result.gitBranch).toBe("main");
    expect(result.model).toBe("gpt-synthetic-1");
    expect(result.title).toBe("こんにちは");
    expect(result.lastMessage).toBe("完了しました");
    expect(result.lastRole).toBe("assistant");
    expect(result.entrypoint).toBe("codex-exec");
    expect(result.firstAt).toBe("2026-01-01T00:00:00Z");
    expect(result.lastAt).toBe("2026-01-01T00:05:00Z");
    expect(result.parseFailures).toBe(0);
  });

  it("session_meta.git が無い場合 gitBranch は null", () => {
    const head = [sessionMetaLine("2026-01-01T00:00:00Z")];
    const result = parseCodexSummary(head, []);
    expect(result.gitBranch).toBeNull();
  });

  it("entrypoint: originator が codex_exec なら codex-exec", () => {
    const result = parseCodexSummary(
      [sessionMetaLine("2026-01-01T00:00:00Z", { originator: "codex_exec" })],
      [],
    );
    expect(result.entrypoint).toBe("codex-exec");
  });

  it("entrypoint: originator が codex_cli_rs なら codex-tui", () => {
    const result = parseCodexSummary(
      [sessionMetaLine("2026-01-01T00:00:00Z", { originator: "codex_cli_rs" })],
      [],
    );
    expect(result.entrypoint).toBe("codex-tui");
  });

  it("entrypoint: 未知の originator なら unknown", () => {
    const result = parseCodexSummary(
      [sessionMetaLine("2026-01-01T00:00:00Z", { originator: "something_else" })],
      [],
    );
    expect(result.entrypoint).toBe("unknown");
  });

  it("turn_context が複数あれば最後の model を採用する", () => {
    const head = [
      sessionMetaLine("2026-01-01T00:00:00Z"),
      turnContextLine("2026-01-01T00:00:01Z", "model-a"),
      turnContextLine("2026-01-01T00:00:02Z", "model-b"),
    ];
    const tail = [turnContextLine("2026-01-01T00:00:03Z", "model-c")];
    const result = parseCodexSummary(head, tail);
    expect(result.model).toBe("model-c");
  });
});

describe("parseCodexSummary: title", () => {
  it("先頭 1 行だけを使い、前後の空白を除去する", () => {
    const head = [userMessageLine("2026-01-01T00:00:00Z", "  タイトル行  \n本文の 2 行目")];
    const result = parseCodexSummary(head, []);
    expect(result.title).toBe("タイトル行");
  });

  it("空文字の user_message は飛ばして次の候補を使う", () => {
    const head = [
      userMessageLine("2026-01-01T00:00:00Z", "   \n"),
      userMessageLine("2026-01-01T00:00:01Z", "2 番目のメッセージ"),
    ];
    const result = parseCodexSummary(head, []);
    expect(result.title).toBe("2 番目のメッセージ");
  });

  it("head に無く tail にある場合は tail から取る", () => {
    const head = [sessionMetaLine("2026-01-01T00:00:00Z")];
    const tail = [userMessageLine("2026-01-01T00:05:00Z", "tail のタイトル")];
    const result = parseCodexSummary(head, tail);
    expect(result.title).toBe("tail のタイトル");
  });

  it("user_message が無ければ title は null", () => {
    const result = parseCodexSummary([sessionMetaLine("2026-01-01T00:00:00Z")], []);
    expect(result.title).toBeNull();
  });
});

describe("parseCodexSummary: lastMessage", () => {
  it("(a) task_complete が最後 → assistant", () => {
    const tail = [
      userMessageLine("2026-01-01T00:00:00Z", "質問"),
      taskCompleteLine("2026-01-01T00:00:01Z", "回答しました"),
    ];
    const result = parseCodexSummary([], tail);
    expect(result.lastMessage).toBe("回答しました");
    expect(result.lastRole).toBe("assistant");
  });

  it("(b) task_complete より後ろに response_item(assistant) があればそちらを使う", () => {
    const tail = [
      taskCompleteLine("2026-01-01T00:00:00Z", "旧い完了メッセージ"),
      responseItemLine("2026-01-01T00:00:01Z", "assistant", "新しい応答"),
    ];
    const result = parseCodexSummary([], tail);
    expect(result.lastMessage).toBe("新しい応答");
    expect(result.lastRole).toBe("assistant");
  });

  it("(b') 逆順: response_item より後ろに task_complete があれば task_complete（後ろの方）が勝つ（位置基準の優先が対称であることの確認）", () => {
    const tail = [
      responseItemLine("2026-01-01T00:00:00Z", "assistant", "古い応答"),
      taskCompleteLine("2026-01-01T00:00:01Z", "新しい完了メッセージ"),
    ];
    const result = parseCodexSummary([], tail);
    expect(result.lastMessage).toBe("新しい完了メッセージ");
    expect(result.lastRole).toBe("assistant");
  });

  it("(c) role: developer の response_item は無視する", () => {
    const tail = [
      responseItemLine("2026-01-01T00:00:00Z", "user", "ユーザーの発言"),
      responseItemLine("2026-01-01T00:00:01Z", "developer", "開発者向け指示（無視される）"),
    ];
    const result = parseCodexSummary([], tail);
    expect(result.lastMessage).toBe("ユーザーの発言");
    expect(result.lastRole).toBe("user");
  });

  it("(d) content が {type,text} 配列の場合は text を改行連結する", () => {
    const tail = [
      responseItemLine("2026-01-01T00:00:00Z", "assistant", [
        { type: "output_text", text: "1 段落目" },
        { type: "output_text", text: "2 段落目" },
      ]),
    ];
    const result = parseCodexSummary([], tail);
    expect(result.lastMessage).toBe("1 段落目\n2 段落目");
  });

  it("(d-1) content 配列に text 空文字の要素が混ざっても連結対象にせず、先頭改行が付かない", () => {
    const tail = [
      responseItemLine("2026-01-01T00:00:00Z", "assistant", [
        { type: "output_text", text: "" },
        { type: "output_text", text: "本文" },
      ]),
    ];
    const result = parseCodexSummary([], tail);
    expect(result.lastMessage).toBe("本文");
  });

  it("(d-2) type が input_text / output_text 以外の要素は text を持っていても無視する", () => {
    const tail = [
      responseItemLine("2026-01-01T00:00:00Z", "assistant", [
        { type: "input_image", text: "採用されないはずのテキスト" },
        { type: "output_text", text: "実際のテキスト" },
      ]),
    ];
    const result = parseCodexSummary([], tail);
    expect(result.lastMessage).toBe("実際のテキスト");
  });

  it("(d-3) type が無く text だけを持つ要素は採用し、input_text/output_text 以外の明示的な type を持つ要素は無視する", () => {
    const tail = [
      responseItemLine("2026-01-01T00:00:00Z", "assistant", [
        { text: "type 無しのテキスト" },
        { type: "reasoning", text: "採用されないはずの思考メモ" },
      ]),
    ];
    const result = parseCodexSummary([], tail);
    expect(result.lastMessage).toBe("type 無しのテキスト");
  });

  it("(e) content が文字列の場合はそのまま使う", () => {
    const tail = [responseItemLine("2026-01-01T00:00:00Z", "assistant", "そのままの文字列")];
    const result = parseCodexSummary([], tail);
    expect(result.lastMessage).toBe("そのままの文字列");
  });

  it("(f) user_message が最後 → user", () => {
    const tail = [
      taskCompleteLine("2026-01-01T00:00:00Z", "前のターンの完了"),
      userMessageLine("2026-01-01T00:00:01Z", "追加の質問"),
    ];
    const result = parseCodexSummary([], tail);
    expect(result.lastMessage).toBe("追加の質問");
    expect(result.lastRole).toBe("user");
  });

  it("(g) tail が空なら head から取る", () => {
    const head = [taskCompleteLine("2026-01-01T00:00:00Z", "head 側の完了メッセージ")];
    const result = parseCodexSummary(head, []);
    expect(result.lastMessage).toBe("head 側の完了メッセージ");
    expect(result.lastRole).toBe("assistant");
  });

  it("(h) 空文字の last_agent_message は飛ばして前の候補を使う", () => {
    const tail = [
      userMessageLine("2026-01-01T00:00:00Z", "先の質問"),
      taskCompleteLine("2026-01-01T00:00:01Z", ""),
    ];
    const result = parseCodexSummary([], tail);
    expect(result.lastMessage).toBe("先の質問");
    expect(result.lastRole).toBe("user");
  });

  it("すべて空なら lastMessage / lastRole は null", () => {
    const result = parseCodexSummary([sessionMetaLine("2026-01-01T00:00:00Z")], []);
    expect(result.lastMessage).toBeNull();
    expect(result.lastRole).toBeNull();
  });
});

describe("parseCodexSummary: 未知の type / payload.type は無視する", () => {
  it("未知の type（compacted）は無視され、parseFailures には数えない", () => {
    const lines = [
      sessionMetaLine("2026-01-01T00:00:00Z"),
      line("2026-01-01T00:00:01Z", "compacted", { note: "synthetic" }),
    ];
    const result = parseCodexSummary(lines, []);
    expect(result.parseFailures).toBe(0);
  });

  it("未知の event_msg.payload.type（function_call）は無視され、parseFailures には数えない", () => {
    const lines = [
      sessionMetaLine("2026-01-01T00:00:00Z"),
      line("2026-01-01T00:00:01Z", "event_msg", { type: "function_call", name: "synthetic_tool" }),
    ];
    const result = parseCodexSummary(lines, []);
    expect(result.parseFailures).toBe(0);
    expect(result.lastMessage).toBeNull();
  });

  it("未知の response_item.payload.type（reasoning）は lastMessage の対象にならない", () => {
    const tail = [
      line("2026-01-01T00:00:00Z", "response_item", { type: "reasoning", content: "考え中" }),
    ];
    const result = parseCodexSummary([], tail);
    expect(result.lastMessage).toBeNull();
    expect(result.parseFailures).toBe(0);
  });
});

describe("parseCodexSummary: parseFailures（壊れた行・形が違う行）", () => {
  it("壊れた JSON 行は parseFailures に数える", () => {
    const lines = ["{not valid json", sessionMetaLine("2026-01-01T00:00:00Z")];
    const result = parseCodexSummary(lines, []);
    expect(result.parseFailures).toBe(1);
    expect(result.cwd).toBe(SYNTHETIC_CWD);
  });

  it("type 欠落の行は parseFailures に数える", () => {
    const lines = [JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", payload: {} })];
    const result = parseCodexSummary(lines, []);
    expect(result.parseFailures).toBe(1);
  });

  it("payload が非オブジェクト（文字列）の行は parseFailures に数える", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        type: "session_meta",
        payload: "not-an-object",
      }),
    ];
    const result = parseCodexSummary(lines, []);
    expect(result.parseFailures).toBe(1);
  });

  it("配列行（JSON.parse がオブジェクトを返さない）は parseFailures に数える", () => {
    const lines = [JSON.stringify([1, 2, 3])];
    const result = parseCodexSummary(lines, []);
    expect(result.parseFailures).toBe(1);
  });

  it("timestamp 欠落の行は破損行として parseFailures に数える（rollout の全行は timestamp を持つ前提の仕様）", () => {
    const lines = [JSON.stringify({ type: "session_meta", payload: { cwd: SYNTHETIC_CWD } })];
    const result = parseCodexSummary(lines, []);
    // rollout の全行は { timestamp, type, payload } の形を持つ前提のため、timestamp が無い行は
    // 破損行として parseFailures に数え、session_meta としては採用しない（cwd が読み取れない）。
    expect(result.parseFailures).toBe(1);
    expect(result.cwd).toBeNull();
  });

  it("head と tail の合計が parseFailures になる", () => {
    const head = ["broken-head-line"];
    const tail = ["broken-tail-line-1", "broken-tail-line-2"];
    const result = parseCodexSummary(head, tail);
    expect(result.parseFailures).toBe(3);
  });
});

describe("parseCodexSummary: firstAt / lastAt", () => {
  it("未知の type の行も含めて最初 / 最後の timestamp を採用する", () => {
    const head = [line("2026-01-01T00:00:00Z", "compacted", {})];
    const tail = [line("2026-01-01T00:09:00Z", "compacted", {})];
    const result = parseCodexSummary(head, tail);
    expect(result.firstAt).toBe("2026-01-01T00:00:00Z");
    expect(result.lastAt).toBe("2026-01-01T00:09:00Z");
  });

  it("head と tail が同じ有効行を含む（小ファイル）場合でも firstAt / lastAt はその行を指す（重複排除はしない）", () => {
    const sharedLine = sessionMetaLine("2026-01-01T00:00:00Z");
    const lines = [sharedLine];
    const result = parseCodexSummary(lines, lines);
    expect(result.firstAt).toBe("2026-01-01T00:00:00Z");
    expect(result.lastAt).toBe("2026-01-01T00:00:00Z");
    // 有効な行なので、head/tail 両方に数えられても parseFailures は 0 のまま
    expect(result.parseFailures).toBe(0);
  });

  it("head と tail が同じ壊れた行を含む場合、parseFailures は head + tail の合計として二重にカウントされる", () => {
    const brokenLines = ["{not valid json (shared between head and tail)"];
    const result = parseCodexSummary(brokenLines, brokenLines);
    expect(result.parseFailures).toBe(2);
  });
});

describe("parseCodexSummary: 空データ", () => {
  it("head / tail が両方空 → すべて null・unknown・0", () => {
    const result = parseCodexSummary([], []);
    expect(result.cwd).toBeNull();
    expect(result.originator).toBeNull();
    expect(result.cliVersion).toBeNull();
    expect(result.modelProvider).toBeNull();
    expect(result.gitBranch).toBeNull();
    expect(result.model).toBeNull();
    expect(result.title).toBeNull();
    expect(result.lastMessage).toBeNull();
    expect(result.lastRole).toBeNull();
    expect(result.firstAt).toBeNull();
    expect(result.lastAt).toBeNull();
    expect(result.entrypoint).toBe("unknown");
    expect(result.parseFailures).toBe(0);
  });
});

describe("parseCodexSummary: 性能（落ちないことのみ確認）", () => {
  it("数万行相当の大きい配列でも例外を投げない", () => {
    const head: string[] = [];
    for (let i = 0; i < 20000; i++) {
      head.push(line(`2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`, "compacted", { i }));
    }
    const tail: string[] = [];
    for (let i = 0; i < 20000; i++) {
      tail.push(
        userMessageLine(`2026-01-01T01:00:${String(i % 60).padStart(2, "0")}Z`, `msg-${i}`),
      );
    }
    expect(() => parseCodexSummary(head, tail)).not.toThrow();
    const result = parseCodexSummary(head, tail);
    expect(result.parseFailures).toBe(0);
  });
});
