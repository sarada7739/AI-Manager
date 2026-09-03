// サーバの起動エントリ。config 読込 → 索引構築 → 監視 / SSE 起動 → Hono 起動の順で行う。

import os from "node:os";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./log.js";
import { readClaudeDetail } from "./sources/claude/detail.js";
import { readCodexDetail } from "./sources/codex/detail.js";
import { createEventHub, createIndexGate, createSerializedRefresh } from "./store/events.js";
import { SessionIndex } from "./store/index.js";
import { startWatcher } from "./store/watcher.js";

const HOSTNAME = "127.0.0.1";
/** シャットダウンの強制終了までの猶予（ms）。通常経路が先に終われば発火しない。 */
const FORCE_EXIT_TIMEOUT_MS = 3000;

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

  const hub = createEventHub({ log });
  hub.startHeartbeat();

  // rebuild（createSerializedRefresh 経由）と refreshFiles（watcher の onChange 経由）が
  // 同時に索引を書き換えないよう、1 つのゲートに両方を通す（Round 2 レビュー引き継ぎ）。
  const gate = createIndexGate(index);
  const refresh = createSerializedRefresh(gate, hub);

  const watcherHandle = startWatcher({
    roots: config.roots,
    pollIntervalSec: config.pollIntervalSec,
    onChange: (paths) =>
      gate.refreshFiles(paths).then((result) => {
        hub.publish("sessions-changed", {
          changed: result.scanned,
          at: new Date().toISOString(),
        });
      }),
    // reject は watcher 側（debounce の flush 経路）が固定文言でログに出して握るため、
    // ここでは catch しない。
    log,
  });

  const app = createApp({
    index,
    config,
    log,
    homeDir,
    version: process.env.npm_package_version ?? "0.0.0",
    watcherMode: () => watcherHandle.mode(),
    hub,
    refresh,
    readClaudeDetail,
    readCodexDetail,
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
        watcher: watcherHandle.mode(),
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

  // Ctrl+C（Windows でも SIGINT として届く経路）でのみ想定。二重登録・二重終了はしない。
  let shuttingDown = false;
  function shutdown(): void {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    // hub.stop() は全 SSE 購読者の close() を呼び、routes/events.ts の keepalive ループを
    // 抜けさせる（Round 3 レビュー引き継ぎ）。watcherHandle.stop() は先に呼び、以後の
    // ファイル変更検知が新たな refreshFiles を起こさないようにする。
    watcherHandle.stop();
    hub.stop();
    server.close(() => {
      process.exit(process.exitCode ?? 0);
    });
    // 応答中の SSE 接続（keep-alive）は idle にならないため、close() のコールバックだけでは
    // いつまでも呼ばれないことがある。Node 18.2+（本環境は Node 25）の
    // closeAllConnections() で強制的に切断し、close() の完了を促す。
    (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    // 保険。上記が何らかの理由で完了しなくても、猶予後に強制終了する
    // （unref なので、これ自体が通常終了を妨げることはない）。
    setTimeout(() => process.exit(process.exitCode ?? 0), FORCE_EXIT_TIMEOUT_MS).unref();
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(() => {
  process.stdout.write('{"level":"error","message":"起動処理で想定外のエラーが発生しました"}\n');
  process.exitCode = 1;
});
