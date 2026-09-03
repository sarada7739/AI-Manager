// ボードの 1 列。ColumnHeader + 仮想スクロールしたセッションカード一覧を描画する（T-023）。
import { useVirtualizer } from "@tanstack/react-virtual";
import { type CSSProperties, useEffect, useRef } from "react";
import type { SessionGroup } from "../../../shared/grouping.js";
import { EmptyState } from "../../components/index.js";
import styles from "./BoardColumn.module.css";
import type { FocusedCard } from "./BoardView.js";
import { ColumnHeader } from "./ColumnHeader.js";
import { SessionCard } from "./SessionCard.js";

/**
 * カード高さの見積り（px）。DESIGN.md のトークンでは表せない値のため、CSS ではなく JS 定数として持つ。
 * 実際の高さは最終メッセージの折り返し行数などで変わるため、`useVirtualizer` の `measureElement` で
 * 実測し、この見積りをレンダー後に補正する。
 */
const ESTIMATED_CARD_HEIGHT = 120;

export interface BoardColumnProps {
  group: SessionGroup;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  nowMs: number;
  columnIndex: number;
  focusedCard: FocusedCard | null;
  onFocusCard: (column: number, index: number) => void;
}

/** ボードの 1 列（DESIGN.md §5.1 / §6.2）。 */
export function BoardColumn({
  group,
  selectedKey,
  onSelect,
  nowMs,
  columnIndex,
  focusedCard,
  onFocusCard,
}: BoardColumnProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 仮想化で描画中のカード要素。フォーカス移動時にこの Map から実要素を引いて .focus() する。
  const cardElRefs = useRef(new Map<number, HTMLElement>());

  // focusedCard / columnIndex / group.sessions.length は ref 経由でフォーカス実行 effect に渡す。
  // これらを effect の依存配列に直接入れると、絞り込みやポーリングで列順・件数・focusedCard の参照が
  // 変わるたびに effect が再実行され、ユーザーが検索欄などにいてもカードへ DOM フォーカスが奪われて
  // しまう（レビュー指摘 R2）。effect の依存は requestId（ユーザー操作のたびに単調増加する識別子）だけにする。
  const focusedCardRef = useRef(focusedCard);
  const columnIndexRef = useRef(columnIndex);
  const sessionCountRef = useRef(group.sessions.length);

  // ref への書き戻しはレンダー本体ではなく effect 内で行う（レビュー指摘 R3: レンダー中の
  // ref 書き込みを避ける）。依存配列を持たないため毎レンダー後に実行され、下のフォーカス実行 effect
  // より前に宣言しているため、同じコミット内では必ず先に実行され最新値になる。
  useEffect(() => {
    focusedCardRef.current = focusedCard;
    columnIndexRef.current = columnIndex;
    sessionCountRef.current = group.sessions.length;
  });

  const rowVirtualizer = useVirtualizer({
    count: group.sessions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: 5,
  });

  const focusRequestId = focusedCard?.requestId;

  // フォーカス対象のカードがこの列にあるときだけ、スクロールしてから DOM フォーカスを移す。
  // 依存は focusRequestId（ユーザー操作のたびに単調増加、effect 本体では ref 経由でしか値を読まないため
  // 通常の解析では「不要な依存」に見える）だけにし、データ更新だけでは再実行されないようにする（R2）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusRequestId は再実行のトリガー専用であり、意図的に依存へ残す。
  useEffect(() => {
    const target = focusedCardRef.current;
    if (
      target === null ||
      target === undefined ||
      target.column !== columnIndexRef.current ||
      sessionCountRef.current === 0
    ) {
      return;
    }
    const index = target.index;
    rowVirtualizer.scrollToIndex(index);
    const rafId = requestAnimationFrame(() => {
      cardElRefs.current.get(index)?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [focusRequestId, rowVirtualizer]);

  if (group.sessions.length === 0) {
    return (
      <div className={styles.column} data-column-key={group.key}>
        <div className={styles.scroll}>
          <ColumnHeader group={group} />
          <EmptyState message="このグループにセッションはありません" />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.column} data-column-key={group.key}>
      <div ref={scrollRef} className={styles.scroll}>
        <ColumnHeader group={group} />
        <div className={styles.list}>
          <div
            className={styles.virtualInner}
            style={
              { "--virtual-total-size": `${rowVirtualizer.getTotalSize()}px` } as CSSProperties
            }
          >
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const session = group.sessions[virtualItem.index];
              if (!session) {
                // noUncheckedIndexedAccess 対策。仮想化された範囲は group.sessions.length 以内のため
                // 実際には到達しないが、型を満たすために防御する。
                return null;
              }
              const isFocused =
                focusedCard?.column === columnIndex && focusedCard.index === virtualItem.index;
              return (
                <div
                  key={session.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualItem.index}
                  className={styles.virtualRow}
                  style={{ "--virtual-offset": `${virtualItem.start}px` } as CSSProperties}
                >
                  <SessionCard
                    session={session}
                    selected={selectedKey === session.key}
                    nowMs={nowMs}
                    tabIndex={isFocused ? 0 : -1}
                    cardRef={(el) => {
                      if (el) {
                        cardElRefs.current.set(virtualItem.index, el);
                      } else {
                        cardElRefs.current.delete(virtualItem.index);
                      }
                    }}
                    onSelect={(key) => {
                      onFocusCard(columnIndex, virtualItem.index);
                      onSelect(key);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
