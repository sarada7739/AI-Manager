// Codex CLI の rollout（sessions/YYYY/MM/DD/rollout-*.jsonl）を列挙する。
// 固定 4 階層のみを走査する（再帰で全体を辿る実装にしない）。ファイルは開かず stat のみ行う。
// シンボリックリンクは dirent.isDirectory() / isFile() が false になるため自然に辿らない。

import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isExcludedFile, isUnderRoot } from "../fs/safe-path.js";

/** rollout ファイル 1 件のメタ情報。 */
export interface CodexSessionFile {
  /** ファイル名末尾の threadId（小文字化した UUID）。 */
  id: string;
  /** 絶対パス。ログに出さない。 */
  jsonlPath: string;
  /** ファイルサイズ（バイト）。 */
  sizeBytes: number;
  /** mtime（epoch ms）。 */
  mtime: number;
}

/** locateCodexSessions の戻り値。 */
export interface LocateCodexResult {
  sessions: CodexSessionFile[];
  warnings: string[];
}

/**
 * rollout ファイル名のパターン。`rollout-<任意>-<uuid>.jsonl`。
 * キャプチャグループ 1 が threadId（UUID）。
 */
export const CODEX_ROLLOUT_FILE_PATTERN =
  /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** `sessions/` 直下の年ディレクトリ名パターン（`YYYY`）。 */
const YEAR_PATTERN = /^\d{4}$/;
/** 月・日ディレクトリ名パターン（`MM` / `DD`）。 */
const MONTH_OR_DAY_PATTERN = /^\d{2}$/;

/**
 * `root`（`.codex` 相当のディレクトリ）配下の `sessions/YYYY/MM/DD/rollout-*.jsonl` を列挙する。
 *
 * - `root` が絶対パスでなければ空配列 + 警告を返す。
 * - 走査は固定 4 階層（`sessions` → `YYYY` → `MM` → `DD` → ファイル）のみ。パターンに合わない
 *   ディレクトリ名には入らない（`thread-writer-locks/` など他のディレクトリには触れない）。
 * - `node:fs/promises` の `readdir({ withFileTypes: true })` と `stat` のみを使う。ファイルは開かない。
 * - `sessions/` が無い（ENOENT）場合は空配列 + 警告を返す。
 * - それ以外の読み取り失敗（ディレクトリ・ファイルいずれも）は例外を投げず、件数を集計して
 *   最後に 1 件の警告としてまとめる。警告に実パス・ディレクトリ名は含めない。
 * - 除外対象ファイル（`isExcludedFile`）と root 配下でないパス（`isUnderRoot`）は無視する。
 * - 結果は `jsonlPath` の小文字比較で昇順に安定ソートする。
 */
export async function locateCodexSessions(root: string): Promise<LocateCodexResult> {
  if (!path.isAbsolute(root)) {
    return {
      sessions: [],
      warnings: [
        "ルートディレクトリの指定が不正です（絶対パスではありません）。設定を確認してください。",
      ],
    };
  }

  let failureCount = 0;
  const sessionsDir = path.join(root, "sessions");

  let yearEntries: Dirent[] = [];
  try {
    yearEntries = await readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      return {
        sessions: [],
        warnings: [
          "sessions ディレクトリが見つかりません。Codex CLI を一度実行するとセッションログが作成されます。",
        ],
      };
    }
    failureCount += 1;
    yearEntries = [];
  }

  const sessions: CodexSessionFile[] = [];

  for (const yearEntry of yearEntries) {
    if (!yearEntry.isDirectory() || !YEAR_PATTERN.test(yearEntry.name)) {
      continue;
    }
    const yearDir = path.join(sessionsDir, yearEntry.name);

    let monthEntries: Dirent[];
    try {
      monthEntries = await readdir(yearDir, { withFileTypes: true });
    } catch {
      failureCount += 1;
      continue;
    }

    for (const monthEntry of monthEntries) {
      if (!monthEntry.isDirectory() || !MONTH_OR_DAY_PATTERN.test(monthEntry.name)) {
        continue;
      }
      const monthDir = path.join(yearDir, monthEntry.name);

      let dayEntries: Dirent[];
      try {
        dayEntries = await readdir(monthDir, { withFileTypes: true });
      } catch {
        failureCount += 1;
        continue;
      }

      for (const dayEntry of dayEntries) {
        if (!dayEntry.isDirectory() || !MONTH_OR_DAY_PATTERN.test(dayEntry.name)) {
          continue;
        }
        const dayDir = path.join(monthDir, dayEntry.name);

        let fileEntries: Dirent[];
        try {
          fileEntries = await readdir(dayDir, { withFileTypes: true });
        } catch {
          failureCount += 1;
          continue;
        }

        for (const fileEntry of fileEntries) {
          if (!fileEntry.isFile()) {
            continue;
          }
          const match = CODEX_ROLLOUT_FILE_PATTERN.exec(fileEntry.name);
          if (match === null) {
            continue;
          }
          const threadId = match[1];
          if (threadId === undefined) {
            continue;
          }
          // 保険的チェック。UUID 判定を通った rollout ファイル名は現行の EXCLUDED_FILE_PATTERNS には
          // 一致しないが、将来パターンが拡張されても除外ファイルを開かない防御として残す。
          if (isExcludedFile(fileEntry.name)) {
            continue;
          }
          const jsonlPath = path.join(dayDir, fileEntry.name);
          // 保険的チェック。固定 4 階層の組み立てからは常に root 配下になるが、パス組み立てが
          // 変わっても root 外を返さない防御として残す。
          if (!isUnderRoot(jsonlPath, [root])) {
            continue;
          }

          try {
            const fileStat = await stat(jsonlPath);
            if (!fileStat.isFile()) {
              continue;
            }
            sessions.push({
              id: threadId.toLowerCase(),
              jsonlPath,
              sizeBytes: fileStat.size,
              mtime: fileStat.mtimeMs,
            });
          } catch {
            failureCount += 1;
          }
        }
      }
    }
  }

  sessions.sort((a, b) => {
    const left = a.jsonlPath.toLowerCase();
    const right = b.jsonlPath.toLowerCase();
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  });

  const warnings: string[] = [];
  if (failureCount > 0) {
    warnings.push(
      `セッションディレクトリのうち ${failureCount} 件を読み取れませんでした。権限を確認してください。`,
    );
  }

  return { sessions, warnings };
}

/** Node の fs エラーが ENOENT かどうかを判定する。 */
function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
