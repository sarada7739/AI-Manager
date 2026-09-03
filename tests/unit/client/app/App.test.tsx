// T-020 受け入れ条件:
// 「起動時に load() を呼び、Loading → 本体、エラー時は ErrorBanner」
// 「view の切替で BoardView / ListView のプレースホルダが切り替わる」
// 「タイトルバー document.title が『AI-Manager · N 稼働』になる」
//
// App は既定インスタンス useSessionStore（実 apiClient、globalThis.fetch を使う）に依存する。
// createApiClient は `opts.fetch ?? globalThis.fetch` をモジュール評価時に一度だけ捕捉するため、
// テスト本体で vi.stubGlobal("fetch", ...) するだけでは既にロード済みの apiClient には反映されない
// （実測済み）。そのため各テストで vi.resetModules() → フェイク fetch を stub → 動的 import で
// App を含むモジュールグラフを丸ごと作り直し、テストごとに独立した store / apiClient を得る。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../../../../src/shared/types.js";

const NOW_ISO = "2026-01-01T00:00:00.000Z";

// App は T-025 で useAutoRefresh()（SSE 購読 + ポーリングフォールバック）を呼ぶようになった。
// jsdom は EventSource を実装していないため既定では自動的にポーリングのみへフォールバックするが、
// タスクカードの指定どおり明示的にフェイク EventSource を注入し、購読・close 呼び出しで
// 例外が起きないことを保証する。
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {
    this.closed = true;
  }
}

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    key: "claude:00000000-0000-4000-8000-000000000001",
    tool: "claude",
    id: "00000000-0000-4000-8000-000000000001",
    title: "合成タイトル",
    lastMessage: "合成メッセージ",
    lastRole: "assistant",
    cwd: "C:/synthetic/work",
    branch: "main",
    model: "synthetic-model",
    entrypoint: "cli",
    accountKey: "claude:cli",
    state: "idle",
    stateReason: "none",
    pid: null,
    startedAt: null,
    firstAt: NOW_ISO,
    updatedAt: NOW_ISO,
    logSizeBytes: 100,
    subagentCount: 0,
    released: false,
    ...overrides,
  };
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function jsonResponse(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** url に応じて sessions / accounts の応答を返すフェイク fetch を作る。 */
function makeFakeFetch(opts: {
  sessions?: FakeResponse | Promise<FakeResponse>;
  accounts?: FakeResponse | Promise<FakeResponse>;
}): ReturnType<typeof vi.fn> {
  const sessions = opts.sessions ?? jsonResponse(200, { sessions: [], generatedAt: NOW_ISO });
  const accounts = opts.accounts ?? jsonResponse(200, { accounts: [] });
  return vi.fn(async (url: string) => {
    if (url.includes("/api/sessions")) {
      return sessions;
    }
    if (url.includes("/api/accounts")) {
      return accounts;
    }
    throw new Error(`テストで想定していない URL: ${url}`);
  });
}

/** 解決タイミングを手動で制御できる Promise を作る。 */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  const box: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>((res) => {
    box.resolve = res;
  });
  return {
    promise,
    resolve: (value: T) => {
      box.resolve?.(value);
    },
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("App", () => {
  it("初回は role=status（Loading）が表示され、データ取得後にプレースホルダ data-feature='board' が表示される", async () => {
    const deferred = createDeferred<FakeResponse>();
    const fakeFetch = makeFakeFetch({ sessions: deferred.promise });
    vi.stubGlobal("fetch", fakeFetch);
    vi.resetModules();
    const { App } = await import("../../../../src/client/app/App.js");

    const { container } = render(<App />);

    // role=status は初回ローディングの Loading（aria-label『読み込み中』）と、ヘッダ右端の
    // LiveStatus（T-025 で常設）の 2 つが同時に存在しうるため、Loading の方を名前で区別する。
    expect(screen.getByRole("status", { name: "読み込み中" })).toBeInTheDocument();

    await act(async () => {
      deferred.resolve(jsonResponse(200, { sessions: [makeSession()], generatedAt: NOW_ISO }));
      await deferred.promise;
    });

    await waitFor(() => {
      expect(container.querySelector('[data-feature="board"]')).not.toBeNull();
    });
    expect(screen.queryByRole("status", { name: "読み込み中" })).not.toBeInTheDocument();
  });

  it("document.title が『AI-Manager · 1 稼働』になる（running 1 件）", async () => {
    const fakeFetch = makeFakeFetch({
      sessions: jsonResponse(200, {
        sessions: [
          makeSession({ key: "claude:1", state: "running" }),
          makeSession({ key: "claude:2", state: "idle" }),
        ],
        generatedAt: NOW_ISO,
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);
    vi.resetModules();
    const { App } = await import("../../../../src/client/app/App.js");

    render(<App />);

    await waitFor(() => {
      expect(document.title).toBe("AI-Manager · 1 稼働");
    });
  });

  it("fetch が 500 で { error } を返すと role=alert に message と hint が表示される", async () => {
    const fakeFetch = makeFakeFetch({
      sessions: jsonResponse(500, {
        error: {
          code: "http_500",
          message: "セッションログを読めませんでした。",
          hint: "「更新」を押してください。",
        },
      }),
    });
    vi.stubGlobal("fetch", fakeFetch);
    vi.resetModules();
    const { App } = await import("../../../../src/client/app/App.js");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("セッションログを読めませんでした。");
    expect(alert).toHaveTextContent("「更新」を押してください。");
  });

  it("データ 0 件のとき EmptyState の文言が表示される", async () => {
    const fakeFetch = makeFakeFetch({});
    vi.stubGlobal("fetch", fakeFetch);
    vi.resetModules();
    const { App } = await import("../../../../src/client/app/App.js");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("セッションがありません")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Claude Code か Codex を一度起動してから「更新」を押してください"),
    ).toBeInTheDocument();
  });

  it("ヘッダの『リスト』をクリックすると data-feature='list' に切り替わる", async () => {
    const fakeFetch = makeFakeFetch({
      sessions: jsonResponse(200, { sessions: [makeSession()], generatedAt: NOW_ISO }),
    });
    vi.stubGlobal("fetch", fakeFetch);
    vi.resetModules();
    const { App } = await import("../../../../src/client/app/App.js");

    const { container } = render(<App />);
    await waitFor(() => {
      expect(container.querySelector('[data-feature="board"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "リスト" }));

    expect(container.querySelector('[data-feature="list"]')).not.toBeNull();
    expect(container.querySelector('[data-feature="board"]')).toBeNull();
  });

  it("startUrlSync により初期 URL ?view=list で起動するとリスト表示になる", async () => {
    window.history.replaceState(null, "", "/?view=list");
    const fakeFetch = makeFakeFetch({
      sessions: jsonResponse(200, { sessions: [makeSession()], generatedAt: NOW_ISO }),
    });
    vi.stubGlobal("fetch", fakeFetch);
    vi.resetModules();
    const { App } = await import("../../../../src/client/app/App.js");

    const { container } = render(<App />);

    await waitFor(() => {
      expect(container.querySelector('[data-feature="list"]')).not.toBeNull();
    });
  });

  it("アンマウントしても例外が起きない", async () => {
    const fakeFetch = makeFakeFetch({
      sessions: jsonResponse(200, { sessions: [makeSession()], generatedAt: NOW_ISO }),
    });
    vi.stubGlobal("fetch", fakeFetch);
    vi.resetModules();
    const { App } = await import("../../../../src/client/app/App.js");

    const { container, unmount } = render(<App />);
    await waitFor(() => {
      expect(container.querySelector('[data-feature="board"]')).not.toBeNull();
    });

    expect(() => unmount()).not.toThrow();
  });

  it("配線: compose / accounts / filters / board の各 feature スロットが描画される（data-feature）", async () => {
    const fakeFetch = makeFakeFetch({
      sessions: jsonResponse(200, { sessions: [makeSession()], generatedAt: NOW_ISO }),
    });
    vi.stubGlobal("fetch", fakeFetch);
    vi.resetModules();
    const { App } = await import("../../../../src/client/app/App.js");

    const { container } = render(<App />);
    await waitFor(() => {
      expect(container.querySelector('[data-feature="board"]')).not.toBeNull();
    });

    expect(container.querySelector('[data-feature="compose"]')).not.toBeNull();
    expect(container.querySelector('[data-feature="account-strip"]')).not.toBeNull();
    expect(container.querySelector('[data-feature="filter-bar"]')).not.toBeNull();
  });

  it("Header の extra スロットに LiveStatus（自動更新の状態表示）が描画される", async () => {
    const fakeFetch = makeFakeFetch({
      sessions: jsonResponse(200, { sessions: [makeSession()], generatedAt: NOW_ISO }),
    });
    vi.stubGlobal("fetch", fakeFetch);
    vi.resetModules();
    const { App } = await import("../../../../src/client/app/App.js");

    const { container } = render(<App />);
    // 読み込み完了（board 表示）まで待つ。完了後は role=status の要素が LiveStatus 1 つだけになる
    // （初回ローディングの Loading は読み込み中しか role=status を持たないため）。
    await waitFor(() => {
      expect(container.querySelector('[data-feature="board"]')).not.toBeNull();
    });

    const statusEl = screen.getByRole("status");
    expect(["自動更新: 接続", "自動更新: ポーリング", "更新中"]).toContain(statusEl.textContent);
  });
});
