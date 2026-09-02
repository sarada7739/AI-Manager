import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  CODEX_ROLLOUT_FILE_PATTERN,
  locateCodexSessions,
} from "../../../src/server/sources/codex/locator";

// vitest の ESM 制約により、モジュール名前空間には直接 vi.spyOn できない。
// readFile / open だけ vi.fn でラップし、それ以外（readdir / stat 等）は実体をそのまま使う。
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    open: vi.fn(actual.open),
  };
});

// T-011: locateCodexSessions の受け入れ条件を検証する。
// フィクスチャは os.tmpdir() 配下に合成データで作る。実ログ・実パス・ホスト名は使わない。
// UUID は "00000000-0000-4000-8000-00000000000N" のような明らかな合成値のみ使う。

const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const ID3 = "00000000-0000-4000-8000-000000000003";
const ID4 = "00000000-0000-4000-8000-000000000004";
const ID5 = "00000000-0000-4000-8000-000000000005";

const DUMMY_JSONL = '{"timestamp":"2026-08-29T10:11:12Z","type":"session_meta","payload":{}}\n';

async function writeDummyJsonl(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, DUMMY_JSONL);
}

describe("CODEX_ROLLOUT_FILE_PATTERN", () => {
  it("rollout-<任意>-<uuid>.jsonl にマッチし、キャプチャグループ 1 が threadId", () => {
    const match = CODEX_ROLLOUT_FILE_PATTERN.exec(`rollout-2026-08-29T10-11-12-${ID1}.jsonl`);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(ID1);
  });

  it("大文字 UUID にもマッチする", () => {
    const match = CODEX_ROLLOUT_FILE_PATTERN.exec(
      `rollout-2026-08-29T10-11-12-${ID1.toUpperCase()}.jsonl`,
    );
    expect(match).not.toBeNull();
  });

  it("UUID を含まない rollout-x.jsonl にはマッチしない", () => {
    expect(CODEX_ROLLOUT_FILE_PATTERN.test("rollout-x.jsonl")).toBe(false);
  });

  it("拡張子が .jsonl でない rollout-<uuid>.txt にはマッチしない", () => {
    expect(CODEX_ROLLOUT_FILE_PATTERN.test(`rollout-2026-08-29-${ID1}.txt`)).toBe(false);
  });

  it("rollout- で始まらない notes-<uuid>.jsonl にはマッチしない", () => {
    expect(CODEX_ROLLOUT_FILE_PATTERN.test(`notes-${ID1}.jsonl`)).toBe(false);
  });
});

describe("locateCodexSessions: 正常系・無視ケース（メインフィクスチャ）", () => {
  let root: string;

  const setupRoot = async (): Promise<string> => {
    const r = await mkdtemp(path.join(tmpdir(), "ai-manager-codex-locator-"));
    const sessionsDir = path.join(r, "sessions");

    // 正常: 複数日・複数件
    await writeDummyJsonl(
      path.join(sessionsDir, "2026", "08", "29", `rollout-2026-08-29T10-11-12-${ID1}.jsonl`),
    );
    await writeDummyJsonl(
      path.join(sessionsDir, "2026", "08", "30", `rollout-2026-08-30T09-00-00-${ID2}.jsonl`),
    );
    // 大文字 UUID のファイル名
    await writeDummyJsonl(
      path.join(
        sessionsDir,
        "2026",
        "09",
        "01",
        `rollout-2026-09-01T00-00-00-${ID3.toUpperCase()}.jsonl`,
      ),
    );

    // 無視: UUID 無し
    await writeDummyJsonl(path.join(sessionsDir, "2026", "08", "29", "rollout-x.jsonl"));
    // 無視: 拡張子違い
    await writeDummyJsonl(
      path.join(sessionsDir, "2026", "08", "29", `rollout-2026-08-29T10-11-12-${ID1}.txt`),
    );
    // 無視: rollout- で始まらない
    await writeDummyJsonl(path.join(sessionsDir, "2026", "08", "29", `notes-${ID1}.jsonl`));
    // 無視: 階層不足（sessions/YYYY/MM/rollout-...jsonl）
    await writeDummyJsonl(
      path.join(sessionsDir, "2026", "08", `rollout-2026-08-01T00-00-00-${ID4}.jsonl`),
    );
    // 無視: 階層過多（sessions/YYYY/MM/DD/extra/rollout-...jsonl）
    await writeDummyJsonl(
      path.join(
        sessionsDir,
        "2026",
        "08",
        "29",
        "extra",
        `rollout-2026-08-29T00-00-00-${ID5}.jsonl`,
      ),
    );
    // 無視: YYYY が 4 桁の数字でない
    await writeDummyJsonl(
      path.join(sessionsDir, "abcd", "08", "29", `rollout-2026-08-29T00-00-00-${ID1}.jsonl`),
    );
    // 無視: MM が 1 桁
    await writeDummyJsonl(
      path.join(sessionsDir, "2026", "8", "29", `rollout-2026-08-29T00-00-00-${ID2}.jsonl`),
    );

    // 無視: root 直下の秘密情報・ロックファイル・DB（sessions/ を経由しない）
    await mkdir(path.join(r, "thread-writer-locks"), { recursive: true });
    await writeFile(path.join(r, "thread-writer-locks", `${ID1}.lock`), "lock");
    await writeFile(path.join(r, "auth.json"), "{}");
    await writeFile(path.join(r, "state_1.sqlite"), "binary");

    return r;
  };

  afterAll(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("複数日・複数件を列挙し、size / mtime が fs.stat の値と一致する", async () => {
    root = await setupRoot();
    const result = await locateCodexSessions(root);
    expect(result.warnings).toEqual([]);

    const session1 = result.sessions.find((s) => s.id === ID1);
    expect(session1).toBeDefined();
    if (session1 === undefined) return;

    const filePath = path.join(
      root,
      "sessions",
      "2026",
      "08",
      "29",
      `rollout-2026-08-29T10-11-12-${ID1}.jsonl`,
    );
    const fileStat = await stat(filePath);
    expect(session1.sizeBytes).toBe(fileStat.size);
    expect(session1.mtime).toBe(fileStat.mtimeMs);
    expect(session1.jsonlPath).toBe(filePath);

    const session2 = result.sessions.find((s) => s.id === ID2 && s.jsonlPath.includes("08-30"));
    expect(session2).toBeDefined();
  });

  it("大文字 UUID のファイル名でも列挙され、id は小文字化される", async () => {
    const result = await locateCodexSessions(root);
    const session3 = result.sessions.find((s) => s.jsonlPath.includes("2026-09-01"));
    expect(session3).toBeDefined();
    expect(session3?.id).toBe(ID3.toLowerCase());
  });

  it("UUID を含まない rollout-x.jsonl は列挙されない", async () => {
    const result = await locateCodexSessions(root);
    const paths = result.sessions.map((s) => s.jsonlPath);
    expect(paths.some((p) => p.endsWith("rollout-x.jsonl"))).toBe(false);
  });

  it("拡張子が .jsonl でないファイルは列挙されない", async () => {
    const result = await locateCodexSessions(root);
    const paths = result.sessions.map((s) => s.jsonlPath);
    expect(paths.some((p) => p.endsWith(".txt"))).toBe(false);
  });

  it("rollout- で始まらない notes-<uuid>.jsonl は列挙されない", async () => {
    const result = await locateCodexSessions(root);
    const paths = result.sessions.map((s) => s.jsonlPath);
    expect(paths.some((p) => p.includes("notes-"))).toBe(false);
  });

  it("階層不足（sessions/YYYY/MM/rollout-...jsonl）は列挙されない", async () => {
    const result = await locateCodexSessions(root);
    expect(result.sessions.find((s) => s.id === ID4)).toBeUndefined();
  });

  it("階層過多（sessions/YYYY/MM/DD/extra/rollout-...jsonl）は列挙されない", async () => {
    const result = await locateCodexSessions(root);
    expect(result.sessions.find((s) => s.id === ID5)).toBeUndefined();
  });

  it("YYYY が 4 桁の数字でない（abcd）ディレクトリには入らない", async () => {
    const result = await locateCodexSessions(root);
    const paths = result.sessions.map((s) => s.jsonlPath);
    expect(paths.some((p) => p.includes(`${path.sep}abcd${path.sep}`))).toBe(false);
  });

  it("MM が 1 桁（sessions/2026/8/29/...）のディレクトリには入らない", async () => {
    const result = await locateCodexSessions(root);
    const paths = result.sessions.map((s) => s.jsonlPath);
    expect(paths.some((p) => p.includes(`${path.sep}2026${path.sep}8${path.sep}`))).toBe(false);
  });

  it("root 直下の thread-writer-locks / auth.json / state_1.sqlite は sessions に含まれない", async () => {
    const result = await locateCodexSessions(root);
    const paths = result.sessions.map((s) => s.jsonlPath);
    expect(paths.some((p) => p.includes("thread-writer-locks"))).toBe(false);
    expect(paths.some((p) => p.endsWith("auth.json"))).toBe(false);
    expect(paths.some((p) => p.endsWith("state_1.sqlite"))).toBe(false);
  });

  it("jsonlPath の昇順（大文字小文字無視）でソートされて返る", async () => {
    const result = await locateCodexSessions(root);
    const actual = result.sessions.map((s) => s.jsonlPath);
    const expected = [...actual].sort((a, b) => {
      const left = a.toLowerCase();
      const right = b.toLowerCase();
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThanOrEqual(3);
  });
});

describe("locateCodexSessions: thread-writer-locks / 本文を読まない", () => {
  let root: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("thread-writer-locks・auth.json・state_1.sqlite があっても readFile / open が一度も呼ばれない", async () => {
    root = await mkdtemp(path.join(tmpdir(), "ai-manager-codex-locator-noread-"));
    await writeDummyJsonl(
      path.join(root, "sessions", "2026", "08", "29", `rollout-2026-08-29T10-11-12-${ID1}.jsonl`),
    );
    await mkdir(path.join(root, "thread-writer-locks"), { recursive: true });
    await writeFile(path.join(root, "thread-writer-locks", `${ID1}.lock`), "lock");
    await writeFile(path.join(root, "auth.json"), "{}");
    await writeFile(path.join(root, "state_1.sqlite"), "binary");

    vi.mocked(readFile).mockClear();
    vi.mocked(open).mockClear();

    const result = await locateCodexSessions(root);

    expect(result.sessions.length).toBe(1);
    expect(readFile).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("JSONL の中身が壊れていても結果に影響しない（本文を解釈しないことの代替確認）", async () => {
    root = await mkdtemp(path.join(tmpdir(), "ai-manager-codex-locator-corrupt-"));
    const filePath = path.join(
      root,
      "sessions",
      "2026",
      "08",
      "29",
      `rollout-2026-08-29T10-11-12-${ID1}.jsonl`,
    );
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{not valid json at all\n\x00\x01garbage");

    const result = await locateCodexSessions(root);
    expect(result.warnings).toEqual([]);
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0]?.id).toBe(ID1);
  });
});

describe("locateCodexSessions: 空・異常系", () => {
  it("sessions/ が空 → { sessions: [], warnings: [] }", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ai-manager-codex-locator-emptysessions-"));
    try {
      await mkdir(path.join(root, "sessions"), { recursive: true });
      const result = await locateCodexSessions(root);
      expect(result).toEqual({ sessions: [], warnings: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("YYYY/MM/DD が空 → そのディレクトリからは列挙されず、警告も出ない", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ai-manager-codex-locator-emptyday-"));
    try {
      await mkdir(path.join(root, "sessions", "2026", "08", "29"), { recursive: true });
      const result = await locateCodexSessions(root);
      expect(result).toEqual({ sessions: [], warnings: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sessions/ が無い → 空配列 + 警告 1 件、例外を投げない", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ai-manager-codex-locator-nosessions-"));
    try {
      const result = await locateCodexSessions(root);
      expect(result.sessions).toEqual([]);
      expect(result.warnings.length).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("root 自体が存在しない → 空配列 + 警告、例外を投げない", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "ai-manager-codex-locator-base-"));
    try {
      const nonExistentRoot = path.join(base, "does-not-exist-root");
      const result = await locateCodexSessions(nonExistentRoot);
      expect(result.sessions).toEqual([]);
      expect(result.warnings.length).toBe(1);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("root が相対パス → 空配列 + 警告、例外を投げない", async () => {
    const result = await locateCodexSessions("relative/path/to/root");
    expect(result.sessions).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("警告文言に実パス・一時ディレクトリのパスを含めない", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ai-manager-codex-locator-warnpath-"));
    try {
      const result = await locateCodexSessions(root);
      for (const warning of result.warnings) {
        expect(warning).not.toContain(root);
      }
      const relativeResult = await locateCodexSessions("relative/path/to/root");
      for (const warning of relativeResult.warnings) {
        expect(warning).not.toContain("relative/path/to/root");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
