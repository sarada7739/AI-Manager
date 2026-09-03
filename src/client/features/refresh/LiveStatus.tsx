// 自動更新の状態表示。ヘッダ帯右端に出す（F-9 / T-025）。
// 既存 Header.tsx の「更新中」表示はこのコンポーネントに置き換える。
import { useSessionStore } from "../../store/useSessionStore.js";
import styles from "./LiveStatus.module.css";

/**
 * 「更新中」/「自動更新: 接続」/「自動更新: ポーリング」を状態に応じて出し分ける（props なし）。
 * `status.loading` かつ既にセッションを表示中（＝再読込中）のときだけ「更新中」を優先する。
 */
export function LiveStatus() {
  const loading = useSessionStore((state) => state.status.loading);
  const live = useSessionStore((state) => state.status.live);
  const hasSessions = useSessionStore((state) => state.sessions.length > 0);

  let label: string;
  if (loading && hasSessions) {
    label = "更新中";
  } else if (live) {
    label = "自動更新: 接続";
  } else {
    label = "自動更新: ポーリング";
  }

  return (
    <span className={styles.status} role="status">
      {label}
    </span>
  );
}
