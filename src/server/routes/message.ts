// POST /api/sessions/:tool/:id/message: 稼働中の Claude Code セッションへ指示を送る（F-7, ADR-0009）。
// ARCHITECTURE.md §2.1「server/routes → sources は禁止」に合わせ、送信の実処理（sendClaudeMessage）は
// 型だけを import し、実物は呼び出し側（app.ts 経由で index.ts）が渡す。
// route はパスを組み立てず、`index.getMessagingTarget()` が返す root / pid / socketPath だけを使う。
// Codex 宛は未対応（ADR-0009）のため、常に 400 を返す。

import { Hono } from "hono";
import { isRecord } from "../../shared/guards.js";
import type { Result } from "../../shared/result.js";
import { toApiError } from "../errors.js";
import type { Logger } from "../log.js";
import type {
  SendMessageError,
  SendMessageSuccess,
  sendClaudeMessage,
} from "../sources/claude/messaging.js";
import type { SessionIndex } from "../store/index.js";

/** id パラメータの検証用パターン（UUID 形式。大文字小文字を区別しない）。 */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 本文の最小・最大文字数（trim 後）。 */
const MIN_TEXT_LENGTH = 1;
const MAX_TEXT_LENGTH = 4000;

/** 同一セッションへの連続送信を拒否する間隔（ms）。 */
const RATE_LIMIT_MS = 10_000;

/** `createMessageRoute` の依存。 */
export interface MessageRouteDeps {
  index: Pick<SessionIndex, "get" | "getMessagingTarget">;
  /** 送信の実処理。sources を直接 import しないため、呼び出し側が実物を渡す。 */
  sendClaudeMessage: typeof sendClaudeMessage;
  /** 現在時刻（epoch ms）。省略時は `Date.now`（テストでの差し替え用）。 */
  now?: () => number;
  /** 件数・成否のみを出すログ。省略可。 */
  log?: Logger;
}

/** 同一本文の拒否に使う記録の保持期間（ms）。これを過ぎたエントリは掃除され、同一本文でも送れる。 */
const DUPLICATE_RETENTION_MS = 10 * 60_000;

/** セッション key ごとのレート制限記録。 */
interface RateLimitEntry {
  lastSentAtMs: number;
  /** 直前に投函できた本文。失敗した送信は記録しない（hint「もう一度送ってください」どおり再送できるように）。 */
  lastText: string | null;
  /** `sendClaudeMessage` の呼び出し中かどうか。同時送信を弾くための予約フラグ。 */
  inFlight: boolean;
}

/**
 * レート制限の記録から `DUPLICATE_RETENTION_MS` 以上経過したエントリを間引く（Map が無限に育たないように）。
 * 保持期間を key によらず一定にすることで、同一本文の拒否が続く長さが他セッションへの送信の有無に
 * 左右されないようにする（reviewer Round 2 NON_BLOCKING の反映）。送信中のエントリは消さない。
 */
function pruneRateLimits(rateLimits: Map<string, RateLimitEntry>, nowMs: number): void {
  for (const [key, entry] of rateLimits) {
    if (!entry.inFlight && nowMs - entry.lastSentAtMs >= DUPLICATE_RETENTION_MS) {
      rateLimits.delete(key);
    }
  }
}

/** 送信失敗コードごとの hint（固定文言。タスクカードの指定どおり）。 */
const SEND_ERROR_HINTS: Record<string, string> = {
  key_not_found: "セッションを再起動すると鍵が作り直されます。",
  key_invalid: "セッションを再起動すると鍵が作り直されます。",
  pipe_unreachable: "セッションが終了した可能性があります。「更新」で状態を取り直してください。",
  send_failed: "もう一度送ってください。続く場合はセッションを再起動してください。",
};

/** `POST /sessions/:tool/:id/message` を持つ Hono インスタンスを作る。`app.ts` が `/api` 配下にマウントする。 */
export function createMessageRoute(deps: MessageRouteDeps): Hono {
  const now = deps.now ?? (() => Date.now());
  // セッション key ごとの直近送信記録。プロセス内メモリのみ（永続化しない）。
  const rateLimits = new Map<string, RateLimitEntry>();
  const route = new Hono();

  route.post("/sessions/:tool/:id/message", async (c) => {
    const toolParam = c.req.param("tool");
    const idParam = c.req.param("id");

    if (toolParam === "codex") {
      return c.json(
        toApiError({
          code: "unsupported_tool",
          message: "Codex への送信は未対応です。",
          hint: "Claude Code のセッションを選んでください（ADR-0009）。",
        }),
        400,
      );
    }

    if (toolParam !== "claude" || !ID_PATTERN.test(idParam)) {
      return c.json(
        toApiError({
          code: "invalid_id",
          message: "セッション ID の形式が不正です。",
          hint: "一覧から選択し直してください。",
        }),
        400,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        toApiError({
          code: "invalid_body",
          message: "本文の形式が不正です。",
          hint: "text フィールドに文字列を指定してください。",
        }),
        400,
      );
    }

    if (!isRecord(body) || typeof body.text !== "string") {
      return c.json(
        toApiError({
          code: "invalid_body",
          message: "本文の形式が不正です。",
          hint: "text フィールドに文字列を指定してください。",
        }),
        400,
      );
    }

    const text = body.text.trim();
    if (text.length < MIN_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH) {
      return c.json(
        toApiError({
          code: "invalid_text",
          message: `本文は ${MIN_TEXT_LENGTH}〜${MAX_TEXT_LENGTH} 文字で指定してください。`,
          hint: "内容を短くするか、空でないことを確認してください。",
        }),
        400,
      );
    }

    const key = `${toolParam}:${idParam.toLowerCase()}`;

    if (deps.index.get(key) === undefined) {
      return c.json(
        toApiError({
          code: "not_found",
          message: "セッションが見つかりません。",
          hint: "一覧を「更新」してから選択し直してください。",
        }),
        404,
      );
    }

    const target = deps.index.getMessagingTarget(key);
    if (target === undefined) {
      return c.json(
        toApiError({
          code: "not_running",
          message: "このセッションは稼働中ではないため送れません。",
          hint: "稼働中（●）のセッションを選ぶか、「更新」で状態を取り直してください。",
        }),
        409,
      );
    }

    const nowMs = now();
    pruneRateLimits(rateLimits, nowMs);
    const previous = rateLimits.get(key);

    // 同一セッションへの送信が既に進行中（sendClaudeMessage の await 中）なら、10 秒ウィンドウの
    // 経過に関わらず弾く（同時に届いた複数リクエストが両方通過するのを防ぐ。
    // reviewer Round 1 BLOCKING 指摘の反映）。
    if (previous?.inFlight === true) {
      return c.json(
        toApiError({
          code: "rate_limited",
          message: "送信の間隔が短すぎます。",
          hint: "送信中です。完了を待ってください。",
        }),
        429,
      );
    }

    if (previous !== undefined) {
      const elapsedMs = nowMs - previous.lastSentAtMs;
      if (elapsedMs < RATE_LIMIT_MS) {
        const remainingSec = Math.ceil((RATE_LIMIT_MS - elapsedMs) / 1000);
        return c.json(
          toApiError({
            code: "rate_limited",
            message: "送信の間隔が短すぎます。",
            hint: `あと ${remainingSec} 秒あけてください。`,
          }),
          429,
        );
      }
      if (previous.lastText !== null && previous.lastText === text) {
        return c.json(
          toApiError({
            code: "duplicate_text",
            message: "直前と同じ内容は送れません。",
            hint: "内容を変えてから送ってください。",
          }),
          400,
        );
      }
    }

    // 検査を通った時点で予約する（await の前）。成否にかかわらず 10 秒ウィンドウに数える
    // （reviewer Round 1 BLOCKING 指摘の反映）。
    const entry: RateLimitEntry = { lastSentAtMs: nowMs, lastText: text, inFlight: true };
    rateLimits.set(key, entry);

    let result: Result<SendMessageSuccess, SendMessageError>;
    try {
      result = await deps.sendClaudeMessage(target, text);
    } finally {
      entry.inFlight = false;
    }

    if (!result.ok) {
      // 失敗した本文は同一本文の拒否に使わない。hint「もう一度送ってください」どおり、10 秒あければ
      // 同じ内容を送り直せる（reviewer Round 2 BLOCKING の反映）。10 秒の枠は残す。
      entry.lastText = null;
      deps.log?.warn("指示を送れませんでした", { tool: toolParam, code: result.error.code });
      return c.json(
        toApiError({
          code: result.error.code,
          message: "セッションへ送れませんでした。",
          hint: SEND_ERROR_HINTS[result.error.code] ?? "時間をおいて「更新」を押してください。",
        }),
        502,
      );
    }

    deps.log?.info("指示を送信しました", { tool: toolParam, ok: true });

    return c.json({
      ok: true,
      sentAt: result.value.sentAt,
      note: "配信されたか保留されたかは受信側の設定（crossSessionInbound）に従います。",
    });
  });

  return route;
}
