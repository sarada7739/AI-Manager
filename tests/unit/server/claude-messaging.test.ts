// T-031: sendClaudeMessage（名前付きパイプへの投函アダプタ）の受け入れ条件を検証する。
// 実パイプ・実ファイルには一切触れない。すべて deps のフェイク（readdir / readFile / connect）で検証する。
// フィクスチャは合成データのみ。トークンも合成値 "0123456789abcdef0123456789abcdef" を使う
// （実トークンではない。実装が戻り値・エラー・ログにこの文字列を含めないことを確認する用途）。

import { EventEmitter } from "node:events";
import type { Dirent } from "node:fs";
import type net from "node:net";
import { describe, expect, it, vi } from "vitest";
import type {
  MessagingTarget,
  SendClaudeMessageDeps,
} from "../../../src/server/sources/claude/messaging";
import { sendClaudeMessage } from "../../../src/server/sources/claude/messaging";

// ---------------------------------------------------------------------------
// 共通フィクスチャ
// ---------------------------------------------------------------------------

const ROOT = "C:\\synthetic\\.claude";
const PID = 4242;
const VALID_SOCKET_PATH = "\\\\.\\pipe\\LOCAL\\cc-msg-0123abcd";
const SYNTHETIC_TOKEN = "0123456789abcdef0123456789abcdef";

function makeTarget(overrides: Partial<MessagingTarget> = {}): MessagingTarget {
  return { root: ROOT, pid: PID, socketPath: VALID_SOCKET_PATH, ...overrides };
}

/** Dirent 相当の最小フェイク（isFile() と name だけ持つ）。 */
function fakeDirent(name: string, isFile = true): Dirent {
  return { name, isFile: () => isFile } as unknown as Dirent;
}

function makeReaddirFake(entries: Dirent[]): SendClaudeMessageDeps["readdir"] {
  return (async () => entries) as unknown as SendClaudeMessageDeps["readdir"];
}

function makeReaddirRejectFake(): SendClaudeMessageDeps["readdir"] {
  return (async () => {
    throw new Error("ENOENT（テスト用フェイク）");
  }) as unknown as SendClaudeMessageDeps["readdir"];
}

function makeReadFileFake(content: string): SendClaudeMessageDeps["readFile"] {
  return (async () => content) as unknown as SendClaudeMessageDeps["readFile"];
}

function keyFileName(pid: number, hex = "a".repeat(64)): string {
  return `${pid}.${hex}.key`;
}

function keyJson(peerToken: string): string {
  return JSON.stringify({ peerToken });
}

/**
 * net.Socket の最小フェイク。EventEmitter を継承し、messaging.ts が使う
 * write / end / destroy / setTimeout / once("error"|"connect"|"close") だけを実装する。
 * - autoConnect: true なら構築後にマイクロタスクで "connect" を発火する
 *   （sendPayload がリスナーを張った後に届くよう、同期呼び出し内では発火しない）。
 * - connectError: true なら代わりに "error" を発火する。
 * - writeError: 非 undefined なら write のコールバックにエラーを渡す（end() は呼ばれない）。
 * - タイムアウトテスト用に何もしない（autoConnect: false）ことも選べる。
 */
class FakeSocket extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;
  ended = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly opts: {
      writeError?: Error;
      /** `end()` を呼んでも "close" を発火しない（受信側が接続を閉じないケースを模す）。 */
      neverClose?: boolean;
      /** `write()` のコールバックを一切呼ばない（接続後に応答が返らないケースを模す）。 */
      hangWrite?: boolean;
    } = {},
  ) {
    super();
  }

  setTimeout(ms: number, cb: () => void): this {
    this.timeoutHandle = setTimeout(cb, ms);
    return this;
  }

  write(data: string, encoding: BufferEncoding, cb: (error?: Error) => void): boolean {
    this.written.push(Buffer.from(data, encoding));
    if (this.opts.hangWrite) {
      return true;
    }
    if (this.opts.writeError) {
      cb(this.opts.writeError);
    } else {
      cb(undefined as unknown as Error);
    }
    return true;
  }

  end(): this {
    this.ended = true;
    if (!this.opts.writeError && !this.opts.neverClose) {
      queueMicrotask(() => this.emit("close"));
    }
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    if (this.timeoutHandle !== undefined) {
      clearTimeout(this.timeoutHandle);
    }
    return this;
  }
}

/**
 * `connect(socketPath)` フェイクを作る。`autoConnect` / `connectError` は、実際に接続関数が
 * 呼ばれた時点（= sendPayload がリスナーを張った直後）を基準にマイクロタスクで発火する。
 * FakeSocket の構築時点で発火をスケジュールすると、readPeerToken の await 完了より先に
 * イベントが失われてしまうため、ここで初めてスケジュールする。
 */
function connectReturning(
  socket: FakeSocket,
  opts: { autoConnect?: boolean; connectError?: boolean } = {},
): (socketPath: string) => net.Socket {
  return () => {
    if (opts.autoConnect) {
      queueMicrotask(() => socket.emit("connect"));
    }
    if (opts.connectError) {
      queueMicrotask(() => socket.emit("error", new Error("接続エラー（テスト用フェイク）")));
    }
    return socket as unknown as net.Socket;
  };
}

function writtenText(socket: FakeSocket): string {
  return Buffer.concat(socket.written).toString("utf8");
}

// ---------------------------------------------------------------------------
// 正常系: 送信されるバイト列
// ---------------------------------------------------------------------------

describe("sendClaudeMessage: 正常系（送信されるバイト列）", () => {
  it("認証行 + user 行 + 改行の順で書き込まれ、from: 'ai-manager'・本文がそのまま content に入る", async () => {
    const socket = new FakeSocket();
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
      connect: connectReturning(socket, { autoConnect: true }),
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    };

    const result = await sendClaudeMessage(makeTarget(), "こんにちは", deps);

    expect(result.ok).toBe(true);
    const payload = writtenText(socket);
    const [authLineRaw, messageLineRaw, trailing] = payload.split("\n");
    expect(trailing).toBe("");
    const authLine = JSON.parse(authLineRaw ?? "");
    const messageLine = JSON.parse(messageLineRaw ?? "");
    expect(authLine).toEqual({ type: "auth", token: SYNTHETIC_TOKEN });
    expect(messageLine).toEqual({
      type: "user",
      message: { role: "user", content: "こんにちは" },
      from: "ai-manager",
    });
  });

  it("日本語・改行・引用符・バックスラッシュを含む本文でも JSON として正しく往復する", async () => {
    const socket = new FakeSocket();
    const text = '改行\nを含む "引用符" と \\バックスラッシュ\\ を含む本文';
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
      connect: connectReturning(socket, { autoConnect: true }),
    };

    const result = await sendClaudeMessage(makeTarget(), text, deps);

    expect(result.ok).toBe(true);
    const payload = writtenText(socket);
    const lines = payload.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    const messageLine = JSON.parse(lines[1] ?? "");
    expect(messageLine.message.content).toBe(text);
  });

  it("複数の .key の中から pid 一致だけを選ぶ", async () => {
    const socket = new FakeSocket();
    const otherToken = "ffffffffffffffffffffffffffffffff";
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([
        fakeDirent(keyFileName(1111, "b".repeat(64))),
        fakeDirent(keyFileName(PID)),
        fakeDirent(keyFileName(2222, "c".repeat(64))),
      ]),
      readFile: (async (filePath: string) => {
        if (filePath.includes(`${PID}.`)) {
          return keyJson(SYNTHETIC_TOKEN);
        }
        return keyJson(otherToken);
      }) as unknown as SendClaudeMessageDeps["readFile"],
      connect: connectReturning(socket, { autoConnect: true }),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(true);
    const payload = writtenText(socket);
    const authLine = JSON.parse(payload.split("\n")[0] ?? "");
    expect(authLine.token).toBe(SYNTHETIC_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// 異常系: .key 関連
// ---------------------------------------------------------------------------

describe("sendClaudeMessage: .key が見つからない・読めない → key_not_found", () => {
  it("一致する .key が無い場合 → key_not_found", async () => {
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(9999))]),
      readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("key_not_found");
    }
  });

  it("sessions ディレクトリ自体が読めない（readdir が reject）場合 → key_not_found", async () => {
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirRejectFake(),
      readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("key_not_found");
    }
  });

  it("空の sessions ディレクトリ（エントリ 0 件） → key_not_found", async () => {
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([]),
      readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("key_not_found");
    }
  });
});

describe("sendClaudeMessage: .key の内容が不正 → key_invalid", () => {
  it("JSON でない内容 → key_invalid", async () => {
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake("{ not valid json ,,,"),
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("key_invalid");
    }
  });

  it("peerToken が 32 桁 16 進でない（短い） → key_invalid", async () => {
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake(keyJson("abc123")),
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("key_invalid");
    }
  });

  it("peerToken が 16 進以外の文字を含む（32 桁だが不正） → key_invalid", async () => {
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake(keyJson("g".repeat(32))),
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("key_invalid");
    }
  });

  it("peerToken フィールド自体が無い → key_invalid", async () => {
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake(JSON.stringify({ other: "field" })),
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("key_invalid");
    }
  });

  it("4 KiB 超の .key ファイル → key_invalid（境界値）", async () => {
    const bigContent = JSON.stringify({ peerToken: SYNTHETIC_TOKEN, padding: "x".repeat(5000) });
    expect(Buffer.byteLength(bigContent, "utf8")).toBeGreaterThan(4 * 1024);
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake(bigContent),
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("key_invalid");
    }
  });

  it("空ファイル（0 バイト） → key_invalid", async () => {
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake(""),
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("key_invalid");
    }
  });
});

// ---------------------------------------------------------------------------
// 異常系: パイプ関連
// ---------------------------------------------------------------------------

describe("sendClaudeMessage: パイプ関連の失敗", () => {
  it("socketPath が形式外（cc-msg- 前置きでない） → pipe_unreachable（.key には触れない）", async () => {
    // vi.fn() は readdir の複雑なオーバーロード型とかみ合わないため、呼び出し回数だけを
    // 手動でカウントするフェイクにする（実装が .key に触れていないことの確認が目的）。
    let readdirCallCount = 0;
    const readdir = (async () => {
      readdirCallCount += 1;
      return [fakeDirent(keyFileName(PID))];
    }) as unknown as SendClaudeMessageDeps["readdir"];
    const deps: SendClaudeMessageDeps = {
      readdir,
      readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(
      makeTarget({ socketPath: "\\\\.\\pipe\\other\\not-cc-msg" }),
      "本文",
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("pipe_unreachable");
    }
    expect(readdirCallCount).toBe(0);
  });

  it("connect がエラーを発火する → pipe_unreachable", async () => {
    const socket = new FakeSocket();
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
      connect: connectReturning(socket, { connectError: true }),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("pipe_unreachable");
    }
  });

  it("書き込み中にエラーが発生する → send_failed（socket が destroy される）", async () => {
    const socket = new FakeSocket({
      writeError: new Error("書き込みエラー（テスト用フェイク）"),
    });
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
      connect: connectReturning(socket, { autoConnect: true }),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("send_failed");
    }
    expect(socket.destroyed).toBe(true);
  });

  it("5 秒のタイムアウト → 失敗（pipe_unreachable）し、socket が destroy される", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket(); // autoConnect なし・応答なし
      const deps: SendClaudeMessageDeps = {
        readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
        readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
        connect: connectReturning(socket),
      };

      const pending = sendClaudeMessage(makeTarget(), "本文", deps);
      // .key の読み取り（マイクロタスク経由の Promise）を先に流してから、5 秒進める。
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("pipe_unreachable");
      }
      expect(socket.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// トークンが戻り値・エラーに現れないこと
// ---------------------------------------------------------------------------

describe("sendClaudeMessage: トークンの値が戻り値・エラーに一切含まれない", () => {
  it("成功時の戻り値（JSON 化した文字列）にトークン文字列が含まれない", async () => {
    const socket = new FakeSocket();
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
      connect: connectReturning(socket, { autoConnect: true }),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_TOKEN);
  });

  it("key_invalid エラー時の戻り値（JSON 化した文字列）にトークン文字列（もどき）が含まれない", async () => {
    const almostToken = SYNTHETIC_TOKEN.slice(0, 31); // 31 桁 = 不正
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake(keyJson(almostToken)),
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(almostToken);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// reviewer Round 1 BLOCKING 修正の固定化: sendPayload は close を待たない
// ---------------------------------------------------------------------------

describe("sendClaudeMessage: 受信側が接続を閉じなくても write 成功時点で ok になる（reviewer Round 1 修正の固定化）", () => {
  it("close が一切発火しなくても ok になり、5 秒進めても結果は変わらない", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket({ neverClose: true });
      const deps: SendClaudeMessageDeps = {
        readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
        readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
        connect: connectReturning(socket, { autoConnect: true }),
      };

      const pending = sendClaudeMessage(makeTarget(), "本文", deps);
      // .key の読み取り・connect の発火（マイクロタスク経由）を流す。
      await vi.advanceTimersByTimeAsync(0);
      const result = await pending;

      expect(result.ok).toBe(true);
      expect(socket.ended).toBe(true);

      // close を待たない実装なので、タイムアウトの猶予（5 秒）を過ぎても結果は変わらない。
      await vi.advanceTimersByTimeAsync(5000);
      expect(result.ok).toBe(true);
      // 相手が閉じなくても、end() 後のリンガー（1 秒）でソケットは破棄される（half-open を残さない）。
      expect(socket.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sendClaudeMessage: 接続前 / 接続後のタイムアウトで異なるコードになる", () => {
  it("接続前（connect イベント前）のタイムアウトは pipe_unreachable（既存動作の確認）", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket(); // autoConnect なし・応答なし
      const deps: SendClaudeMessageDeps = {
        readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
        readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
        connect: connectReturning(socket),
      };

      const pending = sendClaudeMessage(makeTarget(), "本文", deps);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("pipe_unreachable");
      }
      expect(socket.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("接続後・write コールバック前のタイムアウトは send_failed になる", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket({ hangWrite: true });
      const deps: SendClaudeMessageDeps = {
        readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
        readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
        connect: connectReturning(socket, { autoConnect: true }),
      };

      const pending = sendClaudeMessage(makeTarget(), "本文", deps);
      // .key の読み取り・connect の発火（connected=true になる）を流してから 5 秒進める。
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5000);

      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("send_failed");
      }
      expect(socket.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sendClaudeMessage: settle 後の error イベントでプロセスが落ちない（reviewer Round 1 修正の固定化）", () => {
  it("write 成功後（settle 後）に socket が error を出しても例外にならず、結果は ok のまま変わらない", async () => {
    const socket = new FakeSocket();
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([fakeDirent(keyFileName(PID))]),
      readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
      connect: connectReturning(socket, { autoConnect: true }),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);
    expect(result.ok).toBe(true);

    // settle 後に 'error' を発火しても、no-op ハンドラが付いているため例外にならない
    // （リスナー無しの 'error' は Node の既定動作でプロセスを落とすため、この検証に意味がある）。
    expect(() => {
      socket.emit("error", new Error("settle 後のエラー（テスト用フェイク）"));
    }).not.toThrow();
    expect(result.ok).toBe(true);
  });
});

describe("sendClaudeMessage: 同一 pid の .key 候補が複数ある場合は key_invalid（reviewer Round 1 修正の固定化）", () => {
  it("同一 pid・別 sha の .key が 2 件あると key_invalid（鍵ファイルが複数あります）になり、readFile は呼ばれない", async () => {
    let readFileCallCount = 0;
    const readFile = (async () => {
      readFileCallCount += 1;
      return keyJson(SYNTHETIC_TOKEN);
    }) as unknown as SendClaudeMessageDeps["readFile"];

    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([
        fakeDirent(keyFileName(PID, "a".repeat(64))),
        fakeDirent(keyFileName(PID, "b".repeat(64))),
      ]),
      readFile,
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("key_invalid");
      expect(result.error.message).toContain("複数");
    }
    expect(readFileCallCount).toBe(0);
  });

  it("同一 pid の .key が 3 件以上でも key_invalid になる（境界を超えても同じ扱い）", async () => {
    const deps: SendClaudeMessageDeps = {
      readdir: makeReaddirFake([
        fakeDirent(keyFileName(PID, "a".repeat(64))),
        fakeDirent(keyFileName(PID, "b".repeat(64))),
        fakeDirent(keyFileName(PID, "c".repeat(64))),
      ]),
      readFile: makeReadFileFake(keyJson(SYNTHETIC_TOKEN)),
      connect: connectReturning(new FakeSocket()),
    };

    const result = await sendClaudeMessage(makeTarget(), "本文", deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("key_invalid");
    }
  });
});
