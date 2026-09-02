// 相対時刻の文言を組み立てる純粋関数。
// DESIGN.md §8「文言のルール」の表記に従う。
// node:* / react への依存禁止。

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** 2 桁になるようゼロ埋めする。 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * ISO 日時文字列を、基準時刻 `nowMs` から見た相対時刻の文言に変換する。
 * - 差が 60 秒未満（未来も含む） → 「たった今」
 * - 60 分未満 → 「N分前」
 * - 24 時間未満 → 「N時間前」
 * - 7 日未満 → 「N日前」
 * - それ以上 → ローカル日付 `YYYY-MM-DD`
 * `iso` が不正な日時文字列の場合は「—」を返す。
 */
export function formatRelative(iso: string, nowMs: number): string {
  const targetMs = new Date(iso).getTime();
  if (Number.isNaN(targetMs)) {
    return "—";
  }

  const diffMs = nowMs - targetMs;

  // diffMs が負（未来）の場合もここに含めて「たった今」にする。
  if (diffMs < MINUTE_MS) {
    return "たった今";
  }
  if (diffMs < HOUR_MS) {
    return `${Math.floor(diffMs / MINUTE_MS)}分前`;
  }
  if (diffMs < DAY_MS) {
    return `${Math.floor(diffMs / HOUR_MS)}時間前`;
  }
  if (diffMs < WEEK_MS) {
    return `${Math.floor(diffMs / DAY_MS)}日前`;
  }

  const target = new Date(targetMs);
  const year = target.getFullYear();
  const month = pad2(target.getMonth() + 1);
  const day = pad2(target.getDate());
  return `${year}-${month}-${day}`;
}
