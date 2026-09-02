// 初回読み込み中のスケルトン。アニメーションなし（DESIGN.md §6.9）。
import styles from "./Loading.module.css";

export interface LoadingProps {
  rows?: number;
  label?: string;
}

/** スケルトン行を rows 件描画する。既定 3 行。更新中の表現には使わない（DESIGN.md §6.9）。 */
export function Loading({ rows = 3, label = "読み込み中" }: LoadingProps) {
  const items = Array.from({ length: rows }, (_, index) => index);
  return (
    <div className={styles.container} role="status" aria-label={label}>
      {items.map((index) => (
        <div key={index} className={styles.row} />
      ))}
    </div>
  );
}
