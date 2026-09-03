// T-025 受け入れ条件（DetailPanel）:
// 「DetailPanel が右側 --panel-width に開き、DESIGN.md §5.3 の項目を表示。recentMessages を
//   role ラベル付きで最大 20 件。Esc / × で閉じる。読み込み中は Loading、失敗は ErrorBanner」
// 「詳細パネルはクライアントで本文を加工しない」
//
// apiClient.getSession は vi.mock で差し替える（他のメソッドは実装のまま）。
// 合成データのみ。ストアは既定インスタンス useSessionStore を使い、beforeEach で初期状態に戻す。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody } from "../../../../../src/client/api/client.js";
import { apiClient } from "../../../../../src/client/api/client.js";
import { DetailPanel } from "../../../../../src/client/features/session-detail/DetailPanel.js";
import { useSessionStore } from "../../../../../src/client/store/useSessionStore.js";
import { DEFAULT_FILTERS, DEFAULT_SORT } from "../../../../../src/shared/grouping.js";
import type { Result } from "../../../../../src/shared/result.js";
import type { SessionDetail, SessionSummary } from "../../../../../src/shared/types.js";

// DetailPanel は apiClient を直接 import して使う（props で注入できない）ため、モジュールごと
// vi.mock し、getSession だけ vi.fn に差し替える。他のメソッドは実装のまま残す。
vi.mock("../../../../../src/client/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../src/client/api/client.js")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      getSession: vi.fn(),
    },
  };
});

const NOW_ISO = "2026-01-01T00:00:00.000Z";

function getSessionMock() {
  return apiClient.getSession as unknown as ReturnType<typeof vi.fn>;
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
    logSizeBytes: 3_984_588,
    subagentCount: 0,
    released: false,
    ...overrides,
  };
}

function makeDetail(
  session: SessionSummary,
  overrides: Partial<Pick<SessionDetail, "recentMessages" | "parseWarnings">> = {},
): SessionDetail {
  return {
    ...session,
    recentMessages: [],
    parseWarnings: [],
    ...overrides,
  };
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

/** 既定インスタンス useSessionStore を初期状態に戻す（他テストからの汚染を防ぐ）。 */
function resetStore(): void {
  useSessionStore.setState({
    sessions: [],
    accounts: [],
    view: "board",
    groupBy: "account",
    filters: DEFAULT_FILTERS,
    sort: DEFAULT_SORT,
    readOnly: true,
    selectedKey: null,
    status: { loading: false, error: null, lastFetchedAt: null, live: false },
  });
}

beforeEach(() => {
  resetStore();
  getSessionMock().mockReset();
  // 既定では常に成功させる（selectedKey の副作用として発火する取得 effect が、個々のテストで
  // 明示的にモックしていない場合でも例外を投げないようにするための安全なフォールバック）。
  getSessionMock().mockResolvedValue({ ok: true, value: makeDetail(makeSession()) });
});

afterEach(() => {
  cleanup();
  resetStore();
  vi.restoreAllMocks();
});

describe("DetailPanel", () => {
  it("selectedKey が null のとき何も描画しない", () => {
    const { container } = render(<DetailPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("selectedKey がストアの sessions に無いときも何も描画しない（消えたセッションを選び直した場合）", () => {
    useSessionStore.setState({ selectedKey: "claude:not-in-list" });
    const { container } = render(<DetailPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("role=dialog でタイトル・<dl> 6 項目・最近のメッセージ 3 件・parseWarnings を表示し、本文を加工しない（sk-ant- を含む本文がそのまま出る）", async () => {
    const session = makeSession();
    const detail = makeDetail(session, {
      recentMessages: [
        { role: "user", at: NOW_ISO, text: "sk-ant-api03-secret-token を含む本文" },
        { role: "assistant", at: "2026-01-01T00:05:00.000Z", text: "2 件目の本文" },
        { role: "user", at: "2026-01-01T00:10:00.000Z", text: "3 件目の本文" },
      ],
      parseWarnings: ["1 件の行を解釈できませんでした。"],
    });
    getSessionMock().mockResolvedValue({ ok: true, value: detail });
    useSessionStore.setState({ sessions: [session], selectedKey: session.key });

    render(<DetailPanel />);

    const dialog = screen.getByRole("dialog", { name: "セッション詳細" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: session.title })).toBeInTheDocument();

    // <dl> 6 項目（作業ディレクトリ / ブランチ / モデル / ログサイズ / 最終更新 / セッション ID）。
    const dl = dialog.querySelector("dl");
    expect(dl).not.toBeNull();
    expect(dl?.textContent).toContain(session.cwd);
    expect(dl?.textContent).toContain(session.branch);
    expect(dl?.textContent).toContain(session.model);
    expect(dl?.textContent).toContain("3.8 MB");
    // セッション ID は先頭 4 + … + 末尾 4 で短縮され、UUID 全文は出ない。
    expect(dl?.textContent).toContain("0000…0001");
    expect(dl?.textContent).not.toContain(session.id);

    await waitFor(() => {
      expect(dialog.querySelectorAll("li[data-role]")).toHaveLength(3);
    });

    const items = dialog.querySelectorAll("li[data-role]");
    expect(items[0]).toHaveAttribute("data-role", "user");
    expect(items[1]).toHaveAttribute("data-role", "assistant");
    // クライアントで本文を加工しない: sk-ant- を含む文字列がそのまま出る。
    expect(items[0]?.textContent).toContain("sk-ant-api03-secret-token を含む本文");

    // レビュー指摘: 「N 件の行を解釈できませんでした。表示に影響はありません。」（句点 1 つずつ）で
    // 全文一致すること（二重句点や表記ゆれの回帰）。
    expect(dialog.textContent).toContain(
      "1 件の行を解釈できませんでした。表示に影響はありません。",
    );
  });

  it("同一ロール・同一時刻のメッセージが 2 件でも console.error が呼ばれない（key にインデックスを含む。BLOCKING 回帰）", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const session = makeSession();
    getSessionMock().mockResolvedValue({
      ok: true,
      value: makeDetail(session, {
        recentMessages: [
          { role: "user", at: NOW_ISO, text: "同時刻 1 件目" },
          { role: "user", at: NOW_ISO, text: "同時刻 2 件目" },
        ],
      }),
    });
    useSessionStore.setState({ sessions: [session], selectedKey: session.key });

    render(<DetailPanel />);

    await waitFor(() => {
      expect(document.querySelectorAll("li[data-role]")).toHaveLength(2);
    });

    // React が重複 key を検出すると console.error に警告を出す。role・at が同じでも
    // インデックスを key に含めていれば警告は出ない。
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(screen.getByText("同時刻 1 件目")).toBeInTheDocument();
    expect(screen.getByText("同時刻 2 件目")).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it("recentMessages を 25 件返したら 25 件そのまま表示する（クライアントで件数を切らない）", async () => {
    const session = makeSession();
    const recentMessages = Array.from({ length: 25 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      at: NOW_ISO,
      text: `本文${i}`,
    }));
    getSessionMock().mockResolvedValue({
      ok: true,
      value: makeDetail(session, { recentMessages }),
    });
    useSessionStore.setState({ sessions: [session], selectedKey: session.key });

    render(<DetailPanel />);

    await waitFor(() => {
      expect(document.querySelectorAll("li[data-role]")).toHaveLength(25);
    });
  });

  it("recentMessages が 0 件（取得成功）のとき案内文を表示し、1 件以上なら表示しない（T-028）", async () => {
    const session = makeSession();
    getSessionMock().mockResolvedValue({
      ok: true,
      value: makeDetail(session, { recentMessages: [] }),
    });
    useSessionStore.setState({ sessions: [session], selectedKey: session.key });

    render(<DetailPanel />);

    await waitFor(() => {
      expect(document.querySelector('[data-empty-messages="true"]')).not.toBeNull();
    });
    expect(screen.getByText(/直近のログに表示できる発言がありません/)).toBeInTheDocument();
    // reviewer Round 1 指摘: 文言が変わった（次にどうするかの案内を追加）。新しい文言も照合する。
    expect(screen.getByText(/しばらくしてから「更新」を押してください/)).toBeInTheDocument();
    expect(document.querySelectorAll("li[data-role]")).toHaveLength(0);
    // reviewer Round 1 指摘: 0 件のときは <ol>（.messageList）自体を描画しない。
    expect(document.querySelector("ol")).toBeNull();
  });

  it("recentMessages が 1 件以上のときは案内文を出さない（T-028）", async () => {
    const session = makeSession();
    getSessionMock().mockResolvedValue({
      ok: true,
      value: makeDetail(session, {
        recentMessages: [{ role: "user", at: NOW_ISO, text: "本文" }],
      }),
    });
    useSessionStore.setState({ sessions: [session], selectedKey: session.key });

    render(<DetailPanel />);

    await waitFor(() => {
      expect(document.querySelectorAll("li[data-role]")).toHaveLength(1);
    });
    expect(document.querySelector('[data-empty-messages="true"]')).toBeNull();
  });

  it("取得中は role=status（Loading）が表示される", async () => {
    const deferred = createDeferred<Result<SessionDetail, ApiErrorBody>>();
    getSessionMock().mockReturnValue(deferred.promise);
    const session = makeSession();
    useSessionStore.setState({ sessions: [session], selectedKey: session.key });

    render(<DetailPanel />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    // reviewer Round 1 指摘: 取得中は案内文（空メッセージ用）を出してはならない。
    expect(document.querySelector('[data-empty-messages="true"]')).toBeNull();

    await act(async () => {
      deferred.resolve({ ok: true, value: makeDetail(session) });
      await deferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  it("取得失敗時は role=alert に message / hint が表示される", async () => {
    const session = makeSession();
    getSessionMock().mockResolvedValue({
      ok: false,
      error: {
        code: "http_500",
        message: "セッション詳細を読めませんでした。",
        hint: "一覧から選び直してください。",
      },
    });
    useSessionStore.setState({ sessions: [session], selectedKey: session.key });

    render(<DetailPanel />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("セッション詳細を読めませんでした。");
    expect(alert).toHaveTextContent("一覧から選び直してください。");
    // reviewer Round 1 指摘: 取得失敗時は案内文（空メッセージ用）を出してはならない。
    expect(document.querySelector('[data-empty-messages="true"]')).toBeNull();
  });

  it("Escape で selectedKey が null になる（閉じる）", async () => {
    const session = makeSession();
    getSessionMock().mockResolvedValue({ ok: true, value: makeDetail(session) });
    useSessionStore.setState({ sessions: [session], selectedKey: session.key });

    render(<DetailPanel />);
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(useSessionStore.getState().selectedKey).toBeNull();
  });

  it("×（閉じるボタン）クリックで selectedKey が null になる", async () => {
    const session = makeSession();
    getSessionMock().mockResolvedValue({ ok: true, value: makeDetail(session) });
    useSessionStore.setState({ sessions: [session], selectedKey: session.key });

    render(<DetailPanel />);
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const closeButton = screen.getByRole("button", { name: "閉じる" });
    // data-close="true" は閉じるボタンの識別マーカー（実装はボタン自体か、それを包む要素に
    // 付ける可能性があるため closest で許容する）。
    expect(closeButton.closest('[data-close="true"]')).not.toBeNull();
    fireEvent.click(closeButton);

    expect(useSessionStore.getState().selectedKey).toBeNull();
  });

  it("textarea にフォーカスがある状態の Escape は閉じない（検索欄などの用途を優先）", async () => {
    const session = makeSession();
    getSessionMock().mockResolvedValue({ ok: true, value: makeDetail(session) });
    useSessionStore.setState({ sessions: [session], selectedKey: session.key });

    render(<DetailPanel />);
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(useSessionStore.getState().selectedKey).toBe(session.key);

    document.body.removeChild(textarea);
  });

  it("開いたら閉じるボタンにフォーカスが移る", async () => {
    const session = makeSession();
    getSessionMock().mockResolvedValue({ ok: true, value: makeDetail(session) });
    useSessionStore.setState({ sessions: [session], selectedKey: session.key });

    render(<DetailPanel />);

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "閉じる" }));
    });
  });

  it("閉じたら data-session-key を持つ元の要素にフォーカスが戻る", async () => {
    const session = makeSession();
    getSessionMock().mockResolvedValue({ ok: true, value: makeDetail(session) });

    const originCard = document.createElement("button");
    originCard.setAttribute("data-session-key", session.key);
    originCard.textContent = "元のカード";
    document.body.appendChild(originCard);

    useSessionStore.setState({ sessions: [session], selectedKey: session.key });
    render(<DetailPanel />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    act(() => {
      useSessionStore.getState().select(null);
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(originCard);
    });

    document.body.removeChild(originCard);
  });

  it("selectedKey を切り替えると古いリクエストの結果は無視される（順序が入れ替わっても新しい方が勝つ）", async () => {
    const sessionA = makeSession({
      key: "claude:aaaaaaaa-0000-4000-8000-00000000000a",
      id: "aaaaaaaa-0000-4000-8000-00000000000a",
      title: "セッション A",
    });
    const sessionB = makeSession({
      key: "claude:bbbbbbbb-0000-4000-8000-00000000000b",
      id: "bbbbbbbb-0000-4000-8000-00000000000b",
      title: "セッション B",
    });

    const deferredA = createDeferred<Result<SessionDetail, ApiErrorBody>>();
    const deferredB = createDeferred<Result<SessionDetail, ApiErrorBody>>();
    getSessionMock().mockImplementation((_tool: string, id: string) => {
      if (id === sessionA.id) {
        return deferredA.promise;
      }
      return deferredB.promise;
    });

    useSessionStore.setState({ sessions: [sessionA, sessionB], selectedKey: sessionA.key });
    render(<DetailPanel />);

    await act(async () => {
      useSessionStore.getState().select(sessionB.key);
    });

    // 先に選び直した B の結果を先に解決し、その後で古い A の結果を解決する（順序の入れ替わり）。
    await act(async () => {
      deferredB.resolve({
        ok: true,
        value: makeDetail(sessionB, {
          recentMessages: [{ role: "assistant", at: NOW_ISO, text: "B の本文" }],
        }),
      });
      await deferredB.promise;
    });

    await waitFor(() => {
      expect(screen.getByText("B の本文")).toBeInTheDocument();
    });

    await act(async () => {
      deferredA.resolve({
        ok: true,
        value: makeDetail(sessionA, {
          recentMessages: [{ role: "user", at: NOW_ISO, text: "A の本文" }],
        }),
      });
      await deferredA.promise;
    });

    expect(screen.queryByText("A の本文")).not.toBeInTheDocument();
    expect(screen.getByText("B の本文")).toBeInTheDocument();
  });
});
