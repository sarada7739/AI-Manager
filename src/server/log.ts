// サーバのログ出力。CLAUDE.md §4「サーバは console を直接呼ばず log.ts を使う」を実装する。
// セッション本文・実パスをログに出さないため、message と fields（ネストしたオブジェクト・配列を
// 含む）の文字列値に含まれる roots / homeDir 配下のパスをマスクしてから出力する。
// マスクは homeDir を先に `~` へ置換し、そのうえで roots のうち homeDir 配下でないものだけを
// `<root>` に置換する（`~/.claude/projects/x` のように homeDir 配下のパス構造は残す）。
// 既定インスタンスは持たず、起動時に config を渡して生成する。

import { isRecord } from "../shared/guards.js";

/** ログレベル。 */
export type LogLevel = "info" | "warn" | "error";

/** ログ出力関数の共通シグネチャ。 */
export type LogMethod = (message: string, fields?: Record<string, unknown>) => void;

/** `createLogger` が返すロガー。 */
export interface Logger {
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
}

/** `createLogger` のオプション。 */
export interface CreateLoggerOptions {
  /** マスク対象のルートディレクトリ一覧（config.roots）。 */
  roots: readonly string[];
  /** マスク対象のホームディレクトリ。 */
  homeDir: string;
  /** 出力先。既定は `process.stdout.write`（`console` は使わない）。 */
  sink?: (line: string) => void;
}

/** 1 件のマスク規則（一致した箇所を `replacement` に置き換える）。 */
interface MaskRule {
  pattern: RegExp;
  replacement: string;
}

/** 再帰的なマスク処理の深さ上限。循環に近い深い構造でスタックを消費し続けないための保険。 */
const MAX_MASK_DEPTH = 32;

/** 正規表現の特殊文字をエスケープする。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * パス文字列（マスク対象のルートやホームディレクトリ）を、区切り文字が `\` でも `/` でも
 * 一致する正規表現に変換する。マッチは大文字小文字を無視し、末尾が区切り文字または
 * 文字列終端の位置でのみ成立する（前方一致するだけの別ディレクトリを誤って一致させないため）。
 */
function buildMaskPattern(rawPrefix: string): RegExp | undefined {
  const trimmed = rawPrefix.replace(/[\\/]+$/, "");
  const segments = trimmed.split(/[\\/]+/).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return undefined;
  }
  const body = segments.map((segment) => escapeRegExp(segment)).join("[\\\\/]");
  return new RegExp(`${body}(?=[\\\\/]|$)`, "gi");
}

/**
 * `homeDir` をダッシュ符号化した文字列（`projects/<dir>` のディレクトリ名で使われる形。
 * 例: `C:\Users\name` → `C--Users-name`）に一致する正規表現を作る。
 * 英数字以外の文字をすべて `-` に置換したものを対象にし、末尾が `-` / `\` / `/` または
 * 文字列終端の位置でのみ成立する（`buildMaskPattern` と同じ「単語境界」の考え方。
 * ダッシュ符号化された文字列内では区切りが `-` になるため、区切り候補に `-` を加える）。
 */
function buildDashMaskPattern(rawHomeDir: string): RegExp | undefined {
  const trimmed = rawHomeDir.replace(/[\\/]+$/, "");
  const encoded = trimmed.replace(/[^A-Za-z0-9]/g, "-").replace(/-+$/, "");
  if (encoded.length === 0) {
    return undefined;
  }
  return new RegExp(`${escapeRegExp(encoded)}(?=[-\\\\/]|$)`, "gi");
}

/** パス文字列を `\` / `/` 区切りで小文字の segment 配列に正規化する。 */
function normalizeSegments(value: string): string[] {
  return value
    .replace(/[\\/]+$/, "")
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

/** `candidate` が `homeDir` 自身またはその配下かどうかを判定する（大文字小文字・区切り文字を無視）。 */
function isPathUnderHomeDir(candidate: string, homeDir: string): boolean {
  const homeSegments = normalizeSegments(homeDir);
  if (homeSegments.length === 0) {
    return false;
  }
  const candidateSegments = normalizeSegments(candidate);
  if (candidateSegments.length < homeSegments.length) {
    return false;
  }
  return homeSegments.every((segment, index) => candidateSegments[index] === segment);
}

/**
 * マスク規則の一覧を作る。
 * 1. homeDir を `~` に置換する規則を先頭に置く。
 * 2. roots のうち homeDir 配下でないものだけを、長い（＝より具体的な）順に `<root>` へ置換する
 *    規則として追加する（homeDir 配下の root は 1. の置換で `~/...` の形になるため個別には扱わない）。
 */
function buildMaskRules(roots: readonly string[], homeDir: string): MaskRule[] {
  const rules: MaskRule[] = [];

  const homePattern = homeDir.length > 0 ? buildMaskPattern(homeDir) : undefined;
  if (homePattern !== undefined) {
    rules.push({ pattern: homePattern, replacement: "~" });
  }

  const dashHomePattern = homeDir.length > 0 ? buildDashMaskPattern(homeDir) : undefined;
  if (dashHomePattern !== undefined) {
    rules.push({ pattern: dashHomePattern, replacement: "~" });
  }

  const outsideRoots = roots
    .filter((root) => root.length > 0 && !isPathUnderHomeDir(root, homeDir))
    .sort((a, b) => b.length - a.length);

  for (const root of outsideRoots) {
    const pattern = buildMaskPattern(root);
    if (pattern !== undefined) {
      rules.push({ pattern, replacement: "<root>" });
    }
  }

  return rules;
}

/** 文字列内のマスク対象パスを規則に従って置換する。 */
function maskValue(value: string, rules: readonly MaskRule[]): string {
  let result = value;
  for (const rule of rules) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

/** value が「素の」オブジェクト（オブジェクトリテラル相当）かどうかを判定する。 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 値を再帰的にマスクする。
 * - 文字列: マスク規則を適用する
 * - 配列・素のオブジェクト: 中身を再帰的にマスクする（`seen` で訪問中の祖先を追跡し、
 *   自身を再度参照する循環構造は `"[circular]"` にする。`depth` が上限を超えたら `"[depth]"`）
 * - `Date`: ISO 文字列にしてからマスクする
 * - `Error`: `message` を文字列としてマスクする
 * - `Map` / `Set` / クラスインスタンスなど、その他の非プレーンオブジェクト: `String(value)` をマスクする
 * - それ以外（数値・真偽値・null・undefined 等）はそのまま返す
 */
function maskDeep(
  value: unknown,
  rules: readonly MaskRule[],
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (typeof value === "string") {
    return maskValue(value, rules);
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_MASK_DEPTH) {
      return "[depth]";
    }
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    const masked = value.map((item) => maskDeep(item, rules, seen, depth + 1));
    seen.delete(value);
    return masked;
  }

  if (value !== null && typeof value === "object") {
    if (isPlainObject(value) && isRecord(value)) {
      if (depth >= MAX_MASK_DEPTH) {
        return "[depth]";
      }
      if (seen.has(value)) {
        return "[circular]";
      }
      seen.add(value);
      const masked: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        masked[key] = maskDeep(item, rules, seen, depth + 1);
      }
      seen.delete(value);
      return masked;
    }
    if (value instanceof Date) {
      return maskValue(value.toISOString(), rules);
    }
    if (value instanceof Error) {
      return maskValue(value.message, rules);
    }
    // Map / Set / クラスインスタンスなど、その他の非プレーンオブジェクト。
    return maskValue(String(value), rules);
  }

  return value;
}

/** `fields` を（ネストを含めて）再帰的にマスクした新しいオブジェクトを作る。 */
function maskFields(
  fields: Record<string, unknown>,
  rules: readonly MaskRule[],
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    masked[key] = maskDeep(value, rules, new WeakSet<object>(), 0);
  }
  return masked;
}

/**
 * ロガーを生成する。1 行 JSON（`{ level, at, message, ...fields }`）を `sink` に渡す。
 * `message` と `fields`（ネストしたオブジェクト・配列を含む）の文字列値に含まれる
 * `roots` / `homeDir` 配下のパスをマスクしてから出力する。
 */
export function createLogger(opts: CreateLoggerOptions): Logger {
  const sink = opts.sink ?? ((line: string) => process.stdout.write(line));
  const rules = buildMaskRules(opts.roots, opts.homeDir);

  function write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    try {
      // 予約キー（level / at / message）は fields より後に置き、fields 側に同名キーが
      // あっても上書きされないようにする。
      const record: Record<string, unknown> = {
        ...(fields ? maskFields(fields, rules) : {}),
        level,
        at: new Date().toISOString(),
        message: maskValue(message, rules),
      };
      sink(`${JSON.stringify(record)}\n`);
    } catch {
      // マスク処理・JSON化のいずれで失敗しても、ログ出力自体を止めないよう固定の 1 行を出す。
      // sink 自体が失敗し続ける場合でも呼び出し側に例外を伝播させない（ログは業務処理を止めない）。
      try {
        sink('{"level":"error","message":"ログの整形に失敗しました"}\n');
      } catch {
        // 出力先が壊れている。これ以上できることは無い
      }
    }
  }

  return {
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}
