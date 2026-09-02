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
    expect(result.warnings[0]).toContain("1");
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
