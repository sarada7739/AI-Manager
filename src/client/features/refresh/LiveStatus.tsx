// 自動更新の状態表示。ヘッダ帯右端に出す（F-9 / T-025）。send（ADR-0009 / T-032）が
// idle 以外のときは自動更新の表示より優先して送信結果を出す。
// 既存 Header.tsx の「更新中」表示はこのコンポーネントに置き換える。
import { useSessionStore } from "../../store/useSessionStore.js";
import styles from "./LiveStatus.module.css";

/**
 * 送信状態が優先表示（「送信中…」「送信: 投函しました」「▲ 送信: 失敗（…）」）を持たないときだけ、
 * 「更新中」/「自動更新: 接続」/「自動更新: ポーリング」を状態に応じて出し分ける（props なし）。
 * `status.loading` かつ既にセッションを表示中（＝再読込中）のときだけ「更新中」を優先する。
 */
export function LiveStatus() {
  const loading = useSessionStore((state) => state.status.loading);
  const live = useSessionStore((state) => state.status.live);
  const hasSessions = useSessionStore((state) => state.sessions.length > 0);
  const sendState = useSessionStore((state) => state.send.state);
  const sendMessage = useSessionStore((state) => state.send.message);

  let label: string;
  let isError = false;
  // 送信結果（sending / sent / error）は §6.11 で --text-sm 指定のため専用クラスを足す。
  const isSend = sendState !== "idle";

  if (sendState === "sending") {
    label = "送信中…";
  } else if (sendState === "sent") {
    label = "送信: 投函しました";
  } else if (sendState === "error") {
    label = `▲ 送信: 失敗（${sendMessage}）`;
    isError = true;
  } else if (loading && hasSessions) {
    label = "更新中";
  } else if (live) {
    label = "自動更新: 接続";
  } else {
    label = "自動更新: ポーリング";
  }

  const className = [styles.status, isSend ? styles.send : "", isError ? styles.error : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={className} role="status">
      {label}
    </span>
  );
}
