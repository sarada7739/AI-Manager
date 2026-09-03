// API クライアント。fetch を Result 型でラップし、例外を投げない。
// ARCHITECTURE.md §5 のエンドポイント・エラー形状に対応する。
// クライアント側はこの client.ts 経由でしか /api/* に触れない。

import { isArray, isBoolean, isNumber, isRecord, isString } from "../../shared/guards.js";
import { err, ok, type Result } from "../../shared/result.js";
import type {
  Account,
  ApiError,
  SessionDetail,
  SessionSummary,
  ToolKind,
} from "../../shared/types.js";

/** API のエラー本体（`ApiError["error"]`）。 */
export type ApiErrorBody = ApiError["error"];

/** GET /api/sessions の応答。 */
export interface SessionsResponse {
  sessions: SessionSummary[];
  generatedAt: string;
}

/** GET /api/accounts の応答。 */
export interface AccountsResponse {
  accounts: Account[];
}

/** GET /api/health の応答。 */
export interface HealthResponse {
  ok: boolean;
  version: string;
  roots: string[];
  watcher: "fs" | "poll" | "both";
  processInfo: boolean;
  warnings: string[];
}

/** POST /api/refresh の応答。 */
export interface RefreshResponse {
  ok: boolean;
  scanned: number;
  durationMs: number;
}

/** POST /api/sessions/:tool/:id/message の応答（ADR-0009）。 */
export interface MessageResponse {
  ok: boolean;
  sentAt: string;
  note: string;
}

/** サーバ API クライアント。すべて例外を投げず `Result` で返す。 */
export interface ApiClient {
  getSessions(): Promise<Result<SessionsResponse, ApiErrorBody>>;
  getAccounts(): Promise<Result<AccountsResponse, ApiErrorBody>>;
  getSession(tool: ToolKind, id: string): Promise<Result<SessionDetail, ApiErrorBody>>;
  getHealth(): Promise<Result<HealthResponse, ApiErrorBody>>;
  postRefresh(): Promise<Result<RefreshResponse, ApiErrorBody>>;
  /** 稼働中の Claude セッションへ指示を送る（ADR-0009）。id は既存の isValidId で検証する。 */
  postMessage(
    tool: ToolKind,
    id: string,
    text: string,
  ): Promise<Result<MessageResponse, ApiErrorBody>>;
}

/** `createApiClient` のオプション。 */
export interface ApiClientOptions {
  /** fetch 実装。省略時は `globalThis.fetch`（テストでの差し替え用）。 */
  fetch?: typeof fetch;
  /** API のベース URL。省略時は空文字（同一オリジン。Vite dev では `/api` プロキシに乗る）。 */
  baseUrl?: string;
}

/** id が Claude(UUID) / Codex 双方で許容される `[0-9a-f-]{36}` 形式かどうか。大文字小文字は無視する。 */
const ID_PATTERN = /^[0-9a-f-]{36}$/i;

function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** サーバに接続できなかったときの既定エラー。 */
function networkError(): ApiErrorBody {
  return {
    code: "network",
    message: "サーバに接続できませんでした。",
    hint: "pnpm dev でサーバが起動しているか確認し、「更新」を押してください。",
  };
}

/** HTTP エラー応答の本文が期待した形でなかったときの既定エラー。 */
function httpError(status: number): ApiErrorBody {
  return {
    code: `http_${status}`,
    message: `サーバがエラーを返しました（HTTP ${status}）。`,
    hint: "時間をおいて「更新」を押してください。",
  };
}

/** 成功応答の本文が期待した最低限の形を満たさなかったときの既定エラー。 */
function invalidResponseError(): ApiErrorBody {
  return {
    code: "invalid_response",
    message: "サーバの応答を解釈できませんでした。",
    hint: "サーバとクライアントのバージョンが一致しているか確認してください。",
  };
}

/** リクエストの id が不正な形式だったときのエラー。fetch 自体は行わない。 */
function invalidIdError(): ApiErrorBody {
  return {
    code: "invalid_id",
    message: "セッション ID の形式が不正です。",
    hint: "一覧から選び直してください。",
  };
}

/** 本文が `{ error: { code, message, hint } }`（`ApiError` 形）かどうかを判定する。 */
function isApiError(value: unknown): value is ApiError {
  if (!isRecord(value)) {
    return false;
  }
  const errorValue = value.error;
  if (!isRecord(errorValue)) {
    return false;
  }
  return isString(errorValue.code) && isString(errorValue.message) && isString(errorValue.hint);
}

/** JSON 本文を読む。パース失敗（空応答・非 JSON）は null を返す。 */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * fetch 1 回分の共通処理。ネットワーク例外・HTTP エラー・応答形の検証をまとめて `Result` に変換する。
 * `validate` は成功応答の本文が期待した最低限の形（トップレベルのキーと配列かどうか）を満たすかだけを見る。
 * 要素の全フィールドまでは検証しない。
 */
async function request<T>(
  fetchImpl: typeof fetch,
  url: string,
  validate: (body: unknown) => body is T,
  init?: RequestInit,
): Promise<Result<T, ApiErrorBody>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...init,
      headers: { Accept: "application/json", ...init?.headers },
    });
  } catch {
    return err(networkError());
  }

  const body = await readJson(res);

  if (!res.ok) {
    return err(isApiError(body) ? body.error : httpError(res.status));
  }

  if (!validate(body)) {
    return err(invalidResponseError());
  }
  return ok(body);
}

/** 要素の全フィールドは検証しない。object であり `key` / `tool` / `updatedAt` が文字列であることだけ見る。 */
function isSessionSummaryShaped(value: unknown): boolean {
  return (
    isRecord(value) && isString(value.key) && isString(value.tool) && isString(value.updatedAt)
  );
}

function isSessionsResponse(value: unknown): value is SessionsResponse {
  return (
    isRecord(value) &&
    isArray(value.sessions) &&
    value.sessions.every(isSessionSummaryShaped) &&
    isString(value.generatedAt)
  );
}

function isAccountsResponse(value: unknown): value is AccountsResponse {
  return isRecord(value) && isArray(value.accounts);
}

function isSessionDetail(value: unknown): value is SessionDetail {
  return (
    isRecord(value) &&
    isString(value.key) &&
    isString(value.tool) &&
    isString(value.id) &&
    isArray(value.recentMessages) &&
    isArray(value.parseWarnings)
  );
}

/** watcher に許される値。 */
const WATCHER_VALUES = new Set(["fs", "poll", "both"]);

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    isRecord(value) &&
    isBoolean(value.ok) &&
    isString(value.version) &&
    isArray(value.roots) &&
    isString(value.watcher) &&
    WATCHER_VALUES.has(value.watcher) &&
    isBoolean(value.processInfo) &&
    isArray(value.warnings)
  );
}

function isRefreshResponse(value: unknown): value is RefreshResponse {
  return (
    isRecord(value) && isBoolean(value.ok) && isNumber(value.scanned) && isNumber(value.durationMs)
  );
}

function isMessageResponse(value: unknown): value is MessageResponse {
  return isRecord(value) && isBoolean(value.ok) && isString(value.sentAt) && isString(value.note);
}

/**
 * `ApiClient` を組み立てる。テストではフェイク `fetch` を渡す。
 * `opts.fetch` 省略時は `globalThis.fetch` をモジュール評価時ではなく **呼び出し時** に参照するラッパを使う。
 * こうしないと `apiClient`（既定インスタンス）がモジュール読み込み時点の `globalThis.fetch` を
 * 固定で捕まえてしまい、テストの `vi.stubGlobal("fetch", ...)` が既定インスタンスに効かない
 * （レビュー指摘）。
 */
export function createApiClient(opts: ApiClientOptions = {}): ApiClient {
  const fetchImpl: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const baseUrl = opts.baseUrl ?? "";

  return {
    getSessions: () => request(fetchImpl, `${baseUrl}/api/sessions`, isSessionsResponse),

    getAccounts: () => request(fetchImpl, `${baseUrl}/api/accounts`, isAccountsResponse),

    getSession: async (tool, id) => {
      if (!isValidId(id)) {
        return err(invalidIdError());
      }
      return request(
        fetchImpl,
        `${baseUrl}/api/sessions/${encodeURIComponent(tool)}/${encodeURIComponent(id)}`,
        isSessionDetail,
      );
    },

    getHealth: () => request(fetchImpl, `${baseUrl}/api/health`, isHealthResponse),

    postRefresh: () =>
      request(fetchImpl, `${baseUrl}/api/refresh`, isRefreshResponse, { method: "POST" }),

    postMessage: async (tool, id, text) => {
      if (!isValidId(id)) {
        return err(invalidIdError());
      }
      return request(
        fetchImpl,
        `${baseUrl}/api/sessions/${encodeURIComponent(tool)}/${encodeURIComponent(id)}/message`,
        isMessageResponse,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        },
      );
    },
  };
}

/** 既定インスタンス。`globalThis.fetch` を使う。 */
export const apiClient: ApiClient = createApiClient();
