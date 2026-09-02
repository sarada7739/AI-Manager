import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../src/server/log";

// T-006 Round 2: createLogger の受け入れ条件を検証する。
// sink は配列に push する関数に差し替え、console を一切呼ばないことを確認する。
// ダミーのパス（例: "C:\Users\someone\..."）を使い、実パス・実ユーザー名は書かない。
//
// マスク仕様（Round 2）:
// - homeDir を先に `~` に置換し、そのうえで homeDir 配下でない roots だけを `<root>` に置換する。
//   そのため homeDir 配下にある root（例: `~/.claude`）は `<root>` にはならず `~/.claude/...` の形を保つ。
// - message も fields と同様にマスクされる。
// - fields はネスト（オブジェクト・配列）を含めて再帰的にマスクされる。

const ROOT_CLAUDE = "C:\\Users\\someone\\.claude"; // homeDir 配下の root
const ROOT_CODEX = "C:\\Users\\someone\\.codex"; // homeDir 配下の root
const HOME_DIR = "C:\\Users\\someone";
const OUTSIDE_ROOT = "D:\\shared\\.claude-external"; // homeDir 配下ではない root

function makeSink(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

describe("createLogger", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("出力は JSON.parse でき、level / at(ISO) / message / fields を含む", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE, ROOT_CODEX], homeDir: HOME_DIR, sink });

    logger.info("読み込み開始", { count: 3 });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.level).toBe("info");
    expect(typeof parsed.at).toBe("string");
    expect(new Date(parsed.at).toISOString()).toBe(parsed.at);
    expect(parsed.message).toBe("読み込み開始");
    expect(parsed.count).toBe(3);
  });

  it("level は info / warn / error それぞれ正しく出力される", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.info("info メッセージ");
    logger.warn("warn メッセージ");
    logger.error("error メッセージ");

    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0] ?? "").level).toBe("info");
    expect(JSON.parse(lines[1] ?? "").level).toBe("warn");
    expect(JSON.parse(lines[2] ?? "").level).toBe("error");
  });

  it("1 行に 1 JSON（改行を含む 1 レコード）を出力する", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.info("test");

    expect(lines).toHaveLength(1);
    // 1 回の呼び出しで 1 レコード分のみが渡される（複数行や複数 JSON が混ざらない）
    expect(lines[0]?.trim().split("\n")).toHaveLength(1);
  });

  it("fields の文字列値に含まれる homeDir 配下のパス（root を含む）が `~` に置換される（`\\` 区切り）", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE, ROOT_CODEX], homeDir: HOME_DIR, sink });

    logger.info("読み込み", {
      path: `${ROOT_CLAUDE}\\projects\\a.jsonl`,
    });

    const parsed = JSON.parse(lines[0] ?? "");
    // homeDir が先に `~` に置換されるため、root 部分（.claude）はそのまま残る形になる
    expect(parsed.path).toBe("~\\.claude\\projects\\a.jsonl");
  });

  it("fields の文字列値に含まれる homeDir 配下のパスが `~` に置換される（`/` 区切り）", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE, ROOT_CODEX], homeDir: HOME_DIR, sink });

    logger.info("読み込み", {
      path: `${ROOT_CLAUDE.replace(/\\/g, "/")}/projects/a.jsonl`,
    });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.path).toBe("~/.claude/projects/a.jsonl");
  });

  it("パスの大文字小文字が違っても置換される", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.info("読み込み", {
      path: `${ROOT_CLAUDE.toUpperCase()}\\PROJECTS\\A.JSONL`,
    });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.path).toBe("~\\.CLAUDE\\PROJECTS\\A.JSONL");
  });

  it("homeDir 配下（roots 外）のパスも `~` に置換される", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.info("読み込み", {
      path: `${HOME_DIR}\\Desktop\\note.txt`,
    });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.path).toBe("~\\Desktop\\note.txt");
  });

  it("homeDir 配下でない root は `<root>` に置換される", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [OUTSIDE_ROOT], homeDir: HOME_DIR, sink });

    logger.info("読み込み", {
      path: `${OUTSIDE_ROOT}\\projects\\a.jsonl`,
    });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.path).toBe("<root>\\projects\\a.jsonl");
  });

  it("homeDir 配下の root は `<root>` にならず `~/....` の形を保つ", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE, OUTSIDE_ROOT], homeDir: HOME_DIR, sink });

    logger.info("読み込み", {
      claudePath: `${ROOT_CLAUDE}\\projects\\a.jsonl`,
      externalPath: `${OUTSIDE_ROOT}\\b.jsonl`,
    });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.claudePath).toBe("~\\.claude\\projects\\a.jsonl");
    expect(parsed.externalPath).toBe("<root>\\b.jsonl");
  });

  it("roots / homeDir 配下でないパスはそのまま出力される", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.info("読み込み", {
      path: "D:\\other\\data.jsonl",
    });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.path).toBe("D:\\other\\data.jsonl");
  });

  it("前方一致するだけの別ディレクトリ（.claude2）は誤って置換しない", () => {
    // homeDir を candidate の前方一致にしないため、roots/homeDir とは別系統のダミーパスにする
    // （HOME_DIR "C:\Users\someone" 自体が候補パスの前方一致になってしまうため、ここでは使わない）。
    const { lines, sink } = makeSink();
    const logger = createLogger({
      roots: [ROOT_CLAUDE],
      homeDir: "C:\\Users\\other",
      sink,
    });

    logger.info("読み込み", {
      path: "C:\\Users\\someone\\.claude2\\x.jsonl",
    });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.path).toBe("C:\\Users\\someone\\.claude2\\x.jsonl");
  });

  it("fields のネスト（配列内の文字列）も再帰的にマスクされる", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.info("読み込み", {
      paths: [`${ROOT_CLAUDE}\\a.jsonl`, "D:\\other\\b.jsonl"],
    });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.paths).toEqual(["~\\.claude\\a.jsonl", "D:\\other\\b.jsonl"]);
  });

  it("fields のネスト（2 段のオブジェクト）も再帰的にマスクされる", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.info("読み込み", {
      level1: { level2: { path: `${ROOT_CLAUDE}\\x.jsonl` } },
    });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.level1).toEqual({ level2: { path: "~\\.claude\\x.jsonl" } });
  });

  it("message 自体もマスクされる", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    const messageWithPath = `失敗: ${ROOT_CLAUDE}\\projects\\a.jsonl`;
    logger.error(messageWithPath);

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.message).toBe("失敗: ~\\.claude\\projects\\a.jsonl");
  });

  it("fields を渡さない場合でも level / at / message のみで正常に出力される", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.warn("フィールドなし");

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.level).toBe("warn");
    expect(parsed.message).toBe("フィールドなし");
  });

  it("数値・真偽値・null など文字列以外の field 値はそのまま出力される（ネスト内も同様）", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.info("値の型", { count: 5, ok: true, missing: null, nested: { flag: false, n: 1 } });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.count).toBe(5);
    expect(parsed.ok).toBe(true);
    expect(parsed.missing).toBeNull();
    expect(parsed.nested).toEqual({ flag: false, n: 1 });
  });

  it("roots が空配列でも例外を投げず動作する（homeDir 配下は引き続きマスクされる）", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [], homeDir: HOME_DIR, sink });

    logger.info("マスク対象なし", { path: `${ROOT_CLAUDE}\\x.jsonl` });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.path).toBe("~\\.claude\\x.jsonl");
  });

  it("console を一切呼ばない", () => {
    const { sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  // T-013 引き継ぎ分: Date / Error / Map / 予約キー / 循環参照 / 深さ上限 / ダッシュ符号化 homeDir のマスク

  it("field 値が Date の場合、ISO 文字列に変換されてから出力される", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });
    const someDate = new Date("2026-01-01T00:00:00.000Z");

    logger.info("日付を含む", { someDate });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.someDate).toBe("2026-01-01T00:00:00.000Z");
  });

  it("field 値が Error の場合、message がマスクされた文字列として出力される", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });
    const error = new Error(`失敗: ${ROOT_CLAUDE}\\a.jsonl`);

    logger.error("読み込みエラー", { error });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.error).toBe("失敗: ~\\.claude\\a.jsonl");
  });

  it("field 値が Map の場合、String(value) が出力される（マスクも適用される）", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });
    const map = new Map([["a", 1]]);

    logger.info("Map を含む", { map });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.map).toBe(String(map));
  });

  it("field 値が Set の場合、String(value) が出力される", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });
    const set = new Set([1, 2, 3]);

    logger.info("Set を含む", { set });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.set).toBe(String(set));
  });

  it("fields に予約キー（level / at / message）を渡しても出力側の値が上書きされない", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.info("実際のメッセージ", {
      level: "not-a-real-level",
      at: "not-a-real-timestamp",
      message: "not-the-real-message",
    });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("実際のメッセージ");
    expect(parsed.at).not.toBe("not-a-real-timestamp");
    expect(new Date(parsed.at).toISOString()).toBe(parsed.at);
  });

  it('循環参照を含む field は例外にならず "[circular]" になる', () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });
    const circular: Record<string, unknown> = { name: "自己参照" };
    circular.self = circular;

    expect(() => logger.info("循環構造", { circular })).not.toThrow();

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.circular.self).toBe("[circular]");
  });

  it('深さ上限（32）を超えるネストは "[depth]" になる', () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });
    let nested: unknown = "leaf";
    for (let i = 0; i < 40; i += 1) {
      nested = { child: nested };
    }

    expect(() => logger.info("深いネスト", { root: nested })).not.toThrow();

    const parsed = JSON.parse(lines[0] ?? "");
    expect(JSON.stringify(parsed.root)).toContain("[depth]");
  });

  it("homeDir のダッシュ符号化形（`C--Users-someone`）を含む message がマスクされる", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.error("失敗: C--Users-someone-project の読み込みに失敗しました");

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.message).toBe("失敗: ~-project の読み込みに失敗しました");
  });

  it("homeDir のダッシュ符号化形を含む fields もマスクされる", () => {
    const { lines, sink } = makeSink();
    const logger = createLogger({ roots: [ROOT_CLAUDE], homeDir: HOME_DIR, sink });

    logger.info("読み込み", { dirName: "C--Users-someone-project" });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.dirName).toBe("~-project");
  });

  it("sink が呼び出しのたびに throw しても、createLogger の呼び出し側に例外が伝播しない", () => {
    const logger = createLogger({
      roots: [ROOT_CLAUDE],
      homeDir: HOME_DIR,
      sink: () => {
        throw new Error("sink が常に失敗する");
      },
    });

    expect(() => logger.info("test", { path: `${ROOT_CLAUDE}\\a.jsonl` })).not.toThrow();
  });
});
