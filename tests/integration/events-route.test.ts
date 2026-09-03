import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../src/server/log";
import { createLogger } from "../../src/server/log";
import type { EventsRouteDeps } from "../../src/server/routes/events";
import { createEventsRoute } from "../../src/server/routes/events";
import { createEventHub } from "../../src/server/store/events";
import type { RebuildResult } from "../../src/server/store/index";

/**
 * `EventsRouteDeps` に `log`（第1段階レビュー対応で追加見込み）を渡すための拡張型。
 * 現行の型が未対応でも、型付き変数経由で渡すことで過剰プロパティチェックに引っかからない。
 */
interface EventsRouteDepsWithLog extends EventsRouteDeps {
  log?: Logger;
}

// T-015 GET /api/events (SSE) と POST /api/refresh の統合テスト。
// `new Hono().route("/api", createEventsRoute(deps))` で組み、`app.request()` で検証する
// （実 HTTP サーバは立てない）。hub は本物の createEventHub を使い、purely synthetic な値のみ扱う。

function makeSinkLog() {
  const lines: string[] = [];
  const log = createLogger({
    roots: [],
    homeDir: "C:\\synthetic",
    sink: (line) => lines.push(line),
  });
  return { log, lines };
}

/** レスポンスボディから 1 チャンク分だけデコードして読む。読み終えたら reader は開いたまま返す。 */
async function readOneChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value, done } = await reader.read();
  if (done || value === undefined) {
    return "";
  }
  return new TextDecoder().decode(value);
}

/**
 * `reader.read()` を実タイマー（`vi.useFakeTimers` は使わない）の `timeoutMs` で打ち切る。
 * Round 2 レビュー対応（SSE 接続中のシャットダウン）の検証は、実装が未対応だとストリームが
 * 終了せず `reader.read()` が永久に解決しない可能性があるため、テスト自体がハングしないよう
 * 明示的なタイムアウトを設ける。
 */
function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `reader.read() が ${timeoutMs}ms 以内に完了しませんでした（ストリームが終了していない可能性）`,
        ),
      );
    }, timeoutMs);
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

describe("POST /api/refresh", () => {
  it("refresh が解決すると 200 で { ok: true, scanned, durationMs } を返す", async () => {
    const { log } = makeSinkLog();
    const hub = createEventHub({ log });
    const result: RebuildResult = { scanned: 7, durationMs: 42, warnings: [] };
    const refresh = vi.fn().mockResolvedValue(result);
    const app = new Hono().route("/api", createEventsRoute({ hub, refresh }));

    const res = await app.request("/api/refresh", { method: "POST" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, scanned: 7, durationMs: 42 });
  });

  it("refresh が reject すると 500 で error.code が 'refresh_failed'、message / hint が空でない", async () => {
    const { log } = makeSinkLog();
    const hub = createEventHub({ log });
    const refresh = vi.fn().mockRejectedValue(new Error("boom"));
    const app = new Hono().route("/api", createEventsRoute({ hub, refresh }));

    const res = await app.request("/api/refresh", { method: "POST" });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("refresh_failed");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.hint.length).toBeGreaterThan(0);
  });

  it("refresh が reject すると deps.log.error が固定文言で呼ばれ、例外メッセージ・パスが含まれない（第1段階レビュー対応）", async () => {
    const { log, lines } = makeSinkLog();
    const hub = createEventHub({ log });
    const sensitiveMessage = "boom: C:\\synthetic\\home\\.claude\\secret.jsonl";
    const refresh = vi.fn().mockRejectedValue(new Error(sensitiveMessage));
    const deps: EventsRouteDepsWithLog = { hub, refresh, log };
    const app = new Hono().route("/api", createEventsRoute(deps));

    const res = await app.request("/api/refresh", { method: "POST" });
    expect(res.status).toBe(500);

    const joined = lines.join("\n");
    expect(joined.length).toBeGreaterThan(0);
    expect(joined).not.toContain(sensitiveMessage);
    expect(joined).not.toContain("secret.jsonl");
    expect(joined).not.toContain("synthetic");
  });

  it("同時実行は refresh() 側（createSerializedRefresh）に委ねられるため、このルートは単に呼ぶだけ", async () => {
    const { log } = makeSinkLog();
    const hub = createEventHub({ log });
    const refresh = vi
      .fn()
      .mockResolvedValue({ scanned: 1, durationMs: 1, warnings: [] } satisfies RebuildResult);
    const app = new Hono().route("/api", createEventsRoute({ hub, refresh }));

    await Promise.all([
      app.request("/api/refresh", { method: "POST" }),
      app.request("/api/refresh", { method: "POST" }),
    ]);

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/events", () => {
  it("接続すると hub.startHeartbeat() が呼ばれる（第1段階レビュー対応）", async () => {
    const { log } = makeSinkLog();
    const hub = createEventHub({ log });
    const startHeartbeatSpy = vi.spyOn(hub, "startHeartbeat");
    const refresh = vi.fn();
    const app = new Hono().route("/api", createEventsRoute({ hub, refresh }));

    const controller = new AbortController();
    const res = await app.request("/api/events", { signal: controller.signal });
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (reader === undefined) return;
    await readOneChunk(reader); // ハンドラの本体が実行されるまで読み進める

    expect(startHeartbeatSpy).toHaveBeenCalled();

    await reader.cancel();
    controller.abort();
  });

  it("content-type が text/event-stream を含む", async () => {
    const { log } = makeSinkLog();
    const hub = createEventHub({ log });
    const refresh = vi.fn();
    const app = new Hono().route("/api", createEventsRoute({ hub, refresh }));

    const controller = new AbortController();
    const res = await app.request("/api/events", { signal: controller.signal });

    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    await reader?.cancel();
    controller.abort();
  });

  it("接続直後の最初のチャンクに event: heartbeat が含まれる", async () => {
    const { log } = makeSinkLog();
    const hub = createEventHub({ log });
    const refresh = vi.fn();
    const now = () => new Date("2026-05-01T00:00:00.000Z");
    const app = new Hono().route("/api", createEventsRoute({ hub, refresh, now }));

    const controller = new AbortController();
    const res = await app.request("/api/events", { signal: controller.signal });
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (reader === undefined) return;

    const chunk = await readOneChunk(reader);
    expect(chunk).toContain("event: heartbeat");
    expect(chunk).toContain("2026-05-01T00:00:00.000Z");

    await reader.cancel();
    controller.abort();
  });

  it("接続中に hub.publish('sessions-changed', ...) するとストリームに event: sessions-changed と JSON データが流れる", async () => {
    const { log } = makeSinkLog();
    const hub = createEventHub({ log });
    const refresh = vi.fn();
    const app = new Hono().route("/api", createEventsRoute({ hub, refresh }));

    const controller = new AbortController();
    const res = await app.request("/api/events", { signal: controller.signal });
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (reader === undefined) return;

    // 1 チャンク目は接続直後の heartbeat。
    await readOneChunk(reader);

    await vi.waitFor(() => expect(hub.size()).toBe(1));
    hub.publish("sessions-changed", { changed: 3, at: "2026-05-02T00:00:00.000Z" });

    const chunk = await readOneChunk(reader);
    expect(chunk).toContain("event: sessions-changed");
    expect(chunk).toContain('"changed":3');
    expect(chunk).toContain("2026-05-02T00:00:00.000Z");

    await reader.cancel();
    controller.abort();
  });

  it("接続で hub.size() が 1 になる", async () => {
    const { log } = makeSinkLog();
    const hub = createEventHub({ log });
    const refresh = vi.fn();
    const app = new Hono().route("/api", createEventsRoute({ hub, refresh }));

    expect(hub.size()).toBe(0);

    const controller = new AbortController();
    const res = await app.request("/api/events", { signal: controller.signal });
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (reader === undefined) return;
    await readOneChunk(reader); // heartbeat を読んで接続の subscribe が完了していることを確かめる

    await vi.waitFor(() => expect(hub.size()).toBe(1));

    await reader.cancel();
    controller.abort();
  });

  it("reader.cancel() / abort 後は hub.size() が 0 に戻る（実装の onAbort 依存。発火しない場合は別途報告する）", async () => {
    const { log } = makeSinkLog();
    const hub = createEventHub({ log });
    const refresh = vi.fn();
    const app = new Hono().route("/api", createEventsRoute({ hub, refresh }));

    const controller = new AbortController();
    const res = await app.request("/api/events", { signal: controller.signal });
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (reader === undefined) return;
    await readOneChunk(reader);
    await vi.waitFor(() => expect(hub.size()).toBe(1));

    await reader.cancel();
    controller.abort();

    await vi.waitFor(() => expect(hub.size()).toBe(0), { timeout: 2000 });
  });

  it("接続中に hub.stop() を呼ぶとストリームが終了する（reader.read() が done:true）。hub.size() も 0 になる（Round 2 レビュー対応 BLOCKING）", async () => {
    const { log } = makeSinkLog();
    const hub = createEventHub({ log });
    const refresh = vi.fn();
    const app = new Hono().route("/api", createEventsRoute({ hub, refresh }));

    const controller = new AbortController();
    const res = await app.request("/api/events", { signal: controller.signal });
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (reader === undefined) return;

    await readOneChunk(reader); // 接続直後の heartbeat を読み、subscribe 完了を待つ
    await vi.waitFor(() => expect(hub.size()).toBe(1));

    hub.stop();

    // 実タイマーで最大 3 秒待つ（vi.useFakeTimers は使わない）。
    const result = await readWithTimeout(reader, 3000);
    expect(result.done).toBe(true);
    expect(hub.size()).toBe(0);

    await reader.cancel().catch(() => {});
    controller.abort();
  }, 5000);
});
