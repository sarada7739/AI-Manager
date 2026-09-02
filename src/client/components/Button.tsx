// primary / ghost の 2 種類のボタン。無効時は理由を隣に表示する（DESIGN.md §6.6）。
import { type ReactNode, useId } from "react";
import styles from "./Button.module.css";

export interface ButtonProps {
  variant: "primary" | "ghost";
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** disabled のときに隣に表示する理由。 */
  reason?: string;
  type?: "button" | "submit";
  className?: string;
}

/**
 * primary は画面に 1 つまで（「送る」）。ghost は「更新」「ボード / リスト」など（DESIGN.md §6.6）。
 * 無効時はネイティブ disabled を付けず aria-disabled にし、onClick を呼ばない。
 */
export function Button({
  variant,
  children,
  onClick,
  disabled = false,
  reason,
  type = "button",
  className,
}: ButtonProps) {
  const reasonId = useId();
  const showReason = disabled && Boolean(reason);
  const classes = [styles.button, styles[variant], disabled ? styles.disabled : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={styles.wrapper}>
      <button
        type={type}
        className={classes}
        aria-disabled={disabled}
        aria-describedby={showReason ? reasonId : undefined}
        onClick={disabled ? undefined : onClick}
      >
        {children}
      </button>
      {showReason ? (
        <span id={reasonId} className={styles.reason}>
          {reason}
        </span>
      ) : null}
    </span>
  );
}
