import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  matchRunning,
  PROC_START_TOLERANCE_TICKS,
  type RunningMeta,
  readRunningMeta,
} from "../../../src/server/sources/claude/running";
import type { ProcessInfo } from "../../../src/server/sources/process/list";

// T-010: readRunningMeta / matchRunning の受け入れ条件を検証する。
// フィクスチャは os.tmpdir() 配下に合成データで作る。実ログ・実パス・ホスト名・実 pid は使わない。
// UUID は "00000000-0000-4000-8000-00000000000N" のような合成値のみ使う。

const SID1 = "00000000-0000-4000-8000-000000000001";
const SID2 = "00000000-0000-4000-8000-000000000002";
const SID3 = "00000000-0000-4000-8000-000000000003";
const SID4 = "00000000-0000-4000-8000-000000000004";

async function makeRoot(prefix: string): Promise<{ root: string; sessionsDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const sessionsDir = path.join(root, "sessions");
  await mkdir(sessionsDir, { recursive: true });
  return { root, sessionsDir };
}

async function writeMeta(sessionsDir: string, fileName: string, body: unknown): Promise<void> {
  await writeFile(path.join(sessionsDir, fileName), JSON.stringify(body), "utf8");
}

/** メタファイルの想定サイズ上限（実装の MAX_META_FILE_BYTES と同値）。256 KiB。 */
const MAX_META_FILE_BYTES = 256 * 1024;

/**
 * ちょうど `targetBytes` バイト（UTF-8）になる、それ以外は妥当な RunningMeta JSON 文字列を作る。
 * `padding` フィールドは既知フィールドではないため結果には反映されず、サイズ調整だけに使う。
 */
function buildMetaContentOfSize(pid: number, sessionId: string, targetBytes: number): string {
  const base = {
    pid,
    sessionId,
    cwd: "C:\\synthetic\\x",
    startedAt: 1,
    procStart: 1,
    padding: "",
  };
  const baseBytes = Buffer.byteLength(JSON.stringify(base), "utf8");
  if (baseBytes > targetBytes) {
    throw new Error("targetBytes が小さすぎます");
  }
  const padded = { ...base, padding: "x".repeat(targetBytes - baseBytes) };
  const content = JSON.stringify(padded);
  if (Buffer.byteLength(content, "utf8") !== targetBytes) {
    throw new Error("パディング調整に失敗しました");
  }
  return content;
}

describe("readRunningMeta: 正常系", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it("sessions/*.json を読み、型ガードを通った RunningMeta 配列を返す。sessionId は小文字化。entrypoint の cli/claude-desktop/other/欠落はそれぞれ維持・維持・unknown・unknown。version 欠落は null。余計なフィールドは結果に含まれない", async () => {
    const created = await makeRoot("ai-manager-claude-running-basic-");
    root = created.root;
    const { sessionsDir } = created;

    await writeMeta(sessionsDir, "1001.json", {
      pid: 1001,
      sessionId: SID1.toUpperCase(),
      cwd: "C:\\synthetic\\project-a",
      startedAt: 1700000000000,
      procStart: 133000000000000000,
      entrypoint: "cli",
      version: "1.2.3",
      messagingSocketPath: "\\\\.\\pipe\\synthetic",
      peerFeatures: ["x"],
    });
    await writeMeta(sessionsDir, "1002.json", {
      pid: 1002,
      sessionId: SID2,
      cwd: "C:\\synthetic\\project-b",
      startedAt: 1700000001000,
      procStart: 133000000001000000,
      entrypoint: "claude-desktop",
    });
    await writeMeta(sessionsDir, "1003.json", {
      pid: 1003,
      sessionId: SID3,
      cwd: "C:\\synthetic\\project-c",
      startedAt: 1700000002000,
      procStart: 133000000002000000,
      entrypoint: "other",
    });
    await writeMeta(sessionsDir, "1004.json", {
      pid: 1004,
      sessionId: SID4,
      cwd: "C:\\synthetic\\project-d",
      startedAt: 1700000003000,
      procStart: 133000000003000000,
    });

    const result = await readRunningMeta(root);

    expect(result.warnings).toEqual([]);
    expect(result.metas).toHaveLength(4);

    const byPid = new Map(result.metas.map((m) => [m.pid, m]));
    expect(byPid.get(1001)).toEqual({
      pid: 1001,
      sessionId: SID1,
      cwd: "C:\\synthetic\\project-a",
      startedAt: 1700000000000,
      procStart: 133000000000000000,
      entrypoint: "cli",
      version: "1.2.3",
    });
    expect(byPid.get(1002)?.entrypoint).toBe("claude-desktop");
    expect(byPid.get(1003)?.entrypoint).toBe("unknown");
    expect(byPid.get(1004)?.entrypoint).toBe("unknown");
    expect(byPid.get(1004)?.version).toBeNull();
  });
});

describe("readRunningMeta: .key ファイルを開かない", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  // 注: この環境の vitest では、running.ts が `readFile` を名前付きインポートしているため
  // `vi.spyOn(fsPromises, "readFile")` は
  // "Cannot redefine property: readFile"（TypeError: Module namespace is not configurable in ESM）
  // で失敗する（同じ関数を名前付きインポートしていない locator.ts 相手の spyOn は成功することを
  // 個別に確認済み＝環境固有の制約であり実装の問題ではない）。
  // そのため受け入れ条件が示すもう一つの確認方法を使う: `.key` の中身を壊れた JSON にしておき、
  // 読まれていれば増えるはずの警告件数が増えないことで「開かれていない」ことを確認する。
  it("<pid>.key / <pid>.abc.key は無視される（中身を壊れた JSON にしても警告件数が増えないことで、開かれていないことを確認する）", async () => {
    const created = await makeRoot("ai-manager-claude-running-key-");
    root = created.root;
    const { sessionsDir } = created;

    await writeMeta(sessionsDir, "2001.json", {
      pid: 2001,
      sessionId: SID1,
      cwd: "C:\\synthetic\\x",
      startedAt: 1,
      procStart: 1,
    });
    await writeFile(path.join(sessionsDir, "2001.key"), "not valid key content {{{", "utf8");
    await writeFile(path.join(sessionsDir, "2001.abc.key"), "also not valid {{{", "utf8");

    const result = await readRunningMeta(root);

    expect(result.metas).toHaveLength(1);
    expect(result.metas[0]?.pid).toBe(2001);
    expect(result.warnings).toEqual([]);
  });
});

describe("readRunningMeta: 異常系の集計", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it("壊れた JSON・pid 欠落・pid 不一致・sessionId が UUID でない・procStart 欠落はスキップされ、集計警告 1 件（件数入り）になる。正常なものは残る", async () => {
    const created = await makeRoot("ai-manager-claude-running-invalid-");
    root = created.root;
    const { sessionsDir } = created;

    await writeFile(path.join(sessionsDir, "3001.json"), "{ not valid json ,,,", "utf8");
    await writeMeta(sessionsDir, "3002.json", {
      // pid 欠落
      sessionId: SID1,
      cwd: "C:\\synthetic\\x",
      startedAt: 1,
      procStart: 1,
    });
    await writeMeta(sessionsDir, "3003.json", {
      // ファイル名(3003)と pid(9999)が不一致
      pid: 9999,
      sessionId: SID1,
      cwd: "C:\\synthetic\\x",
      startedAt: 1,
      procStart: 1,
    });
    await writeMeta(sessionsDir, "3004.json", {
      pid: 3004,
      sessionId: "not-a-uuid",
      cwd: "C:\\synthetic\\x",
      startedAt: 1,
      procStart: 1,
    });
    await writeMeta(sessionsDir, "3005.json", {
      pid: 3005,
      sessionId: SID2,
      cwd: "C:\\synthetic\\x",
      startedAt: 1,
      // procStart 欠落
    });
    await writeMeta(sessionsDir, "3006.json", {
      pid: 3006,
      sessionId: SID3,
      cwd: "C:\\synthetic\\x",
      startedAt: 1,
      procStart: 1,
    });

    const result = await readRunningMeta(root);

    expect(result.metas).toHaveLength(1);
    expect(result.metas[0]?.pid).toBe(3006);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("5");
  });

  it("256 KiB 超のメタファイルは読まずスキップし、警告に数える", async () => {
    const created = await makeRoot("ai-manager-claude-running-huge-");
    root = created.root;
    const { sessionsDir } = created;

    const bigPadding = "x".repeat(300 * 1024);
    await writeMeta(sessionsDir, "5001.json", {
      pid: 5001,
      sessionId: SID1,
      cwd: "C:\\synthetic\\x",
      startedAt: 1,
      procStart: 1,
      padding: bigPadding,
    });
    await writeMeta(sessionsDir, "5002.json", {
      pid: 5002,
      sessionId: SID2,
      cwd: "C:\\synthetic\\x",
      startedAt: 1,
      procStart: 1,
    });

    const result = await readRunningMeta(root);

    expect(result.metas).toHaveLength(1);
    expect(result.metas[0]?.pid).toBe(5002);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("1 件");
  });

  it("256 KiB ちょうどのメタファイルは読める（境界値）", async () => {
    const created = await makeRoot("ai-manager-claude-running-boundary-eq-");
    root = created.root;
    const { sessionsDir } = created;

    const content = buildMetaContentOfSize(6001, SID1, MAX_META_FILE_BYTES);
    expect(Buffer.byteLength(content, "utf8")).toBe(MAX_META_FILE_BYTES);
    await writeFile(path.join(sessionsDir, "6001.json"), content, "utf8");

    const result = await readRunningMeta(root);

    expect(result.warnings).toEqual([]);
    expect(result.metas).toHaveLength(1);
    expect(result.metas[0]?.pid).toBe(6001);
  });

  it("256 KiB + 1 バイトのメタファイルはスキップされ警告になる（境界値）", async () => {
    const created = await makeRoot("ai-manager-claude-running-boundary-over-");
    root = created.root;
    const { sessionsDir } = created;

    const content = buildMetaContentOfSize(6002, SID1, MAX_META_FILE_BYTES + 1);
    expect(Buffer.byteLength(content, "utf8")).toBe(MAX_META_FILE_BYTES + 1);
    await writeFile(path.join(sessionsDir, "6002.json"), content, "utf8");

    const result = await readRunningMeta(root);

    expect(result.metas).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});

describe("readRunningMeta: 無視すべきファイル名・エントリ", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it("notes.json（数字でない名前）、123.json.bak、ディレクトリ 456.json/ は無視され警告も増えない", async () => {
    const created = await makeRoot("ai-manager-claude-running-ignore-");
    root = created.root;
    const { sessionsDir } = created;

    await writeMeta(sessionsDir, "4001.json", {
      pid: 4001,
      sessionId: SID1,
      cwd: "C:\\synthetic\\x",
      startedAt: 1,
      procStart: 1,
    });
    await writeFile(path.join(sessionsDir, "notes.json"), "not read anyway", "utf8");
    await writeFile(path.join(sessionsDir, "123.json.bak"), "not read anyway", "utf8");
    await mkdir(path.join(sessionsDir, "456.json"), { recursive: true });

    const result = await readRunningMeta(root);

    expect(result.metas).toHaveLength(1);
    expect(result.metas[0]?.pid).toBe(4001);
    expect(result.warnings).toEqual([]);
  });
});

describe("readRunningMeta: sessions 無し・root 相対パス", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it("sessions/ ディレクトリが無ければ metas: [] + 警告 1 件", async () => {
    root = await mkdtemp(path.join(tmpdir(), "ai-manager-claude-running-nosessions-"));

    const result = await readRunningMeta(root);

    expect(result.metas).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("root が絶対パスでなければ空 + 警告", async () => {
    const result = await readRunningMeta("relative\\path\\to\\root");

    expect(result.metas).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});

describe("matchRunning", () => {
  const baseMeta: RunningMeta = {
    pid: 100,
    sessionId: SID1,
    cwd: "C:\\synthetic\\project",
    startedAt: 0,
    procStart: 1_000_000_000,
    entrypoint: "cli",
    version: null,
  };

  it("pid 不一致 → alive:false", () => {
    const processes: ProcessInfo[] = [
      { pid: 999, name: "claude.exe", creationFileTime: 1_000_000_000, commandLine: null },
    ];

    const result = matchRunning(baseMeta, processes);

    expect(result).toEqual({ alive: false, procStartMatches: false, process: null });
  });

  it("pid 一致・procStart 差 0 → alive:true, procStartMatches:true", () => {
    const proc: ProcessInfo = {
      pid: 100,
      name: "claude.exe",
      creationFileTime: baseMeta.procStart,
      commandLine: null,
    };

    const result = matchRunning(baseMeta, [proc]);

    expect(result.alive).toBe(true);
    expect(result.procStartMatches).toBe(true);
    expect(result.process).toEqual(proc);
  });

  it(`procStart の差が PROC_START_TOLERANCE_TICKS（${PROC_START_TOLERANCE_TICKS}）ちょうど → true`, () => {
    const proc: ProcessInfo = {
      pid: 100,
      name: "claude.exe",
      creationFileTime: baseMeta.procStart + PROC_START_TOLERANCE_TICKS,
      commandLine: null,
    };

    expect(matchRunning(baseMeta, [proc]).procStartMatches).toBe(true);
  });

  it("procStart の差が PROC_START_TOLERANCE_TICKS + 1 → false", () => {
    const proc: ProcessInfo = {
      pid: 100,
      name: "claude.exe",
      creationFileTime: baseMeta.procStart + PROC_START_TOLERANCE_TICKS + 1,
      commandLine: null,
    };

    expect(matchRunning(baseMeta, [proc]).procStartMatches).toBe(false);
  });

  it("creationFileTime が null → alive:true, procStartMatches:false", () => {
    const proc: ProcessInfo = {
      pid: 100,
      name: "claude.exe",
      creationFileTime: null,
      commandLine: null,
    };

    const result = matchRunning(baseMeta, [proc]);

    expect(result.alive).toBe(true);
    expect(result.procStartMatches).toBe(false);
    expect(result.process).toEqual(proc);
  });
});

// T-027: procStart（Windows FILETIME）は 2^53 を超えるため実機では数字の文字列で書かれる。
// readRunningMeta が数値・数字文字列のどちらも受け付け、それ以外は不正として警告に数えることを確認する。
describe("readRunningMeta: procStart が数値・数字文字列のどちらでも読める", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it("procStart が数字だけの文字列（2^53 超）でも読み込め、procStart は数値として返り警告なし", async () => {
    const created = await makeRoot("ai-manager-claude-running-procstart-string-");
    root = created.root;
    const { sessionsDir } = created;

    await writeMeta(sessionsDir, "8001.json", {
      pid: 8001,
      sessionId: SID1,
      cwd: "C:\\synthetic\\project",
      startedAt: 1700000000000,
      procStart: "134000000000000000",
    });

    const result = await readRunningMeta(root);

    expect(result.warnings).toEqual([]);
    expect(result.metas).toHaveLength(1);
    expect(result.metas[0]?.procStart).toBe(134000000000000000);
    expect(typeof result.metas[0]?.procStart).toBe("number");
  });

  it("procStart が数値（従来型）の場合も引き続き読み込める", async () => {
    const created = await makeRoot("ai-manager-claude-running-procstart-number-");
    root = created.root;
    const { sessionsDir } = created;

    await writeMeta(sessionsDir, "8002.json", {
      pid: 8002,
      sessionId: SID1,
      cwd: "C:\\synthetic\\project",
      startedAt: 1700000000000,
      procStart: 134000000000000000,
    });

    const result = await readRunningMeta(root);

    expect(result.warnings).toEqual([]);
    expect(result.metas).toHaveLength(1);
    expect(result.metas[0]?.procStart).toBe(134000000000000000);
  });

  it("数値の procStart と文字列の procStart が混在する 2 ファイルは両方読める", async () => {
    const created = await makeRoot("ai-manager-claude-running-procstart-mixed-");
    root = created.root;
    const { sessionsDir } = created;

    await writeMeta(sessionsDir, "8003.json", {
      pid: 8003,
      sessionId: SID1,
      cwd: "C:\\synthetic\\project",
      startedAt: 1700000000000,
      procStart: 134000000003000000,
    });
    await writeMeta(sessionsDir, "8004.json", {
      pid: 8004,
      sessionId: SID1,
      cwd: "C:\\synthetic\\project",
      startedAt: 1700000000000,
      procStart: "134000000004000000",
    });

    const result = await readRunningMeta(root);

    expect(result.warnings).toEqual([]);
    expect(result.metas).toHaveLength(2);

    const byPid = new Map(result.metas.map((m) => [m.pid, m]));
    expect(byPid.get(8003)?.procStart).toBe(134000000003000000);
    expect(byPid.get(8004)?.procStart).toBe(134000000004000000);
  });
});

describe("readRunningMeta: procStart が不正な値はスキップされ警告に数えられる", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  const invalidProcStartCases: Array<[string, unknown, number]> = [
    ["空文字列", "", 9001],
    ["0x 付き16進風文字列", "0x10", 9002],
    ["数字とアルファベット混在", "12a", 9003],
    ["負数の文字列", "-5", 9004],
    ["null", null, 9005],
    ["オブジェクト", {}, 9006],
    // reviewer Round 1 指摘: 指数表記は数字だけの文字列（/^[0-9]+$/）にマッチしないため不正。
    ["指数表記の文字列", "1e5", 9007],
    // reviewer Round 1 指摘: 数字だけの文字列だが桁あふれし Number() が Infinity を返すため不正。
    ["桁あふれする数字文字列", "9".repeat(400), 9008],
  ];

  it.each(invalidProcStartCases)(
    "procStart が%s（%o）の場合はスキップされ警告 1 件に数えられる",
    async (_label, invalidValue, pid) => {
      const created = await makeRoot(`ai-manager-claude-running-procstart-invalid-${pid}-`);
      root = created.root;
      const { sessionsDir } = created;

      await writeMeta(sessionsDir, `${pid}.json`, {
        pid,
        sessionId: SID1,
        cwd: "C:\\synthetic\\project",
        startedAt: 1700000000000,
        procStart: invalidValue,
      });

      const result = await readRunningMeta(root);

      expect(result.metas).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("1 件");
    },
  );
});

describe("matchRunning: 文字列由来の procStart でも 1 秒の許容差で一致判定する", () => {
  const baseMetaFromString: RunningMeta = {
    pid: 100,
    sessionId: SID1,
    cwd: "C:\\synthetic\\project",
    startedAt: 0,
    // parseFileTime("134000000000000000") で得られる数値と同じ値。
    procStart: 134000000000000000,
    entrypoint: "cli",
    version: null,
  };

  it("文字列由来の procStart に対し creationFileTime が +0.5 秒差 → procStartMatches:true", () => {
    const proc: ProcessInfo = {
      pid: 100,
      name: "claude.exe",
      creationFileTime: 134000000005000000,
      commandLine: null,
    };

    const result = matchRunning(baseMetaFromString, [proc]);

    expect(result.alive).toBe(true);
    expect(result.procStartMatches).toBe(true);
  });

  it("文字列由来の procStart に対し creationFileTime が +2 秒差 → procStartMatches:false", () => {
    const proc: ProcessInfo = {
      pid: 100,
      name: "claude.exe",
      creationFileTime: 134000000020000000,
      commandLine: null,
    };

    const result = matchRunning(baseMetaFromString, [proc]);

    expect(result.alive).toBe(true);
    expect(result.procStartMatches).toBe(false);
  });
});

// reviewer Round 1 指摘: readRunningMeta が返した RunningMeta（procStart は文字列由来）を
// そのまま matchRunning に渡す合成経路（回帰テスト）。procStart を「数字文字列」で書く際、
// 2^53 を超える奇数値（Number() で丸めが起きる値）を使い、丸め後の値を基準に
// ±0.5 秒 / ±2 秒で許容差の境界が機能することを確認する。
describe("readRunningMeta → matchRunning の合成経路（回帰）", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it("procStart が文字列で書かれた（2^53 超・丸めが起きる奇数値）メタを readRunningMeta で読み、matchRunning に渡すと、+0.5 秒差は procStartMatches:true、+2 秒差は false になる", async () => {
    const created = await makeRoot("ai-manager-claude-running-composed-");
    root = created.root;
    const { sessionsDir } = created;

    await writeMeta(sessionsDir, "8101.json", {
      pid: 8101,
      sessionId: SID1,
      cwd: "C:\\synthetic\\project",
      startedAt: 1700000000000,
      // 2^53 を超え、Number() で丸めが起きる奇数値。実機の procStart 相当。
      procStart: "134328283107540222",
    });

    const result = await readRunningMeta(root);

    expect(result.warnings).toEqual([]);
    expect(result.metas).toHaveLength(1);
    const meta = result.metas[0];
    expect(meta).toBeDefined();
    if (meta === undefined) {
      throw new Error("meta が undefined です");
    }
    expect(typeof meta.procStart).toBe("number");

    const nearProc: ProcessInfo = {
      pid: 8101,
      name: "claude.exe",
      creationFileTime: meta.procStart + 5_000_000,
      commandLine: null,
    };
    const nearResult = matchRunning(meta, [nearProc]);
    expect(nearResult.alive).toBe(true);
    expect(nearResult.procStartMatches).toBe(true);

    const farProc: ProcessInfo = {
      pid: 8101,
      name: "claude.exe",
      creationFileTime: meta.procStart + 20_000_000,
      commandLine: null,
    };
    const farResult = matchRunning(meta, [farProc]);
    expect(farResult.alive).toBe(true);
    expect(farResult.procStartMatches).toBe(false);
  });
});
