// クライアントの中心状態。ARCHITECTURE.md §6 の状態と、画面共通のアクションを持つ。
// feature 側はこのストアを購読するだけにし、派生データ（絞り込み・グルーピング結果）は
// selectors.ts の純粋関数で計算する（ストアには保存しない）。

import { create } from "zustand";
import type { GroupBy, SessionFilters, SortSpec } from "../../shared/grouping.js";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "../../shared/grouping.js";
import type { Account, SessionSummary, ToolKind } from "../../shared/types.js";
import type { ApiClient, ApiErrorBody } from "../api/client.js";
import { apiClient } from "../api/client.js";

/** 表示形式。 */
export type ViewMode = "board" | "list";

/** 通信状態。 */
export interface SessionStoreStatus {
  loading: boolean;
  error: ApiErrorBody | null;
  lastFetchedAt: string | null;
  /** SSE（T-025）で購読中かどうか。本タスクでは setLive で値を差し替えられるだけ。 */
  live: boolean;
}

/** 指示送信の状態（ADR-0009 / T-032）。 */
export interface SendStatus {
  state: "idle" | "sending" | "sent" | "error";
  /** 成功時「投函しました」、失敗時は API の message + hint。idle 時は空文字。 */
  message: string;
  /** 状態が確定した時刻（epoch ms）。idle 時は null。 */
  at: number | null;
}

/** ストアが持つ状態とアクション。 */
export interface SessionStoreState {
  sessions: SessionSummary[];
  accounts: Account[];
  view: ViewMode;
  groupBy: GroupBy;
  filters: SessionFilters;
  sort: SortSpec;
  /** 読み取り専用モード。既定 true（第 1 段階は送信 API が無いため）。 */
  readOnly: boolean;
  selectedKey: string | null;
  status: SessionStoreStatus;
  /** 指示送信の状態（ADR-0009）。 */
  send: SendStatus;

  /** セッション・アカウントを再取得する。多重フェッチはしない（進行中の Promise を共有する）。 */
  load(): Promise<void>;
  /** サーバに再走査を要求してから load() する。postRefresh 失敗時のエラーは load() の結果で上書きしない。 */
  refresh(): Promise<void>;
  setView(view: ViewMode): void;
  setGroupBy(groupBy: GroupBy): void;
  /** filters の一部だけを差し替える（マージ）。 */
  setFilter(patch: Partial<SessionFilters>): void;
  setSort(sort: SortSpec): void;
  select(key: string | null): void;
  setReadOnly(readOnly: boolean): void;
  /** SSE 購読状態（T-025）。 */
  setLive(live: boolean): void;
  /** filters を DEFAULT_FILTERS に戻す（フィルタバーの「絞り込みを解除」用）。 */
  resetFilters(): void;
  /**
   * 稼働中の Claude セッションへ指示を送る（ADR-0009）。`key` は `claude:<id>` 形式。
   * `readOnly` が true のときは何もしない（防御）。成功・失敗とも 10 秒後に idle へ戻す。
   */
  sendMessage(key: string, text: string): Promise<void>;
}

/** `createSessionStore` の依存。テストではフェイク api を渡す。 */
export interface SessionStoreDeps {
  api: ApiClient;
  /** 現在時刻。省略時は `() => new Date()`（テストでの差し替え用）。 */
  now?: () => Date;
  /** send.state を idle に戻すタイマー。省略時は `setTimeout`（テストでの差し替え用）。 */
  setTimer?: (callback: () => void, ms: number) => void;
}

/** ストア初期状態（アクションを除く）。 */
const INITIAL_STATUS: SessionStoreStatus = {
  loading: false,
  error: null,
  lastFetchedAt: null,
  live: false,
};

/** send の初期状態。 */
const INITIAL_SEND: SendStatus = { state: "idle", message: "", at: null };

/** 送信結果（sent / error）表示を idle に戻すまでの時間（ms）。 */
const SEND_RESET_DELAY_MS = 10_000;

/**
 * `key`（`${tool}:${id}` 形式）を tool / id に分解する。tool が ToolKind でなければ null。
 * DetailPanel.tsx の isToolKind と同じ検証をストア側でも独立に持つ（feature → store の
 * 逆方向 import は禁止のため）。
 */
function parseSessionKey(key: string): { tool: ToolKind; id: string } | null {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex < 0) {
    return null;
  }
  const tool = key.slice(0, separatorIndex);
  const id = key.slice(separatorIndex + 1);
  if (tool !== "claude" && tool !== "codex") {
    return null;
  }
  return { tool, id };
}

/**
 * `view` の初期値（= URL 同期の既定値）。
 * `url-sync.ts` の `startUrlSync` はここではなく「呼び出し時点のストア状態」を既定値にすると、
 * React StrictMode の「実行 → クリーンアップ → 再実行」で 2 回目の既定値が変わってしまう
 * （レビュー指摘）。そのため URL 同期側もこの定数を参照する。
 */
export const INITIAL_VIEW: ViewMode = "board";

/** `groupBy` の初期値（= URL 同期の既定値）。理由は INITIAL_VIEW と同じ。 */
export const INITIAL_GROUP_BY: GroupBy = "account";

/** postRefresh 失敗時に status.error へ入れる専用エラー（サーバが返した生のエラーは使わない）。 */
const REFRESH_FAILED_ERROR: ApiErrorBody = {
  code: "refresh_failed",
  message: "再走査の要求に失敗しました。表示中の一覧は取得済みの最新データです。",
  hint: "時間をおいて「更新」を押してください。",
};

/**
 * セッションストアを組み立てる。
 * `load()` が同時に複数回呼ばれても多重フェッチしないよう、進行中の Promise をこのクロージャ内で共有する
 * （ストアの状態としては持たない。参照が増えるだけで表示には使わないため）。
 */
export function createSessionStore(deps: SessionStoreDeps) {
  const now = deps.now ?? (() => new Date());
  let inFlightLoad: Promise<void> | null = null;

  return create<SessionStoreState>()((set, get) => {
    /** getSessions / getAccounts を並行取得し、両方成功したときだけ置き換える。 */
    const runLoad = async (): Promise<void> => {
      set((state) => ({ status: { ...state.status, loading: true } }));

      const [sessionsResult, accountsResult] = await Promise.all([
        deps.api.getSessions(),
        deps.api.getAccounts(),
      ]);

      if (sessionsResult.ok && accountsResult.ok) {
        set((state) => ({
          sessions: sessionsResult.value.sessions,
          accounts: accountsResult.value.accounts,
          status: {
            loading: false,
            error: null,
            lastFetchedAt: now().toISOString(),
            live: state.status.live,
          },
        }));
        return;
      }

      // どちらかが失敗。既存の sessions / accounts は保持し、最初に見つかった err を status.error に入れる。
      let firstError: ApiErrorBody;
      if (!sessionsResult.ok) {
        firstError = sessionsResult.error;
      } else if (!accountsResult.ok) {
        firstError = accountsResult.error;
      } else {
        // 両方成功なら上の if で return 済みのため実際には到達しない。型を満たすための防御的な値。
        firstError = {
          code: "unknown",
          message: "不明なエラーが発生しました。",
          hint: "時間をおいて「更新」を押してください。",
        };
      }
      set((state) => ({
        status: { ...state.status, loading: false, error: firstError },
      }));
    };

    /**
     * 進行中の load() があればまずその完了を待ってから、新たに 1 回だけ fetch する。
     * refresh() から使う。postRefresh（再走査要求）の前に開始していた load() は再走査前の
     * データを取りに行った可能性があるため、その結果を refresh() の最終状態として共有しない
     * （レビュー指摘）。
     */
    const forceLoad = async (): Promise<void> => {
      if (inFlightLoad) {
        await inFlightLoad;
      }
      const promise = runLoad().finally(() => {
        inFlightLoad = null;
      });
      inFlightLoad = promise;
      await promise;
    };

    return {
      sessions: [],
      accounts: [],
      view: INITIAL_VIEW,
      groupBy: INITIAL_GROUP_BY,
      filters: DEFAULT_FILTERS,
      sort: DEFAULT_SORT,
      readOnly: true,
      selectedKey: null,
      status: INITIAL_STATUS,
      send: INITIAL_SEND,

      load: () => {
        if (inFlightLoad) {
          return inFlightLoad;
        }
        const promise = runLoad().finally(() => {
          inFlightLoad = null;
        });
        inFlightLoad = promise;
        return promise;
      },

      refresh: async () => {
        const refreshResult = await deps.api.postRefresh();
        await forceLoad();
        // postRefresh が失敗していた場合、続く load() が成功して error: null にしていても
        // 専用のエラー（REFRESH_FAILED_ERROR）で上書きし直す。ただし load() 自体が失敗して
        // 独自のエラーを設定している場合は、そちらを優先し上書きしない（レビュー指摘）。
        if (!refreshResult.ok && get().status.error === null) {
          set((state) => ({ status: { ...state.status, error: REFRESH_FAILED_ERROR } }));
        }
      },

      setView: (view) => set({ view }),
      setGroupBy: (groupBy) => set({ groupBy }),
      setFilter: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
      setSort: (sort) => set({ sort }),
      select: (key) => set({ selectedKey: key }),
      setReadOnly: (readOnly) => set({ readOnly }),
      setLive: (live) => set((state) => ({ status: { ...state.status, live } })),
      // 既定値のままでも新しい参照にして、selector 購読が変化を検知できるようにする
      resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),

      sendMessage: async (key, text) => {
        // 読み取り専用のときは呼ばれても何もしない（防御。ComposeBox 側でも「送る」を無効化する）。
        if (get().readOnly) {
          return;
        }
        const timer =
          deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));

        // 不正な key、または送信非対応のツール（Codex は ADR-0009 で送信対象外）は、
        // API を呼ばずにエラー状態にして利用者に理由を見せる（無反応にしない）。
        const parsed = parseSessionKey(key);
        if (parsed === null || parsed.tool !== "claude") {
          set({
            send: {
              state: "error",
              message:
                "このセッションには送信できません。 一覧から稼働中の Claude セッションを選んでください。",
              at: now().getTime(),
            },
          });
          timer(() => set({ send: { ...INITIAL_SEND } }), SEND_RESET_DELAY_MS);
          return;
        }

        set({ send: { state: "sending", message: "", at: null } });
        const result = await deps.api.postMessage(parsed.tool, parsed.id, text);

        if (result.ok) {
          set({ send: { state: "sent", message: "投函しました", at: now().getTime() } });
        } else {
          set({
            send: {
              state: "error",
              message: `${result.error.message} ${result.error.hint}`,
              at: now().getTime(),
            },
          });
        }

        timer(() => set({ send: { ...INITIAL_SEND } }), SEND_RESET_DELAY_MS);
      },
    };
  });
}

/** 既定インスタンス。実 API クライアントを使う。 */
export const useSessionStore = createSessionStore({ api: apiClient });
