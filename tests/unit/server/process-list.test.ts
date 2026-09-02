import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProcessListCache,
  extractResumeId,
  listProcesses,
  PROCESS_CACHE_MS,
  PROCESS_LIST_ARGS,
} from "../../../src/server/sources/process/list";

// T-010: listProcesses / extractResumeId の受け入れ条件を検証する。
// 実際の PowerShell は起動せず、必ず runner を差し替える。
// キャッシュはモジュール変数のため、各テストの前に clearProcessListCache() で破棄する。

beforeEach(() => {
  clearProcessListCache();
});

function claudeItem(overrides: Record<string, unknown> = {}) {
  return {
    pid: 111,
    name: "claude.exe",
    creationFileTime: null,
    commandLine: null,
    ...overrides,
  };
}

describe("listProcesses: 正常系", () => {
  it("runner が返す JSON 配列から available:true と各フィールドを変換して返す（creationFileTime の文字列→number 変換、null のまま、commandLine null を含む）", async () => {
    const stdout = JSON.stringify([
      claudeItem({
        pid: 111,
        name: "claude.exe",
        creationFileTime: "134000000000000000",
        commandLine: "claude --resume=abc",
      }),
      claudeItem({ pid: 222, name: "codex.exe", creationFileTime: null, commandLine: null }),
    ]);
    const runner = vi.fn().mockResolvedValue(stdout);

    const result = await listProcesses({ runner, now: () => 0 });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.processes).toHaveLength(2);
    expect(result.processes[0]).toEqual({
      pid: 111,
      name: "claude.exe",
      creationFileTime: Number("134000000000000000"),
      commandLine: "claude --resume=abc",
    });
    expect(result.processes[1]).toEqual({
      pid: 222,
      name: "codex.exe",
      creationFileTime: null,
      commandLine: null,
    });
    expect(result.fetchedAt).toBe(0);
  });

  it("名前フィルタ: claude.exe / Codex.exe / CLAUDE-something は残り、node.exe / xclaude.exe は落ちる", async () => {
    const stdout = JSON.stringify([
      claudeItem({ pid: 1, name: "claude.exe" }),
      claudeItem({ pid: 2, name: "Codex.exe" }),
      claudeItem({ pid: 3, name: "CLAUDE-something" }),
      claudeItem({ pid: 4, name: "node.exe" }),
      claudeItem({ pid: 5, name: "xclaude.exe" }),
    ]);
    const runner = vi.fn().mockResolvedValue(stdout);

    const result = await listProcesses({ runner, now: () => 0 });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.processes.map((p) => p.pid).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("runner に渡された file が powershell.exe、args が PROCESS_LIST_ARGS と同一内容で、-NonInteractive と -NoProfile を含み、ユーザー入力由来の文字列を含まない", async () => {
    const runner = vi.fn().mockResolvedValue("[]");

    await listProcesses({ runner, now: () => 0 });

    expect(runner).toHaveBeenCalledTimes(1);
    const [file, args] = runner.mock.calls[0] as [string, readonly string[]];
    expect(file).toBe("powershell.exe");
    expect(args).toEqual(PROCESS_LIST_ARGS);
    expect(args).toContain("-NonInteractive");
    expect(args).toContain("-NoProfile");
  });

  it("PROCESS_LIST_ARGS は -NonInteractive / -NoProfile を含み、-Command の次の要素（スクリプト本体）が [Console]::OutputEncoding と UTF8Encoding を含み、-ExecutionPolicy は含まれない（stdout を UTF-8 に固定する）", () => {
    expect(PROCESS_LIST_ARGS).toContain("-NonInteractive");
    expect(PROCESS_LIST_ARGS).toContain("-NoProfile");
    expect(PROCESS_LIST_ARGS).not.toContain("-ExecutionPolicy");

    const commandIndex = PROCESS_LIST_ARGS.indexOf("-Command");
    expect(commandIndex).toBeGreaterThanOrEqual(0);
    const script = PROCESS_LIST_ARGS[commandIndex + 1];
    expect(script).toBeDefined();
    expect(script ?? "").toContain("[Console]::OutputEncoding");
    expect(script ?? "").toContain("UTF8Encoding");
  });

  it("stdout が BOM 付き（\\uFEFF）でもパースでき、日本語を含む commandLine もそのまま保持される", async () => {
    const commandLine =
      "C:\\synthetic\\表十\\claude.exe --resume=00000000-0000-4000-8000-000000000001";
    const stdout = `\uFEFF${JSON.stringify([claudeItem({ pid: 300, commandLine })])}`;
    const runner = vi.fn().mockResolvedValue(stdout);

    const result = await listProcesses({ runner, now: () => 0 });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.processes).toHaveLength(1);
    expect(result.processes[0]?.commandLine).toBe(commandLine);
  });

  it("配列でない単一オブジェクトの JSON は 1 件として扱う", async () => {
    const runner = vi.fn().mockResolvedValue(JSON.stringify(claudeItem({ pid: 10 })));

    const result = await listProcesses({ runner, now: () => 0 });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.processes).toHaveLength(1);
    expect(result.processes[0]?.pid).toBe(10);
  });

  it("空文字 stdout は 0 件で available: true", async () => {
    const runner = vi.fn().mockResolvedValue("");

    const result = await listProcesses({ runner, now: () => 0 });

    expect(result).toEqual({ available: true, processes: [], fetchedAt: 0 });
  });
});

describe("listProcesses: creationFileTime のパース", () => {
  it.each([
    ["", null],
    ["0x10", null],
    ["abc", null],
  ])(
    "文字列 %j は creationFileTime: null になる（数字以外を許容しない）",
    async (raw, expected) => {
      const runner = vi
        .fn()
        .mockResolvedValue(JSON.stringify([claudeItem({ pid: 400, creationFileTime: raw })]));

      const result = await listProcesses({ runner, now: () => 0 });

      expect(result.available).toBe(true);
      if (!result.available) return;
      expect(result.processes[0]?.creationFileTime).toBe(expected);
    },
  );

  it('数字だけの文字列 "134000000000000000" は数値に変換される', async () => {
    const runner = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify([claudeItem({ pid: 401, creationFileTime: "134000000000000000" })]),
      );

    const result = await listProcesses({ runner, now: () => 0 });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.processes[0]?.creationFileTime).toBe(Number("134000000000000000"));
  });
});

describe("listProcesses: 不正要素の除去", () => {
  it("不正要素（pid が文字列、pid が 0、name 欠落、非オブジェクト）は捨てられる", async () => {
    const stdout = JSON.stringify([
      claudeItem({ pid: "123" }),
      claudeItem({ pid: 0 }),
      { pid: 5, creationFileTime: null, commandLine: null },
      "not-an-object",
      claudeItem({ pid: 6 }),
    ]);
    const runner = vi.fn().mockResolvedValue(stdout);

    const result = await listProcesses({ runner, now: () => 0 });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.processes.map((p) => p.pid)).toEqual([6]);
  });
});

describe("listProcesses: 失敗", () => {
  it("runner が reject すると available:false を返し、例外を投げない。reason は空でない", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("boom"));

    const result = await listProcesses({ runner, now: () => 0 });

    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("stdout が JSON でなければ available:false", async () => {
    const runner = vi.fn().mockResolvedValue("not json {{{");

    const result = await listProcesses({ runner, now: () => 0 });

    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe("listProcesses: キャッシュ", () => {
  it(`${PROCESS_CACHE_MS - 1}ms 後は runner を再度呼ばず同じ結果を返し、${PROCESS_CACHE_MS}ms 以上で再度呼ばれる`, async () => {
    let time = 0;
    const now = () => time;
    const runner = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify([claudeItem({ pid: 1 })]))
      .mockResolvedValueOnce(JSON.stringify([claudeItem({ pid: 2 })]));

    const first = await listProcesses({ runner, now });
    time = PROCESS_CACHE_MS - 1;
    const second = await listProcesses({ runner, now });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);

    time = PROCESS_CACHE_MS;
    const third = await listProcesses({ runner, now });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(third.available).toBe(true);
    if (!third.available) return;
    expect(third.processes[0]?.pid).toBe(2);
  });

  it("失敗結果もキャッシュされる", async () => {
    let time = 0;
    const now = () => time;
    const runner = vi.fn().mockRejectedValue(new Error("boom"));

    const first = await listProcesses({ runner, now });
    time = 1000;
    const second = await listProcesses({ runner, now });

    expect(runner).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("clearProcessListCache() 後は再取得する", async () => {
    const now = () => 0;
    const runner = vi.fn().mockResolvedValue("[]");

    await listProcesses({ runner, now });
    clearProcessListCache();
    await listProcesses({ runner, now });

    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("同時呼び出し（Promise.all で 3 回）は runner が 1 回だけ呼ばれる", async () => {
    const runner = vi.fn().mockResolvedValue("[]");

    const results = await Promise.all([
      listProcesses({ runner, now: () => 0 }),
      listProcesses({ runner, now: () => 0 }),
      listProcesses({ runner, now: () => 0 }),
    ]);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });
});

describe("extractResumeId", () => {
  it.each([
    [
      "claude --resume=00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
    ],
    [
      "claude --resume 00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000002",
    ],
    [
      'claude --resume="00000000-0000-4000-8000-000000000003"',
      "00000000-0000-4000-8000-000000000003",
    ],
    ["claude --other-flag --resumeXYZ", null],
    ["claude --other-flag", null],
  ])("%s から %s を抽出する", (commandLine, expected) => {
    expect(extractResumeId(commandLine)).toBe(expected);
  });

  it("null 入力は null を返す", () => {
    expect(extractResumeId(null)).toBeNull();
  });

  it("--resume の後に何も無い場合は null を返す", () => {
    expect(extractResumeId("claude --resume")).toBeNull();
    expect(extractResumeId("claude --resume ")).toBeNull();
  });

  it("値が - で始まる場合は null を返す（次のフラグを値として拾わない）", () => {
    expect(extractResumeId("claude --resume --model x")).toBeNull();
  });
});
