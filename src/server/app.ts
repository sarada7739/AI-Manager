// Hono アプリケーションの組み立て。ルーティング・CORS・共通ヘッダ・エラーハンドリングを 1 か所にまとめる。
// index.ts から呼ばれるだけでなく、`createApp(deps).request(...)` でテストから直接叩けるようにする
// （T-001 レビュー引き継ぎ）。routes は SessionIndex だけを見て、sources を直接 import しない
// （ARCHITECTURE.md §2.1）。

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppConfig } from "./config.js";
import { toApiError } from "./errors.js";
import type { Logger } from "./log.js";
import { createAccountsRoute } from "./routes/accounts.js";
import { createEventsRoute } from "./routes/events.js";
import { createHealthRoute } from "./routes/health.js";
import { createMessageRoute } from "./routes/message.js";
import { createSessionsRoute } from "./routes/sessions.js";
import type { readClaudeDetail } from "./sources/claude/detail.js";
import type { sendClaudeMessage as SendClaudeMessageFn } from "./sources/claude/messaging.js";
import type { readCodexDetail } from "./sources/codex/detail.js";
import type { EventHub } from "./store/events.js";
import type { RebuildResult, SessionIndex } from "./store/index.js";

/** `createApp` の依存。 */
export interface AppDeps {
  /** routes が見てよい索引の操作。sources を直接触らせないため必要な操作だけを渡す。 */
  index: Pick<
    SessionIndex,
    | "getAll"
    | "get"
    | "getSource"
    | "getAccounts"
    | "getWarnings"
    | "isProcessInfoAvailable"
    | "getMessagingTarget"
  >;
  config: AppConfig;
  log: Logger;
  /** roots の `~` 置換用のホームディレクトリ。 */
  homeDir: string;
  /** package.json の version（index.ts が `process.env.npm_package_version` から渡す）。 */
  version: string;
  /** T-015 が実装する監視モード。未指定なら常に "poll"。 */
  watcherMode?: () => "fs" | "poll" | "both";
  /** 現在時刻。テストでの差し替え用。既定 `() => new Date()`。 */
  now?: () => Date;
  /** 詳細取得の実処理。sources を直接 import しないため、呼び出し側（index.ts）が実物を渡す。 */
  readClaudeDetail: typeof readClaudeDetail;
  readCodexDetail: typeof readCodexDetail;
  /** 指示送信（T-031, ADR-0009）の実処理。sources を直接 import しないため、呼び出し側（index.ts）が実物を渡す。 */
  sendClaudeMessage: typeof SendClaudeMessageFn;
  /** SSE 配信ハブ（T-015）。呼び出し側（index.ts、またはテスト）が実物を渡す。 */
  hub: EventHub;
  /** 直列化済みの再走査（T-015）。呼び出し側（index.ts、またはテスト）が実物を渡す。 */
  refresh: () => Promise<RebuildResult>;
}

/**
 * origin が `http://localhost` または `http://127.0.0.1`（ポート省略可）に厳密一致するかを判定する。
 * `http://localhost.evil.com` のような前方一致だけの偽装ホストを通さないよう、正規表現で完全一致させる。
 */
const ALLOWED_ORIGIN_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGIN_PATTERN.test(origin);
}

/** Hono アプリケーションを組み立てる。 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // /api/* 全体に Cache-Control: no-store を付ける。next() の前に設定しておくことで、
  // 404（notFound）・500（onError）の応答にも同じヘッダが乗る。
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });

  app.use(
    "/api/*",
    cors({
      origin: (origin) => (isAllowedOrigin(origin) ? origin : ""),
    }),
  );

  const sessionsRoute = createSessionsRoute({
    index: deps.index,
    now: deps.now,
    readClaudeDetail: deps.readClaudeDetail,
    readCodexDetail: deps.readCodexDetail,
  });
  const accountsRoute = createAccountsRoute({ index: deps.index });

  // 送信 API（T-031, ADR-0009）。索引の getMessagingTarget と送信の実処理は他の routes と同じく必須の依存。
  const depsNow = deps.now;
  // index はクラスインスタンス（SessionIndex）なので、メソッドを取り出して渡すと this が失われる。
  // 他の routes と同じくオブジェクトごと渡す（実機で 500 になった不具合の修正）。
  const messageRoute = createMessageRoute({
    index: deps.index,
    sendClaudeMessage: deps.sendClaudeMessage,
    now: depsNow ? () => depsNow().getTime() : undefined,
    log: deps.log,
  });
  const healthRoute = createHealthRoute({
    index: deps.index,
    config: deps.config,
    homeDir: deps.homeDir,
    version: deps.version,
    watcherMode: deps.watcherMode,
  });
  const eventsRoute = createEventsRoute({
    hub: deps.hub,
    refresh: deps.refresh,
    now: deps.now,
    log: deps.log,
  });

  app.route("/api", sessionsRoute);
  app.route("/api", accountsRoute);
  app.route("/api", healthRoute);
  app.route("/api", eventsRoute);
  app.route("/api", messageRoute);

  app.notFound((c) =>
    c.json(
      toApiError({
        code: "not_found",
        message: "API が見つかりません。",
        hint: "URL を確認してください。",
      }),
      404,
    ),
  );

  app.onError((_error, c) => {
    // 本文・パスの混入を避けるため、固定文言 + code のみをログに出す（err.message は出さない）。
    deps.log.error("サーバ内部でエラーが発生しました。", { code: "internal" });
    // hint 省略で DEFAULT_ERROR_HINT が補われる
    return c.json(
      toApiError({ code: "internal", message: "サーバ内部でエラーが発生しました。" }),
      500,
    );
  });

  return app;
}
