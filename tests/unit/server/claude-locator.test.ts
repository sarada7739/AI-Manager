import { lstat, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_SESSION_ID_PATTERN,
  locateClaudeSessions,
} from "../../../src/server/sources/claude/locator";

// vitest の ESM 制約により、モジュール名前空間には直接 vi.spyOn できない。
// readFile / open だけ vi.fn でラップし、それ以外（lstat / readdir 等）は実体をそのまま使う。
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    open: vi.fn(actual.open),
  };
});

// T-008: locateClaudeSessions の受け入れ条件を検証する。
// フィクスチャは os.tmpdir() 配下に合成データで作る。実ログ・実パス・ホスト名は使わない。
// UUID は "00000000-0000-4000-8000-00000000000N" のような明らかな合成値のみ使う。

const ID1 = "00000000-0000-4000-8000-000000000001"; // 付随ファイルすべてあり
const ID2 = "00000000-0000-4000-8000-000000000002"; // 大文字ファイル名・付随ファイルなし
const ID3 = "00000000-0000-4000-8000-000000000003"; // custom-title.json がディレクトリ
const ID4 = "00000000-0000-4000-8000-000000000004"; // tool-results/ 配下（無視される）
const ID5 = "00000000-0000-4000-8000-000000000005"; // projects/ 直下（無視される）

const DUMMY_JSONL = '{"type":"user"}\n{"type":"assistant"}\n';

async function writeDummyJsonl(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, DUMMY_JSONL);
}

describe("CLAUDE_SESSION_ID_PATTERN", () => {
  it("小文字・大文字どちらの UUID にもマッチする", () => {
    expect(CLAUDE_SESSION_ID_PATTERN.test(ID1)).toBe(true);
    expect(CLAUDE_SESSION_ID_PATTERN.test(ID1.toUpperCase())).toBe(true);
  });

  it("UUID でない文字列にはマッチしない", () => {
    expect(CLAUDE_SESSION_ID_PATTERN.test("notes")).toBe(false);
    expect(CLAUDE_SESSION_ID_PATTERN.test(`${ID1}x`)).toBe(false);
  });
});

describe("locateClaudeSessions: 正常系・無視ケース（メインフィクスチャ）", () => {
  let root: string;
  let dirA: string;
  let dirB: string;
  let dirC: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ai-manager-claude-locator-"));
    const projectsDir = path.join(root, "projects");
    dirA = path.join(projectsDir, "dir-a");
    dirB = path.join(projectsDir, "dir-b");
    dirC = path.join(projectsDir, "dir-c");
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });
    await mkdir(dirC, { recursive: true }); // 空ディレクトリ

    // ID1: 付随ファイルすべてあり（custom-title.json, desktop-released.json, subagents 3件 + meta 2件）
    await writeDummyJsonl(path.join(dirA, `${ID1}.jsonl`));
    await mkdir(path.join(dirA, ID1, "subagents"), { recursive: true });
    await writeFile(path.join(dirA, ID1, "custom-title.json"), "{}");
    await writeFile(path.join(dirA, `${ID1}.desktop-released.json`), "{}");
    await writeFile(path.join(dirA, ID1, "subagents", "agent-1.jsonl"), DUMMY_JSONL);
    await writeFile(path.join(dirA, ID1, "subagents", "agent-2.jsonl"), DUMMY_JSONL);
    await writeFile(path.join(dirA, ID1, "subagents", "agent-3.jsonl"), DUMMY_JSONL);
    await writeFile(path.join(dirA, ID1, "subagents", "agent-x.meta.json"), "{}");
    await writeFile(path.join(dirA, ID1, "subagents", "agent-y.meta.json"), "{}");

    // ID3: custom-title.json がディレクトリ（ファイルではない） → hasCustomTitleFile: false
    await writeDummyJsonl(path.join(dirA, `${ID3}.jsonl`));
    await mkdir(path.join(dirA, ID3, "custom-title.json"), { recursive: true });

    // 無視されるべきファイル群（dir-a 直下）
    await mkdir(path.join(dirA, "memory"), { recursive: true });
    await writeFile(path.join(dirA, "memory", "x.md"), "# memo");
    await mkdir(path.join(dirA, "tool-results"), { recursive: true });
    await writeDummyJsonl(path.join(dirA, "tool-results", `${ID4}.jsonl`));
    await writeFile(path.join(dirA, "notes.jsonl"), DUMMY_JSONL);
    await writeFile(path.join(dirA, "abc.jsonl"), DUMMY_JSONL);
    await writeFile(path.join(dirA, `${ID1}x.jsonl`), DUMMY_JSONL); // UUID + 余計な文字
    await writeFile(path.join(dirA, `${ID1}.json`), "{}");
    await writeFile(path.join(dirA, `${ID1}.txt`), "text");
    await writeFile(path.join(dirA, "settings.json"), "{}");
    await writeFile(path.join(dirA, "auth.json"), "{}");
    await writeFile(path.join(dirA, "x.key"), "secret");
    await writeFile(path.join(dirA, ".credentials.json"), "{}");

    // ID2: 大文字ファイル名・付随ファイルなし
    await writeDummyJsonl(path.join(dirB, `${ID2.toUpperCase()}.JSONL`));

    // projects/ 直下（<dir> を経由しない）→ 無視される
    await writeDummyJsonl(path.join(projectsDir, `${ID5}.jsonl`));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("複数 <dir> × 複数セッションを列挙し、size / mtime が fs.stat の値と一致する", async () => {
    const result = await locateClaudeSessions(root);
    expect(result.warnings).toEqual([]);

    const session1 = result.sessions.find((s) => s.id === ID1);
    expect(session1).toBeDefined();
    if (session1 === undefined) return;

    const stat = await lstat(path.join(dirA, `${ID1}.jsonl`));
    expect(session1.sizeBytes).toBe(stat.size);
    expect(session1.mtime).toBe(stat.mtimeMs);
    expect(session1.projectDir).toBe(dirA);
    expect(session1.jsonlPath).toBe(path.join(dirA, `${ID1}.jsonl`));
  });

  it("付随ファイルあり: custom-title.json, desktop-released.json, subagents 3件（meta.json は数えない）", async () => {
    const result = await locateClaudeSessions(root);
    const session1 = result.sessions.find((s) => s.id === ID1);
    expect(session1).toBeDefined();
    expect(session1?.hasCustomTitleFile).toBe(true);
    expect(session1?.released).toBe(true);
    expect(session1?.subagentCount).toBe(3);
  });

  it("付随ファイルなし: hasCustomTitleFile / released が false、subagentCount が 0", async () => {
    const result = await locateClaudeSessions(root);
    const session2 = result.sessions.find((s) => s.id === ID2);
    expect(session2).toBeDefined();
    expect(session2?.hasCustomTitleFile).toBe(false);
    expect(session2?.released).toBe(false);
    expect(session2?.subagentCount).toBe(0);
  });

  it("大文字 UUID のファイル名でも列挙され、id は小文字化される", async () => {
    const result = await locateClaudeSessions(root);
    const session2 = result.sessions.find((s) => s.id === ID2);
    expect(session2).toBeDefined();
    expect(session2?.id).toBe(ID2.toLowerCase());
    // ファイルパス自体は元の大文字ファイル名のまま
    expect(session2?.jsonlPath.endsWith(`${ID2.toUpperCase()}.JSONL`)).toBe(true);
  });

  it("custom-title.json がディレクトリの場合は hasCustomTitleFile: false", async () => {
    const result = await locateClaudeSessions(root);
    const session3 = result.sessions.find((s) => s.id === ID3);
    expect(session3).toBeDefined();
    expect(session3?.hasCustomTitleFile).toBe(false);
    expect(session3?.released).toBe(false);
    expect(session3?.subagentCount).toBe(0);
  });

  it("UUID でない .jsonl（notes.jsonl, abc.jsonl, UUID+余計な文字）は列挙されない", async () => {
    const result = await locateClaudeSessions(root);
    const paths = result.sessions.map((s) => s.jsonlPath);
    expect(paths).not.toContain(path.join(dirA, "notes.jsonl"));
    expect(paths).not.toContain(path.join(dirA, "abc.jsonl"));
    expect(paths).not.toContain(path.join(dirA, `${ID1}x.jsonl`));
  });

  it(".json / .txt 拡張子のファイルは列挙されない", async () => {
    const result = await locateClaudeSessions(root);
    const paths = result.sessions.map((s) => s.jsonlPath);
    expect(paths).not.toContain(path.join(dirA, `${ID1}.json`));
    expect(paths).not.toContain(path.join(dirA, `${ID1}.txt`));
  });

  it("memory/ 配下は辿らない（memory/x.md はもちろん対象外）", async () => {
    const result = await locateClaudeSessions(root);
    const paths = result.sessions.map((s) => s.jsonlPath);
    expect(paths.some((p) => p.includes("memory"))).toBe(false);
  });

  it("tool-results/ 配下は辿らない（tool-results/<uuid>.jsonl は列挙されない）", async () => {
    const result = await locateClaudeSessions(root);
    const paths = result.sessions.map((s) => s.jsonlPath);
    expect(paths.some((p) => p.includes("tool-results"))).toBe(false);
    expect(result.sessions.find((s) => s.id === ID4)).toBeUndefined();
  });

  it("<sessionId>/subagents/agent-*.jsonl は本体セッションとして列挙されない", async () => {
    const result = await locateClaudeSessions(root);
    const paths = result.sessions.map((s) => s.jsonlPath);
    expect(paths.some((p) => p.includes("subagents"))).toBe(false);
  });

  it("projects/ 直下に置いた <uuid>.jsonl は列挙されない（<dir> を経由する必要がある）", async () => {
    const result = await locateClaudeSessions(root);
    expect(result.sessions.find((s) => s.id === ID5)).toBeUndefined();
  });

  it("除外ファイル（settings.json / auth.json / x.key / .credentials.json）は sessions に含まれない", async () => {
    const result = await locateClaudeSessions(root);
    const paths = result.sessions.map((s) => s.jsonlPath);
    expect(paths).not.toContain(path.join(dirA, "settings.json"));
    expect(paths).not.toContain(path.join(dirA, "auth.json"));
    expect(paths).not.toContain(path.join(dirA, "x.key"));
    expect(paths).not.toContain(path.join(dirA, ".credentials.json"));
  });

  it("返すパスはすべて isUnderRoot(path, [root]) を通る（root 配下であること）", async () => {
    const result = await locateClaudeSessions(root);
    expect(result.sessions.length).toBeGreaterThan(0);
    for (const session of result.sessions) {
      const resolved = path.resolve(session.jsonlPath).toLowerCase();
      const resolvedRoot = path.resolve(root).toLowerCase();
      expect(resolved.startsWith(`${resolvedRoot}${path.sep}`)).toBe(true);
    }
  });

  it("<dir> が空の場合はそのディレクトリからセッションが列挙されない（dir-c）", async () => {
    const result = await locateClaudeSessions(root);
    expect(result.sessions.some((s) => s.projectDir === dirC)).toBe(false);
  });

  it("jsonlPath の昇順（大文字小文字無視）でソートされて返る", async () => {
    const result = await locateClaudeSessions(root);
    const actual = result.sessions.map((s) => s.jsonlPath);
    const expected = [...actual].sort((a, b) => {
      const left = a.toLowerCase();
      const right = b.toLowerCase();
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    expect(actual).toEqual(expected);
    // 単調な並びであることを保証するため要素数も確認する
    expect(actual.length).toBeGreaterThanOrEqual(3);
  });
});

describe("locateClaudeSessions: 本文を読まない", () => {
  let root: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("readFile / open を一度も呼ばない", async () => {
    root = await mkdtemp(path.join(tmpdir(), "ai-manager-claude-locator-noread-"));
    const dir = path.join(root, "projects", "dir-a");
    await mkdir(dir, { recursive: true });
    await writeDummyJsonl(path.join(dir, `${ID1}.jsonl`));

    vi.mocked(readFile).mockClear();
    vi.mocked(open).mockClear();

    const result = await locateClaudeSessions(root);

    expect(result.sessions.length).toBe(1);
    expect(readFile).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("JSONL の中身が壊れていても結果に影響しない（本文を解釈しないことの代替確認）", async () => {
    root = await mkdtemp(path.join(tmpdir(), "ai-manager-claude-locator-corrupt-"));
    const dir = path.join(root, "projects", "dir-a");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${ID1}.jsonl`), "{not valid json at all\n\x00\x01garbage");

    const result = await locateClaudeSessions(root);
    expect(result.warnings).toEqual([]);
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0]?.id).toBe(ID1);
  });
});

describe("locateClaudeSessions: 空・異常系", () => {
  it("projects/ が空 → { sessions: [], warnings: [] }", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ai-manager-claude-locator-emptyprojects-"));
    try {
      await mkdir(path.join(root, "projects"), { recursive: true });
      const result = await locateClaudeSessions(root);
      expect(result).toEqual({ sessions: [], warnings: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("projects/ が無い → 空配列 + 警告 1 件、例外を投げない", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ai-manager-claude-locator-noprojects-"));
    try {
      const result = await locateClaudeSessions(root);
      expect(result.sessions).toEqual([]);
      expect(result.warnings.length).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("root 自体が存在しない → 空配列 + 警告、例外を投げない", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "ai-manager-claude-locator-base-"));
    try {
      const nonExistentRoot = path.join(base, "does-not-exist-root");
      const result = await locateClaudeSessions(nonExistentRoot);
      expect(result.sessions).toEqual([]);
      expect(result.warnings.length).toBe(1);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("root が相対パス → 空配列 + 警告、例外を投げない", async () => {
    const result = await locateClaudeSessions("relative/path/to/root");
    expect(result.sessions).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("警告文言に実パス・一時ディレクトリのパスを含めない", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ai-manager-claude-locator-warnpath-"));
    try {
      const result = await locateClaudeSessions(root);
      for (const warning of result.warnings) {
        expect(warning).not.toContain(root);
      }
      const relativeResult = await locateClaudeSessions("relative/path/to/root");
      for (const warning of relativeResult.warnings) {
        expect(warning).not.toContain("relative/path/to/root");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
