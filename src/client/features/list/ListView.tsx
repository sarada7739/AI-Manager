// リスト表示（F-2）。sessions / filters / sort / selectedKey をストアから購読し、
// selectSortedSessions で並べ替え済みの一覧を作って TanStack Virtual で仮想化する。
// ネイティブ <table> は仮想化の transform（行位置決め）と相性が悪いため、role 属性に
// よるグリッドセマンティクス（role="grid" / "rowgroup" / "row" / "columnheader" /
// "gridcell"）を採用する（タスクカード T-024 の設計判断。受け入れ条件の
// 「<table> セマンティクス（role 付与）」はこの構造で満たす）。
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SortSpec } from "../../../shared/grouping.js";
import { EmptyState } from "../../components/index.js";
import { selectSortedSessions } from "../../store/selectors.js";
import { useNowMinute } from "../../store/use-now-minute.js";
import { useSessionStore } from "../../store/useSessionStore.js";
import { ListRow } from "./ListRow.js";
import styles from "./ListView.module.css";

/**
 * 行の高さ（px）。`--row-height`（36px）と同値の JS 定数。
 * TanStack Virtual の `estimateSize` は数値を要求するが CSS カスタムプロパティは文字列であり、
 * かつ初回描画前（要素がまだ無い時点）は `getComputedStyle` でも値を取れないため、
 * トークンの値をここでも定数として持つ（tokens.css を変更する際はここも合わせて変更する）。
 */
const ROW_HEIGHT_PX = 36;

/** ヘッダの列定義（表示順そのまま）。`sortKey` が無い列は並べ替え不可。 */
interface ColumnDef {
  label: string;
  sortKey?: SortSpec["key"];
}

const COLUMNS: ColumnDef[] = [
  { label: "状態", sortKey: "state" },
  { label: "種別" },
  { label: "タイトル", sortKey: "title" },
  { label: "最終メッセージ" },
  { label: "フォルダ" },
  { label: "ブランチ" },
  { label: "サイズ", sortKey: "logSizeBytes" },
  { label: "最終更新", sortKey: "updatedAt" },
];

/** リスト表示（props なし。ストア購読）。 */
export function ListView() {
  const sessions = useSessionStore((state) => state.sessions);
  const filters = useSessionStore((state) => state.filters);
  const sort = useSessionStore((state) => state.sort);
  const selectedKey = useSessionStore((state) => state.selectedKey);
  const select = useSessionStore((state) => state.select);
  const setSort = useSessionStore((state) => state.setSort);
  const nowMs = useNowMinute();

  // selectSortedSessions は呼ぶたびに新しい配列を返す純粋関数なので、依存値が変わった
  // ときだけ計算する（selectors.ts の注意書きの通り）。nowMs も依存値に含める（sinceDays
  // の絞り込み判定に使われるため）。
  const sortedSessions = useMemo(
    () => selectSortedSessions({ ...useSessionStore.getState(), sessions, filters, sort }, nowMs),
    [sessions, filters, sort, nowMs],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  // roving tabindex で focus を当てる行のインデックス。
  const [focusedIndex, setFocusedIndex] = useState(0);

  // 絞り込みなどで件数が減ったとき、focusedIndex が範囲外に残らないよう補正する
  // （レビュー指摘: BLOCKING。範囲外のままだと描画中のどの行にも tabIndex=0 が付かず
  // Tab で一覧に入れなくなる）。
  useEffect(() => {
    setFocusedIndex((current) => {
      if (sortedSessions.length === 0) {
        return 0;
      }
      return Math.min(Math.max(current, 0), sortedSessions.length - 1);
    });
  }, [sortedSessions.length]);

  // ヘッダ行はスクロール要素（scrollRef）の中に実在するため、本来は virtualizer に
  // scrollMargin で伝えるべきだが、@tanstack/virtual-core は virtualItem.start に
  // scrollMargin を含める一方 getTotalSize() には含めない仕様のため、start をそのまま
  // --virtual-offset に渡すこの実装と組み合わせると全行がヘッダ高さ分ずれ、最終行が
  // --list-body-height をはみ出す回帰を起こした（Round 2 で追加 → Round 3 で削除）。
  // scrollMargin を使わないままだと可視範囲の計算がヘッダの高さ分だけ早め/遅めにずれる
  // ことになるが、overscan を 10（想定件数に対して十分大きい値）にしているため、
  // 実用上はこのずれを overscan が吸収し、必要な行が描画から漏れることはない。
  const virtualizer = useVirtualizer({
    count: sortedSessions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 10,
  });

  /**
   * 指定インデックスへ focus を移す（範囲外は端に丸める）。
   * scrollToIndex 直後は該当行がまだ DOM に無いことがあるため、requestAnimationFrame で
   * 最大 2 回まで探して focus する（TanStack Virtual 内部の再描画タイミングに依存するため。
   * レビュー指摘の NON_BLOCKING 項目）。
   */
  const moveFocus = useCallback(
    (nextIndex: number) => {
      if (sortedSessions.length === 0) {
        return;
      }
      const clamped = Math.max(0, Math.min(nextIndex, sortedSessions.length - 1));
      setFocusedIndex(clamped);
      virtualizer.scrollToIndex(clamped);

      const tryFocus = (attemptsLeft: number) => {
        requestAnimationFrame(() => {
          const el = scrollRef.current?.querySelector<HTMLDivElement>(
            `[data-row-index="${clamped}"]`,
          );
          if (el) {
            el.focus();
            return;
          }
          if (attemptsLeft > 0) {
            tryFocus(attemptsLeft - 1);
          }
        });
      };
      // 1 回目 + 再試行 1 回 = 最大 2 回。
      tryFocus(1);
    },
    [sortedSessions.length, virtualizer],
  );

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, index: number) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveFocus(index + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveFocus(index - 1);
          break;
        case "Home":
          event.preventDefault();
          moveFocus(0);
          break;
        case "End":
          event.preventDefault();
          moveFocus(sortedSessions.length - 1);
          break;
        default:
          break;
      }
    },
    [moveFocus, sortedSessions.length],
  );

  /** ヘッダクリック時の並べ替え切替。同じ列なら昇降反転、違う列なら既定の向き。 */
  const handleHeaderClick = (key: SortSpec["key"]) => {
    if (sort.key === key) {
      setSort({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      setSort({ key, dir: key === "updatedAt" ? "desc" : "asc" });
    }
  };

  if (sortedSessions.length === 0) {
    return (
      <div className={styles.empty} data-feature="list">
        <EmptyState
          message="条件に合うセッションがありません"
          action="絞り込みを解除してください"
        />
      </div>
    );
  }

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();

  // roving tabindex のタブストップは常にちょうど 1 つにする（レビュー指摘: BLOCKING）。
  // ここに到達する時点で sortedSessions.length > 0 は確定している（0 件は上で早期 return
  // 済み）ため、以降は 0 件分岐を持たない。
  // focusedIndex は length でクランプ済みだが、その行が仮想化ウィンドウの外（overscan の
  // 範囲外）にあって実際には描画されていないことがある。その場合は tabIndex=0 を
  // 描画中の先頭行に退避させ、Tab で一覧に入れなくなる事態を防ぐ。
  // 退避先は「sortedSessions[item.index] が実際に解決できる行」に限定する（count と
  // sortedSessions の更新が一瞬ずれ、virtualItems に存在しないインデックスが混ざっても
  // タブストップが 0 個にならないようにするため。レビュー指摘）。
  const effectiveFocusedIndex = Math.min(Math.max(focusedIndex, 0), sortedSessions.length - 1);
  const resolvedItems = virtualItems.filter((item) => sortedSessions[item.index] !== undefined);
  const isFocusedIndexRendered = resolvedItems.some((item) => item.index === effectiveFocusedIndex);
  const tabStopIndex = isFocusedIndexRendered
    ? effectiveFocusedIndex
    : (resolvedItems[0]?.index ?? effectiveFocusedIndex);

  return (
    // biome-ignore lint/a11y/useSemanticElements: <table> ではなく role によるグリッドセマンティクスを採用している（ファイル冒頭のコメント参照。仮想化の transform と <table> の相性が悪いため）。
    <div
      ref={scrollRef}
      className={styles.grid}
      data-feature="list"
      role="grid"
      aria-label="セッション一覧"
      aria-rowcount={sortedSessions.length + 1}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: 上記参照。 */}
      <div className={styles.headerGroup} role="rowgroup">
        {/* biome-ignore lint/a11y/useSemanticElements: 上記参照。 */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: ヘッダ行自体は選択対象ではないため focusable にしない（並べ替えは内部の button が担う）。 */}
        <div className={styles.headerRow} role="row" aria-rowindex={1}>
          {COLUMNS.map((column) => {
            if (column.sortKey === undefined) {
              return (
                // biome-ignore lint/a11y/useSemanticElements: 上記参照。
                // biome-ignore lint/a11y/useFocusableInteractive: 並べ替え不可の列見出しであり操作要素を持たないため focusable にしない。
                <div key={column.label} className={styles.columnHeader} role="columnheader">
                  {column.label}
                </div>
              );
            }

            const isSorted = sort.key === column.sortKey;
            const ariaSort = isSorted ? (sort.dir === "asc" ? "ascending" : "descending") : "none";

            return (
              // biome-ignore lint/a11y/useSemanticElements: 上記参照。
              // biome-ignore lint/a11y/useFocusableInteractive: 列見出し本体ではなく内部の button（並べ替え操作）を focusable にする設計のため。
              <div
                key={column.label}
                className={styles.columnHeader}
                role="columnheader"
                aria-sort={ariaSort}
              >
                <button
                  type="button"
                  className={styles.headerButton}
                  onClick={() => handleHeaderClick(column.sortKey as SortSpec["key"])}
                >
                  {column.label}
                  {isSorted ? (
                    <span className={styles.sortArrow} aria-hidden="true">
                      {sort.dir === "asc" ? "▲" : "▼"}
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: 上記参照。 */}
      <div
        className={styles.bodyGroup}
        role="rowgroup"
        style={{ "--list-body-height": `${totalSize}px` } as CSSProperties}
      >
        {virtualItems.map((virtualItem) => {
          const session = sortedSessions[virtualItem.index];
          if (session === undefined) {
            return null;
          }
          return (
            <ListRow
              key={session.key}
              session={session}
              selected={session.key === selectedKey}
              nowMs={nowMs}
              onSelect={select}
              rowIndex={virtualItem.index}
              tabIndex={tabStopIndex === virtualItem.index ? 0 : -1}
              onKeyDown={(event) => handleRowKeyDown(event, virtualItem.index)}
              virtualOffset={virtualItem.start}
            />
          );
        })}
      </div>
    </div>
  );
}
