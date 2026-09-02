import { describe, expect, it } from "vitest";
import { parseClaudeSummary } from "../../../src/server/sources/claude/parser";

// T-009: parseClaudeSummary の受け入れ条件を検証する。
// RESEARCH.md §2.3〜§2.5 の構造を写した合成行のみを使う。cwd / UUID / 時刻はすべて合成値。

const SYNTHETIC_CWD = "C:\\synthetic\\project";
const OWNER_UUID = "00000000-0000-4000-8000-000000000001";
const VERSION = "0.0.0";
const MODEL = "synthetic-model-1";

interface UserLineOptions {
  timestamp?: string;
  content?: unknown;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  entrypoint?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
}

interface AssistantLineOptions {
  timestamp?: string;
  content?: unknown;
  model?: string | null;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  entrypoint?: string;
  isSidechain?: boolean;
}

/** 合成の user 行を JSON 文字列として組み立てる。 */
function userLine(options: UserLineOptions = {}): string {
  const {
    timestamp = "2026-01-01T00:00:00Z",
    content = "合成メッセージ",
    cwd = SYNTHETIC_CWD,
    version = VERSION,
    gitBranch,
    entrypoint,
    isSidechain,
    isMeta,
  } = options;
  return JSON.stringify({
    type: "user",
    uuid: "00000000-0000-4000-8000-000000000010",
    timestamp,
    cwd,
    version,
    ...(gitBranch !== undefined ? { gitBranch } : {}),
    ...(entrypoint !== undefined ? { entrypoint } : {}),
    ...(isSidechain !== undefined ? { isSidechain } : {}),
    ...(isMeta !== undefined ? { isMeta } : {}),
    message: { role: "user", content },
  });
}

/** 合成の assistant 行を JSON 文字列として組み立てる。model: null で message.model を省略する。 */
function assistantLine(options: AssistantLineOptions = {}): string {
  const {
    timestamp = "2026-01-01T00:00:00Z",
    content = [{ type: "text", text: "合成応答" }],
    model = MODEL,
    cwd = SYNTHETIC_CWD,
    version = VERSION,
    gitBranch,
    entrypoint,
    isSidechain,
  } = options;
  return JSON.stringify({
    type: "assistant",
    uuid: "00000000-0000-4000-8000-000000000011",
    timestamp,
    cwd,
    version,
    ...(gitBranch !== undefined ? { gitBranch } : {}),
    ...(entrypoint !== undefined ? { entrypoint } : {}),
    ...(isSidechain !== undefined ? { isSidechain } : {}),
    message: {
      role: "assistant",
      ...(model !== null ? { model } : {}),
      content,
    },
  });
}

/** custom-title / ai-title / last-prompt / bridge-session など、任意の type の行を組み立てる。 */
function metaLine(
  type: string,
  fields: Record<string, unknown> = {},
  timestamp = "2026-01-01T00:00:00Z",
): string {
  return JSON.stringify({ type, timestamp, ...fields });
}

describe("parseClaudeSummary: 正常系（全フィールドが取れる）", () => {
  it("cwd / version / gitBranch / model / title / lastMessage / firstAt / lastAt / ownerAccountUuid をすべて取得する", () => {
    const head = [
      userLine({
        timestamp: "2026-01-01T00:00:00Z",
        content: "最初のユーザー入力",
        gitBranch: "main",
        entrypoint: "cli",
      }),
      metaLine("bridge-session", { ownerAccountUuid: OWNER_UUID }),
    ];
    const tail = [
      assistantLine({
        timestamp: "2026-01-01T00:05:00Z",
        content: [{ type: "text", text: "最後の応答" }],
        model: MODEL,
      }),
    ];

    const result = parseClaudeSummary(head, tail);

    expect(result.cwd).toBe(SYNTHETIC_CWD);
    expect(result.version).toBe(VERSION);
    expect(result.gitBranch).toBe("main");
    expect(result.entrypoint).toBe("cli");
    expect(result.model).toBe(MODEL);
    expect(result.title).toBe("最初のユーザー入力");
    expect(result.lastMessage).toBe("最後の応答");
    expect(result.lastRole).toBe("assistant");
    expect(result.firstAt).toBe("2026-01-01T00:00:00Z");
    expect(result.lastAt).toBe("2026-01-01T00:05:00Z");
    expect(result.ownerAccountUuid).toBe(OWNER_UUID);
    expect(result.parseFailures).toBe(0);
  });

  it("entrypoint: cli を採用する", () => {
    const result = parseClaudeSummary([userLine({ entrypoint: "cli" })], []);
    expect(result.entrypoint).toBe("cli");
  });

  it("entrypoint: claude-desktop を採用する", () => {
    const result = parseClaudeSummary([userLine({ entrypoint: "claude-desktop" })], []);
    expect(result.entrypoint).toBe("claude-desktop");
  });

  it("entrypoint: 未知の値（例: vscode）は unknown になる", () => {
    const result = parseClaudeSummary([userLine({ entrypoint: "vscode" })], []);
    expect(result.entrypoint).toBe("unknown");
  });

  it("entrypoint: フィールド欠落なら unknown になる", () => {
    const result = parseClaudeSummary([userLine({})], []);
    expect(result.entrypoint).toBe("unknown");
  });
});

describe("parseClaudeSummary: title の優先順（custom-title → ai-title → 最初の user 本文 → null）", () => {
  it("custom-title があれば最優先で採用する", () => {
    const lines = [
      userLine({ content: "ユーザー本文" }),
      metaLine("ai-title", { aiTitle: "AI が付けたタイトル" }),
      metaLine("custom-title", { customTitle: "カスタムタイトル" }),
    ];
    const result = parseClaudeSummary(lines, []);
    expect(result.title).toBe("カスタムタイトル");
  });

  it("custom-title が複数あれば最後のものを採用する", () => {
    const lines = [
      metaLine("custom-title", { customTitle: "古いタイトル" }, "2026-01-01T00:00:00Z"),
      metaLine("custom-title", { customTitle: "新しいタイトル" }, "2026-01-01T00:01:00Z"),
    ];
    const result = parseClaudeSummary(lines, []);
    expect(result.title).toBe("新しいタイトル");
  });

  it("空文字の customTitle は飛ばして次の候補（ai-title）を使う", () => {
    const lines = [
      metaLine("ai-title", { aiTitle: "AI タイトル" }),
      metaLine("custom-title", { customTitle: "" }),
    ];
    const result = parseClaudeSummary(lines, []);
    expect(result.title).toBe("AI タイトル");
  });

  it("custom-title が無ければ ai-title を採用する", () => {
    const lines = [
      userLine({ content: "ユーザー本文" }),
      metaLine("ai-title", { aiTitle: "AI タイトル" }),
    ];
    const result = parseClaudeSummary(lines, []);
    expect(result.title).toBe("AI タイトル");
  });

  it("custom-title / ai-title が無ければ最初の user 本文の先頭 1 行を使う（前後の空白・先頭の空行を飛ばす）", () => {
    const lines = [userLine({ content: "\n   \n  タイトル行  \n本文の 2 行目" })];
    const result = parseClaudeSummary(lines, []);
    expect(result.title).toBe("タイトル行");
  });

  it("どの候補も無ければ title は null", () => {
    const result = parseClaudeSummary([metaLine("system", {})], []);
    expect(result.title).toBeNull();
  });
});

describe("parseClaudeSummary: user の message.content（文字列 / 配列 / 画像）", () => {
  it("content が文字列ならそのまま本文として使う", () => {
    const result = parseClaudeSummary([userLine({ content: "文字列の本文" })], []);
    expect(result.title).toBe("文字列の本文");
  });

  it("content が [{text}] の配列なら text を使う", () => {
    const result = parseClaudeSummary(
      [userLine({ content: [{ type: "text", text: "配列の本文" }] })],
      [],
    );
    expect(result.title).toBe("配列の本文");
  });

  it("content が [{text},{text}] なら改行で連結する", () => {
    const result = parseClaudeSummary(
      [
        userLine({
          content: [
            { type: "text", text: "1 行目" },
            { type: "text", text: "2 行目" },
          ],
        }),
      ],
      [],
    );
    expect(result.title).toBe("1 行目");
    // title は先頭行だけなので lastMessage 側で連結結果を確認する
    const lastResult = parseClaudeSummary(
      [],
      [
        userLine({
          content: [
            { type: "text", text: "1 行目" },
            { type: "text", text: "2 行目" },
          ],
        }),
      ],
    );
    expect(lastResult.lastMessage).toBe("1 行目\n2 行目");
  });

  it("content が [{image}] のみなら「(画像)」になる", () => {
    const result = parseClaudeSummary([], [userLine({ content: [{ type: "image" }] })]);
    expect(result.lastMessage).toBe("(画像)");
    expect(result.lastRole).toBe("user");
  });

  it("content が [{image},{text}] なら text を使う（画像は無視）", () => {
    const result = parseClaudeSummary(
      [],
      [
        userLine({
          content: [{ type: "image" }, { type: "text", text: "画像に添えたテキスト" }],
        }),
      ],
    );
    expect(result.lastMessage).toBe("画像に添えたテキスト");
  });

  it("content が [{tool_result}] のみなら user メッセージとして扱われない（title・lastMessage の候補にならない）", () => {
    const result = parseClaudeSummary(
      [userLine({ content: [{ type: "tool_result", content: "結果" }] })],
      [],
    );
    expect(result.title).toBeNull();
    expect(result.lastMessage).toBeNull();
  });

  it("content が空文字列なら本文なし扱いになる", () => {
    const result = parseClaudeSummary([userLine({ content: "" })], []);
    expect(result.title).toBeNull();
    expect(result.lastMessage).toBeNull();
  });
});

describe("parseClaudeSummary: assistant の message.content（text のみ採用 / tool_use 無視 / synthetic 無視）", () => {
  it("[{text},{tool_use}] は text のみを採用する", () => {
    const result = parseClaudeSummary(
      [],
      [
        assistantLine({
          content: [
            { type: "text", text: "本文" },
            { type: "tool_use", name: "synthetic_tool" },
          ],
        }),
      ],
    );
    expect(result.lastMessage).toBe("本文");
    expect(result.lastRole).toBe("assistant");
  });

  it("[{tool_use}] のみならメッセージとして扱われない", () => {
    const result = parseClaudeSummary(
      [],
      [assistantLine({ content: [{ type: "tool_use", name: "synthetic_tool" }] })],
    );
    expect(result.lastMessage).toBeNull();
    expect(result.lastRole).toBeNull();
  });

  it("[{thinking},{text}] は text のみを採用する", () => {
    const result = parseClaudeSummary(
      [],
      [
        assistantLine({
          content: [
            { type: "thinking", thinking: "考え中" },
            { type: "text", text: "結論" },
          ],
        }),
      ],
    );
    expect(result.lastMessage).toBe("結論");
  });

  it("message.model が <synthetic> の行は model にも lastMessage にも使われない（直前の通常 assistant の値が残る）", () => {
    const head = [
      assistantLine({
        timestamp: "2026-01-01T00:00:00Z",
        model: "通常モデル",
        content: [{ type: "text", text: "通常の応答" }],
      }),
    ];
    const tail = [
      assistantLine({
        timestamp: "2026-01-01T00:05:00Z",
        model: "<synthetic>",
        content: [{ type: "text", text: "内部生成メッセージ" }],
      }),
    ];
    const result = parseClaudeSummary(head, tail);
    expect(result.model).toBe("通常モデル");
    // synthetic 行自体は無視されるので、直前の通常 assistant（head）のメッセージが lastMessage に残る
    expect(result.lastMessage).toBe("通常の応答");
    expect(result.lastRole).toBe("assistant");
  });

  it("model が複数の assistant 行にあれば最後の値を採用する", () => {
    const head = [assistantLine({ timestamp: "2026-01-01T00:00:00Z", model: "model-a" })];
    const tail = [
      assistantLine({ timestamp: "2026-01-01T00:01:00Z", model: "model-b" }),
      assistantLine({ timestamp: "2026-01-01T00:02:00Z", model: "model-c" }),
    ];
    const result = parseClaudeSummary(head, tail);
    expect(result.model).toBe("model-c");
  });

  it("<synthetic> だけなら model は null", () => {
    const result = parseClaudeSummary([assistantLine({ model: "<synthetic>" })], []);
    expect(result.model).toBeNull();
  });
});

describe("parseClaudeSummary: parseFailures（壊れた行・形が違う行はスキップして件数を返す）", () => {
  it("壊れた JSON 行は parseFailures に数える", () => {
    const lines = ["{not valid json", userLine({})];
    const result = parseClaudeSummary(lines, []);
    expect(result.parseFailures).toBe(1);
    expect(result.cwd).toBe(SYNTHETIC_CWD);
  });

  it("配列行（JSON.parse がオブジェクトを返さない）は parseFailures に数える", () => {
    const result = parseClaudeSummary([JSON.stringify([1, 2, 3])], []);
    expect(result.parseFailures).toBe(1);
  });

  it("type 欠落の行は parseFailures に数える", () => {
    const result = parseClaudeSummary(
      [JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", cwd: SYNTHETIC_CWD })],
      [],
    );
    expect(result.parseFailures).toBe(1);
  });

  it("type が数値の行は parseFailures に数える", () => {
    const result = parseClaudeSummary([JSON.stringify({ type: 123 })], []);
    expect(result.parseFailures).toBe(1);
  });

  it("未知の type（attachment, queue-operation, file-history-snapshot）は parseFailures に数えない", () => {
    const lines = [
      metaLine("attachment", { attachment: { type: "hook_success" } }),
      metaLine("queue-operation", { operation: "enqueue" }),
      metaLine("file-history-snapshot", {}),
    ];
    const result = parseClaudeSummary(lines, []);
    expect(result.parseFailures).toBe(0);
  });

  it("head と tail の合計が parseFailures になる", () => {
    const head = ["broken-head-line"];
    const tail = ["broken-tail-line-1", "broken-tail-line-2"];
    const result = parseClaudeSummary(head, tail);
    expect(result.parseFailures).toBe(3);
  });
});

describe("parseClaudeSummary: isSidechain の行は無視する", () => {
  it("sidechain の user 行は cwd / title / lastMessage のいずれにも使われない", () => {
    const result = parseClaudeSummary(
      [
        userLine({
          content: "サブエージェントの入力",
          cwd: "C:\\synthetic\\other",
          isSidechain: true,
        }),
      ],
      [],
    );
    expect(result.cwd).toBeNull();
    expect(result.title).toBeNull();
  });

  it("sidechain の assistant 行は model / lastMessage に使われない", () => {
    const result = parseClaudeSummary(
      [],
      [
        assistantLine({
          model: "サブエージェント専用モデル",
          content: [{ type: "text", text: "サブエージェントの応答" }],
          isSidechain: true,
        }),
      ],
    );
    expect(result.model).toBeNull();
    expect(result.lastMessage).toBeNull();
  });

  it("firstAt / lastAt は sidechain 行も含めて集計する", () => {
    const result = parseClaudeSummary(
      [],
      [userLine({ timestamp: "2026-01-01T00:09:00Z", isSidechain: true })],
    );
    expect(result.lastAt).toBe("2026-01-01T00:09:00Z");
  });
});

describe("parseClaudeSummary: isMeta の user 行は無視する", () => {
  it("isMeta: true の user 行は title / lastMessage に使われない", () => {
    const result = parseClaudeSummary(
      [userLine({ content: "システム注入メッセージ", isMeta: true })],
      [],
    );
    expect(result.title).toBeNull();
    expect(result.lastMessage).toBeNull();
  });
});

describe("parseClaudeSummary: bridge-session.ownerAccountUuid", () => {
  it("大文字 UUID は小文字化して採用する", () => {
    const result = parseClaudeSummary(
      [metaLine("bridge-session", { ownerAccountUuid: OWNER_UUID.toUpperCase() })],
      [],
    );
    expect(result.ownerAccountUuid).toBe(OWNER_UUID);
  });

  it("UUID 形式でない値なら null", () => {
    const result = parseClaudeSummary(
      [metaLine("bridge-session", { ownerAccountUuid: "not-a-uuid" })],
      [],
    );
    expect(result.ownerAccountUuid).toBeNull();
  });

  it("bridge-session が無ければ null", () => {
    const result = parseClaudeSummary([userLine({})], []);
    expect(result.ownerAccountUuid).toBeNull();
  });

  it("複数あれば最初の値を採用する", () => {
    const first = "00000000-0000-4000-8000-00000000000a";
    const second = "00000000-0000-4000-8000-00000000000b";
    const result = parseClaudeSummary(
      [
        metaLine("bridge-session", { ownerAccountUuid: first }, "2026-01-01T00:00:00Z"),
        metaLine("bridge-session", { ownerAccountUuid: second }, "2026-01-01T00:01:00Z"),
      ],
      [],
    );
    expect(result.ownerAccountUuid).toBe(first);
  });
});

describe("parseClaudeSummary: lastMessage / lastRole（tail 逆走査 → last-prompt → head 逆走査 → null）", () => {
  it("tail の最後が user ならそれを採用する", () => {
    const tail = [
      assistantLine({
        timestamp: "2026-01-01T00:00:00Z",
        content: [{ type: "text", text: "応答" }],
      }),
      userLine({ timestamp: "2026-01-01T00:01:00Z", content: "追加の質問" }),
    ];
    const result = parseClaudeSummary([], tail);
    expect(result.lastMessage).toBe("追加の質問");
    expect(result.lastRole).toBe("user");
  });

  it("tail の最後が assistant ならそれを採用する", () => {
    const tail = [
      userLine({ timestamp: "2026-01-01T00:00:00Z", content: "質問" }),
      assistantLine({
        timestamp: "2026-01-01T00:01:00Z",
        content: [{ type: "text", text: "回答" }],
      }),
    ];
    const result = parseClaudeSummary([], tail);
    expect(result.lastMessage).toBe("回答");
    expect(result.lastRole).toBe("assistant");
  });

  it("tail の最後が tool_result のみの user なら飛ばして手前の本文ありの行を採用する", () => {
    const tail = [
      userLine({ timestamp: "2026-01-01T00:00:00Z", content: "本文のある質問" }),
      userLine({
        timestamp: "2026-01-01T00:01:00Z",
        content: [{ type: "tool_result", content: "結果" }],
      }),
    ];
    const result = parseClaudeSummary([], tail);
    expect(result.lastMessage).toBe("本文のある質問");
    expect(result.lastRole).toBe("user");
  });

  it("tail の最後が sidechain 行なら飛ばして手前を採用する", () => {
    const tail = [
      userLine({ timestamp: "2026-01-01T00:00:00Z", content: "本体の質問" }),
      userLine({
        timestamp: "2026-01-01T00:01:00Z",
        content: "サブエージェント入力",
        isSidechain: true,
      }),
    ];
    const result = parseClaudeSummary([], tail);
    expect(result.lastMessage).toBe("本体の質問");
    expect(result.lastRole).toBe("user");
  });

  it("tail に無く head にある場合は head から取る", () => {
    const head = [userLine({ timestamp: "2026-01-01T00:00:00Z", content: "head 側の最後" })];
    const tail = [metaLine("system", {})];
    const result = parseClaudeSummary(head, tail);
    expect(result.lastMessage).toBe("head 側の最後");
    expect(result.lastRole).toBe("user");
  });

  it("tail に本文が無く head の本文と last-prompt が両方ある場合は last-prompt が勝つ（head より新しいため）", () => {
    const head = [
      userLine({ timestamp: "2026-01-01T00:00:00Z", content: "head 側の古い本文" }),
      metaLine("last-prompt", { lastPrompt: "ターン末尾の last-prompt" }),
    ];
    const tail = [metaLine("last-prompt", { lastPrompt: "ターン末尾の last-prompt" })];
    const result = parseClaudeSummary(head, tail);
    expect(result.lastMessage).toBe("ターン末尾の last-prompt");
    expect(result.lastRole).toBe("user");
  });

  it("user / assistant の text ブロックに空文字が混ざっても先頭・末尾に改行が付かない", () => {
    const head = [
      userLine({
        timestamp: "2026-01-01T00:00:00Z",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "本文" },
        ],
      }),
    ];
    const result = parseClaudeSummary(head, []);
    expect(result.lastMessage).toBe("本文");
  });

  it("head にも tail にも無く last-prompt があればそれを採用する（role は user）", () => {
    const result = parseClaudeSummary(
      [metaLine("last-prompt", { lastPrompt: "最後のプロンプト" })],
      [],
    );
    expect(result.lastMessage).toBe("最後のプロンプト");
    expect(result.lastRole).toBe("user");
  });

  it("すべて無ければ lastMessage / lastRole は null", () => {
    const result = parseClaudeSummary([metaLine("system", {})], []);
    expect(result.lastMessage).toBeNull();
    expect(result.lastRole).toBeNull();
  });
});

describe("parseClaudeSummary: firstAt / lastAt", () => {
  it("timestamp を持つ最初 / 最後の行を採用する（無視行も含む）", () => {
    const head = [userLine({ timestamp: "2026-01-01T00:00:00Z" })];
    const tail = [
      userLine({ timestamp: "2026-01-01T00:09:00Z", isSidechain: true, content: "sidechain" }),
    ];
    const result = parseClaudeSummary(head, tail);
    expect(result.firstAt).toBe("2026-01-01T00:00:00Z");
    expect(result.lastAt).toBe("2026-01-01T00:09:00Z");
  });

  it("timestamp の無い行は飛ばす", () => {
    const result = parseClaudeSummary(
      [JSON.stringify({ type: "user", message: { role: "user", content: "timestamp 無し" } })],
      [],
    );
    expect(result.firstAt).toBeNull();
    expect(result.lastAt).toBeNull();
  });
});

describe("parseClaudeSummary: 空データ", () => {
  it("head / tail が両方空 → すべて null・unknown・0", () => {
    const result = parseClaudeSummary([], []);
    expect(result.cwd).toBeNull();
    expect(result.version).toBeNull();
    expect(result.gitBranch).toBeNull();
    expect(result.model).toBeNull();
    expect(result.title).toBeNull();
    expect(result.lastMessage).toBeNull();
    expect(result.lastRole).toBeNull();
    expect(result.firstAt).toBeNull();
    expect(result.lastAt).toBeNull();
    expect(result.ownerAccountUuid).toBeNull();
    expect(result.entrypoint).toBe("unknown");
    expect(result.parseFailures).toBe(0);
  });

  it("head と tail が同じ配列（小ファイル）の場合、parseFailures は重複計上（合計）される", () => {
    const brokenLines = ["{not valid json (shared between head and tail)"];
    const result = parseClaudeSummary(brokenLines, brokenLines);
    expect(result.parseFailures).toBe(2);
  });

  it("head と tail が同じ有効行を含む場合でも firstAt / lastAt はその行を指す（重複排除しない）", () => {
    const sharedLine = userLine({ timestamp: "2026-01-01T00:00:00Z" });
    const lines = [sharedLine];
    const result = parseClaudeSummary(lines, lines);
    expect(result.firstAt).toBe("2026-01-01T00:00:00Z");
    expect(result.lastAt).toBe("2026-01-01T00:00:00Z");
    expect(result.parseFailures).toBe(0);
  });
});

describe("parseClaudeSummary: 性能（例外を投げないことのみ確認）", () => {
  it("2 万行相当の大きい配列でも例外を投げない", () => {
    const head: string[] = [];
    for (let i = 0; i < 20000; i++) {
      head.push(
        userLine({
          timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
          content: `msg-${i}`,
        }),
      );
    }
    const tail: string[] = [];
    for (let i = 0; i < 20000; i++) {
      tail.push(
        assistantLine({
          timestamp: `2026-01-01T01:00:${String(i % 60).padStart(2, "0")}Z`,
          content: [{ type: "text", text: `reply-${i}` }],
        }),
      );
    }
    expect(() => parseClaudeSummary(head, tail)).not.toThrow();
    const result = parseClaudeSummary(head, tail);
    expect(result.parseFailures).toBe(0);
  });
});
