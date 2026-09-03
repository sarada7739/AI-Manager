import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../src/server/log";
import type {
  CreateEventHubOptions,
  EventName,
  IndexGateTarget,
  Subscriber,
} from "../../../src/server/store/events";

/**
 * Round 2 レビュー対応で `Subscriber` に追加される見込みの `close?(): void`。
 * 現行の型にはまだ無いため、型付き変数経由でキャストして渡す
 * （フレッシュなオブジェクトリテラルではないため過剰プロパティチェックに引っかからない）。
 */
interface SubscriberWithClose extends Subscriber {
  close?: () => void;
}

import {
  createEventHub,
  createIndexGate,
  createSerializedRefresh,
  HEARTBEAT_MS,
} from "../../../src/server/store/events";
import type { RebuildResult } from "../../../src/server/store/index";

// T-015 createEventHub / createSerializedRefresh の受け入れ条件を検証する。
// 実タイマーには依存せず setIntervalFn / clearIntervalFn をフェイクに差し替える。

function makeFakeLog(): { log: Logger; warns: string[]; infos: string[] } {
  const warns: string[] = [];
  const infos: string[] = [];
  const log: Logger = {
    info: (message) => infos.push(message),
    warn: (message) => warns.push(message),
    error: () => {},
  };
  return { log, warns, infos };
}

function makeFakeIntervalTimers() {
  let nextId = 1;
  const intervals = new Map<number, () => void>();
  const delays: number[] = [];
  const setIntervalFn = vi.fn((fn: () => void, delay?: number) => {
    const id = nextId++;
    intervals.set(id, fn);
    delays.push(delay ?? 0);
    return id as unknown as ReturnType<typeof setInterval>;
  });
  const clearIntervalFn = vi.fn((id: unknown) => {
    intervals.delete(id as number);
  });
  function fireAll(): void {
    for (const fn of intervals.values()) fn();
  }
  return { setIntervalFn, clearIntervalFn, delays, fireAll, activeCount: () => intervals.size };
}

/** テスト用の Subscriber。send の呼び出しを記録する。 */
function makeRecordingSubscriber(): Subscriber & { calls: Array<[EventName, unknown]> } {
  const calls: Array<[EventName, unknown]> = [];
  return {
    calls,
    send(event, data) {
      calls.push([event, data]);
    },
  };
}

function makeDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createEventHub: subscribe / publish / size", () => {
  it("subscribe した購読者に publish が届き、size() は購読数を返す", () => {
    const { log } = makeFakeLog();
    const hub = createEventHub({ log });
    const subscriber = makeRecordingSubscriber();

    expect(hub.size()).toBe(0);
    hub.subscribe(subscriber);
    expect(hub.size()).toBe(1);

    hub.publish("sessions-changed", { changed: 3, at: "2026-01-01T00:00:00.000Z" });

    expect(subscriber.calls).toEqual([
      ["sessions-changed", { changed: 3, at: "2026-01-01T00:00:00.000Z" }],
    ]);
  });

  it("解除関数を呼ぶと購読が外れ、以後 publish が届かない", () => {
    const { log } = makeFakeLog();
    const hub = createEventHub({ log });
    const subscriber = makeRecordingSubscriber();

    const unsubscribe = hub.subscribe(subscriber);
    unsubscribe();
    expect(hub.size()).toBe(0);

    hub.publish("heartbeat", { at: "x" });
    expect(subscriber.calls).toEqual([]);
  });

  it("解除関数を複数回呼んでも安全（2 回目は何もしない）", () => {
    const { log } = makeFakeLog();
    const hub = createEventHub({ log });
    const subscriber = makeRecordingSubscriber();

    const unsubscribe = hub.subscribe(subscriber);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    expect(hub.size()).toBe(0);
  });

  it("send が throw する購読者だけが解除され、他の購読者は残る", () => {
    const { log } = makeFakeLog();
    const hub = createEventHub({ log });
    const throwing: Subscriber = {
      send: () => {
        throw new Error("boom");
      },
    };
    const ok = makeRecordingSubscriber();

    hub.subscribe(throwing);
    hub.subscribe(ok);
    expect(hub.size()).toBe(2);

    hub.publish("heartbeat", { at: "x" });

    expect(hub.size()).toBe(1);
    expect(ok.calls).toEqual([["heartbeat", { at: "x" }]]);
  });

  it("send が reject する購読者だけが解除され、他の購読者は残る", async () => {
    const { log } = makeFakeLog();
    const hub = createEventHub({ log });
    const rejecting: Subscriber = {
      send: () => Promise.reject(new Error("boom")),
    };
    const ok = makeRecordingSubscriber();

    hub.subscribe(rejecting);
    hub.subscribe(ok);
    expect(hub.size()).toBe(2);

    hub.publish("heartbeat", { at: "x" });
    // reject は非同期に解決するため待つ。
    await vi.waitFor(() => expect(hub.size()).toBe(1));

    expect(ok.calls).toEqual([["heartbeat", { at: "x" }]]);
  });
});

describe("createEventHub: startHeartbeat / stop", () => {
  it("startHeartbeat は HEARTBEAT_MS 間隔で setIntervalFn を呼び、発火のたびに heartbeat を publish する", () => {
    const { log } = makeFakeLog();
    const timers = makeFakeIntervalTimers();
    const now = () => new Date("2026-03-01T00:00:00.000Z");
    const hub = createEventHub({
      log,
      now,
      setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
      clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
    });
    const subscriber = makeRecordingSubscriber();
    hub.subscribe(subscriber);

    hub.startHeartbeat();

    expect(timers.delays).toEqual([HEARTBEAT_MS]);
    timers.fireAll();

    expect(subscriber.calls).toEqual([["heartbeat", { at: "2026-03-01T00:00:00.000Z" }]]);
  });

  it("startHeartbeat を 2 回呼んでも setIntervalFn は 1 回しか呼ばれない（二重起動しない）", () => {
    const { log } = makeFakeLog();
    const timers = makeFakeIntervalTimers();
    const hub = createEventHub({
      log,
      setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
      clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
    });

    hub.startHeartbeat();
    hub.startHeartbeat();

    expect(timers.setIntervalFn).toHaveBeenCalledTimes(1);
  });

  it("stop() はハートビートを止め、購読者を全員解除する", () => {
    const { log } = makeFakeLog();
    const timers = makeFakeIntervalTimers();
    const hub = createEventHub({
      log,
      setIntervalFn: timers.setIntervalFn as unknown as typeof setInterval,
      clearIntervalFn: timers.clearIntervalFn as unknown as typeof clearInterval,
    });
    const subscriber = makeRecordingSubscriber();
    hub.subscribe(subscriber);
    hub.startHeartbeat();

    hub.stop();

    expect(timers.clearIntervalFn).toHaveBeenCalled();
    expect(hub.size()).toBe(0);
    timers.fireAll(); // interval はもう登録されていないので何も起きない
    expect(subscriber.calls).toEqual([]);
  });

  it("stop() は close を持つ購読者の close を呼ぶ。close の無い購読者が混在しても例外にならない（Round 2 レビュー対応）", () => {
    const { log } = makeFakeLog();
    const hub = createEventHub({ log });

    const closeSpy = vi.fn();
    const withClose: SubscriberWithClose = { send: () => {}, close: closeSpy };
    const withoutClose: Subscriber = { send: () => {} };

    hub.subscribe(withClose);
    hub.subscribe(withoutClose);
    expect(hub.size()).toBe(2);

    expect(() => hub.stop()).not.toThrow();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(hub.size()).toBe(0);
  });

  it("stop() は close が throw しても他の購読者の解除・close 呼び出しを止めない", () => {
    const { log } = makeFakeLog();
    const hub = createEventHub({ log });

    const throwingClose: SubscriberWithClose = {
      send: () => {},
      close: () => {
        throw new Error("boom");
      },
    };
    const okCloseSpy = vi.fn();
    const okClose: SubscriberWithClose = { send: () => {}, close: okCloseSpy };

    hub.subscribe(throwingClose);
    hub.subscribe(okClose);

    expect(() => hub.stop()).not.toThrow();
    expect(okCloseSpy).toHaveBeenCalledTimes(1);
    expect(hub.size()).toBe(0);
  });
});

describe("createEventHub: log は省略可（第1段階レビュー対応）", () => {
  it("createEventHub() を引数なしで呼んでも subscribe / publish / stop が例外なく動く", () => {
    const hub = createEventHub();
    const subscriber = makeRecordingSubscriber();

    hub.subscribe(subscriber);
    expect(() => hub.publish("heartbeat", { at: "x" })).not.toThrow();
    expect(subscriber.calls).toEqual([["heartbeat", { at: "x" }]]);
    expect(() => hub.stop()).not.toThrow();
  });

  it("createEventHub({}) のように log を省略したオプションでも動く", () => {
    // 現行の型は log を必須にしているため、レビュー対応後の「log?: Logger」を見込んでキャストする。
    const opts = {} as CreateEventHubOptions;
    const hub = createEventHub(opts);
    expect(() => hub.publish("heartbeat", { at: "x" })).not.toThrow();
    expect(() => hub.stop()).not.toThrow();
  });
});

describe("createSerializedRefresh", () => {
  it("rebuild が遅延している間に 3 回呼んでも rebuild は 1 回だけ実行され、全呼び出しが同じ結果に解決する", async () => {
    const deferred = makeDeferred<RebuildResult>();
    const rebuild = vi.fn(() => deferred.promise);
    const { log } = makeFakeLog();
    const now = () => new Date("2026-04-01T00:00:00.000Z");
    const hub = createEventHub({ log, now });
    const subscriber = makeRecordingSubscriber();
    hub.subscribe(subscriber);

    const refresh = createSerializedRefresh({ rebuild }, hub, now);

    const p1 = refresh();
    const p2 = refresh();
    const p3 = refresh();

    expect(rebuild).toHaveBeenCalledTimes(1);

    const result: RebuildResult = { scanned: 5, durationMs: 12, warnings: [] };
    deferred.resolve(result);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toEqual(result);
    expect(r2).toEqual(result);
    expect(r3).toEqual(result);

    expect(subscriber.calls).toEqual([
      ["sessions-changed", { changed: 5, at: "2026-04-01T00:00:00.000Z" }],
    ]);
  });

  it("完了後に再度呼ぶと新しい rebuild が実行される", async () => {
    let call = 0;
    const results: RebuildResult[] = [
      { scanned: 1, durationMs: 1, warnings: [] },
      { scanned: 2, durationMs: 2, warnings: [] },
    ];
    const rebuild = vi.fn(async () => {
      const result = results[call] as RebuildResult;
      call += 1;
      return result;
    });
    const { log } = makeFakeLog();
    const hub = createEventHub({ log });
    const subscriber = makeRecordingSubscriber();
    hub.subscribe(subscriber);

    const refresh = createSerializedRefresh({ rebuild }, hub);

    const first = await refresh();
    expect(first.scanned).toBe(1);

    const second = await refresh();
    expect(second.scanned).toBe(2);

    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(subscriber.calls).toHaveLength(2);
  });

  it("rebuild が reject すると refresh() も reject し、sessions-changed は publish されない", async () => {
    const rebuild = vi.fn().mockRejectedValue(new Error("rebuild failed"));
    const { log } = makeFakeLog();
    const hub = createEventHub({ log });
    const subscriber = makeRecordingSubscriber();
    hub.subscribe(subscriber);

    const refresh = createSerializedRefresh({ rebuild }, hub);

    await expect(refresh()).rejects.toThrow("rebuild failed");
    expect(subscriber.calls).toEqual([]);
  });

  it("reject 後に再度呼ぶと rebuild が再実行される（inFlight がクリアされている）", async () => {
    const rebuild = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ scanned: 1, durationMs: 1, warnings: [] } satisfies RebuildResult);
    const { log } = makeFakeLog();
    const hub = createEventHub({ log });

    const refresh = createSerializedRefresh({ rebuild }, hub);

    await expect(refresh()).rejects.toThrow("boom");
    const second = await refresh();

    expect(second.scanned).toBe(1);
    expect(rebuild).toHaveBeenCalledTimes(2);
  });
});

describe("createIndexGate: rebuild と refreshFiles を同時に走らせない（第1段階レビュー対応）", () => {
  it("rebuild 進行中に refreshFiles を呼ぶと、rebuild 完了後に実行される（呼び出し順序を記録して確認）", async () => {
    const order: string[] = [];
    const rebuildDeferred = makeDeferred<RebuildResult>();
    const rebuild = vi.fn(() => {
      order.push("rebuild:start");
      return rebuildDeferred.promise.then((result) => {
        order.push("rebuild:end");
        return result;
      });
    });
    const refreshFiles = vi.fn(async (paths: readonly string[]) => {
      order.push("refreshFiles:start");
      const result: RebuildResult = { scanned: paths.length, durationMs: 1, warnings: [] };
      order.push("refreshFiles:end");
      return result;
    });
    const fakeIndex: IndexGateTarget = { rebuild, refreshFiles };

    const gate = createIndexGate(fakeIndex);

    const p1 = gate.rebuild();
    const p2 = gate.refreshFiles(["C:\\synthetic\\.claude\\projects\\dir\\a.jsonl"]);

    // runExclusive は `Promise.resolve().then(fn)` 経由のため、最初の呼び出しも
    // マイクロタスク 1 回分は非同期になる。呼ばれるまで待つ。
    await vi.waitFor(() => expect(rebuild).toHaveBeenCalledTimes(1));
    expect(refreshFiles).not.toHaveBeenCalled();

    rebuildDeferred.resolve({ scanned: 1, durationMs: 1, warnings: [] });
    await Promise.all([p1, p2]);

    expect(order).toEqual([
      "rebuild:start",
      "rebuild:end",
      "refreshFiles:start",
      "refreshFiles:end",
    ]);
    expect(refreshFiles).toHaveBeenCalledWith(["C:\\synthetic\\.claude\\projects\\dir\\a.jsonl"]);
  });

  it("refreshFiles 進行中に rebuild を呼んでも、逆順で待たされる（呼んだ順に直列化される）", async () => {
    const order: string[] = [];
    const refreshFilesDeferred = makeDeferred<RebuildResult>();
    const refreshFiles = vi.fn(() => {
      order.push("refreshFiles:start");
      return refreshFilesDeferred.promise.then((result) => {
        order.push("refreshFiles:end");
        return result;
      });
    });
    const rebuild = vi.fn(async () => {
      order.push("rebuild:start");
      const result: RebuildResult = { scanned: 9, durationMs: 1, warnings: [] };
      order.push("rebuild:end");
      return result;
    });
    const fakeIndex: IndexGateTarget = { rebuild, refreshFiles };

    const gate = createIndexGate(fakeIndex);

    const p1 = gate.refreshFiles(["a.jsonl"]);
    const p2 = gate.rebuild();

    await vi.waitFor(() => expect(refreshFiles).toHaveBeenCalledTimes(1));
    expect(rebuild).not.toHaveBeenCalled();

    refreshFilesDeferred.resolve({ scanned: 1, durationMs: 1, warnings: [] });
    await Promise.all([p1, p2]);

    expect(order).toEqual([
      "refreshFiles:start",
      "refreshFiles:end",
      "rebuild:start",
      "rebuild:end",
    ]);
  });

  it("runExclusive を直接使うと任意の関数も同じキューで直列化される", async () => {
    const order: string[] = [];
    const rebuild = vi.fn(
      async () => ({ scanned: 0, durationMs: 0, warnings: [] }) as RebuildResult,
    );
    const refreshFiles = vi.fn(
      async () => ({ scanned: 0, durationMs: 0, warnings: [] }) as RebuildResult,
    );
    const gate = createIndexGate({ rebuild, refreshFiles });

    const deferred = makeDeferred<void>();
    const p1 = gate.runExclusive(async () => {
      order.push("first:start");
      await deferred.promise;
      order.push("first:end");
    });
    const p2 = gate.runExclusive(async () => {
      order.push("second");
    });

    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    deferred.resolve();
    await Promise.all([p1, p2]);

    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("片方が reject してもキューは止まらず、後続の呼び出しは実行される", async () => {
    const rebuild = vi.fn().mockRejectedValue(new Error("boom"));
    const refreshFiles = vi.fn(
      async () => ({ scanned: 2, durationMs: 1, warnings: [] }) as RebuildResult,
    );
    const gate = createIndexGate({ rebuild, refreshFiles });

    await expect(gate.rebuild()).rejects.toThrow("boom");
    const result = await gate.refreshFiles(["a.jsonl"]);

    expect(result.scanned).toBe(2);
    expect(refreshFiles).toHaveBeenCalledTimes(1);
  });
});
