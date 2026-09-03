// GET /api/events（SSE: sessions-changed, heartbeat）と POST /api/refresh。
// ARCHITECTURE.md §2.1「server/routes → sources は禁止」のため、EventHub と
// 直列化済みの refresh 関数だけを見る（rebuild そのものはここから呼ばない）。

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { toApiError } from "../errors.js";
import type { Logger } from "../log.js";
import type { EventHub } from "../store/events.js";
import type { RebuildResult } from "../store/index.js";

/** `createEventsRoute` の依存。 */
export interface EventsRouteDeps {
  hub: EventHub;
  /** 直列化済みの再走査（`store/events.ts` の `createSerializedRefresh` が作る）。 */
  refresh: () => Promise<RebuildResult>;
  /** 現在時刻。既定 `() => new Date()`（テストでの差し替え用）。 */
  now?: () => Date;
  /** 省略可。`POST /refresh` 失敗時のログ出力にのみ使う（本文・実パスは出さない）。 */
  log?: Logger;
}

/** 接続が生きているかを確認するためのポーリング間隔（ms）。イベント自体はここでは送らない。 */
const KEEPALIVE_POLL_MS = 1000;

/** `GET /events`, `POST /refresh` を持つ Hono インスタンスを作る。`app.ts` が `/api` 配下にマウントする。 */
export function createEventsRoute(deps: EventsRouteDeps): Hono {
  const now = deps.now ?? (() => new Date());
  const route = new Hono();

  route.get("/events", (c) => {
    // 配線忘れの保険。`index.ts` が起動時に呼んでいなくても、最初の接続で確実に始動する
    // （`startHeartbeat` は二重起動しない）。
    deps.hub.startHeartbeat();

    return streamSSE(c, async (stream) => {
      // hub.stop()（サーバーシャットダウン）で close が呼ばれたら即座にループを抜けられるよう、
      // sleep とレースさせる Promise を用意する（Round 3 レビュー BLOCKING: これが無いと
      // SIGINT 時に SSE 接続が開いたままだとプロセスがハングしていた）。
      let hubClosed = false;
      let notifyHubClosed: (() => void) | undefined;
      const hubClosedPromise = new Promise<void>((resolve) => {
        notifyHubClosed = resolve;
      });

      const unsubscribe = deps.hub.subscribe({
        send: async (event, data) => {
          await stream.writeSSE({ event, data: JSON.stringify(data) });
        },
        close: () => {
          hubClosed = true;
          notifyHubClosed?.();
        },
      });

      let unsubscribed = false;
      const unsubscribeOnce = (): void => {
        if (unsubscribed) {
          return;
        }
        unsubscribed = true;
        unsubscribe();
      };
      stream.onAbort(unsubscribeOnce);

      // 接続直後にクライアントの接続確認用の heartbeat を 1 回送る。
      await stream.writeSSE({
        event: "heartbeat",
        data: JSON.stringify({ at: now().toISOString() }),
      });

      // cb が返ると hono がストリームを閉じてしまうため、切断（クライアント側の abort）または
      // hub.stop()（サーバー側のシャットダウン）のどちらか早い方まで待ち続ける。
      // 実際のイベント送信は購読中の `send` コールバック経由で行われる。
      while (!stream.aborted && !stream.closed && !hubClosed) {
        await Promise.race([stream.sleep(KEEPALIVE_POLL_MS), hubClosedPromise]);
      }
      unsubscribeOnce();
      if (!stream.closed) {
        await stream.close();
      }
    });
  });

  route.post("/refresh", async (c) => {
    try {
      const result = await deps.refresh();
      return c.json({ ok: true, scanned: result.scanned, durationMs: result.durationMs });
    } catch {
      // 本文・実パスは出さず、固定文言 + code のみをログに出す（app.ts の onError と同じ方針）。
      deps.log?.error("再走査に失敗しました。", { code: "refresh_failed" });
      return c.json(
        toApiError({
          code: "refresh_failed",
          message: "再走査に失敗しました。",
          hint: "時間をおいて「更新」を押してください。",
        }),
        500,
      );
    }
  });

  return route;
}
