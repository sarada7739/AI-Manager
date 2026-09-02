import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACTIVE_WINDOW_MINUTES,
  resolveState,
  type StateInput,
} from "../../../src/shared/state";
import type { SessionState, StateReason } from "../../../src/shared/types";

// T-004: resolveState の受け入れ条件を検証する。
// ADR-0003（docs/adr/0003-running-state-detection.md）の 3 段階判定。

const NOW_MS = 1_700_000_000_000;
const MINUTE_MS = 60_000;

/** 真理値表・個別ケース用の基準入力。mtime は既定 5 分窓の内側（1 秒前）に固定し、
 *  hasProcessMeta / processAlive / procStartMatches / processInfoAvailable の
 *  組み合わせだけで分岐が決まるようにする。 */
function baseInput(overrides: Partial<StateInput>): StateInput {
  return {
    hasProcessMeta: false,
    processAlive: false,
    procStartMatches: false,
    processInfoAvailable: true,
    mtimeMs: NOW_MS - 1_000,
    nowMs: NOW_MS,
    activeWindowMinutes: 5,
    ...overrides,
  };
}

describe("resolveState の真理値表（hasProcessMeta × processAlive × procStartMatches × processInfoAvailable の16通り）", () => {
  // mtime は基準入力で「窓内（1 秒前）」に固定しているため、
  // running にならない行はすべて mtime 判定で active/mtime になる。
  it.each<[boolean, boolean, boolean, boolean, SessionState, StateReason]>([
    // hasProcessMeta, processAlive, procStartMatches, processInfoAvailable, state, reason
    [false, false, false, false, "active", "no-process-info"],
    [false, false, false, true, "active", "mtime"],
    [false, false, true, false, "active", "no-process-info"],
    [false, false, true, true, "active", "mtime"],
    [false, true, false, false, "active", "no-process-info"],
    [false, true, false, true, "active", "mtime"],
    [false, true, true, false, "active", "no-process-info"],
    [false, true, true, true, "active", "mtime"],
    [true, false, false, false, "active", "no-process-info"],
    [true, false, false, true, "active", "mtime"],
    [true, false, true, false, "active", "no-process-info"],
    [true, false, true, true, "active", "mtime"],
    [true, true, false, false, "active", "no-process-info"],
    [true, true, false, true, "active", "mtime"],
    [true, true, true, false, "active", "no-process-info"],
    [true, true, true, true, "running", "process"],
  ])(
    "hasProcessMeta=%s processAlive=%s procStartMatches=%s processInfoAvailable=%s → state=%s reason=%s",
    (hasProcessMeta, processAlive, procStartMatches, processInfoAvailable, expectedState, expectedReason) => {
      const result = resolveState(
        baseInput({ hasProcessMeta, processAlive, procStartMatches, processInfoAvailable }),
      );
      expect(result).toEqual({ state: expectedState, reason: expectedReason });
    },
  );
});

describe("受け入れ条件の個別ケース", () => {
  it("メタあり + 生存 + procStart 一致 + processInfoAvailable → running / process", () => {
    const result = resolveState(
      baseInput({
        hasProcessMeta: true,
        processAlive: true,
        procStartMatches: true,
        processInfoAvailable: true,
      }),
    );
    expect(result).toEqual({ state: "running", reason: "process" });
  });

  it("メタあり + プロセス不在 → mtime 判定（窓内なら active/mtime）", () => {
    const result = resolveState(
      baseInput({
        hasProcessMeta: true,
        processAlive: false,
        procStartMatches: false,
        processInfoAvailable: true,
        mtimeMs: NOW_MS - 1_000,
      }),
    );
    expect(result).toEqual({ state: "active", reason: "mtime" });
  });

  it("メタあり + プロセス不在 → mtime 判定（窓外なら idle/none）", () => {
    const result = resolveState(
      baseInput({
        hasProcessMeta: true,
        processAlive: false,
        procStartMatches: false,
        processInfoAvailable: true,
        mtimeMs: NOW_MS - 10 * MINUTE_MS,
      }),
    );
    expect(result).toEqual({ state: "idle", reason: "none" });
  });

  it("メタあり + 生存 + procStart 不一致（PID 再利用）→ mtime 判定（窓内なら active/mtime）", () => {
    const result = resolveState(
      baseInput({
        hasProcessMeta: true,
        processAlive: true,
        procStartMatches: false,
        processInfoAvailable: true,
        mtimeMs: NOW_MS - 1_000,
      }),
    );
    expect(result).toEqual({ state: "active", reason: "mtime" });
  });

  it("メタあり + 生存 + procStart 不一致（PID 再利用）→ mtime 判定（窓外なら idle/none）", () => {
    const result = resolveState(
      baseInput({
        hasProcessMeta: true,
        processAlive: true,
        procStartMatches: false,
        processInfoAvailable: true,
        mtimeMs: NOW_MS - 10 * MINUTE_MS,
      }),
    );
    expect(result).toEqual({ state: "idle", reason: "none" });
  });

  it("processInfoAvailable: false → 条件が揃っていても running にならず、state は mtime 判定（窓内=active）、reason は no-process-info", () => {
    const result = resolveState(
      baseInput({
        hasProcessMeta: true,
        processAlive: true,
        procStartMatches: true,
        processInfoAvailable: false,
        mtimeMs: NOW_MS - 1_000,
      }),
    );
    expect(result.state).not.toBe("running");
    expect(result).toEqual({ state: "active", reason: "no-process-info" });
  });

  it("processInfoAvailable: false → 条件が揃っていても running にならず、state は mtime 判定（窓外=idle）、reason は no-process-info", () => {
    const result = resolveState(
      baseInput({
        hasProcessMeta: true,
        processAlive: true,
        procStartMatches: true,
        processInfoAvailable: false,
        mtimeMs: NOW_MS - 10 * MINUTE_MS,
      }),
    );
    expect(result.state).not.toBe("running");
    expect(result).toEqual({ state: "idle", reason: "no-process-info" });
  });
});

describe("mtime の境界値（activeWindowMinutes=10 を明示指定）", () => {
  const WINDOW_MINUTES = 10;
  const WINDOW_MS = WINDOW_MINUTES * MINUTE_MS;

  function mtimeInput(mtimeMs: number): StateInput {
    return baseInput({
      hasProcessMeta: false,
      processAlive: false,
      procStartMatches: false,
      processInfoAvailable: true,
      activeWindowMinutes: WINDOW_MINUTES,
      mtimeMs,
    });
  }

  it("差がちょうど window → active", () => {
    const result = resolveState(mtimeInput(NOW_MS - WINDOW_MS));
    expect(result).toEqual({ state: "active", reason: "mtime" });
  });

  it("差が window + 1ms → idle", () => {
    const result = resolveState(mtimeInput(NOW_MS - (WINDOW_MS + 1)));
    expect(result).toEqual({ state: "idle", reason: "none" });
  });

  it("差が 0（mtime = now）→ active", () => {
    const result = resolveState(mtimeInput(NOW_MS));
    expect(result).toEqual({ state: "active", reason: "mtime" });
  });

  it("未来の mtime（時計ずれ）→ active", () => {
    const result = resolveState(mtimeInput(NOW_MS + 5_000));
    expect(result).toEqual({ state: "active", reason: "mtime" });
  });
});

describe("activeWindowMinutes が不正な場合は既定 5 分で判定する", () => {
  const invalidValues: Array<[string, number]> = [
    ["0", 0],
    ["負の値", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ];

  it.each(invalidValues)("activeWindowMinutes=%s(%d) → 4分前は active", (_label, invalid) => {
    const result = resolveState(
      baseInput({
        hasProcessMeta: false,
        processAlive: false,
        procStartMatches: false,
        processInfoAvailable: true,
        activeWindowMinutes: invalid,
        mtimeMs: NOW_MS - 4 * MINUTE_MS,
      }),
    );
    expect(result).toEqual({ state: "active", reason: "mtime" });
  });

  it.each(invalidValues)("activeWindowMinutes=%s(%d) → 6分前は idle", (_label, invalid) => {
    const result = resolveState(
      baseInput({
        hasProcessMeta: false,
        processAlive: false,
        procStartMatches: false,
        processInfoAvailable: true,
        activeWindowMinutes: invalid,
        mtimeMs: NOW_MS - 6 * MINUTE_MS,
      }),
    );
    expect(result).toEqual({ state: "idle", reason: "none" });
  });

  it("DEFAULT_ACTIVE_WINDOW_MINUTES は 5", () => {
    expect(DEFAULT_ACTIVE_WINDOW_MINUTES).toBe(5);
  });
});

describe("processInfoAvailable: false のとき state が active / idle いずれでも reason は no-process-info", () => {
  it("state が active のケース", () => {
    const result = resolveState(
      baseInput({
        processInfoAvailable: false,
        mtimeMs: NOW_MS - 1_000,
      }),
    );
    expect(result.state).toBe("active");
    expect(result.reason).toBe("no-process-info");
  });

  it("state が idle のケース", () => {
    const result = resolveState(
      baseInput({
        processInfoAvailable: false,
        mtimeMs: NOW_MS - 10 * MINUTE_MS,
      }),
    );
    expect(result.state).toBe("idle");
    expect(result.reason).toBe("no-process-info");
  });
});

describe("resolveState は error を返さない", () => {
  const booleans = [true, false];
  const mtimeScenarios = [
    NOW_MS - 1_000, // 窓内
    NOW_MS - 10 * MINUTE_MS, // 窓外
    NOW_MS + 5_000, // 未来
  ];
  const windowScenarios = [5, 10, 0, -1, Number.NaN, Number.POSITIVE_INFINITY];

  const cases: StateInput[] = [];
  for (const hasProcessMeta of booleans) {
    for (const processAlive of booleans) {
      for (const procStartMatches of booleans) {
        for (const processInfoAvailable of booleans) {
          for (const mtimeMs of mtimeScenarios) {
            for (const activeWindowMinutes of windowScenarios) {
              cases.push({
                hasProcessMeta,
                processAlive,
                procStartMatches,
                processInfoAvailable,
                mtimeMs,
                nowMs: NOW_MS,
                activeWindowMinutes,
              });
            }
          }
        }
      }
    }
  }

  it("あらゆる入力の組み合わせで state が running / active / idle のいずれかであり、error にならない", () => {
    for (const input of cases) {
      const result = resolveState(input);
      expect(["running", "active", "idle"]).toContain(result.state);
      expect(result.state).not.toBe("error");
    }
  });
});
