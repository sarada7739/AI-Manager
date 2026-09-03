// 分単位に丸めた現在時刻（epoch ms）を返すフック。
// セレクタ（applyFilters の sinceDays 判定など）に渡す nowMs を安定させ、useMemo が render ごとに壊れないようにする
// （T-019 レビュー引き継ぎ）。次の分の 0 秒に合わせて更新し、以後も分境界ごとに更新する。

import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/** epoch ms を分単位に切り捨てる。 */
export function floorToMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/**
 * 分単位に丸めた現在時刻を返す。値は分が変わるときだけ更新される。
 * `now` はテストでの差し替え用（省略時は `Date.now`）。
 */
export function useNowMinute(now: () => number = Date.now): number {
  const [minute, setMinute] = useState(() => floorToMinute(now()));

  useEffect(() => {
    // setInterval はドリフトして分境界の数 ms 手前で発火し得るため、毎回「次の分の 0 秒」までを
    // 計算して setTimeout を張り直す（境界を跨いだことを確認してから値を更新する）
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const delay = MINUTE_MS - (now() % MINUTE_MS);
      timeoutId = setTimeout(() => {
        setMinute(floorToMinute(now()));
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, [now]);

  return minute;
}
