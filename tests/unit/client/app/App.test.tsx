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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("App", () => {
  it("初回は role=status（Loading）が表示され、データ取得後にプレースホルダ data-view='board' が表示される", async () => {
    const deferred = createDeferred<FakeResponse>();
    const fakeFetch = makeFakeFetch({ sessions: deferred.promise });
    vi.stubGlobal("fetch", fakeFetch);
    vi.resetModules();
    const { App } = await import("../../../../src/client/app/App.js");

    const { container } = render(<App />);

    expect(screen.getByRole("status")).toBeInTheDocument();

    await act(async () => {
      deferred.resolve(jsonResponse(200, { sessions: [makeSession()], generatedAt: NOW_ISO }));
      await deferred.promise;
    });

    await waitFor(() => {
      expect(container.querySelector('[data-view="board"]')).not.toBeNull();
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

  it("ヘッダの『リスト』をクリックすると data-view='list' に切り替わる", async () => {
    const fakeFetch = makeFakeFetch({
      sessions: jsonResponse(200, { sessions: [makeSession()], generatedAt: NOW_ISO }),
    });
    vi.stubGlobal("fetch", fakeFetch);
    vi.resetModules();
    const { App } = await import("../../../../src/client/app/App.js");

    const { container } = render(<App />);
    await waitFor(() => {
      expect(container.querySelector('[data-view="board"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "リスト" }));

    expect(container.querySelector('[data-view="list"]')).not.toBeNull();
    expect(container.querySelector('[data-view="board"]')).toBeNull();
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
      expect(container.querySelector('[data-view="list"]')).not.toBeNull();
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
      expect(container.querySelector('[data-view="board"]')).not.toBeNull();
    });

    expect(() => unmount()).not.toThrow();
  });
});
