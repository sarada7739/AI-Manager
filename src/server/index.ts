// サーバの起動エントリ。config 読込 → 索引構築 → Hono 起動の順で行う。
// 監視・SSE などの副作用は T-015 が足す。ここは薄く保つ。

import os from "node:os";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./log.js";
import { SessionIndex } from "./store/index.js";

const HOSTNAME = "127.0.0.1";

async function main(): Promise<void> {
  const homeDir = os.homedir();
  const configResult = loadConfig();

  if (!configResult.ok) {
    // roots が確定していないため、既定のロガー（roots: []）でエラーを出して終了する。
    const bootLog = createLogger({ roots: [], homeDir });
    bootLog.error(configResult.error.message, { hint: configResult.error.hint });
    process.exitCode = 1;
    return;
  }

  const config = configResult.value;
  const log = createLogger({ roots: config.roots, homeDir });

  const index = new SessionIndex(config, log);
  const rebuildResult = await index.rebuild();

  const app = createApp({
    index,
    config,
    log,
    homeDir,
    version: process.env.npm_package_version ?? "0.0.0",
  });

  // 成功ログは listen 完了のコールバックで出す（listen 失敗時に成功ログが先に出ないように）
  const server = serve(
    {
      fetch: app.fetch,
      hostname: HOSTNAME,
      port: config.port,
    },
    () => {
      log.info("サーバを起動しました", {
        port: config.port,
        sessions: index.getAll().length,
        accounts: index.getAccounts().length,
        rebuildMs: rebuildResult.durationMs,
        warnings: rebuildResult.warnings.length,
      });
    },
  );

  server.on("error", (error: NodeJS.ErrnoException) => {
    log.error("ポートを開けませんでした。", {
      code: error.code ?? "unknown",
      hint: "local-data/config.json の port を変更するか、使用中のプロセスを終了してください。",
    });
    process.exitCode = 1;
  });
}

main().catch(() => {
  process.stdout.write('{"level":"error","message":"起動処理で想定外のエラーが発生しました"}\n');
  process.exitCode = 1;
});
