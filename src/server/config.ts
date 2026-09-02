// サーバ設定の読込と既定値。ARCHITECTURE.md §2 の server/config.ts に対応する。
// 設定は local-data/config.json（省略可）を 1 か所で読み、既定値とマージする。
// node:path で組み立て、ホームは os.homedir()（テストでは homeDir オプションで差し替え可能）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asNumber, asString, isArray, isRecord, isString } from "../shared/guards.js";
import { err, ok, type Result } from "../shared/result.js";

/** サーバ全体の設定。 */
export interface AppConfig {
  /**
   * 読み取り対象のルートディレクトリ一覧。
   *
   * 【信頼モデル】roots は config.json（ローカルファイル）由来の「信頼済みのローカル設定」であり、
   * 任意のローカルパスを許容してよい。ネットワーク・API リクエストなど外部入力から roots を
   * 組み立てることは絶対にしてはならない（外部入力はあくまで roots 配下かどうかの判定対象に
   * とどめる。`src/server/sources/fs/safe-path.ts` の isUnderRoot を参照）。
   */
  roots: readonly string[];
  /** この分数以内に更新があれば「稼働中」とみなす稼働判定の窓（分）。 */
  activeWindowMinutes: number;
  /** ポーリングによる再走査の間隔（秒）。 */
  pollIntervalSec: number;
  /** サーバの待受ポート。 */
  port: number;
  /** アカウントキーごとの表示ラベル上書き。 */
  accounts: Record<string, string>;
}

/**
 * 既定の設定値を組み立てる。呼び出しごとに新しい配列・オブジェクトを返す
 * （呼び出し元同士で `roots` / `accounts` の参照を共有しないため）。
 */
export function buildDefaultConfig(homeDir: string): AppConfig {
  return {
    roots: [path.join(homeDir, ".claude"), path.join(homeDir, ".codex")],
    activeWindowMinutes: 5,
    pollIntervalSec: 10,
    port: 4317,
    accounts: {},
  };
}

/**
 * 既定の設定値（表示・テスト用に凍結したスナップショット）。`os.homedir()` を用いて構築する。
 * ランタイムの `loadConfig` はこの定数を直接使わず、都度 `buildDefaultConfig(homeDir)` を呼ぶ。
 */
const defaultConfigSnapshot = buildDefaultConfig(os.homedir());
export const DEFAULT_CONFIG: AppConfig = Object.freeze({
  ...defaultConfigSnapshot,
  roots: Object.freeze(defaultConfigSnapshot.roots),
  accounts: Object.freeze(defaultConfigSnapshot.accounts),
});

/** `loadConfig` のオプション。 */
export interface LoadConfigOptions {
  /** 設定ファイルのパス。既定は `<cwd>/local-data/config.json`。 */
  configPath?: string;
  /** ホームディレクトリ。`roots` 内の `~` 展開と既定値の組み立てに使う。既定は `os.homedir()`（テストでの差し替え用）。 */
  homeDir?: string;
}

/** 値が文字列の配列かどうかを判定する。 */
function isStringArray(value: unknown): value is string[] {
  return isArray(value) && value.every((item) => isString(item));
}

/** 値が「値がすべて文字列の Record」かどうかを判定する。 */
function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => isString(item));
}

/** 文字列先頭の `~` をホームディレクトリに展開する（`~` 単体、`~/...`、`~\...` が対象）。 */
function expandTilde(value: string, homeDir: string): string {
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

/** ファイル未検出エラー（ENOENT）かどうかを判定する。 */
function isFileNotFoundError(error: unknown): boolean {
  return asString(error, "code") === "ENOENT";
}

/** 値が正の整数かどうかを判定する。 */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * 設定ファイルを読み込み、既定値とマージして返す。
 * - ファイルが存在しない場合は既定値（`buildDefaultConfig(homeDir)`）をそのまま返す（ok）。
 * - JSON のパースに失敗した場合、またはいずれかのフィールドの型・値が不正な場合は err を返す。
 * - 一部のキーのみを含む部分的な設定は、残りを既定値で補って返す。
 * - `roots` に含まれる `~` は `homeDir`（既定 `os.homedir()`）に展開する。
 * - err の `message` には実パス（configPath 等）を含めない。固定文言 + `hint` で次の行動を示す。
 *   呼び出し側がログに出す際は、パスが必要なら fields 経由で渡す（log.ts がマスクする）。
 */
export function loadConfig(opts?: LoadConfigOptions): Result<AppConfig> {
  const homeDir = opts?.homeDir ?? os.homedir();
  const configPath = opts?.configPath ?? path.join(process.cwd(), "local-data", "config.json");
  const defaults = buildDefaultConfig(homeDir);

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return ok(defaults);
    }
    return err({
      code: "config_invalid",
      message: "設定ファイルを読み込めませんでした。",
      hint: "ファイルの権限を確認するか、ファイルを削除して既定値で起動してください。",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({
      code: "config_invalid",
      message: "設定ファイルの内容を JSON として解析できませんでした。",
      hint: "JSON の構文を確認するか、ファイルを削除して既定値で起動してください。",
    });
  }

  if (!isRecord(parsed)) {
    return err({
      code: "config_invalid",
      message: "設定ファイルの内容がオブジェクトではありません。",
      hint: "トップレベルを { } のオブジェクトにしてください。",
    });
  }

  let roots: string[] = [...defaults.roots];
  let activeWindowMinutes = defaults.activeWindowMinutes;
  let pollIntervalSec = defaults.pollIntervalSec;
  let port = defaults.port;
  let accounts: Record<string, string> = { ...defaults.accounts };

  if ("roots" in parsed) {
    const value = parsed.roots;
    if (!isStringArray(value)) {
      return err({
        code: "config_invalid",
        message: "設定の roots は文字列の配列である必要があります。",
        hint: '例: "roots": ["C:\\\\Users\\\\me\\\\.claude"]',
      });
    }
    const expandedRoots = value.map((root) => expandTilde(root, homeDir));
    const hasInvalidRoot = expandedRoots.some(
      (root) => root.length === 0 || !path.isAbsolute(root),
    );
    if (hasInvalidRoot) {
      return err({
        code: "config_invalid",
        message: "設定の roots は空でない絶対パスの配列である必要があります。",
        hint: 'local-data/config.json の roots を絶対パス（例: "C:\\\\Users\\\\me\\\\.claude"）にしてください。',
      });
    }
    roots = expandedRoots;
  }

  if ("activeWindowMinutes" in parsed) {
    const value = asNumber(parsed, "activeWindowMinutes");
    if (value === undefined || !isPositiveInteger(value)) {
      return err({
        code: "config_invalid",
        message: "設定の activeWindowMinutes は正の整数である必要があります。",
        hint: "local-data/config.json の activeWindowMinutes を正の整数にしてください。",
      });
    }
    activeWindowMinutes = value;
  }

  if ("pollIntervalSec" in parsed) {
    const value = asNumber(parsed, "pollIntervalSec");
    if (value === undefined || !isPositiveInteger(value)) {
      return err({
        code: "config_invalid",
        message: "設定の pollIntervalSec は正の整数である必要があります。",
        hint: "local-data/config.json の pollIntervalSec を正の整数にしてください。",
      });
    }
    pollIntervalSec = value;
  }

  if ("port" in parsed) {
    const value = asNumber(parsed, "port");
    if (value === undefined || !isPositiveInteger(value) || value > 65535) {
      return err({
        code: "config_invalid",
        message: "設定の port は 1〜65535 の整数である必要があります。",
        hint: "local-data/config.json の port を正の整数（1〜65535）にしてください。",
      });
    }
    port = value;
  }

  if ("accounts" in parsed) {
    const value = parsed.accounts;
    if (!isStringRecord(value)) {
      return err({
        code: "config_invalid",
        message: "設定の accounts は文字列値のオブジェクトである必要があります。",
        hint: '例: "accounts": { "claude:cli": "個人用" }',
      });
    }
    accounts = value;
  }

  return ok({ roots, activeWindowMinutes, pollIntervalSec, port, accounts });
}
