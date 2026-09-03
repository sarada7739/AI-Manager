import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, createApiClient } from "../../../src/client/api/client";

// T-019 受け入れ条件:
// 「api/client.ts が getSessions, getAccounts, getSession(tool, id), getHealth, postRefresh を持ち、
//   HTTP エラーを ApiError（message + hint）に変換する」を検証する。
// 実 fetch は使わず、フェイク fetch を注入する。合成データのみ。
//
// T-032 受け入れ条件（postMessage、DESIGN.md §6.11 / ADR-0009）:
// 「正しい URL / method / body / content-type で fetch を呼ぶ」「応答の型ガード（ok / sentAt / note）」
// 「id 不正で fetch を呼ばない」「502 の { error } を err にする」

/** noUncheckedIndexedAccess 対策: 範囲内であることをテスト側で保証した上で要素を取り出す。 */
function at<T>(arr: T[], index: number): T {
  const value = arr[index];
  if (value === undefined) {
    throw new Error(`index ${index} is out of range (length=${arr.length})`);
  }
  return value;
}

/** fetch 呼び出しの記録 1 件分。 */
interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/** フェイク fetch を作る。handler が呼び出しごとに Response を返す。呼び出し履歴は calls に積む。 */
function makeFakeFetch(handler: (call: FetchCall) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = { url: String(input), init };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html" } });
}

/** init.headers から Accept ヘッダの値を安全に取り出す（optional chaining の連鎖を避けるため）。 */
function acceptHeaderOf(init: RequestInit | undefined): string | undefined {
  if (init === undefined) {
    return undefined;
  }
  const headers = init.headers as Record<string, string> | undefined;
  return headers?.Accept;
}

function rejectingFetch(): { fetchImpl: typeof fetch } {
  const fetchImpl = vi.fn(async () => {
    throw new Error("connect ECONNREFUSED");
  }) as unknown as typeof fetch;
  return { fetchImpl };
}

const VALID_ID = "00000000-0000-4000-8000-000000000001";

describe("createApiClient: URL・メソッド・Accept ヘッダ", () => {
  it("getSessions は GET /api/sessions を Accept: application/json で呼ぶ", async () => {
    const { fetchImpl, calls } = makeFakeFetch(() =>
      jsonResponse(200, { sessions: [], generatedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const client = createApiClient({ fetch: fetchImpl });
    await client.getSessions();
    expect(calls).toHaveLength(1);
    const call = at(calls, 0);
    expect(call.url).toBe("/api/sessions");
    expect(call.init?.method === undefined || call.init?.method === "GET").toBe(true);
    expect(acceptHeaderOf(call.init)).toBe("application/json");
  });

  it("getAccounts は GET /api/accounts を Accept: application/json で呼ぶ", async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => jsonResponse(200, { accounts: [] }));
    const client = createApiClient({ fetch: fetchImpl });
    await client.getAccounts();
    const call = at(calls, 0);
    expect(call.url).toBe("/api/accounts");
    expect(acceptHeaderOf(call.init)).toBe("application/json");
  });

  it("getHealth は GET /api/health を Accept: application/json で呼ぶ", async () => {
    const { fetchImpl, calls } = makeFakeFetch(() =>
      jsonResponse(200, {
        ok: true,
        version: "0.0.0",
        roots: [],
        watcher: "fs",
        processInfo: true,
        warnings: [],
      }),
    );
    const client = createApiClient({ fetch: fetchImpl });
    await client.getHealth();
    const call = at(calls, 0);
    expect(call.url).toBe("/api/health");
    expect(acceptHeaderOf(call.init)).toBe("application/json");
  });

  it("postRefresh は POST /api/refresh を Accept: application/json で呼ぶ", async () => {
    const { fetchImpl, calls } = makeFakeFetch(() =>
      jsonResponse(200, { ok: true, scanned: 3, durationMs: 12 }),
    );
    const client = createApiClient({ fetch: fetchImpl });
    await client.postRefresh();
    const call = at(calls, 0);
    expect(call.url).toBe("/api/refresh");
    expect(call.init?.method).toBe("POST");
    expect(acceptHeaderOf(call.init)).toBe("application/json");
  });

  it("getSession は GET /api/sessions/:tool/:id を Accept: application/json で呼ぶ", async () => {
    const { fetchImpl, calls } = makeFakeFetch(() =>
      jsonResponse(200, {
        key: `claude:${VALID_ID}`,
        tool: "claude",
        id: VALID_ID,
        recentMessages: [],
        parseWarnings: [],
      }),
    );
    const client = createApiClient({ fetch: fetchImpl });
    await client.getSession("claude", VALID_ID);
    const call = at(calls, 0);
    expect(call.url).toBe(`/api/sessions/claude/${VALID_ID}`);
    expect(acceptHeaderOf(call.init)).toBe("application/json");
  });
});

describe("createApiClient: 200 応答", () => {
  it("200 で ok と本文を返す", async () => {
    const body = { sessions: [], generatedAt: "2026-01-01T00:00:00.000Z" };
    const { fetchImpl } = makeFakeFetch(() => jsonResponse(200, body));
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.getSessions();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(body);
    }
  });
});

describe("createApiClient: baseUrl", () => {
  it("baseUrl がすべての呼び出しの URL に前置される", async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => jsonResponse(200, { accounts: [] }));
    const client = createApiClient({ fetch: fetchImpl, baseUrl: "http://127.0.0.1:4317" });
    await client.getAccounts();
    expect(at(calls, 0).url).toBe("http://127.0.0.1:4317/api/accounts");
  });
});

describe("createApiClient: エラー変換", () => {
  it("fetch が reject すると network コードになる", async () => {
    const { fetchImpl } = rejectingFetch();
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.getSessions();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("network");
      expect(result.error.message.length).toBeGreaterThan(0);
      expect(result.error.hint.length).toBeGreaterThan(0);
    }
  });

  it("500 で { error } 本文なら、その code / message / hint をそのまま使う", async () => {
    const errorBody = {
      error: {
        code: "roots_missing",
        message: "設定された roots が見つかりません。",
        hint: "config.json を確認してください。",
      },
    };
    const { fetchImpl } = makeFakeFetch(() => jsonResponse(500, errorBody));
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.getSessions();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(errorBody.error);
    }
  });

  it("500 で HTML 本文なら http_500 になり、message / hint は空でない", async () => {
    const { fetchImpl } = makeFakeFetch(() =>
      htmlResponse(500, "<html><body>Internal Server Error</body></html>"),
    );
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.getSessions();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("http_500");
      expect(result.error.message.length).toBeGreaterThan(0);
      expect(result.error.hint.length).toBeGreaterThan(0);
    }
  });

  it("200 だが JSON でない本文は invalid_response になる", async () => {
    const { fetchImpl } = makeFakeFetch(() => htmlResponse(200, "<html>not json</html>"));
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.getSessions();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_response");
    }
  });

  it("200 で sessions が配列でないと invalid_response になる", async () => {
    const { fetchImpl } = makeFakeFetch(() =>
      jsonResponse(200, { sessions: "not-an-array", generatedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.getSessions();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_response");
    }
  });

  it("getAccounts: 500 で HTML 本文なら http_500 になる", async () => {
    const { fetchImpl } = makeFakeFetch(() => htmlResponse(500, "<html>error</html>"));
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.getAccounts();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("http_500");
    }
  });

  it("getHealth: 500 で HTML 本文なら http_500 になる", async () => {
    const { fetchImpl } = makeFakeFetch(() => htmlResponse(500, "<html>error</html>"));
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.getHealth();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("http_500");
    }
  });

  it("postRefresh: 500 で HTML 本文なら http_500 になる", async () => {
    const { fetchImpl } = makeFakeFetch(() => htmlResponse(500, "<html>error</html>"));
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.postRefresh();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("http_500");
    }
  });

  it("getSession: recentMessages が配列でないと invalid_response になる", async () => {
    const { fetchImpl } = makeFakeFetch(() =>
      jsonResponse(200, {
        key: `claude:${VALID_ID}`,
        tool: "claude",
        id: VALID_ID,
        recentMessages: "not-an-array",
        parseWarnings: [],
      }),
    );
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.getSession("claude", VALID_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_response");
    }
  });

  it("getSessions: 要素に key が無いと invalid_response になる（新仕様: 要素の形も検証する）", async () => {
    const { fetchImpl } = makeFakeFetch(() =>
      jsonResponse(200, {
        sessions: [{ tool: "claude", updatedAt: "2026-01-01T00:00:00.000Z" }],
        generatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.getSessions();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_response");
    }
  });

  it("getHealth: watcher が不正な値だと invalid_response になる（新仕様: watcher/processInfo を検証する）", async () => {
    const { fetchImpl } = makeFakeFetch(() =>
      jsonResponse(200, {
        ok: true,
        version: "0.0.0",
        roots: [],
        watcher: "x",
        processInfo: true,
        warnings: [],
      }),
    );
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.getHealth();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_response");
    }
  });
});

describe("apiClient（既定インスタンス）: fetch は呼び出し時に globalThis.fetch を参照する", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('vi.stubGlobal("fetch", fake) が既定インスタンス apiClient に効く', async () => {
    const fake = vi.fn(async () => jsonResponse(200, { accounts: [] }));
    vi.stubGlobal("fetch", fake);

    const result = await apiClient.getAccounts();

    expect(fake).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });
});

describe("createApiClient: getSession の id 検証", () => {
  it('getSession("claude", "not-a-uuid") は invalid_id を返し、fetch を呼ばない', async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => jsonResponse(200, {}));
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.getSession("claude", "not-a-uuid");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_id");
    }
    expect(calls).toHaveLength(0);
  });

  it("getSession の id は URL エンコードされる（encodeURIComponent と同じ結果になる）", async () => {
    const { fetchImpl, calls } = makeFakeFetch(() =>
      jsonResponse(200, {
        key: `codex:${VALID_ID}`,
        tool: "codex",
        id: VALID_ID,
        recentMessages: [],
        parseWarnings: [],
      }),
    );
    const client = createApiClient({ fetch: fetchImpl });
    await client.getSession("codex", VALID_ID);
    const expectedUrl = `/api/sessions/${encodeURIComponent("codex")}/${encodeURIComponent(VALID_ID)}`;
    expect(at(calls, 0).url).toBe(expectedUrl);
  });
});

describe("createApiClient: postMessage（T-032 / ADR-0009）", () => {
  it("正しい URL / method / body / Content-Type で fetch を呼ぶ", async () => {
    const { fetchImpl, calls } = makeFakeFetch(() =>
      jsonResponse(200, { ok: true, sentAt: "2026-01-01T00:00:00.000Z", note: "" }),
    );
    const client = createApiClient({ fetch: fetchImpl });
    await client.postMessage("claude", VALID_ID, "合成本文");

    expect(calls).toHaveLength(1);
    const call = at(calls, 0);
    expect(call.url).toBe(`/api/sessions/claude/${VALID_ID}/message`);
    expect(call.init?.method).toBe("POST");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("application/json");
    expect(call.init?.body).toBe(JSON.stringify({ text: "合成本文" }));
  });

  it("応答の型ガード: ok / sentAt / note を満たさない応答は invalid_response になる", async () => {
    const { fetchImpl } = makeFakeFetch(() =>
      jsonResponse(200, { ok: true, sentAt: "2026-01-01T00:00:00.000Z" }),
    );
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.postMessage("claude", VALID_ID, "本文");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_response");
    }
  });

  it("応答の型ガード: 期待した形の応答は成功として値をそのまま返す", async () => {
    const body = { ok: true, sentAt: "2026-01-01T00:00:00.000Z", note: "queued" };
    const { fetchImpl } = makeFakeFetch(() => jsonResponse(200, body));
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.postMessage("claude", VALID_ID, "本文");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(body);
    }
  });

  it("id が不正な形式のとき invalid_id を返し、fetch を呼ばない", async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => jsonResponse(200, {}));
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.postMessage("claude", "not-a-uuid", "本文");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_id");
    }
    expect(calls).toHaveLength(0);
  });

  it("502 で { error } 本文なら、その code / message / hint を err にする", async () => {
    const errorBody = {
      error: {
        code: "read_only",
        message: "読み取り専用のため送信できません。",
        hint: "読み取り専用トグルを OFF にしてください。",
      },
    };
    const { fetchImpl } = makeFakeFetch(() => jsonResponse(502, errorBody));
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.postMessage("claude", VALID_ID, "本文");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(errorBody.error);
    }
  });

  it("502 で { error } 本文が無ければ http_502 になる", async () => {
    const { fetchImpl } = makeFakeFetch(() => htmlResponse(502, "<html>Bad Gateway</html>"));
    const client = createApiClient({ fetch: fetchImpl });
    const result = await client.postMessage("claude", VALID_ID, "本文");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("http_502");
      expect(result.error.message.length).toBeGreaterThan(0);
      expect(result.error.hint.length).toBeGreaterThan(0);
    }
  });
});
