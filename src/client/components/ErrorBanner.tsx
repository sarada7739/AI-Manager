// エラーバナー。何が起きたか + 次にどうするかを示す（DESIGN.md §6.10）。
import styles from "./ErrorBanner.module.css";

export interface ErrorBannerProps {
  message: string;
  hint: string;
}

/** フィルタバー直下に表示する（DESIGN.md §6.10）。 */
export function ErrorBanner({ message, hint }: ErrorBannerProps) {
  return (
    <div className={styles.banner} role="alert">
      <p className={styles.message}>{message}</p>
      <p className={styles.hint}>{hint}</p>
    </div>
  );
}
