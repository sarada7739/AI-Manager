// SSE 購読者への通知（EventHub）。ARCHITECTURE.md §2 の server/store/events.ts に対応する。
// watcher.ts の変更検知結果を受けて routes/events.ts の GET /events が配信する。
// EventHub 自体は「誰に何を送るか」だけを扱い、索引の再走査は呼ばない。
// ただし本ファイルはそれに加えて、SessionIndex の rebuild / refreshFiles を直列化する
// createIndexGate、および rebuild を配信に繋げる createSerializedRefresh も提供する
// （Round 2 レビュー引き継ぎ: index.ts の onChange → refreshFiles と、
// createSerializedRefresh 経由の rebuild が同時に走ると索引の内部状態が競合するため、
// 両方を 1 つのゲートに通す）。

import type { Logger } from "../log.js";
import type { RebuildResult, SessionIndex } from "./index.js";

/**
 * `sessions-changed` イベントのペイロード。
 * `changed` は「変更が反映された件数」を表す。`refreshFiles` 由来では実際に再構築した
 * セッション数、`rebuild`（`createSerializedRefresh` 経由）由来では走査したセッションの
 * 総数（`RebuildResult.scanned`）になる。名称・意味は流用しつつ、由来によって数え方が
 * 異なる点に注意（フィールド名は変更しない）。
 */
export interface SessionsChangedPayload {
  changed: number;
  at: string;
}

/** EventHub が配信するイベント種別。 */
export type EventName = "sessions-changed" | "heartbeat";

/** 1 件の購読者。`send` が reject / throw した場合は購読を解除する。 */
export interface Subscriber {
  send(event: EventName, data: unknown): void | Promise<void>;
  /**
   * `hub.stop()` が呼ばれた際に、購読解除の前に 1 回だけ呼ばれる（省略可）。
   * `routes/events.ts` はこれを使って SSE の keepalive ループを抜け、ストリームを閉じる
   * （Round 3 レビュー引き継ぎ: これが無いと `hub.stop()` は内部の購読者一覧を空にするだけで、
   * 接続中の SSE ストリーム自体には何も伝わらず、`SIGINT` 時にプロセスがハングしていた）。
   */
  close?(): void;
}

/** SSE 購読者を管理し、イベントを配信するハブ。 */
export interface EventHub {
  /** 購読を開始する。戻り値の関数を呼ぶと解除する（複数回呼んでも安全）。 */
  subscribe(subscriber: Subscriber): () => void;
  /** 全購読者へイベントを配信する。`send` の reject / throw は購読者を外す。 */
  publish(event: EventName, data: unknown): void;
  /** 現在の購読者数。 */
  size(): number;
  /** `HEARTBEAT_MS` ごとに `heartbeat` を配信する。二重起動しない。 */
  startHeartbeat(): void;
  /** ハートビートを止め、各購読者の `close` を呼んでから全員を解除する（SSE ストリームを終わらせる）。 */
  stop(): void;
}

/** ハートビートの間隔（ms）。 */
export const HEARTBEAT_MS = 30_000;

/** `createEventHub` のオプション。 */
export interface CreateEventHubOptions {
  /** 省略可（`stop()` のログ出力にのみ使う）。 */
  log?: Logger;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  /** 現在時刻。既定 `() => new Date()`（テストでの差し替え用）。 */
  now?: () => Date;
}

/** EventHub を生成する。 */
export function createEventHub(opts?: CreateEventHubOptions): EventHub {
  const setIntervalFn = opts?.setIntervalFn ?? setInterval;
  const clearIntervalFn = opts?.clearIntervalFn ?? clearInterval;
  const now = opts?.now ?? (() => new Date());
  const log = opts?.log;

  const subscribers = new Map<number, Subscriber>();
  let nextId = 1;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  function removeSubscriber(id: number): void {
    subscribers.delete(id);
  }

  function publish(event: EventName, data: unknown): void {
    for (const [id, subscriber] of subscribers) {
      try {
        const result = subscriber.send(event, data);
        if (result !== undefined && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>).catch(() => {
            removeSubscriber(id);
          });
        }
      } catch {
        removeSubscriber(id);
      }
    }
  }

  return {
    subscribe(subscriber: Subscriber): () => void {
      const id = nextId;
      nextId += 1;
      subscribers.set(id, subscriber);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) {
          return;
        }
        unsubscribed = true;
        removeSubscriber(id);
      };
    },
    publish,
    size(): number {
      return subscribers.size;
    },
    startHeartbeat(): void {
      if (heartbeatTimer !== undefined) {
        return;
      }
      heartbeatTimer = setIntervalFn(() => {
        publish("heartbeat", { at: now().toISOString() });
      }, HEARTBEAT_MS);
      // 実 Node タイマーの場合、このインターバルだけでプロセス終了がブロックされないようにする
      // （テストの差し替え用フェイクはただの数値を返すため `unref` を持たない。存在するときだけ呼ぶ）。
      const maybeUnref = heartbeatTimer as unknown as { unref?: () => void };
      maybeUnref.unref?.();
    },
    stop(): void {
      if (heartbeatTimer !== undefined) {
        clearIntervalFn(heartbeatTimer);
        heartbeatTimer = undefined;
      }
      // 購読解除の前に、接続中の SSE ストリームへ「閉じてよい」を伝える。
      // close 自体が throw しても他の購読者への通知を止めない。
      for (const subscriber of subscribers.values()) {
        try {
          subscriber.close?.();
        } catch {
          // 個別の close 失敗は無視する（stop() 自体は継続する）
        }
      }
      subscribers.clear();
      log?.info("イベント配信を停止しました。");
    },
  };
}

/** `createSerializedRefresh` が受け取る索引の操作。 */
export type SerializedRefreshIndex = Pick<SessionIndex, "rebuild">;

/**
 * `index.rebuild()` の同時実行を 1 つに直列化し、完了後に `hub` へ `sessions-changed` を publish する
 * ラッパを作る。進行中に呼ばれた場合は新しい rebuild を起動せず、進行中の Promise をそのまま返す。
 */
export function createSerializedRefresh(
  index: SerializedRefreshIndex,
  hub: EventHub,
  now: () => Date = () => new Date(),
): () => Promise<RebuildResult> {
  let inFlight: Promise<RebuildResult> | null = null;

  return function refresh(): Promise<RebuildResult> {
    if (inFlight !== null) {
      return inFlight;
    }

    const promise = index
      .rebuild()
      .then((result) => {
        const payload: SessionsChangedPayload = {
          changed: result.scanned,
          at: now().toISOString(),
        };
        hub.publish("sessions-changed", payload);
        return result;
      })
      .finally(() => {
        inFlight = null;
      });

    inFlight = promise;
    return promise;
  };
}

/** `createIndexGate` が受け取る索引の操作。 */
export type IndexGateTarget = Pick<SessionIndex, "rebuild" | "refreshFiles">;

/** `createIndexGate` が返すゲート。 */
export interface IndexGate {
  /** `fn` を、他の `runExclusive` 呼び出しと排他的に（呼ばれた順に）実行する。 */
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
  /** `runExclusive` 経由で `index.rebuild()` を実行する。 */
  rebuild(): Promise<RebuildResult>;
  /** `runExclusive` 経由で `index.refreshFiles(paths)` を実行する。 */
  refreshFiles(paths: readonly string[]): Promise<RebuildResult>;
}

/**
 * `SessionIndex.rebuild` と `SessionIndex.refreshFiles` は、どちらも `this.index`
 * （内部の Map）を書き換える。`rebuild` は丸ごと差し替え、`refreshFiles` は差分だけを
 * 書き換えるため、2 つが同時に走ると片方の結果がもう片方に踏み潰される
 * （Round 2 レビュー引き継ぎ）。`createIndexGate` は 1 つのキューで両者を直列化し、
 * 進行中の呼び出しがあれば次の呼び出しはその完了を待ってから実行する。
 * `createSerializedRefresh` の同時実行防止（`inFlight`）とは独立した、より広い排他制御。
 */
export function createIndexGate(index: IndexGateTarget): IndexGate {
  // キューが空のときは fn を同期的に起動する（`.then` チェーンだけで直列化すると、
  // 呼び出しが必ず 1 マイクロタスク遅れてしまい、「呼んだ直後に実行済み」を期待する
  // 呼び出し側の同期チェックと食い違う）。busy 中の呼び出しだけを待ち行列に積む。
  let busy = false;
  const queue: Array<() => void> = [];

  function runNext(): void {
    const next = queue.shift();
    if (next === undefined) {
      busy = false;
      return;
    }
    next();
  }

  function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = (): void => {
        Promise.resolve(fn()).then(
          (value) => {
            resolve(value);
            runNext();
          },
          (error: unknown) => {
            reject(error);
            runNext();
          },
        );
      };
      if (busy) {
        queue.push(task);
      } else {
        busy = true;
        task();
      }
    });
  }

  return {
    runExclusive,
    rebuild: () => runExclusive(() => index.rebuild()),
    refreshFiles: (paths) => runExclusive(() => index.refreshFiles(paths)),
  };
}
