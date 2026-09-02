import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDefaultConfig, DEFAULT_CONFIG, loadConfig } from "../../../src/server/config";

// T-006 Round 2: loadConfig / buildDefaultConfig / DEFAULT_CONFIG の受け入れ条件を検証する。
// os.homedir() の実ファイルには依存しない。configPath は毎回 mkdtemp した一時ディレクトリを指す。
// roots の期待値は「実 os.homedir()」ではなく、テストごとに明示的に渡すダミーの homeDir
// （"C:\Users\someone" や一時ディレクトリ配下）から組み立てる。DEFAULT_CONFIG との
// toEqual(DEFAULT_CONFIG) のようなトートロジーな比較はしない（リテラルの期待値と比較する）。

describe("buildDefaultConfig", () => {
  it("呼び出しごとに新しいオブジェクト・配列を返す（roots / accounts の参照を共有しない）", () => {
    const a = buildDefaultConfig("C:\\Users\\someone");
    const b = buildDefaultConfig("C:\\Users\\someone");

    expect(a.roots).not.toBe(b.roots);
    expect(a.accounts).not.toBe(b.accounts);
    // 参照は別でも内容は同じ
    expect(a).toEqual(b);
  });

  it("homeDir から roots を組み立て、他のフィールドは固定の既定値になる", () => {
    const config = buildDefaultConfig("C:\\Users\\someone");

    expect(config.roots).toEqual([
      path.join("C:\\Users\\someone", ".claude"),
      path.join("C:\\Users\\someone", ".codex"),
    ]);
    expect(config.activeWindowMinutes).toBe(5);
    expect(config.pollIntervalSec).toBe(10);
    expect(config.port).toBe(4317);
    expect(config.accounts).toEqual({});
  });
});

describe("DEFAULT_CONFIG", () => {
  it("凍結されたスナップショットである（本体・roots・accounts のいずれも変更不可）", () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.roots)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.accounts)).toBe(true);
  });
});

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-manager-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("設定ファイルが無い場合、渡した homeDir から組み立てた既定値で ok を返す（os.homedir() に依存しない）", () => {
    const configPath = path.join(tmpDir, "does-not-exist.json");
    const homeDir = "C:\\Users\\someone";

    const result = loadConfig({ configPath, homeDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      roots: [path.join(homeDir, ".claude"), path.join(homeDir, ".codex")],
      activeWindowMinutes: 5,
      pollIntervalSec: 10,
      port: 4317,
      accounts: {},
    });
  });

  it("部分設定（{ port: 5000 }）は他のキーが既定値のままマージされる", () => {
    const configPath = path.join(tmpDir, "config.json");
    const homeDir = path.join(tmpDir, "home", "someone");
    fs.writeFileSync(configPath, JSON.stringify({ port: 5000 }), "utf-8");

    const result = loadConfig({ configPath, homeDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      roots: [path.join(homeDir, ".claude"), path.join(homeDir, ".codex")],
      activeWindowMinutes: 5,
      pollIntervalSec: 10,
      port: 5000,
      accounts: {},
    });
  });

  it("roots に含まれる `~` が homeDir オプションで展開される（`~`, `~/...`, `~\\...`）", () => {
    const configPath = path.join(tmpDir, "config.json");
    const fakeHome = path.join(tmpDir, "home", "someone");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ roots: ["~/.claude", "~\\.codex", "~"] }),
      "utf-8",
    );

    const result = loadConfig({ configPath, homeDir: fakeHome });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roots).toEqual([
      path.join(fakeHome, ".claude"),
      path.join(fakeHome, ".codex"),
      fakeHome,
    ]);
  });

  it("`~` を含まない roots はそのまま（展開しない）", () => {
    const configPath = path.join(tmpDir, "config.json");
    const literalRoot = "C:\\Users\\someone\\.claude";
    fs.writeFileSync(configPath, JSON.stringify({ roots: [literalRoot] }), "utf-8");

    const result = loadConfig({ configPath, homeDir: path.join(tmpDir, "home") });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roots).toEqual([literalRoot]);
  });

  it("roots の要素が空文字の場合は err(config_invalid) を返す", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ roots: [""] }), "utf-8");

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config_invalid");
  });

  it("roots の要素が相対パス（`~` 展開後も相対）の場合は err(config_invalid) を返す", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ roots: ["relative/x"] }), "utf-8");

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config_invalid");
  });

  it("roots の一部だけが空文字・相対パスでも配列全体が err になる", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ roots: ["C:\\Users\\someone\\.claude", "relative/x"] }),
      "utf-8",
    );

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config_invalid");
  });

  it("壊れた JSON は err(config_invalid) を返し、message / hint が空でない", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, "{ invalid json,,, ", "utf-8");

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config_invalid");
    expect(result.error.message.length).toBeGreaterThan(0);
    expect((result.error.hint ?? "").length).toBeGreaterThan(0);
  });

  it("err の message に実パス（configPath / 一時ディレクトリのパス）を含めない", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, "{ invalid json,,, ", "utf-8");

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toContain(tmpDir);
    expect(result.error.message).not.toContain(configPath);
    expect(result.error.hint ?? "").not.toContain(tmpDir);
  });

  it("空ファイルは JSON として不正なため err(config_invalid) を返す", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, "", "utf-8");

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config_invalid");
  });

  it("トップレベルが配列など、オブジェクトでない JSON は err(config_invalid) を返す", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify([1, 2, 3]), "utf-8");

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config_invalid");
  });

  it("トップレベルが文字列など、オブジェクトでない JSON は err(config_invalid) を返す", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify("hello"), "utf-8");

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config_invalid");
  });

  it("port が数値でない（{ port: 'abc' }）場合は err(config_invalid) を返す", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ port: "abc" }), "utf-8");

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config_invalid");
  });

  it("roots が配列でない（{ roots: 'notarray' }）場合は err(config_invalid) を返す", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ roots: "notarray" }), "utf-8");

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config_invalid");
  });

  it("roots の要素が文字列でない場合も err(config_invalid) を返す", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ roots: [1, 2] }), "utf-8");

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config_invalid");
  });

  it("accounts が文字列値のオブジェクトでない（{ accounts: [1] }）場合は err(config_invalid) を返す", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ accounts: [1] }), "utf-8");

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config_invalid");
  });

  it("accounts の値が文字列でない（{ accounts: { a: 1 } }）場合も err(config_invalid) を返す", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ accounts: { a: 1 } }), "utf-8");

    const result = loadConfig({ configPath });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("config_invalid");
  });

  it("activeWindowMinutes / pollIntervalSec が数値でない場合も err(config_invalid) を返す", () => {
    const configPath1 = path.join(tmpDir, "config1.json");
    fs.writeFileSync(configPath1, JSON.stringify({ activeWindowMinutes: "5" }), "utf-8");
    const result1 = loadConfig({ configPath: configPath1 });
    expect(result1.ok).toBe(false);

    const configPath2 = path.join(tmpDir, "config2.json");
    fs.writeFileSync(configPath2, JSON.stringify({ pollIntervalSec: "10" }), "utf-8");
    const result2 = loadConfig({ configPath: configPath2 });
    expect(result2.ok).toBe(false);
  });

  // Round 2: activeWindowMinutes / pollIntervalSec / port は「正の整数」であることを検証する
  // （port はさらに 1〜65535 の範囲）。hint に対象キー名が含まれることも確認する。
  describe("数値フィールドの範囲検証（正の整数であること）", () => {
    it.each([
      ["port", 0],
      ["port", 70000],
      ["port", 1.5],
      ["port", -1],
      ["pollIntervalSec", 0],
    ])("%s = %j は err(config_invalid) を返し、hint にキー名を含む", (key, value) => {
      const configPath = path.join(tmpDir, `config-${key}-${String(value)}.json`);
      fs.writeFileSync(configPath, JSON.stringify({ [key]: value }), "utf-8");

      const result = loadConfig({ configPath });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("config_invalid");
      expect(result.error.hint ?? "").toContain(key);
    });

    it("activeWindowMinutes が数値でない文字列（'5'）の場合、hint にキー名を含む", () => {
      const configPath = path.join(tmpDir, "config-activeWindowMinutes-string.json");
      fs.writeFileSync(configPath, JSON.stringify({ activeWindowMinutes: "5" }), "utf-8");

      const result = loadConfig({ configPath });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("config_invalid");
      expect(result.error.hint ?? "").toContain("activeWindowMinutes");
    });
  });

  it("有効な完全設定はそのまま反映される", () => {
    const configPath = path.join(tmpDir, "config.json");
    const fakeHome = path.join(tmpDir, "home", "someone");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        roots: ["~/.claude"],
        activeWindowMinutes: 15,
        pollIntervalSec: 30,
        port: 5000,
        accounts: { "claude:cli": "個人用" },
      }),
      "utf-8",
    );

    const result = loadConfig({ configPath, homeDir: fakeHome });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      roots: [path.join(fakeHome, ".claude")],
      activeWindowMinutes: 15,
      pollIntervalSec: 30,
      port: 5000,
      accounts: { "claude:cli": "個人用" },
    });
  });
});
