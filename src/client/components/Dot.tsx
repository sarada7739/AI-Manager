// 状態ドット。色だけでなく形と aria-label でも稼働状態を示す（DESIGN.md §2.4 / §7）。
import type { SessionState } from "../../shared/types.js";
import styles from "./Dot.module.css";

/** 稼働状態 → 日本語ラベル（DESIGN.md §8）。 */
export const STATE_LABELS: Record<SessionState, string> = {
  running: "稼働中",
  active: "作業中",
  idle: "停止",
  error: "エラー",
};

export interface DotProps {
  state: SessionState;
  className?: string;
}

/** 状態ドット。形: running=塗円 / active=半円 / idle=輪郭円 / error=三角（DESIGN.md §2.4）。 */
export function Dot({ state, className }: DotProps) {
  const classes = [styles.dot, styles[state], className].filter(Boolean).join(" ");
  return (
    <span role="img" aria-label={STATE_LABELS[state]} data-state={state} className={classes} />
  );
}
