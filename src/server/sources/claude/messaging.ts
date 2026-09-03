// 稼働中の Claude Code セッションへ指示を送るアダプタ（F-7, ADR-0009）。
// docs/RESEARCH.md §6.2a で確定した投函形式に基づき、`sessions/<pid>.json` が指す名前付きパイプ
// （`\\.\pipe\LOCAL\cc-msg-<hex>`）へ「認証行 + メッセージ行」の 2 行を書き、書き終えた時点で成功とする
// （受信側は接続を閉じないことがあるため `close` は待たず、`end()` 後に短いリンガーで破棄する）。
// 実測（RESEARCH.md §6.2a）では受信側は行を受け取っても接続を閉じないため、`write` の
// コールバックが成功した時点で「届いた」とみなす（`close` イベントは待たない。reviewer Round 1
// 指摘の反映）。
//
// 【`.key` を読む唯一の経路】
// ARCHITECTURE.md §7 のとおり `sessions/*.key` は読み取り除外対象だが、送信に必要な
// `peerToken` を得るためだけに、この関数の中でだけ例外的に読む（`isExcludedFile` は呼ばない）。
// 読み取った `peerToken` は認証行の組み立てにのみ使い、戻り値・エラー・ログには一切含めない。
// 変数はこの関数のスコープを出た時点で参照されなくなる（メモリに保持しない）。

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { isRecord } from "../../../shared/guards.js";
import type { Result } from "../../../shared/result.js";
import { err, ok } from "../../../shared/result.js";
import { isUnderRoot } from "../fs/safe-path.js";

/** 送信先の特定に必要な最小限の情報（`SessionIndex.getMessagingTarget` が返す形と同じ）。 */
export interface MessagingTarget {
  root: string;
  pid: number;
  socketPath: string;
}

/** 送信失敗時のエラーコード。 */
export type SendMessageErrorCode =
  | "key_not_found"
  | "key_invalid"
  | "pipe_unreachable"
  | "send_failed";

/** 送信失敗時のエラー。実パス・トークン・本文は含めない。 */
export interface SendMessageError {
  code: SendMessageErrorCode;
  message: string;
}

/** 送信成功時の戻り値。 */
export interface SendMessageSuccess {
  sentAt: string;
}

/** `sendClaudeMessage` の依存（テストでの差し替え用）。省略時は node:fs/promises・node:net の実物。 */
export interface SendClaudeMessageDeps {
  readdir?: typeof readdir;
  readFile?: typeof readFile;
  /** `net.connect(path)` 相当。テストでは実パイプを立てずにフェイクの Socket を返せる。 */
  connect?: (socketPath: string) => net.Socket;
  /** 現在時刻。省略時は `() => new Date()`。 */
  now?: () => Date;
}

/** `peerToken` の形式（RESEARCH.md §6.2a：32 桁の 16 進文字列）。 */
const PEER_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** `messagingSocketPath` の形式。ユーザー入力からパスを組み立てないための最終検証にも使う。 */
const SOCKET_PATH_PATTERN = /^\\\\\.\\pipe\\LOCAL\\cc-msg-[0-9a-f]+$/;

/** `.key` ファイルの想定サイズ上限（実測 111 バイト。余裕を持って 4 KiB）。 */
const MAX_KEY_FILE_BYTES = 4 * 1024;

/** 接続〜書き込み完了までのタイムアウト（ms）。 */
const CONNECT_AND_SEND_TIMEOUT_MS = 5000;

/** 書き終えて `end()` した後、相手が閉じなくてもソケットを破棄するまでの猶予（ms）。結果には影響しない。 */
const LINGER_AFTER_END_MS = 1000;

/** `sessions/<pid>.<64 hex>.key` の形式に一致する名前だけを対象にする正規表現を作る。 */
function buildKeyFileNamePattern(pid: number): RegExp {
  return new RegExp(`^${pid}\\.[0-9a-f]{64}\\.key$`);
}

/**
 * `root/sessions` 配下から `<pid>.<64 hex>.key` に一致するファイルを探し、`peerToken` を返す。
 * 見つからない・読めない場合は `key_not_found`、JSON でない・形式が不正な場合は `key_invalid`。
 * 一致するファイルが 2 件以上ある場合も `key_invalid`（古い鍵が残留していて、どれが現在の
 * プロセスのものか特定できないため。stale な鍵を誤って掴まないための reviewer 指摘の反映）。
 */
async function readPeerToken(
  target: MessagingTarget,
  deps: Required<Pick<SendClaudeMessageDeps, "readdir" | "readFile">>,
): Promise<Result<string, SendMessageError>> {
  const sessionsDir = path.join(target.root, "sessions");

  let entries: Dirent[];
  try {
    entries = await deps.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return err({ code: "key_not_found", message: "鍵ファイルが見つかりませんでした。" });
  }

  const namePattern = buildKeyFileNamePattern(target.pid);
  const keyFileNames = entries
    .filter((entry) => entry.isFile() && namePattern.test(entry.name))
    .map((entry) => entry.name);

  if (keyFileNames.length === 0) {
    return err({ code: "key_not_found", message: "鍵ファイルが見つかりませんでした。" });
  }
  if (keyFileNames.length > 1) {
    return err({ code: "key_invalid", message: "鍵ファイルが複数あります。" });
  }
  const [keyFileName] = keyFileNames;
  if (keyFileName === undefined) {
    return err({ code: "key_not_found", message: "鍵ファイルが見つかりませんでした。" });
  }

  const keyFilePath = path.join(sessionsDir, keyFileName);
  if (!isUnderRoot(keyFilePath, [target.root])) {
    return err({ code: "key_not_found", message: "鍵ファイルが見つかりませんでした。" });
  }

  let raw: string;
  try {
    raw = await deps.readFile(keyFilePath, "utf8");
  } catch {
    return err({ code: "key_not_found", message: "鍵ファイルを読み取れませんでした。" });
  }

  if (Buffer.byteLength(raw, "utf8") > MAX_KEY_FILE_BYTES) {
    return err({ code: "key_invalid", message: "鍵ファイルの形式が不正です。" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({ code: "key_invalid", message: "鍵ファイルの形式が不正です。" });
  }
  // raw はここで役目を終える（以降は参照しない）。

  const peerToken =
    isRecord(parsed) && typeof parsed.peerToken === "string" ? parsed.peerToken : undefined;
  if (peerToken === undefined || !PEER_TOKEN_PATTERN.test(peerToken)) {
    return err({ code: "key_invalid", message: "鍵ファイルの形式が不正です。" });
  }

  return ok(peerToken);
}

/**
 * 検証済みの `socketPath` へ接続し、`payload`（認証行 + メッセージ行）を書いて接続を閉じる。
 * 受信側は行を受け取っても接続を閉じない（RESEARCH.md §6.2a）ため、`close` イベントは待たず、
 * `write` のコールバックが成功した時点で「届いた」とみなして resolve する（応答行も無いため読まない）。
 * `pipe_unreachable` は接続確立前（`connect` 前の `error` / タイムアウト）にだけ使い、
 * 接続後（`connect` イベント後）のタイムアウト・書き込みエラーは `send_failed` にする。
 */
function sendPayload(
  socketPath: string,
  payload: string,
  connect: (socketPath: string) => net.Socket,
): Promise<Result<void, SendMessageError>> {
  return new Promise((resolve) => {
    let settled = false;
    let connected = false;
    const socket = connect(socketPath);

    function finish(result: Result<void, SendMessageError>): void {
      if (settled) {
        return;
      }
      settled = true;
      socket.removeAllListeners();
      // settle 後にこのソケットが 'error' を出してもプロセスを落とさないよう、
      // no-op のハンドラを付けておく（リスナー無しの 'error' は Node の既定動作で
      // プロセスを落とすため。reviewer Round 1 指摘の反映）。
      socket.on("error", () => {});
      resolve(result);
    }

    function connectPhaseError(): SendMessageError {
      return connected
        ? { code: "send_failed", message: "送信中にエラーが発生しました。" }
        : { code: "pipe_unreachable", message: "パイプへ接続できませんでした。" };
    }

    socket.setTimeout(CONNECT_AND_SEND_TIMEOUT_MS, () => {
      socket.destroy();
      finish(err(connectPhaseError()));
    });

    socket.once("error", () => {
      socket.destroy();
      finish(err(connectPhaseError()));
    });

    socket.once("connect", () => {
      connected = true;
      socket.write(payload, "utf8", (writeError) => {
        if (writeError) {
          socket.destroy();
          finish(err({ code: "send_failed", message: "送信中にエラーが発生しました。" }));
          return;
        }
        socket.end();
        finish(ok(undefined));
        // 受信側は接続を閉じないことがある（RESEARCH.md §6.2a）ため、書き終えた後は結果を変えずに
        // 後始末だけ行う: 相手が閉じれば close で終わり、閉じなければ短いリンガー後に破棄する
        // （half-open のハンドルを残さない。reviewer Round 2 NON_BLOCKING の反映）。
        const linger = setTimeout(() => socket.destroy(), LINGER_AFTER_END_MS);
        linger.unref();
        socket.once("close", () => clearTimeout(linger));
      });
    });
  });
}

/**
 * 稼働中の Claude Code セッションへ 1 件の指示（`text`）を送る。
 * 手順: `.key` から `peerToken` を読む → 名前付きパイプへ接続 → 認証行・メッセージ行を書く →
 * 接続を閉じる。応答行は無いため読まない（RESEARCH.md §6.2a）。
 */
export async function sendClaudeMessage(
  target: MessagingTarget,
  text: string,
  deps?: SendClaudeMessageDeps,
): Promise<Result<SendMessageSuccess, SendMessageError>> {
  const resolvedDeps = {
    readdir: deps?.readdir ?? readdir,
    readFile: deps?.readFile ?? readFile,
    connect: deps?.connect ?? ((socketPath: string) => net.connect(socketPath)),
    now: deps?.now ?? (() => new Date()),
  };

  // ユーザー入力（target は索引由来だが、念のため）からパイプ名を組み立てず、
  // 形式を再検証してから net.connect に渡す。
  if (!SOCKET_PATH_PATTERN.test(target.socketPath)) {
    return err({ code: "pipe_unreachable", message: "パイプへ接続できませんでした。" });
  }

  const tokenResult = await readPeerToken(target, resolvedDeps);
  if (!tokenResult.ok) {
    return tokenResult;
  }
  const peerToken = tokenResult.value;

  const authLine = JSON.stringify({ type: "auth", token: peerToken });
  const messageLine = JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    from: "ai-manager",
  });
  const payload = `${authLine}\n${messageLine}\n`;
  // peerToken はここまで。以降は payload だけを使い、peerToken 自体は参照しない。

  const sendResult = await sendPayload(target.socketPath, payload, resolvedDeps.connect);
  if (!sendResult.ok) {
    return sendResult;
  }

  return ok({ sentAt: resolvedDeps.now().toISOString() });
}
