// パス短縮・バイト数などの表示整形を行う純粋関数。
// shared のため node:*（path モジュール含む）/ react への依存禁止。文字列処理のみで実装する。
// node:* を使わないため、パスの比較・置換は文字列操作で行う。

/** 文字列中の `\` をすべて `/` に統一する。 */
function toSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * パスを短縮する。ホーム配下であれば先頭を `~` に置換し、区切り文字を `/` に統一する。
 * ホームディレクトリとの一致判定は大文字小文字を無視する。
 * ホーム直下（`path === homeDir`）は `~` を返す。
 * `homeDir` が空文字なら、区切り文字の統一のみ行う（ダミー例: `C:\Users\dummy` → `C:/Users/dummy`）。
 * 比較の前に `path` と `homeDir` それぞれの末尾の区切り文字（`/` または `\`）を 1 つ落としてから判定する
 * （例: 末尾に `\` が付いていても付いていなくても同じ結果になる）。
 *
 * 表示専用の関数であり、パス封じ込め（サンドボックス外アクセス防止などの安全性判定）には使わないこと。
 * `..` などの相対参照は正規化しない。
 */
export function shortenPath(path: string, homeDir: string): string {
  const normalizedPath = toSlash(path);

  if (homeDir === "") {
    return normalizedPath;
  }

  const normalizedHome = toSlash(homeDir);
  // 比較用に末尾の区切り文字を落とす（表示に使う normalizedPath 自体は変更しない）。
  const trimmedPath = normalizedPath.endsWith("/") ? normalizedPath.slice(0, -1) : normalizedPath;
  const trimmedHome = normalizedHome.endsWith("/") ? normalizedHome.slice(0, -1) : normalizedHome;

  const lowerPath = trimmedPath.toLowerCase();
  const lowerHome = trimmedHome.toLowerCase();

  if (lowerPath === lowerHome) {
    return "~";
  }

  // ホーム配下かどうかを、区切り文字を挟んだ前方一致で判定する。
  const homePrefix = `${lowerHome}/`;
  if (lowerPath.startsWith(homePrefix)) {
    const rest = trimmedPath.slice(homePrefix.length);
    return `~/${rest}`;
  }

  return normalizedPath;
}

/**
 * 文字列の先頭を省略し、末尾を残す形で `max` 文字に収める（フォルダ表示用）。
 * `max <= 1` の場合は常に「…」を返す。
 * 省略が不要な場合（`text.length <= max`）はそのまま返す。
 *
 * UTF-16 コード単位で切る。サロゲートペア（絵文字等）を含む文字列には使わないこと
 * （ペアの途中で切れて文字化けする可能性がある）。
 */
export function truncateStart(text: string, max: number): string {
  if (max <= 1) {
    return "…";
  }
  if (text.length <= max) {
    return text;
  }
  const tail = text.slice(text.length - (max - 1));
  return `…${tail}`;
}

/**
 * バイト数を人間が読みやすい単位に整形する（1024 基準）。
 * B は整数、KB 以上は小数第 1 位まで表示する。
 * 負数・非有限（NaN / Infinity）は「—」を返す。
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "—";
  }
  if (n < 1024) {
    return `${Math.round(n)} B`;
  }

  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = n / 1024;
  let unitIndex = 0;
  // 丸め（小数第 1 位）後の表示値が 1024 以上になる場合は、次の単位へ繰り上げる。
  // 生の value だけで判定すると、丸めで "1024.0 KB" のような桁あふれが起きるため。
  while (unitIndex < units.length - 1 && Number(value.toFixed(1)) >= 1024) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * ブランチ名を正規化する。
 * `null` / `undefined` / 空文字 / `"HEAD"` は「ブランチなし」とみなし `null` を返す。
 * それ以外はそのまま返す。
 */
export function normalizeBranch(branch: string | null | undefined): string | null {
  if (branch === null || branch === undefined || branch === "" || branch === "HEAD") {
    return null;
  }
  return branch;
}
