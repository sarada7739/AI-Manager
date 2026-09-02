import { describe, expect, it } from "vitest";
import {
  applyFilters,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  folderOptions,
  groupSessions,
  type SessionFilters,
  type SortSpec,
  sortSessions,
} from "../../../src/shared/grouping";
import type { Account, SessionSummary } from "../../../src/shared/types";

// T-018: applyFilters / groupSessions / sortSessions / folderOptions の受け入れ条件を検証する。
// 合成データのみを使う。実パス・UUID・ホスト名は使わない。

/** noUncheckedIndexedAccess 対策: 範囲内であることをテスト側で保証した上で要素を取り出す。 */
function at<T>(arr: T[], index: number): T {
  const value = arr[index];
  if (value === undefined) {
    throw new Error(`index ${index} is out of range (length=${arr.length})`);
  }
  return value;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = 1_700_000_000_000; // 固定基準時刻
const NOW_ISO = new Date(NOW_MS).toISOString();

/** 全フィールドにダミー既定値を持つ SessionSummary を作る。overrides で上書きする。 */
function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    key: `claude:dummy-${Math.random().toString(36).slice(2)}`,
    tool: "claude",
    id: "dummy-id",
    title: "ダミータイトル",
    lastMessage: "ダミーの最終メッセージ",
    lastRole: "assistant",
    cwd: "C:\\work\\alpha",
    branch: "main",
    model: "dummy-model",
    entrypoint: "cli",
    accountKey: "claude:cli",
    state: "idle",
    stateReason: "none",
    pid: null,
    startedAt: null,
    firstAt: NOW_ISO,
    updatedAt: NOW_ISO,
    logSizeBytes: 1000,
    subagentCount: 0,
    released: false,
    ...overrides,
  };
}

function isoAtDaysAgo(days: number, extraMs = 0): string {
  return new Date(NOW_MS - days * DAY_MS + extraMs).toISOString();
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    key: "claude:cli",
    label: "ダミーアカウント",
    tool: "claude",
    running: false,
    runningCount: 0,
    sessionCount: 0,
    startedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DEFAULT_FILTERS / DEFAULT_SORT
// ---------------------------------------------------------------------------

describe("DEFAULT_FILTERS / DEFAULT_SORT", () => {
  it('DEFAULT_FILTERS の既定値は all / null / null / 14 / false / ""', () => {
    expect(DEFAULT_FILTERS).toEqual({
      tool: "all",
      accountKey: null,
      folder: null,
      sinceDays: 14,
      runningOnly: false,
      query: "",
    });
  });

  it("DEFAULT_SORT の既定値は updatedAt desc", () => {
    expect(DEFAULT_SORT).toEqual({ key: "updatedAt", dir: "desc" });
  });
});

// ---------------------------------------------------------------------------
// applyFilters
// ---------------------------------------------------------------------------

describe("applyFilters", () => {
  it("空配列を渡しても例外にならず空配列を返す", () => {
    expect(applyFilters([], DEFAULT_FILTERS, NOW_MS)).toEqual([]);
  });

  it("tool 単独: 指定ツールのみ残る", () => {
    const sessions = [
      makeSession({ key: "a", tool: "claude" }),
      makeSession({ key: "b", tool: "codex" }),
    ];
    const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null, tool: "codex" };
    const result = applyFilters(sessions, filters, NOW_MS);
    expect(result.map((s) => s.key)).toEqual(["b"]);
  });

  it('tool: "all" は絞り込まない', () => {
    const sessions = [
      makeSession({ key: "a", tool: "claude" }),
      makeSession({ key: "b", tool: "codex" }),
    ];
    const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null };
    const result = applyFilters(sessions, filters, NOW_MS);
    expect(result.map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("accountKey 単独: 指定アカウントのみ残る", () => {
    const sessions = [
      makeSession({ key: "a", accountKey: "claude:cli" }),
      makeSession({ key: "b", accountKey: "claude:other" }),
    ];
    const filters: SessionFilters = {
      ...DEFAULT_FILTERS,
      sinceDays: null,
      accountKey: "claude:other",
    };
    const result = applyFilters(sessions, filters, NOW_MS);
    expect(result.map((s) => s.key)).toEqual(["b"]);
  });

  describe("folder（cwd の境界一致）", () => {
    it("大文字小文字を無視して前方一致する", () => {
      const sessions = [makeSession({ key: "a", cwd: "C:\\Work\\Alpha\\sub" })];
      const filters: SessionFilters = {
        ...DEFAULT_FILTERS,
        sinceDays: null,
        folder: "c:\\work\\alpha",
      };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("区切り文字 \\ と / を同一視する", () => {
      const sessions = [makeSession({ key: "a", cwd: "C:/work/alpha/sub" })];
      const filters: SessionFilters = {
        ...DEFAULT_FILTERS,
        sinceDays: null,
        folder: "C:\\work\\alpha",
      };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("前方一致しないものは除外する", () => {
      const sessions = [makeSession({ key: "a", cwd: "C:\\work\\beta" })];
      const filters: SessionFilters = {
        ...DEFAULT_FILTERS,
        sinceDays: null,
        folder: "C:\\work\\alpha",
      };
      expect(applyFilters(sessions, filters, NOW_MS)).toEqual([]);
    });

    // 確定仕様: 正規化（大文字小文字無視・`\`→`/`・末尾 `/` 除去）後に
    // cwd === folder または cwd.startsWith(folder + "/") のときだけ一致する。
    // 単純な文字列前方一致ではないため、"alpha2" のように接頭辞が一致するだけの
    // 別フォルダは含まれない。
    it("区切り境界で判定するため、フォルダ名の接頭辞が一致するだけの別フォルダは含まれない", () => {
      const sessions = [makeSession({ key: "a", cwd: "C:\\work\\alpha2\\sub" })];
      const filters: SessionFilters = {
        ...DEFAULT_FILTERS,
        sinceDays: null,
        folder: "C:\\work\\alpha",
      };
      expect(applyFilters(sessions, filters, NOW_MS)).toEqual([]);
    });

    it("folder の末尾に区切りが付いていても正規化して一致する", () => {
      const sessions = [makeSession({ key: "a", cwd: "C:\\work\\alpha\\sub" })];
      const filters: SessionFilters = {
        ...DEFAULT_FILTERS,
        sinceDays: null,
        folder: "C:\\work\\alpha\\",
      };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("folder と cwd が大文字小文字・区切り文字違いのみで完全一致する場合も一致する", () => {
      const sessions = [makeSession({ key: "a", cwd: "C:\\work\\alpha" })];
      const filters: SessionFilters = {
        ...DEFAULT_FILTERS,
        sinceDays: null,
        folder: "c:/WORK/alpha",
      };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("親フォルダを folder に指定すると子フォルダの cwd も一致する", () => {
      const sessions = [makeSession({ key: "a", cwd: "C:\\work\\alpha" })];
      const filters: SessionFilters = {
        ...DEFAULT_FILTERS,
        sinceDays: null,
        folder: "C:\\work",
      };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });
  });

  describe("sinceDays の境界", () => {
    it("ちょうど境界の updatedAt は含む（>= 判定）", () => {
      const sessions = [makeSession({ key: "a", updatedAt: isoAtDaysAgo(14) })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: 14 };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("境界より 1ms 古い updatedAt は除外する", () => {
      const sessions = [makeSession({ key: "a", updatedAt: isoAtDaysAgo(14, -1) })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: 14 };
      expect(applyFilters(sessions, filters, NOW_MS)).toEqual([]);
    });

    it("sinceDays: null は絞り込まない（14日より古くても残る）", () => {
      const sessions = [makeSession({ key: "a", updatedAt: isoAtDaysAgo(365) })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("DEFAULT_FILTERS（14日）: 15日前の更新は落ちる", () => {
      const sessions = [makeSession({ key: "a", updatedAt: isoAtDaysAgo(15) })];
      expect(applyFilters(sessions, DEFAULT_FILTERS, NOW_MS)).toEqual([]);
    });

    it("DEFAULT_FILTERS（14日）: 13日前の更新は残る", () => {
      const sessions = [makeSession({ key: "a", updatedAt: isoAtDaysAgo(13) })];
      expect(applyFilters(sessions, DEFAULT_FILTERS, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    // 不正な ISO は Date.parse で NaN になり、NaN との比較は常に false になるため
    // 「期間外」として除外される（意図した挙動）。
    it("updatedAt が不正な ISO 文字列（not-a-date）は sinceDays: 14 で除外される", () => {
      const sessions = [makeSession({ key: "a", updatedAt: "not-a-date" })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: 14 };
      expect(() => applyFilters(sessions, filters, NOW_MS)).not.toThrow();
      expect(applyFilters(sessions, filters, NOW_MS)).toEqual([]);
    });

    it("updatedAt が不正な ISO 文字列でも sinceDays: null なら絞り込まれず残る", () => {
      const sessions = [makeSession({ key: "a", updatedAt: "not-a-date" })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });
  });

  describe("runningOnly", () => {
    it("running を残す", () => {
      const sessions = [makeSession({ key: "a", state: "running" })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null, runningOnly: true };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("active も残る（running のみに限定しない）", () => {
      const sessions = [makeSession({ key: "a", state: "active" })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null, runningOnly: true };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("idle / error は除外する", () => {
      const sessions = [
        makeSession({ key: "a", state: "idle" }),
        makeSession({ key: "b", state: "error" }),
      ];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null, runningOnly: true };
      expect(applyFilters(sessions, filters, NOW_MS)).toEqual([]);
    });
  });

  describe("query（部分一致・複数語 AND）", () => {
    it("title に部分一致する", () => {
      const sessions = [makeSession({ key: "a", title: "バグ修正タスク" })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null, query: "修正" };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("lastMessage に部分一致する", () => {
      const sessions = [makeSession({ key: "a", lastMessage: "テスト完了しました" })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null, query: "完了" };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("cwd に部分一致する", () => {
      const sessions = [makeSession({ key: "a", cwd: "C:\\work\\project-x" })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null, query: "project-x" };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("branch に部分一致する（大文字小文字無視）", () => {
      const sessions = [makeSession({ key: "a", branch: "feature/T-018" })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null, query: "t-018" };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("branch が null でも例外にならない", () => {
      const sessions = [makeSession({ key: "a", branch: null, title: "対象タイトル" })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null, query: "対象" };
      expect(() => applyFilters(sessions, filters, NOW_MS)).not.toThrow();
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("複数語は AND: 両方満たすものだけ残る", () => {
      const sessions = [
        makeSession({ key: "a", title: "アルファ バグ修正" }),
        makeSession({ key: "b", title: "アルファのみ" }),
        makeSession({ key: "c", title: "バグ修正のみ" }),
      ];
      const filters: SessionFilters = {
        ...DEFAULT_FILTERS,
        sinceDays: null,
        query: "アルファ バグ",
      };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });

    it("空白のみの query は絞り込まない", () => {
      const sessions = [makeSession({ key: "a" }), makeSession({ key: "b" })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null, query: "   " };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a", "b"]);
    });

    it("空文字の query は絞り込まない", () => {
      const sessions = [makeSession({ key: "a" })];
      const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null, query: "" };
      expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
    });
  });

  it("複数条件は AND で適用される", () => {
    const sessions = [
      makeSession({
        key: "a",
        tool: "claude",
        accountKey: "claude:cli",
        cwd: "C:\\work\\alpha",
        state: "running",
        title: "対象タスク",
        updatedAt: isoAtDaysAgo(1),
      }),
      // tool が違う
      makeSession({
        key: "b",
        tool: "codex",
        accountKey: "claude:cli",
        cwd: "C:\\work\\alpha",
        state: "running",
        title: "対象タスク",
        updatedAt: isoAtDaysAgo(1),
      }),
      // state が違う（running/active でない）
      makeSession({
        key: "c",
        tool: "claude",
        accountKey: "claude:cli",
        cwd: "C:\\work\\alpha",
        state: "idle",
        title: "対象タスク",
        updatedAt: isoAtDaysAgo(1),
      }),
    ];
    const filters: SessionFilters = {
      tool: "claude",
      accountKey: "claude:cli",
      folder: "C:\\work\\alpha",
      sinceDays: 14,
      runningOnly: true,
      query: "対象",
    };
    expect(applyFilters(sessions, filters, NOW_MS).map((s) => s.key)).toEqual(["a"]);
  });

  it("全件が除外条件に合致しても例外にならず空配列", () => {
    const sessions = [makeSession({ key: "a", state: "idle" })];
    const filters: SessionFilters = { ...DEFAULT_FILTERS, sinceDays: null, runningOnly: true };
    expect(() => applyFilters(sessions, filters, NOW_MS)).not.toThrow();
    expect(applyFilters(sessions, filters, NOW_MS)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// groupSessions
// ---------------------------------------------------------------------------

describe("groupSessions", () => {
  it("空配列を渡しても例外にならない（account 軸）", () => {
    const accounts = [makeAccount({ key: "claude:cli", label: "CLI" })];
    expect(() => groupSessions([], "account", accounts)).not.toThrow();
    const groups = groupSessions([], "account", accounts);
    expect(groups).toHaveLength(1);
    expect(at(groups, 0)).toMatchObject({
      key: "claude:cli",
      sessions: [],
      state: "idle",
      runningCount: 0,
    });
  });

  describe("account 軸", () => {
    const accounts = [
      makeAccount({ key: "claude:cli", label: "CLI アカウント" }),
      makeAccount({ key: "claude:desktop-1", label: "Desktop 1" }),
    ];

    it("列は accounts の順で並び、0 件でも列が残る", () => {
      const sessions = [makeSession({ key: "a", accountKey: "claude:cli" })];
      const groups = groupSessions(sessions, "account", accounts);
      expect(groups.map((g) => g.key)).toEqual(["claude:cli", "claude:desktop-1"]);
      expect(at(groups, 0).label).toBe("CLI アカウント");
      expect(at(groups, 1).label).toBe("Desktop 1");
      expect(at(groups, 1).sessions).toEqual([]);
    });

    it("未知の accountKey は末尾に追加され、ラベルは accountKey そのもの", () => {
      const sessions = [
        makeSession({ key: "a", accountKey: "claude:cli" }),
        makeSession({ key: "b", accountKey: "claude:unknown-xyz" }),
      ];
      const groups = groupSessions(sessions, "account", accounts);
      expect(groups.map((g) => g.key)).toEqual([
        "claude:cli",
        "claude:desktop-1",
        "claude:unknown-xyz",
      ]);
      const tail = at(groups, groups.length - 1);
      expect(tail.key).toBe("claude:unknown-xyz");
      expect(tail.label).toBe("claude:unknown-xyz");
      expect(tail.sessions.map((s) => s.key)).toEqual(["b"]);
    });
  });

  describe("folder 軸", () => {
    it("cwd ごとにグルーピングし、runningCount 降順 → label 昇順で並ぶ", () => {
      const sessions = [
        makeSession({ key: "a1", cwd: "C:\\work\\beta", state: "idle" }),
        makeSession({ key: "b1", cwd: "C:\\work\\alpha", state: "running" }),
        makeSession({ key: "b2", cwd: "C:\\work\\alpha", state: "idle" }),
        makeSession({ key: "c1", cwd: "C:\\work\\gamma", state: "idle" }),
      ];
      const groups = groupSessions(sessions, "folder", []);
      // alpha: runningCount=1 が最上位。beta/gamma は runningCount=0 で label 昇順。
      expect(groups.map((g) => g.label)).toEqual([
        "C:\\work\\alpha",
        "C:\\work\\beta",
        "C:\\work\\gamma",
      ]);
    });

    it("大文字小文字・区切り文字違いの cwd は同一グループになり、ラベルは最初の表記", () => {
      const sessions = [
        makeSession({ key: "a", cwd: "C:\\work\\alpha" }),
        makeSession({ key: "b", cwd: "c:/WORK/Alpha" }),
      ];
      const groups = groupSessions(sessions, "folder", []);
      expect(groups).toHaveLength(1);
      expect(at(groups, 0).label).toBe("C:\\work\\alpha");
      expect(
        at(groups, 0)
          .sessions.map((s) => s.key)
          .sort(),
      ).toEqual(["a", "b"]);
    });

    it("末尾に区切りが付いた cwd と付いていない cwd は 1 列に統合される", () => {
      const sessions = [
        makeSession({ key: "a", cwd: "C:\\work\\alpha\\" }),
        makeSession({ key: "b", cwd: "C:\\work\\alpha" }),
      ];
      const groups = groupSessions(sessions, "folder", []);
      expect(groups).toHaveLength(1);
      expect(
        at(groups, 0)
          .sessions.map((s) => s.key)
          .sort(),
      ).toEqual(["a", "b"]);
    });

    // Round 3: 列順は正規化キー（normalizeForCompare 済み）の localeCompare("ja") で決まる。
    // 生ラベルの大文字小文字は順序に影響しない。
    it("runningCount 同値のとき、大文字始まりの Beta より alpha が先に来る", () => {
      const sessions = [
        makeSession({ key: "a", cwd: "C:\\work\\Beta", state: "idle" }),
        makeSession({ key: "b", cwd: "C:\\work\\alpha", state: "idle" }),
      ];
      const groups = groupSessions(sessions, "folder", []);
      expect(groups.map((g) => g.label)).toEqual(["C:\\work\\alpha", "C:\\work\\Beta"]);
    });

    it("区切り文字が / の zeta と \\ の alpha でも alpha が先に来る", () => {
      const sessions = [
        makeSession({ key: "a", cwd: "C:/work/zeta", state: "idle" }),
        makeSession({ key: "b", cwd: "C:\\work\\alpha", state: "idle" }),
      ];
      const groups = groupSessions(sessions, "folder", []);
      expect(groups.map((g) => g.label)).toEqual(["C:\\work\\alpha", "C:/work/zeta"]);
    });
  });

  describe("state 軸", () => {
    it("固定 4 列（running/active/idle/error）を順序・ラベル付きで返す（0 件でも列は残る）", () => {
      const groups = groupSessions([], "state", []);
      expect(groups.map((g) => g.key)).toEqual(["running", "active", "idle", "error"]);
      expect(groups.map((g) => g.label)).toEqual(["稼働中", "作業中", "停止", "エラー"]);
      expect(groups.every((g) => g.sessions.length === 0)).toBe(true);
    });

    it("各セッションが自分の state 列に入る", () => {
      const sessions = [
        makeSession({ key: "a", state: "running" }),
        makeSession({ key: "b", state: "active" }),
        makeSession({ key: "c", state: "idle" }),
        makeSession({ key: "d", state: "error" }),
      ];
      const groups = groupSessions(sessions, "state", []);
      expect(groups.map((g) => g.sessions.map((s) => s.key))).toEqual([["a"], ["b"], ["c"], ["d"]]);
    });
  });

  describe("tool 軸", () => {
    it("固定 2 列（claude/codex）をラベル付きで返す（0 件でも列は残る）", () => {
      const groups = groupSessions([], "tool", []);
      expect(groups.map((g) => g.key)).toEqual(["claude", "codex"]);
      expect(groups.map((g) => g.label)).toEqual(["Claude", "Codex"]);
      expect(groups.every((g) => g.sessions.length === 0)).toBe(true);
    });

    it("tool ごとに振り分けられる", () => {
      const sessions = [
        makeSession({ key: "a", tool: "claude" }),
        makeSession({ key: "b", tool: "codex" }),
      ];
      const groups = groupSessions(sessions, "tool", []);
      expect(at(groups, 0).sessions.map((s) => s.key)).toEqual(["a"]);
      expect(at(groups, 1).sessions.map((s) => s.key)).toEqual(["b"]);
    });
  });

  describe("グループの state 判定（account 軸で混在パターンを検証）", () => {
    const accounts = [makeAccount({ key: "claude:cli", label: "CLI" })];

    it("running が混ざれば running", () => {
      const sessions = [
        makeSession({ key: "a", accountKey: "claude:cli", state: "running" }),
        makeSession({ key: "b", accountKey: "claude:cli", state: "idle" }),
        makeSession({ key: "c", accountKey: "claude:cli", state: "error" }),
      ];
      const groups = groupSessions(sessions, "account", accounts);
      expect(at(groups, 0).state).toBe("running");
      expect(at(groups, 0).runningCount).toBe(1);
    });

    it("active のみ（running なし）は active", () => {
      const sessions = [
        makeSession({ key: "a", accountKey: "claude:cli", state: "active" }),
        makeSession({ key: "b", accountKey: "claude:cli", state: "idle" }),
      ];
      const groups = groupSessions(sessions, "account", accounts);
      expect(at(groups, 0).state).toBe("active");
    });

    it("error のみ（他が無い）は error", () => {
      const sessions = [
        makeSession({ key: "a", accountKey: "claude:cli", state: "error" }),
        makeSession({ key: "b", accountKey: "claude:cli", state: "error" }),
      ];
      const groups = groupSessions(sessions, "account", accounts);
      expect(at(groups, 0).state).toBe("error");
    });

    it("idle のみは idle", () => {
      const sessions = [makeSession({ key: "a", accountKey: "claude:cli", state: "idle" })];
      const groups = groupSessions(sessions, "account", accounts);
      expect(at(groups, 0).state).toBe("idle");
    });

    it("error と idle が混ざる（全件 error でない）と idle", () => {
      const sessions = [
        makeSession({ key: "a", accountKey: "claude:cli", state: "error" }),
        makeSession({ key: "b", accountKey: "claude:cli", state: "idle" }),
      ];
      const groups = groupSessions(sessions, "account", accounts);
      expect(at(groups, 0).state).toBe("idle");
    });

    it("0 件のグループは idle", () => {
      const groups = groupSessions([], "account", accounts);
      expect(at(groups, 0).state).toBe("idle");
      expect(at(groups, 0).runningCount).toBe(0);
    });
  });

  it("グループ内は updatedAt 降順に並ぶ", () => {
    const accounts = [makeAccount({ key: "claude:cli", label: "CLI" })];
    const sessions = [
      makeSession({ key: "old", accountKey: "claude:cli", updatedAt: isoAtDaysAgo(5) }),
      makeSession({ key: "new", accountKey: "claude:cli", updatedAt: isoAtDaysAgo(1) }),
      makeSession({ key: "mid", accountKey: "claude:cli", updatedAt: isoAtDaysAgo(3) }),
    ];
    const groups = groupSessions(sessions, "account", accounts);
    expect(at(groups, 0).sessions.map((s) => s.key)).toEqual(["new", "mid", "old"]);
  });
});

// ---------------------------------------------------------------------------
// sortSessions
// ---------------------------------------------------------------------------

describe("sortSessions", () => {
  it("空配列を渡しても例外にならない", () => {
    expect(sortSessions([], DEFAULT_SORT)).toEqual([]);
  });

  it("updatedAt: 降順（既定）", () => {
    const sessions = [
      makeSession({ key: "a", updatedAt: isoAtDaysAgo(5) }),
      makeSession({ key: "b", updatedAt: isoAtDaysAgo(1) }),
    ];
    const result = sortSessions(sessions, DEFAULT_SORT);
    expect(result.map((s) => s.key)).toEqual(["b", "a"]);
  });

  it("updatedAt: 昇順", () => {
    const sessions = [
      makeSession({ key: "a", updatedAt: isoAtDaysAgo(5) }),
      makeSession({ key: "b", updatedAt: isoAtDaysAgo(1) }),
    ];
    const sort: SortSpec = { key: "updatedAt", dir: "asc" };
    const result = sortSessions(sessions, sort);
    expect(result.map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("logSizeBytes: 昇順・降順", () => {
    const sessions = [
      makeSession({ key: "a", logSizeBytes: 300 }),
      makeSession({ key: "b", logSizeBytes: 100 }),
      makeSession({ key: "c", logSizeBytes: 200 }),
    ];
    expect(sortSessions(sessions, { key: "logSizeBytes", dir: "asc" }).map((s) => s.key)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortSessions(sessions, { key: "logSizeBytes", dir: "desc" }).map((s) => s.key)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("title: 日本語ロケールで「あ」が「い」より前に来る（昇順）", () => {
    const sessions = [
      makeSession({ key: "i", title: "いろは" }),
      makeSession({ key: "a", title: "あいうえお" }),
    ];
    const result = sortSessions(sessions, { key: "title", dir: "asc" });
    expect(result.map((s) => s.key)).toEqual(["a", "i"]);
  });

  // Round 3: コード単位比較（"B".charCodeAt(0)=66 < "a".charCodeAt(0)=97）なら B が先に来るが、
  // localeCompare("ja") では大文字小文字を厳密な第一基準にしないため a が先に来る。
  it('title: ロケール差を捉える（["B", "a"] は昇順で a → B。コード単位比較なら逆になる）', () => {
    const sessions = [makeSession({ key: "B", title: "B" }), makeSession({ key: "a", title: "a" })];
    const result = sortSessions(sessions, { key: "title", dir: "asc" });
    expect(result.map((s) => s.key)).toEqual(["a", "B"]);
  });

  it("title: 降順は逆順になる", () => {
    const sessions = [
      makeSession({ key: "a", title: "あいうえお" }),
      makeSession({ key: "i", title: "いろは" }),
    ];
    const result = sortSessions(sessions, { key: "title", dir: "desc" });
    expect(result.map((s) => s.key)).toEqual(["i", "a"]);
  });

  it("state: running < active < idle < error（昇順）", () => {
    const sessions = [
      makeSession({ key: "e", state: "error" }),
      makeSession({ key: "i", state: "idle" }),
      makeSession({ key: "a", state: "active" }),
      makeSession({ key: "r", state: "running" }),
    ];
    const result = sortSessions(sessions, { key: "state", dir: "asc" });
    expect(result.map((s) => s.key)).toEqual(["r", "a", "i", "e"]);
  });

  it("state: 降順は逆順になる（error が先頭）", () => {
    const sessions = [
      makeSession({ key: "r", state: "running" }),
      makeSession({ key: "a", state: "active" }),
      makeSession({ key: "i", state: "idle" }),
      makeSession({ key: "e", state: "error" }),
    ];
    const result = sortSessions(sessions, { key: "state", dir: "desc" });
    expect(result.map((s) => s.key)).toEqual(["e", "i", "a", "r"]);
  });

  it("安定ソート: 同値の要素は元の順序を保つ", () => {
    const sessions = [
      makeSession({ key: "first", logSizeBytes: 100 }),
      makeSession({ key: "second", logSizeBytes: 100 }),
      makeSession({ key: "third", logSizeBytes: 100 }),
    ];
    const result = sortSessions(sessions, { key: "logSizeBytes", dir: "asc" });
    expect(result.map((s) => s.key)).toEqual(["first", "second", "third"]);
  });

  it("updatedAt が不正な ISO 文字列でも sortSessions は例外を投げない", () => {
    const sessions = [
      makeSession({ key: "a", updatedAt: "not-a-date" }),
      makeSession({ key: "b", updatedAt: isoAtDaysAgo(1) }),
    ];
    expect(() => sortSessions(sessions, { key: "updatedAt", dir: "asc" })).not.toThrow();
    expect(() => sortSessions(sessions, DEFAULT_SORT)).not.toThrow();
  });

  it("非破壊: 入力配列の順序・参照は変更されない", () => {
    const sessions = [
      makeSession({ key: "a", updatedAt: isoAtDaysAgo(5) }),
      makeSession({ key: "b", updatedAt: isoAtDaysAgo(1) }),
    ];
    const original = [...sessions];
    const result = sortSessions(sessions, { key: "updatedAt", dir: "asc" });
    expect(sessions).toEqual(original);
    expect(sessions.map((s) => s.key)).toEqual(["a", "b"]);
    expect(result).not.toBe(sessions);
  });
});

// ---------------------------------------------------------------------------
// folderOptions
// ---------------------------------------------------------------------------

describe("folderOptions", () => {
  it("空配列では空配列を返し例外にならない", () => {
    expect(folderOptions([])).toEqual([]);
  });

  it("大文字小文字・区切り文字・末尾区切りの違いを統合し、表記は最初のものを使う", () => {
    const sessions = [
      makeSession({ cwd: "C:\\work\\alpha" }),
      makeSession({ cwd: "c:/WORK/Alpha" }),
      makeSession({ cwd: "C:\\work\\alpha\\" }),
    ];
    const options = folderOptions(sessions);
    expect(options).toHaveLength(1);
    expect(at(options, 0)).toEqual({ folder: "C:\\work\\alpha", count: 3 });
  });

  it("末尾に区切りが付いた folder と付いていない folder は 1 件に統合される", () => {
    const sessions = [
      makeSession({ cwd: "C:\\work\\alpha\\" }),
      makeSession({ cwd: "C:\\work\\alpha" }),
    ];
    const options = folderOptions(sessions);
    expect(options).toHaveLength(1);
    expect(at(options, 0).count).toBe(2);
  });

  it("count 降順 → folder 昇順で並ぶ", () => {
    const sessions = [
      makeSession({ cwd: "C:\\work\\beta" }),
      makeSession({ cwd: "C:\\work\\alpha" }),
      makeSession({ cwd: "C:\\work\\alpha" }),
      makeSession({ cwd: "C:\\work\\gamma" }),
    ];
    const options = folderOptions(sessions);
    expect(options).toEqual([
      { folder: "C:\\work\\alpha", count: 2 },
      { folder: "C:\\work\\beta", count: 1 },
      { folder: "C:\\work\\gamma", count: 1 },
    ]);
  });

  // Round 3: 順序は正規化キーの localeCompare("ja") で決まり、生ラベルの大文字小文字・
  // 区切り文字は順序に影響しない。
  it("count 同値のとき、大文字始まりの Beta より alpha が先に来る", () => {
    const sessions = [
      makeSession({ cwd: "C:\\work\\Beta" }),
      makeSession({ cwd: "C:\\work\\alpha" }),
    ];
    const options = folderOptions(sessions);
    expect(options.map((o) => o.folder)).toEqual(["C:\\work\\alpha", "C:\\work\\Beta"]);
  });

  it("区切り文字が / の zeta と \\ の alpha でも alpha が先に来る", () => {
    const sessions = [
      makeSession({ cwd: "C:/work/zeta" }),
      makeSession({ cwd: "C:\\work\\alpha" }),
    ];
    const options = folderOptions(sessions);
    expect(options.map((o) => o.folder)).toEqual(["C:\\work\\alpha", "C:/work/zeta"]);
  });
});
