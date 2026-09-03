// 列ヘッダ。状態ドット + ラベル + 件数を表示し、列内スクロール時も上部に固定する（DESIGN.md §6.2）。
import type { SessionGroup } from "../../../shared/grouping.js";
import { Dot } from "../../components/index.js";
import styles from "./ColumnHeader.module.css";

export interface ColumnHeaderProps {
  group: SessionGroup;
}

/** 列ヘッダ（DESIGN.md §6.2）。稼働セッションを含む列は下線が --color-signal になる。 */
export function ColumnHeader({ group }: ColumnHeaderProps) {
  const hasRunning = group.runningCount > 0;

  return (
    <h2 className={styles.header} data-has-running={hasRunning ? "true" : undefined}>
      <span className={styles.left}>
        <Dot state={group.state} />
        <span className={styles.label}>{group.label}</span>
      </span>
      <span className={styles.count}>
        {hasRunning ? (
          <>
            <span className={styles.countNumber}>{group.runningCount}</span>
            <span className={styles.countText}> 稼働 / </span>
            <span className={styles.countNumber}>{group.sessions.length}</span>
          </>
        ) : (
          <span className={styles.countNumber}>{group.sessions.length}</span>
        )}
      </span>
    </h2>
  );
}
