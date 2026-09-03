// リストの 1 行。role="row" + role="gridcell"（<table> ではなく role によるグリッド
// セマンティクス。ListView.tsx のコメント参照）。クリック / Enter / Space で選択する
// （F-2 / T-024）。
import type { CSSProperties, KeyboardEvent } from "react";
import {
  formatBytes,
  normalizeBranch,
  shortenPath,
  truncateStart,
} from "../../../shared/format.js";
import { formatRelative } from "../../../shared/time.js";
import type { SessionSummary } from "../../../shared/types.js";
import { Dot, Pill } from "../../components/index.js";
import styles from "./ListRow.module.css";

/** フォルダ表示の最大文字数（表示専用の JS 定数。DESIGN.md にトークン定義は無い）。 */
const FOLDER_MAX_CHARS = 32;

export interface ListRowProps {
  session: SessionSummary;
  selected: boolean;
  /** `useNowMinute()` の値。相対時刻の計算に使う。 */
  nowMs: number;
  onSelect: (key: string) => void;
  /** virtualizer 上のインデックス（0 始まり）。roving tabindex とキーボード移動に使う。 */
  rowIndex: number;
  tabIndex: number;
  /** Enter / Space 以外のキー（↑ ↓ Home End）を ListView 側に委譲するためのハンドラ。 */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** virtualizer が計算したこの行の開始位置（px）。translateY に使う。 */
  virtualOffset: number;
}

/** リストの 1 行。 */
export function ListRow({
  session,
  selected,
  nowMs,
  onSelect,
  rowIndex,
  tabIndex,
  onKeyDown,
  virtualOffset,
}: ListRowProps) {
  const handleSelect = () => onSelect(session.key);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      // Space はページスクロールを起こすため、選択処理の前に必ず preventDefault する。
      event.preventDefault();
      handleSelect();
      return;
    }
    onKeyDown?.(event);
  };

  const rowClasses = [styles.row, selected ? styles.selected : ""].filter(Boolean).join(" ");

  return (
    // biome-ignore lint/a11y/useSemanticElements: <table> ではなく role によるグリッドセマンティクスを採用している（仮想化の transform と <table> が相性が悪いため。ListView.tsx 冒頭のコメント参照）。
    <div
      className={rowClasses}
      role="row"
      // 1 行目はヘッダ（ListView.tsx 側）なので、データ行は 2 始まりにする。
      aria-rowindex={rowIndex + 2}
      aria-selected={selected}
      data-session-key={session.key}
      data-row-index={rowIndex}
      tabIndex={tabIndex}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      style={{ "--virtual-offset": `${virtualOffset}px` } as CSSProperties}
    >
      {/* biome-ignore-start lint/a11y/useSemanticElements: <table> ではなく role によるグリッドセマンティクスを採用している（理由は上の role="row" のコメント参照）。 */}
      {/* biome-ignore-start lint/a11y/useFocusableInteractive: セル単位ではなく行単位で focus を持たせる設計（roving tabindex は ListRow の role="row" 側）のため、gridcell 自体は focusable にしない。 */}
      <div className={`${styles.cell} ${styles.stateCell}`} role="gridcell">
        <Dot state={session.state} />
      </div>
      <div className={styles.cell} role="gridcell">
        <Pill kind="tool" tool={session.tool} />
      </div>
      <div className={styles.cell} role="gridcell">
        {session.title}
      </div>
      <div className={`${styles.cell} ${styles.lastMessage}`} role="gridcell">
        {session.lastMessage}
      </div>
      <div className={`${styles.cell} ${styles.meta}`} role="gridcell">
        {truncateStart(shortenPath(session.cwd, ""), FOLDER_MAX_CHARS)}
      </div>
      <div className={`${styles.cell} ${styles.meta}`} role="gridcell">
        {normalizeBranch(session.branch) ?? "—"}
      </div>
      <div className={`${styles.cell} ${styles.meta}`} role="gridcell">
        {formatBytes(session.logSizeBytes)}
      </div>
      <div className={`${styles.cell} ${styles.meta}`} role="gridcell">
        {formatRelative(session.updatedAt, nowMs)}
      </div>
      {/* biome-ignore-end lint/a11y/useFocusableInteractive: 上記参照。 */}
      {/* biome-ignore-end lint/a11y/useSemanticElements: 上記参照。 */}
    </div>
  );
}
