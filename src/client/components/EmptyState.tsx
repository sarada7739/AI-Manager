// 空状態。メッセージと次の行動を示す（DESIGN.md §6.8）。
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  message: string;
  /** 次の行動を示す文（例: 絞り込みを解除してください）。 */
  action?: string;
}

/** 列内または一覧全体の中央に表示する（DESIGN.md §6.8）。 */
export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className={styles.container}>
      <p className={styles.message}>{message}</p>
      {action ? <p className={styles.action}>{action}</p> : null}
    </div>
  );
}
