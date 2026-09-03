// ボード表示（F-2）。groupSessions の結果を列として横並びに描画し、キーボードでの列間・カード間移動を扱う（T-023）。
import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from "react";
import type { SessionGroup } from "../../../shared/grouping.js";
import { EmptyState } from "../../components/index.js";
import { selectGroups } from "../../store/selectors.js";
import { useNowMinute } from "../../store/use-now-minute.js";
import { useSessionStore } from "../../store/useSessionStore.js";
import { BoardColumn } from "./BoardColumn.js";
import styles from "./BoardView.module.css";

/**
 * フォーカス中のカード位置（列インデックス・列内のカードインデックス）。
 * `requestId` はユーザー操作（クリック・矢印キー）のたびに単調増加する識別子。
 * `BoardColumn` 側はこの値だけを effect の依存にすることで、データ更新（ポーリングによる
 * 件数・列順の変化）では `scrollToIndex` / `.focus()` を実行しない（レビュー指摘 R2）。
 */
export interface FocusedCard {
  column: number;
  index: number;
  requestId: number;
}

/** 最初にセッションを 1 件以上持つ列のインデックスを返す。全列が空なら 0。 */
function findFirstNonEmptyColumn(groups: SessionGroup[]): number {
  const index = groups.findIndex((group) => group.sessions.length > 0);
  return index === -1 ? 0 : index;
}

/** ボード表示（props なし。ストア購読）。 */
export function BoardView() {
  const sessions = useSessionStore((state) => state.sessions);
  const accounts = useSessionStore((state) => state.accounts);
  const filters = useSessionStore((state) => state.filters);
  const groupBy = useSessionStore((state) => state.groupBy);
  const selectedKey = useSessionStore((state) => state.selectedKey);
  const select = useSessionStore((state) => state.select);
  const nowMs = useNowMinute();

  const groups = useMemo(
    () =>
      selectGroups({ ...useSessionStore.getState(), sessions, accounts, filters, groupBy }, nowMs),
    [sessions, accounts, filters, groupBy, nowMs],
  );

  // 明示的な操作（クリック・矢印キー）でのみ更新する。データ更新（ポーリング）のたびに
  // groups の参照が変わっても、ここは変わらないため、フォーカスを勝手に奪わない。
  const [focusedCard, setFocusedCard] = useState<FocusedCard | null>(null);

  // requestId の発行元。setState のたびに 1 増やし、ユーザー操作の回数を識別する
  // （BoardColumn 側の scrollToIndex / .focus() 実行の唯一のトリガーにする）。
  const requestIdRef = useRef(0);
  const nextRequestId = useCallback(() => {
    requestIdRef.current += 1;
    return requestIdRef.current;
  }, []);

  const handleFocusCard = useCallback(
    (column: number, index: number) => {
      setFocusedCard({ column, index, requestId: nextRequestId() });
    },
    [nextRequestId],
  );

  // 矢印キー操作の判定は、レンダー時にメモ化した groups（クロージャに閉じ込められた値）ではなく、
  // その場でストアから作り直した最新の groups を使う。zustand の setState はコンポーネントの
  // 再レンダーを待たず同期的にストアの内部状態を書き換えるため、直前に絞り込み等が行われた直後の
  // 矢印キー押下では、React の再レンダーがまだコミットされておらず古い groups クロージャのまま
  // イベントが処理されることがある（絞り込みでカードが消えた直後に ↓ を押すと、消えたカードの列の
  // 中で無意味にインデックスを進めてしまう。レビュー指摘 R4）。getState() は常に最新の
  // sessions / filters / groupBy を返すため、これを使えばそのタイミング差を避けられる。
  const getFreshGroups = useCallback((): SessionGroup[] => {
    return selectGroups(useSessionStore.getState(), nowMs);
  }, [nowMs]);

  const moveColumn = useCallback(
    (delta: number) => {
      setFocusedCard((current) => {
        const freshGroups = getFreshGroups();
        if (freshGroups.length === 0) {
          return current;
        }
        // 初回（focusedCard === null）の矢印キーは delta を適用せず、既定位置に確定させるだけにする
        // （レビュー指摘 R2: null のまま delta を足すと最初の 1 回で 1 つ余分に進んでしまうため）。
        if (current === null) {
          const column = findFirstNonEmptyColumn(freshGroups);
          // index は常に 0（Math.min(0, maxIndex) は maxIndex >= 0 なので常に 0 になる。R3 簡略化）。
          return { column, index: 0, requestId: nextRequestId() };
        }
        const nextColumn = Math.min(Math.max(current.column + delta, 0), freshGroups.length - 1);
        const nextGroup = freshGroups[nextColumn];
        if (!nextGroup) {
          // noUncheckedIndexedAccess 対策。nextColumn は freshGroups.length 未満に丸めているため
          // 実際には到達しないが、型を満たすために防御する。
          return current;
        }
        const maxIndex = Math.max(nextGroup.sessions.length - 1, 0);
        return {
          column: nextColumn,
          index: Math.min(current.index, maxIndex),
          requestId: nextRequestId(),
        };
      });
    },
    [getFreshGroups, nextRequestId],
  );

  const moveRow = useCallback(
    (delta: number) => {
      setFocusedCard((current) => {
        const freshGroups = getFreshGroups();
        // 列が 1 つも無いときは何もしない。current === null 分岐より前に置き、
        // 列が無いのに { column: 0, index: 0 } を作ってしまわないようにする（レビュー指摘 R3）。
        if (freshGroups.length === 0) {
          return current;
        }
        // 初回（focusedCard === null）の矢印キーは delta を適用せず、既定位置に確定させるだけにする
        // （moveColumn と同じ理由。レビュー指摘 R2）。
        if (current === null) {
          const column = findFirstNonEmptyColumn(freshGroups);
          return { column, index: 0, requestId: nextRequestId() };
        }
        // 絞り込みで列数が減った場合に備え、column を現在の freshGroups.length にクランプする
        // （NON_BLOCKING 指摘: クランプしないと ↑ ↓ が無反応になりうる）。
        const column = Math.min(Math.max(current.column, 0), freshGroups.length - 1);
        const group = freshGroups[column];
        if (!group || group.sessions.length === 0) {
          // 現在の列が空（絞り込み・ポーリングでフォーカス中のカードが消えた、または
          // 空列にいる状態で ↑ ↓ を押した）なら、その場に留まらず最初の非空列の先頭カードへ移る。
          // 非空列が 1 つも無ければ何もしない（レビュー指摘 R4）。
          const hasNonEmpty = freshGroups.some((candidate) => candidate.sessions.length > 0);
          if (!hasNonEmpty) {
            return current;
          }
          const firstNonEmpty = findFirstNonEmptyColumn(freshGroups);
          return { column: firstNonEmpty, index: 0, requestId: nextRequestId() };
        }
        const maxIndex = group.sessions.length - 1;
        return {
          column,
          index: Math.min(Math.max(current.index + delta, 0), maxIndex),
          requestId: nextRequestId(),
        };
      });
    },
    [getFreshGroups, nextRequestId],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          moveColumn(-1);
          return;
        case "ArrowRight":
          event.preventDefault();
          moveColumn(1);
          return;
        case "ArrowUp":
          event.preventDefault();
          moveRow(-1);
          return;
        case "ArrowDown":
          event.preventDefault();
          moveRow(1);
          return;
        case "Enter": {
          if (focusedCard === null) {
            return;
          }
          // Enter も同じ理由で最新の groups を見て判定する（レビュー指摘 R4 と同じ考え方）。
          const freshGroups = getFreshGroups();
          const session = freshGroups[focusedCard.column]?.sessions[focusedCard.index];
          if (session) {
            event.preventDefault();
            select(session.key);
          }
          return;
        }
        default:
          return;
      }
    },
    [focusedCard, getFreshGroups, moveColumn, moveRow, select],
  );

  const totalVisible = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  const showEmpty = sessions.length > 0 && totalVisible === 0;

  return (
    // biome-ignore lint/a11y/useSemanticElements: DESIGN.md / タスクカードの指定で role="region" の div とする（section にはしない）。
    <div
      className={styles.board}
      data-feature="board"
      role="region"
      aria-label="ボード"
      // 矢印キーでの列・カード移動の起点として領域自体を常に Tab で到達可能にする。focusedCard が
      // 実在するカードを指していない間（空列に移動した直後、絞り込み/ポーリングでフォーカス中の
      // 列・カードが消えた後など）でもボード全体が Tab 到達不能にならないよう常に 0 にする
      // （二重の Tab ストップが生じうる点は元々 NON_BLOCKING として許容。レビュー指摘 R3）。
      // biome-ignore lint/a11y/noNoninteractiveTabindex: 上記コメントの理由により常に 0 にする。
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {showEmpty ? (
        <EmptyState
          message="条件に合うセッションがありません"
          action="絞り込みを解除してください"
        />
      ) : (
        groups.map((group, columnIndex) => (
          <BoardColumn
            key={group.key}
            group={group}
            selectedKey={selectedKey}
            onSelect={select}
            nowMs={nowMs}
            columnIndex={columnIndex}
            focusedCard={focusedCard}
            onFocusCard={handleFocusCard}
          />
        ))
      )}
    </div>
  );
}
