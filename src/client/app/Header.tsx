// ヘッダ帯。タイトル・時計・件数・表示切替・更新ボタンを横並びにする（T-020 / T-025）。
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Pill } from "../components/index.js";
import { RefreshButton } from "../features/refresh/index.js";
import { selectCounts } from "../store/selectors.js";
import { useSessionStore } from "../store/useSessionStore.js";
import styles from "./Header.module.css";

export interface HeaderProps {
  /** 現在時刻。省略時は内部タイマーで 1 分ごとに更新する（テストでの差し替え用）。 */
  now?: Date;
  /** 右端に差し込む追加要素（T-025: LiveStatus）。 */
  extra?: ReactNode;
}

/** `HH:mm` を 24 時間表記で整形する。 */
const clockFormatter = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** ヘッダ帯。DESIGN.md §5.1 のレイアウトに対応する。 */
export function Header({ now: nowProp, extra }: HeaderProps) {
  const [internalNow, setInternalNow] = useState(() => new Date());
  const now = nowProp ?? internalNow;

  // now が props で渡されている間（テスト時）は内部タイマーを持たない。
  useEffect(() => {
    if (nowProp) {
      return;
    }
    let intervalId: ReturnType<typeof setInterval> | undefined;
    // 次の分の 0 秒に合わせてから、以後 60 秒ごとに更新する。
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const timeoutId = setTimeout(() => {
      setInternalNow(new Date());
      intervalId = setInterval(() => setInternalNow(new Date()), 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
    };
  }, [nowProp]);

  const sessions = useSessionStore((state) => state.sessions);
  const view = useSessionStore((state) => state.view);
  const setView = useSessionStore((state) => state.setView);

  // selectCounts は SessionStoreState 全体を要求するため、購読は sessions（参照）の粒度で行い、
  // 計算そのものは selectors.ts の純粋関数に委ねる（sessions が変わった時だけ再計算する）。
  const counts = useMemo(
    () => selectCounts({ ...useSessionStore.getState(), sessions }),
    [sessions],
  );

  return (
    <div className={styles.header}>
      <div className={styles.left}>
        <h1 className={styles.title}>AI-Manager</h1>
        <span className={styles.clock}>{clockFormatter.format(now)} 現在</span>
        <span className={styles.counts}>
          Claude <span className={styles.count}>{counts.claude}</span>{" "}
          <span className={styles.slash}>/</span> Codex{" "}
          <span className={styles.count}>{counts.codex}</span> 件
        </span>
      </div>
      <div className={styles.right}>
        {/* biome-ignore lint/a11y/useSemanticElements: 表示切替のセグメント（トグルボタン群）であり、フォーム部品の fieldset ではないため role="group" を使う（タスクカードの指定）。 */}
        <div className={styles.segment} role="group" aria-label="表示">
          <Pill
            kind="filter"
            label="ボード"
            selected={view === "board"}
            onClick={() => setView("board")}
          />
          <Pill
            kind="filter"
            label="リスト"
            selected={view === "list"}
            onClick={() => setView("list")}
          />
        </div>
        <RefreshButton />
        {extra}
      </div>
    </div>
  );
}
