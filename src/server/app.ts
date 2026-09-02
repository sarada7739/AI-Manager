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
import { createHealthRoute } from "./routes/health.js";
import { createSessionsRoute } from "./routes/sessions.js";
import type { SessionIndex } from "./store/index.js";

/** `createApp` の依存。 */
export interface AppDeps {
  /** routes が見てよい索引の操作。sources を直接触らせないため必要な操作だけを渡す。 */
  index: Pick<SessionIndex, "getAll" | "getAccounts" | "getWarnings" | "isProcessInfoAvailable">;
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

  const sessionsRoute = createSessionsRoute({ index: deps.index, now: deps.now });
  const accountsRoute = createAccountsRoute({ index: deps.index });
  const healthRoute = createHealthRoute({
    index: deps.index,
    config: deps.config,
    homeDir: deps.homeDir,
    version: deps.version,
    watcherMode: deps.watcherMode,
  });

  app.route("/api", sessionsRoute);
  app.route("/api", accountsRoute);
  app.route("/api", healthRoute);

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
