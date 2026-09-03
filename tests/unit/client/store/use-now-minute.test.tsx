// T-023 追加タスク（use-now-minute.ts）:
// 「floorToMinute の境界」「次の分の 0 秒で更新（vi.useFakeTimers + now を差し替え）」
// 「アンマウントでタイマー解除」
// メインが追加した useNowMinute() / floorToMinute() の単体テスト。
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { floorToMinute, useNowMinute } from "../../../../src/client/store/use-now-minute.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("floorToMinute", () => {
  it("floorToMinute(90_500) は 60_000 になる", () => {
    expect(floorToMinute(90_500)).toBe(60_000);
  });

  it("ちょうど分の境界（120_000）はそのまま 120_000 になる", () => {
    expect(floorToMinute(120_000)).toBe(120_000);
  });

  it("分の境界の 1ms 手前（119_999）は 1 分前（60_000）に切り捨てられる", () => {
    expect(floorToMinute(119_999)).toBe(60_000);
  });

  it("0 は 0 になる", () => {
    expect(floorToMinute(0)).toBe(0);
  });
});

describe("useNowMinute", () => {
  it("初期値が floorToMinute(now()) と一致する（分単位に切り捨て済み）", () => {
    // 2026-09-03T09:05:30.000Z 相当。
    const start = Date.parse("2026-09-03T09:05:30.000Z");
    const now = vi.fn(() => start);

    const { result } = renderHook(() => useNowMinute(now));

    expect(result.current).toBe(floorToMinute(start));
    expect(result.current).toBe(Date.parse("2026-09-03T09:05:00.000Z"));
  });

  it("09:05:30 から 30 秒進めて次の分の 0 秒（09:06:00）になると値が更新される", () => {
    let current = Date.parse("2026-09-03T09:05:30.000Z");
    const now = vi.fn(() => current);

    const { result } = renderHook(() => useNowMinute(now));
    expect(result.current).toBe(Date.parse("2026-09-03T09:05:00.000Z"));

    // 次の分の 0 秒（09:06:00）まで 30 秒進める。
    current = Date.parse("2026-09-03T09:06:00.000Z");
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current).toBe(Date.parse("2026-09-03T09:06:00.000Z"));
  });

  it("さらに 60 秒進めると次の分（09:07:00）に更新される", () => {
    let current = Date.parse("2026-09-03T09:05:30.000Z");
    const now = vi.fn(() => current);

    const { result } = renderHook(() => useNowMinute(now));

    current = Date.parse("2026-09-03T09:06:00.000Z");
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe(Date.parse("2026-09-03T09:06:00.000Z"));

    current = Date.parse("2026-09-03T09:07:00.000Z");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(Date.parse("2026-09-03T09:07:00.000Z"));
  });

  it("now を渡さない既定でも例外なく動作する", () => {
    expect(() => renderHook(() => useNowMinute())).not.toThrow();
  });

  it("アンマウント後にタイマーが残らない（vi.getTimerCount()）", () => {
    const now = vi.fn(() => Date.parse("2026-09-03T09:05:30.000Z"));
    const { unmount } = renderHook(() => useNowMinute(now));

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
