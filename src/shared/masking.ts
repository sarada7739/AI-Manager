// ログ本文を API に載せる前に、秘密情報らしき文字列を伏せ字にするユーティリティ。
// 実際の鍵・トークンをそのまま外部へ送らないための最終防衛ライン（CLAUDE.md §4, §9 参照）。
// shared なので node:* / react への依存禁止。
// 正規表現はグローバルフラグの lastIndex 状態に依存しないよう、使用のたびに
// SECRET_PATTERNS の source 文字列から new RegExp() で生成する。

/** 1 件の秘密情報検出パターン。 */
export interface SecretPattern {
  /** パターンを識別するための名前（デバッグ・拡張時の目印）。 */
  name: string;
  /** 検出用の正規表現ソース文字列（フラグは付けずに保持し、使用時に付与する）。 */
  source: string;
  /**
   * true の場合、マッチ全体ではなくキャプチャグループ 1（マッチ末尾に位置するもの）
   * だけを伏せ字にする。"Bearer " のような前置文字列を残したいパターンで使う。
   *
   * 注意: この仕組みは「グループ 1 がマッチ文字列の末尾に位置する」ことに依存している
   * （伏せ字化しない前置部分 = match の先頭から (match.length - group1.length) 文字、
   * という計算をしているため）。新しくこのオプションを使うパターンを追加する場合は、
   * キャプチャグループが必ずマッチ末尾になるよう正規表現を書くこと。
   */
  maskGroup1?: boolean;
  /**
   * 正規表現に付与するフラグ文字列。省略時は "g"。
   * 大文字小文字を区別したくないパターンでは "gi" を指定する。
   */
  flags?: string;
  /**
   * 伏せ字化する対象（maskGroup1 が true ならグループ 1、それ以外はマッチ全体）の
   * 先頭何文字をそのまま残すかを指定する。省略時は 4（従来通り「先頭 4 文字 + ••••」）。
   * トークンを一切見せたくない場合（Bearer トークンなど）は 0 を指定する。
   */
  keepPrefix?: number;
}

/**
 * 検出対象のパターン一覧。追加する場合はここに 1 件足すだけでよい。
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  // Anthropic の API キー（sk-ant- から始まる英数字・ハイフン・アンダースコア列）
  { name: "anthropic-api-key", source: "sk-ant-[A-Za-z0-9_-]+" },
  // 汎用の sk- 系 API キー（sk- に続いて英数字・ハイフン・アンダースコアが 20 文字以上）
  // ※ sk-ant- 形式は否定先読みで除外し、配列内での並び順に依存しないようにする
  { name: "generic-sk-key", source: "sk-(?!ant-)[A-Za-z0-9_-]{20,}" },
  // GitHub の各種トークン（personal access token / oauth / user-to-server 等、20 文字以上）
  { name: "github-token", source: "(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}" },
  // GitHub の細粒度 personal access token
  { name: "github-pat", source: "github_pat_[A-Za-z0-9_]+" },
  // AWS のアクセスキー ID / 一時アクセスキー ID（AKIA・ASIA + 大文字英数字 16 文字以上）
  { name: "aws-access-key-id", source: "(?:AKIA|ASIA)[A-Z0-9]{16,}" },
  // Slack のボートークン / ユーザートークン
  { name: "slack-token", source: "xox[bp]-[A-Za-z0-9-]+" },
  // "Bearer " に続く認証トークン（大文字小文字を区別しない。前置文字列は残すが
  // トークン本体は 1 文字も見せずに全体を伏せ字にする）
  {
    name: "bearer-token",
    source: "Bearer ([A-Za-z0-9._~+/=-]{16,})",
    maskGroup1: true,
    flags: "gi",
    keepPrefix: 0,
  },
] as const;

/**
 * メールアドレス（local@domain.tld 形式）を検出する正規表現ソース。
 * 各パートに文字数上限を設け、多項式的なバックトラッキング（ReDoS）を避ける。
 */
const EMAIL_PATTERN_SOURCE =
  "[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\\.[A-Za-z0-9-]{1,63}){0,10}\\.[A-Za-z]{2,24}";

/** マッチした文字列を「先頭 keepPrefix 文字 + ••••」に変換する（keepPrefix が 0 なら全体を伏せる）。 */
function toMasked(target: string, keepPrefix: number): string {
  return keepPrefix > 0 ? `${target.slice(0, keepPrefix)}••••` : "••••";
}

/**
 * テキスト中の秘密情報らしき文字列・メールアドレスを伏せ字に置換し、
 * 置換した件数と合わせて返す。
 */
export function maskSecretsWithCount(text: string): { text: string; count: number } {
  let masked = text;
  let count = 0;

  for (const pattern of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags ?? "g");
    const keepPrefix = pattern.keepPrefix ?? 4;
    masked = masked.replace(regex, (match: string, group1?: string) => {
      count += 1;
      const target = pattern.maskGroup1 && typeof group1 === "string" ? group1 : match;
      // group1 は常にマッチ末尾に位置する前提（SecretPattern.maskGroup1 のコメント参照）で、
      // その手前をそのまま前置文字列として残す
      const prefix = match.slice(0, match.length - target.length);
      return `${prefix}${toMasked(target, keepPrefix)}`;
    });
  }

  const emailRegex = new RegExp(EMAIL_PATTERN_SOURCE, "g");
  masked = masked.replace(emailRegex, () => {
    count += 1;
    return "***@***";
  });

  return { text: masked, count };
}

/** テキスト中の秘密情報らしき文字列・メールアドレスを伏せ字に置換して返す。 */
export function maskSecrets(text: string): string {
  return maskSecretsWithCount(text).text;
}
