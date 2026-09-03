// 自動更新。/api/events（SSE）を購読し、sessions-changed で load() する。
// SSE が使えない・切れた場合は intervalMs ごとのポーリングにフォールバックする（F-9 / T-025）。
import { useEffect } from "react";
import { useSessionStore } from "../../store/useSessionStore.js";

/** SSE 切断時のポーリング間隔（ms）。 */
export const POLL_INTERVAL_MS = 10_000;

/** heartbeat が届かなくなった（＝接続が切れた）とみなすまでの猶予（ms）。サーバの heartbeat 間隔
 * （30 秒）の 1 回分の取りこぼしを確実に吸収する（2 回目の到着とタイムアウトは同時刻で競合し得る）。 */
export const HEARTBEAT_TIMEOUT_MS = 60_000;

/** `useAutoRefresh` のオプション（テストでの差し替え用）。 */
export interface UseAutoRefreshOptions {
  /** `EventSource` の生成関数。省略時は `window.EventSource`（無い環境ではポーリングのみ）。 */
  createEventSource?: (url: string) => EventSource;
  /** ポーリング間隔（ms）。省略時は `POLL_INTERVAL_MS`。 */
  intervalMs?: number;
}

/**
 * `/api/events` を購読する。接続できている間は SSE の `sessions-changed` を受けて `load()`
 * （サーバ側で再走査済みのため `refresh()` は呼ばない）。
 * 状態遷移:
 * - 接続成功（`open`）→ `setLive(true)`、ポーリング停止、heartbeat タイムアウトをリセット
 * - `heartbeat` 受信 → タイムアウトをリセットするだけ
 * - `error`、または `HEARTBEAT_TIMEOUT_MS` 内に heartbeat が来ない → `setLive(false)` + ポーリング開始
 * - `EventSource` の自動再接続で `open` が再度発火したらポーリングを止める
 * - `EventSource` が無い環境ではポーリングのみで動く
 * アンマウント時に `EventSource` を close し、タイマーをすべて解除する。
 */
export function useAutoRefresh(options: UseAutoRefreshOptions = {}): void {
  // load / setLive は createSessionStore が一度だけ作る安定した関数参照（レンダーのたびに
  // 変わらない）。そのため依存配列に含めても実質的にエフェクトの再実行を増やさない。
  const load = useSessionStore((state) => state.load);
  const setLive = useSessionStore((state) => state.setLive);

  const createEventSourceOption = options.createEventSource;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;

    function startPolling(): void {
      if (pollTimer !== undefined) {
        return;
      }
      pollTimer = setInterval(() => {
        void load();
      }, intervalMs);
    }

    function stopPolling(): void {
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    }

    function resetHeartbeatTimeout(): void {
      if (heartbeatTimer !== undefined) {
        clearTimeout(heartbeatTimer);
      }
      heartbeatTimer = setTimeout(() => {
        setLive(false);
        startPolling();
      }, HEARTBEAT_TIMEOUT_MS);
    }

    const createEventSource =
      createEventSourceOption ??
      (typeof EventSource !== "undefined" ? (url: string) => new EventSource(url) : undefined);

    let eventSource: EventSource | undefined;

    if (createEventSource) {
      eventSource = createEventSource("/api/events");

      eventSource.addEventListener("open", () => {
        setLive(true);
        stopPolling();
        resetHeartbeatTimeout();
      });

      eventSource.addEventListener("sessions-changed", () => {
        void load();
      });

      eventSource.addEventListener("heartbeat", () => {
        resetHeartbeatTimeout();
      });

      eventSource.addEventListener("error", () => {
        // 切断済みなので、以前の接続に紐づく heartbeat タイムアウトは無効化する
        // （再接続後に古いタイマーが誤って発火し setLive(false) を呼び直すのを防ぐ）。
        if (heartbeatTimer !== undefined) {
          clearTimeout(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        setLive(false);
        startPolling();
      });
    } else {
      // EventSource が無い環境（テスト / 旧ブラウザ）ではポーリングのみで動く。
      setLive(false);
      startPolling();
    }

    return () => {
      stopPolling();
      if (heartbeatTimer !== undefined) {
        clearTimeout(heartbeatTimer);
      }
      eventSource?.close();
    };
  }, [load, setLive, intervalMs, createEventSourceOption]);
}
