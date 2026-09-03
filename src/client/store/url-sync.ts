// URL クエリと `view` / `groupBy` / `filters` を双方向同期する。
// 初期化時に URL → ストアへ反映し、以後はストアの変更を購読して history.replaceState で書き戻す。
// React に依存しない（jsdom を使った単体テストからの直接呼び出しを想定）。

import type { StoreApi } from "zustand";
import type { GroupBy, SessionFilters } from "../../shared/grouping.js";
import { DEFAULT_FILTERS } from "../../shared/grouping.js";
import type { SessionStoreState } from "./useSessionStore.js";
import { INITIAL_GROUP_BY, INITIAL_VIEW } from "./useSessionStore.js";

/** URL と同期する状態の部分集合。 */
export interface UrlState {
  view: "board" | "list";
  groupBy: GroupBy;
  filters: SessionFilters;
}

const VIEW_VALUES = new Set<UrlState["view"]>(["board", "list"]);
const GROUP_BY_VALUES = new Set<GroupBy>(["account", "folder", "state", "tool"]);
const TOOL_VALUES = new Set<SessionFilters["tool"]>(["claude", "codex", "all"]);

/** 正の整数のみを受け付ける（"0"・負数・非数値は不可）。 */
function parsePositiveInt(raw: string): number | null {
  return /^[1-9]\d*$/.test(raw) ? Number(raw) : null;
}

/**
 * URL クエリ文字列（`location.search`）からストアの状態を組み立てる。
 * 不正な値・未知の値・キー自体が無い場合は `defaults` にフォールバックする。
 * `folder=""` / `account=""` はそれぞれ「絞り込みなし」= null として扱う（T-018 レビューからの引き継ぎ）。
 * `sinceDays` の「すべて」（null）は `since=all` で表す。`since` は他はすべて正の整数のみを受け付ける。
 */
export function parseUrlState(search: string, defaults: UrlState): UrlState {
  const params = new URLSearchParams(search);

  const rawView = params.get("view");
  const view =
    rawView !== null && VIEW_VALUES.has(rawView as UrlState["view"])
      ? (rawView as UrlState["view"])
      : defaults.view;

  const rawGroupBy = params.get("groupBy");
  const groupBy =
    rawGroupBy !== null && GROUP_BY_VALUES.has(rawGroupBy as GroupBy)
      ? (rawGroupBy as GroupBy)
      : defaults.groupBy;

  const rawTool = params.get("tool");
  const tool =
    rawTool !== null && TOOL_VALUES.has(rawTool as SessionFilters["tool"])
      ? (rawTool as SessionFilters["tool"])
      : defaults.filters.tool;

  const rawAccount = params.get("account");
  const accountKey =
    rawAccount === null ? defaults.filters.accountKey : rawAccount === "" ? null : rawAccount;

  const rawFolder = params.get("folder");
  const folder = rawFolder === null ? defaults.filters.folder : rawFolder === "" ? null : rawFolder;

  const rawSince = params.get("since");
  let sinceDays = defaults.filters.sinceDays;
  if (rawSince === "all") {
    sinceDays = null;
  } else if (rawSince !== null) {
    const parsed = parsePositiveInt(rawSince);
    sinceDays = parsed !== null ? parsed : defaults.filters.sinceDays;
  }

  const rawRunning = params.get("running");
  const runningOnly =
    rawRunning === "1" ? true : rawRunning === "0" ? false : defaults.filters.runningOnly;

  const rawQuery = params.get("q");
  const query = rawQuery !== null ? rawQuery : defaults.filters.query;

  return {
    view,
    groupBy,
    filters: { tool, accountKey, folder, sinceDays, runningOnly, query },
  };
}

/**
 * ストアの状態から URL クエリ文字列を組み立てる。`defaults` と同じ値のキーは省略する。
 * 戻り値はクエリが無ければ `""`、あれば `?` から始まる文字列。
 */
export function buildSearch(state: UrlState, defaults: UrlState): string {
  const params = new URLSearchParams();

  if (state.view !== defaults.view) {
    params.set("view", state.view);
  }
  if (state.groupBy !== defaults.groupBy) {
    params.set("groupBy", state.groupBy);
  }
  if (state.filters.tool !== defaults.filters.tool) {
    params.set("tool", state.filters.tool);
  }
  if (state.filters.accountKey !== defaults.filters.accountKey) {
    params.set("account", state.filters.accountKey ?? "");
  }
  if (state.filters.folder !== defaults.filters.folder) {
    params.set("folder", state.filters.folder ?? "");
  }
  if (state.filters.sinceDays !== defaults.filters.sinceDays) {
    params.set("since", state.filters.sinceDays === null ? "all" : String(state.filters.sinceDays));
  }
  if (state.filters.runningOnly !== defaults.filters.runningOnly) {
    params.set("running", state.filters.runningOnly ? "1" : "0");
  }
  if (state.filters.query !== defaults.filters.query) {
    params.set("q", state.filters.query);
  }

  const search = params.toString();
  return search.length > 0 ? `?${search}` : "";
}

/** `window` のうち url-sync が使う部分（jsdom テストでの差し替え用）。 */
type SyncWindow = Pick<Window, "location" | "history">;

/**
 * URL 同期の既定値。ストアの初期状態と同じ値をモジュール定数から取る。
 * 「呼び出し時点のストア状態」を既定値にすると、React StrictMode の
 * 「実行 → クリーンアップ → 再実行」で 1 回目に URL からストアへ値が反映された後、
 * 2 回目の `startUrlSync` 呼び出し時点ではストアの状態がすでに変わっており、
 * 既定値そのものがズレてしまう（レビュー指摘）。そのため常にこの固定値を使う。
 */
const MODULE_DEFAULTS: UrlState = {
  view: INITIAL_VIEW,
  groupBy: INITIAL_GROUP_BY,
  filters: DEFAULT_FILTERS,
};

/**
 * URL 同期を開始する。
 * `defaults` 省略時はモジュール定数（ストアの初期値と同じ）を使う。現在の URL をストアへ反映した
 * うえで、以後はストアの変更を購読し、既定値と異なるキーだけをクエリに残して
 * `history.replaceState` で URL に書き戻す（現在の URL と同じ内容なら呼ばない）。
 * 戻り値は購読解除関数。
 */
export function startUrlSync(
  store: StoreApi<SessionStoreState>,
  win: SyncWindow = window,
  defaults: UrlState = MODULE_DEFAULTS,
): () => void {
  const fromUrl = parseUrlState(win.location.search, defaults);
  store.setState({ view: fromUrl.view, groupBy: fromUrl.groupBy, filters: fromUrl.filters });

  const writeUrlFromStore = (): void => {
    const current = store.getState();
    const nextSearch = buildSearch(
      { view: current.view, groupBy: current.groupBy, filters: current.filters },
      defaults,
    );
    if (nextSearch === win.location.search) {
      return;
    }
    const nextUrl = `${win.location.pathname}${nextSearch}${win.location.hash}`;
    win.history.replaceState(win.history.state, "", nextUrl);
  };

  return store.subscribe(writeUrlFromStore);
}
