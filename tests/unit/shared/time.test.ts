import { describe, expect, it } from "vitest";
import { formatRelative } from "../../../src/shared/time";

// T-005: formatRelative(iso, nowMs) の受け入れ条件を検証する。
// - 60 秒未満「たった今」、60 分未満「N分前」、24 時間未満「N時間前」、7 日未満「N日前」、
//   それ以上は YYYY-MM-DD（ローカル日付）。未来は「たった今」。不正な iso は「—」。

// タイムゾーン依存を避けるため、nowMs と iso を同じ日の正午（ローカル時刻）に固定する。
const NOON_TODAY = new Date(2026, 5, 15, 12, 0, 0, 0).getTime(); // 2026-06-15 12:00:00 local

describe("formatRelative: 60 秒未満は「たった今」", () => {
  it("差が 59.999 秒なら「たった今」", () => {
    const iso = new Date(NOON_TODAY - 59_999).toISOString();
    expect(formatRelative(iso, NOON_TODAY)).toBe("たった今");
  });

  it("差がちょうど 60 秒なら「1分前」（境界は分表示側に含まれる）", () => {
    const iso = new Date(NOON_TODAY - 60_000).toISOString();
    expect(formatRelative(iso, NOON_TODAY)).toBe("1分前");
  });

  it("差が 0 秒なら「たった今」", () => {
    expect(formatRelative(new Date(NOON_TODAY).toISOString(), NOON_TODAY)).toBe("たった今");
  });
});

describe("formatRelative: 未来は「たった今」", () => {
  it("iso が nowMs より 1 秒未来でも「たった今」", () => {
    const iso = new Date(NOON_TODAY + 1_000).toISOString();
    expect(formatRelative(iso, NOON_TODAY)).toBe("たった今");
  });

  it("iso が nowMs より大きく未来でも「たった今」", () => {
    const iso = new Date(NOON_TODAY + HOURS(3)).toISOString();
    expect(formatRelative(iso, NOON_TODAY)).toBe("たった今");
  });
});

describe("formatRelative: 60 分未満は「N分前」", () => {
  it("差が 59 分なら「59分前」", () => {
    const iso = new Date(NOON_TODAY - MINUTES(59)).toISOString();
    expect(formatRelative(iso, NOON_TODAY)).toBe("59分前");
  });

  it("差がちょうど 60 分なら「1時間前」（時間表示側に含まれる）", () => {
    const iso = new Date(NOON_TODAY - MINUTES(60)).toISOString();
    expect(formatRelative(iso, NOON_TODAY)).toBe("1時間前");
  });

  // T-005 Round 2: 端数は切り捨てることの固定（90秒 = 1.5分 → 1分前）。
  it("差が 90 秒（1.5 分）なら「1分前」に切り捨てられる", () => {
    const iso = new Date(NOON_TODAY - 90_000).toISOString();
    expect(formatRelative(iso, NOON_TODAY)).toBe("1分前");
  });
});

describe("formatRelative: 24 時間未満は「N時間前」", () => {
  it("差が 23 時間なら「23時間前」", () => {
    const iso = new Date(NOON_TODAY - HOURS(23)).toISOString();
    expect(formatRelative(iso, NOON_TODAY)).toBe("23時間前");
  });

  it("差がちょうど 24 時間なら「1日前」（日表示側に含まれる）", () => {
    const iso = new Date(NOON_TODAY - HOURS(24)).toISOString();
    expect(formatRelative(iso, NOON_TODAY)).toBe("1日前");
  });

  // T-005 Round 2: 端数は切り捨てることの固定（150分 = 2.5時間 → 2時間前）。
  it("差が 150 分（2.5 時間）なら「2時間前」に切り捨てられる", () => {
    const iso = new Date(NOON_TODAY - MINUTES(150)).toISOString();
    expect(formatRelative(iso, NOON_TODAY)).toBe("2時間前");
  });
});

describe("formatRelative: 7 日未満は「N日前」", () => {
  it("差が 6 日なら「6日前」", () => {
    const iso = new Date(NOON_TODAY - DAYS(6)).toISOString();
    expect(formatRelative(iso, NOON_TODAY)).toBe("6日前");
  });

  it("差がちょうど 7 日なら絶対日付 YYYY-MM-DD になる（週表示側に含まれない）", () => {
    const iso = new Date(NOON_TODAY - DAYS(7)).toISOString();
    const result = formatRelative(iso, NOON_TODAY);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).toBe("2026-06-08");
  });
});

describe("formatRelative: 7 日以上はローカル日付 YYYY-MM-DD", () => {
  it("差が十分大きい場合、形式が YYYY-MM-DD になる", () => {
    const iso = new Date(NOON_TODAY - DAYS(40)).toISOString();
    const result = formatRelative(iso, NOON_TODAY);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("差が十分大きい場合、値が対象日のローカル日付と一致する", () => {
    // 2026-06-15 12:00 から 40 日前 = 2026-05-06
    const iso = new Date(NOON_TODAY - DAYS(40)).toISOString();
    expect(formatRelative(iso, NOON_TODAY)).toBe("2026-05-06");
  });
});

describe("formatRelative: 不正な iso", () => {
  it("パース不能な文字列は「—」", () => {
    expect(formatRelative("not-a-date", NOON_TODAY)).toBe("—");
  });

  it("空文字は「—」", () => {
    expect(formatRelative("", NOON_TODAY)).toBe("—");
  });
});

function MINUTES(n: number): number {
  return n * 60_000;
}
function HOURS(n: number): number {
  return n * 60 * 60_000;
}
function DAYS(n: number): number {
  return n * 24 * 60 * 60_000;
}
