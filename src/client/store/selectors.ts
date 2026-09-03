// 派生データ（絞り込み後・グループ後）を計算する純粋関数。
// ARCHITECTURE.md §6「派生データはストアに二重に持たない」に対応する。ストアには保存せず、
// コンポーネント側で `useMemo` して使うことを前提にする（このファイル自体はメモ化しない）。
//
// 注意（レビュー指摘）: このファイルの関数は呼ぶたびに新しい配列・オブジェクトを返す。
// `useSessionStore(selectGroups)` のように zustand のセレクタとしてそのまま渡すと、
// 参照が毎回変わるため無限に再レンダリングされる。必ずコンポーネント側で
// `useMemo(() => selectGroups(state, nowMs), [依存値...])` のように使うこと。
// `nowMs` は `Date.now()` を毎回渡すと依存値が絶えず変わってしまうので、呼び出し側で
// 分単位などに丸めた安定した値を用意して渡すこと。

import {
  applyFilters,
  folderOptions,
  groupSessions,
  type SessionGroup,
  sortSessions,
} from "../../shared/grouping.js";
import type { SessionSummary } from "../../shared/types.js";
import type { SessionStoreState } from "./useSessionStore.js";

/**
 * filters を適用した後のセッション一覧。
 * `nowMs`（sinceDays の基準時刻）は呼び出し側が明示的に渡すことを推奨する引数。
 * 本来は必須にしたい（`Date.now()` を既定値にすると呼ぶたびに結果が変わり、純粋関数として
 * 扱えないため。レビュー指摘）が、`src/client/app/App.tsx` / `Header.tsx`（T-020 の範囲。
 * このタスクでは変更不可）がすでに `nowMs` を渡さずに `selectCounts` を呼んでおり、必須化すると
 * `pnpm typecheck` が壊れるため、既定値 `Date.now()` を残す（判断は報告に記載）。
 */
export function selectFilteredSessions(
  state: SessionStoreState,
  nowMs: number = Date.now(),
): SessionSummary[] {
  return applyFilters(state.sessions, state.filters, nowMs);
}

/**
 * groupBy でグルーピングした列一覧。
 * 注意: `SessionGroup.key` は folder 軸だけ正規化済みの小文字文字列（表示用ではない）。
 * 画面表示には必ず `label` を使うこと（T-018 レビューからの引き継ぎ）。
 */
export function selectGroups(state: SessionStoreState, nowMs: number = Date.now()): SessionGroup[] {
  return groupSessions(selectFilteredSessions(state, nowMs), state.groupBy, state.accounts);
}

/** sort を適用した後のセッション一覧（リスト表示用）。 */
export function selectSortedSessions(
  state: SessionStoreState,
  nowMs: number = Date.now(),
): SessionSummary[] {
  return sortSessions(selectFilteredSessions(state, nowMs), state.sort);
}

/** フォルダ絞り込みの選択肢一覧（フィルタバーのセレクト用）。絞り込み前の全セッションから作る。 */
export function selectFolderOptions(
  state: SessionStoreState,
): Array<{ folder: string; count: number }> {
  return folderOptions(state.sessions);
}

/**
 * 稼働中（running）の Claude セッションだけを抽出する。
 * `ComposeBox` の宛先候補（DESIGN.md §6.11。Codex は宛先に出さない）。
 */
export function selectRunningClaudeSessions(state: SessionStoreState): SessionSummary[] {
  return state.sessions.filter(
    (session) => session.tool === "claude" && session.state === "running",
  );
}

/** 選択中のセッション要約。未選択、または一覧から消えていれば null。 */
export function selectSelectedSession(state: SessionStoreState): SessionSummary | null {
  if (state.selectedKey === null) {
    return null;
  }
  return state.sessions.find((session) => session.key === state.selectedKey) ?? null;
}

/** ヘッダ帯・件数表示で使う集計値。 */
export interface SessionCounts {
  /** 絞り込み前の総数。 */
  total: number;
  /** 絞り込み後の件数。 */
  visible: number;
  claude: number;
  codex: number;
  running: number;
}

/** 件数集計。`claude` / `codex` / `running` は絞り込み前の全セッションから数える。 */
export function selectCounts(state: SessionStoreState, nowMs: number = Date.now()): SessionCounts {
  return {
    total: state.sessions.length,
    visible: selectFilteredSessions(state, nowMs).length,
    claude: state.sessions.filter((session) => session.tool === "claude").length,
    codex: state.sessions.filter((session) => session.tool === "codex").length,
    running: state.sessions.filter((session) => session.state === "running").length,
  };
}
