// パストラバーサル対策。読み取り対象を config.roots 配下に限定するための検証。
// ARCHITECTURE.md §7「読み取り対象は config.roots 配下のみ」を実装する。
// node:path のみに依存する（node:fs は使わない。stat せずパス文字列だけで判定する）。
//
// 【roots の信頼モデル】
// roots は config.json（ローカルファイル）から読み込む「信頼済みのローカル設定」であり、
// 任意のパス（シンボリックリンクの先や `..` を含むパスなど）を root として許容してよい。
// ネットワーク経由の入力や API リクエストの値から roots を組み立てては絶対にならない
// （roots 自体が信頼境界であり、isUnderRoot はその内側での「候補パスが roots 配下かどうか」
// だけを検証するものであって、roots 自体の安全性は保証しない）。

import path from "node:path";

/**
 * 除外すべきファイル名パターン一覧。
 * 認証情報・DB ファイル・ローカル設定など、読み取ってはならないファイルを表す。
 * `*` は「任意の 0 文字以上」を意味する単純なワイルドカードとして扱う。
 * `settings.json` / `settings.local.json` は `settings*.json` に包含されるため個別には持たない。
 */
export const EXCLUDED_FILE_PATTERNS: readonly string[] = [
  ".credentials.json",
  "auth.json",
  "*.key",
  // SQLite 本体・WAL・SHM・journal・バックアップをまとめて除外（ARCHITECTURE.md §7 の `*.sqlite*`）
  "*.sqlite*",
  "settings*.json",
];

/**
 * `candidate` が `roots` のいずれかの配下（root 自身を含む）にあるかどうかを判定する。
 *
 * - `candidate` が絶対パスでない場合は常に false（cwd に依存させない。呼び出し側が
 *   相対パスを渡すこと自体を誤りとして扱う）。
 * - `path.resolve` で正規化してから比較する（`..` を含む相対パスもここで解決される）。
 * - 大文字小文字は無視する（NTFS 前提。ADR-0002）。
 * - 「root そのもの」または「root + path.sep で始まる」場合のみ true。
 *   root の名前に前方一致するだけの別ディレクトリ（例: root が `C:\a\.claude` のとき `C:\a\.claude2`）は false。
 * - 別ドライブのパスは false（`path.resolve` 後の文字列比較で自然に false になる）。
 */
export function isUnderRoot(candidate: string, roots: readonly string[]): boolean {
  if (!path.isAbsolute(candidate)) {
    return false;
  }

  const resolvedCandidate = path.resolve(candidate).toLowerCase();

  return roots.some((root) => {
    const resolvedRoot = path.resolve(root).toLowerCase();
    if (resolvedCandidate === resolvedRoot) {
      return true;
    }
    const rootPrefix = resolvedRoot.endsWith(path.sep)
      ? resolvedRoot
      : `${resolvedRoot}${path.sep}`;
    return resolvedCandidate.startsWith(rootPrefix);
  });
}

/**
 * ワイルドカード（`*`）を含む単純パターンと大文字小文字を無視して照合する。
 * `*` 以外の正規表現特殊文字はエスケープしてから比較する。
 */
function matchesPattern(fileName: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  return regex.test(fileName);
}

/**
 * 照合前にファイル名を正規化する。
 * - `path.basename()` でディレクトリ部分を取り除く（フルパスが渡されても最後の要素だけを見る）。
 * - 末尾のドット・空白を取り除く（Windows は `auth.json.` や `auth.json ` を開こうとすると
 *   末尾のドット・空白を無視して `auth.json` を開くため、これを素通りさせない）。
 * - `:` 以降（代替データストリーム、例: `auth.json:hidden`）を切り落とす。
 */
function normalizeFileNameForMatch(fileName: string): string {
  const base = path.basename(fileName);
  const trimmed = base.replace(/[. ]+$/, "");
  const streamSeparatorIndex = trimmed.indexOf(":");
  return streamSeparatorIndex === -1 ? trimmed : trimmed.slice(0, streamSeparatorIndex);
}

/**
 * ファイル名が読み取り除外対象かどうかを判定する（大文字小文字無視）。
 * `fileName` は単体のファイル名・フルパスのどちらでも渡してよい（内部で正規化する）。
 * 末尾のドット・空白の除去、代替データストリーム（`name:stream`）の切り落としも行うため、
 * これらを使って除外パターンを回避することはできない。
 */
export function isExcludedFile(fileName: string): boolean {
  const normalized = normalizeFileNameForMatch(fileName);
  return EXCLUDED_FILE_PATTERNS.some((pattern) => matchesPattern(normalized, pattern));
}
