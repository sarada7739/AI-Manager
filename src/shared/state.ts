// 稼働状態（running / active / idle）を判定する純粋関数。
// ADR-0003（docs/adr/0003-running-state-detection.md）の 3 段階判定をコード化したもの。
// `error` 状態はこの関数では返さない。ログ読み取り失敗など呼び出し側の事情による状態のため、
// 呼び出し側（server 側）が本関数の結果とは別に付与する。
// node:* / react への依存禁止。

import type { SessionState, StateReason } from "./types.js";

/** 稼働状態判定への入力。 */
export interface StateInput {
  /** `~/.claude/sessions/<pid>.json` が存在するか。 */
  hasProcessMeta: boolean;
  /** 同 PID のプロセスが存在するか。 */
  processAlive: boolean;
  /** procStart がプロセスの起動時刻と一致するか。 */
  procStartMatches: boolean;
  /** プロセス列挙に成功したか。 */
  processInfoAvailable: boolean;
  /** ログの最終更新（epoch ms）。 */
  mtimeMs: number;
  /** 現在時刻（epoch ms）。 */
  nowMs: number;
  /** 作業中とみなす窓（分）。 */
  activeWindowMinutes: number;
}

/** 稼働状態判定の結果。 */
export interface StateResult {
  state: SessionState;
  reason: StateReason;
}

/** `activeWindowMinutes` が未指定・不正な場合に使う既定値（分）。 */
export const DEFAULT_ACTIVE_WINDOW_MINUTES = 5;

/** mtime に基づく判定結果。未来の mtime（時計ずれ）は active 扱いにする。 */
function resolveByMtime(mtimeMs: number, nowMs: number, activeWindowMinutes: number): StateResult {
  const windowMinutes =
    Number.isFinite(activeWindowMinutes) && activeWindowMinutes > 0
      ? activeWindowMinutes
      : DEFAULT_ACTIVE_WINDOW_MINUTES;
  const elapsedMs = nowMs - mtimeMs;
  if (elapsedMs <= windowMinutes * 60_000) {
    return { state: "active", reason: "mtime" };
  }
  return { state: "idle", reason: "none" };
}

/**
 * 稼働状態を判定する。
 *
 * 判定順序（ADR-0003）:
 * 1. プロセス列挙が使えない（processInfoAvailable: false）場合は running 判定を諦め、
 *    mtime 判定の state を使いつつ、根拠は「プロセス情報なし」（no-process-info）にする。
 * 2. プロセスメタあり + プロセス生存 + procStart 一致 → running / process。
 * 3. それ以外（メタなし、プロセス不在、procStart 不一致＝PID 再利用）は mtime 判定へフォールバックする。
 */
export function resolveState(input: StateInput): StateResult {
  const mtimeResult = resolveByMtime(input.mtimeMs, input.nowMs, input.activeWindowMinutes);

  if (!input.processInfoAvailable) {
    return { state: mtimeResult.state, reason: "no-process-info" };
  }

  const isRunning = input.hasProcessMeta && input.processAlive && input.procStartMatches;
  if (isRunning) {
    return { state: "running", reason: "process" };
  }

  return mtimeResult;
}
