// ボード / リスト表示のプレースホルダ。T-023 / T-024 で実装を差し替える（T-020）。
import styles from "./ViewPlaceholder.module.css";

/** ボード表示のプレースホルダ。 */
export function BoardViewPlaceholder() {
  return (
    <div className={styles.placeholder} data-view="board">
      ボード表示（T-023 で実装）
    </div>
  );
}

/** リスト表示のプレースホルダ。 */
export function ListViewPlaceholder() {
  return (
    <div className={styles.placeholder} data-view="list">
      リスト表示（T-024 で実装）
    </div>
  );
}
