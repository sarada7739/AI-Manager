// Claude Code のセッションログの所在を stat / readdir だけで列挙する。
// 本文（JSONL の中身）は一切読まない。ARCHITECTURE.md §2 sources/claude/locator.ts に対応。
// 走査するのは `projects/` → `projects/<dir>/`（ディレクトリのみ）→ その直下のファイル、の 3 階層のみ。
// `<sessionId>/subagents/` は件数を数えるためだけに readdir する。それ以外のサブディレクトリ
// （`memory/`, `tool-results/`, `<sessionId>/` の他の中身）には入らない。

import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { asString } from "../../../shared/guards.js";
import { isExcludedFile, isUnderRoot } from "../fs/safe-path.js";

/**
 * Claude セッション ID（UUID）の形式。大文字小文字は無視する。
 * T-009（parser）・T-013（索引）でも再利用する。
 */
export const CLAUDE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** サブエージェントの JSONL ファイル名の形式。`agent-<id>.meta.json` は一致しない。 */
const SUBAGENT_JSONL_PATTERN = /^agent-.+\.jsonl$/i;

/** 1 件の Claude セッションログの所在と stat 情報。本文は含まない。 */
export interface ClaudeSessionFile {
  /** 小文字化した UUID（ファイル名の拡張子を除いた部分） */
  id: string;
  /** JSONL の絶対パス。ログに出さない（log.ts の fields 経由でのみ渡す） */
  jsonlPath: string;
  /** `projects/<dir>` の絶対パス */
  projectDir: string;
  sizeBytes: number;
  /** mtime（epoch ms） */
  mtime: number;
  /** `projects/<dir>/<sessionId>/custom-title.json` が通常ファイルとして存在するか */
  hasCustomTitleFile: boolean;
  /** `projects/<dir>/<sessionId>.desktop-released.json` が存在するか */
  released: boolean;
  /** `projects/<dir>/<sessionId>/subagents/agent-*.jsonl` の件数（`.meta.json` は数えない） */
  subagentCount: number;
}

/** `locateClaudeSessions` の戻り値。 */
export interface LocateClaudeResult {
  sessions: ClaudeSessionFile[];
  /** 利用者向けの警告文言。実パス・ディレクトリ名を含めない（固定文言 + 件数のみ） */
  warnings: string[];
}

/** Node の fs エラーから `.code`（例: "ENOENT"）を取り出す。無ければ undefined。 */
function errorCode(error: unknown): string | undefined {
  return asString(error, "code");
}

/** 指定パスが通常ファイルとして存在するかどうかを判定する（シンボリックリンクは辿らない）。 */
async function statIsRegularFile(targetPath: string): Promise<boolean> {
  try {
    const stat = await lstat(targetPath);
    return stat.isFile();
  } catch {
    // ENOENT はもちろん、その他の stat 失敗も「無い」扱いにする（警告は出さない）
    return false;
  }
}

/**
 * `subagentsDir` 配下の `agent-*.jsonl`（`.meta.json` は除く）の件数を数える。
 * ディレクトリが無い・読み取れない場合は 0 を返す（警告は出さない）。
 */
async function countSubagentFiles(subagentsDir: string): Promise<number> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(subagentsDir);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) {
    // シンボリックリンクを含む「ディレクトリでない」ものは辿らない
    return 0;
  }

  let entries: Dirent[];
  try {
    entries = await readdir(subagentsDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  return entries.filter((entry) => entry.isFile() && SUBAGENT_JSONL_PATTERN.test(entry.name))
    .length;
}

/**
 * `projectDir` 直下から 1 件の Claude セッション JSONL を検証・stat して組み立てる。
 * UUID 形式でない・除外対象・root 配下でない・stat 失敗のいずれかに該当すれば undefined を返す。
 */
async function buildSessionFile(
  root: string,
  projectDir: string,
  fileEntry: Dirent,
): Promise<ClaudeSessionFile | undefined> {
  if (!fileEntry.isFile()) {
    // ディレクトリ（<sessionId>/ 本体含む）・シンボリックリンクはここでは対象外
    return undefined;
  }
  if (!fileEntry.name.toLowerCase().endsWith(".jsonl")) {
    return undefined;
  }

  const rawId = fileEntry.name.slice(0, -".jsonl".length);
  if (!CLAUDE_SESSION_ID_PATTERN.test(rawId)) {
    return undefined;
  }
  // 保険的チェック。UUID 判定を通った `<uuid>.jsonl` は現行の EXCLUDED_FILE_PATTERNS には
  // 一致しないが、将来パターンが拡張されても除外ファイルを開かない防御として残す。
  if (isExcludedFile(fileEntry.name)) {
    return undefined;
  }

  const jsonlPath = path.join(projectDir, fileEntry.name);
  if (!isUnderRoot(jsonlPath, [root])) {
    return undefined;
  }

  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(jsonlPath);
  } catch {
    // 走査中にファイルが消えた等。個別の警告は出さず単に対象から外す
    return undefined;
  }
  if (!stat.isFile()) {
    return undefined;
  }

  const [hasCustomTitleFile, released, subagentCount] = await Promise.all([
    statIsRegularFile(path.join(projectDir, rawId, "custom-title.json")),
    statIsRegularFile(path.join(projectDir, `${rawId}.desktop-released.json`)),
    countSubagentFiles(path.join(projectDir, rawId, "subagents")),
  ]);

  return {
    id: rawId.toLowerCase(),
    jsonlPath,
    projectDir,
    sizeBytes: stat.size,
    mtime: stat.mtimeMs,
    hasCustomTitleFile,
    released,
    subagentCount,
  };
}

/**
 * `root`（`config.roots` の 1 要素。`.claude` に相当するディレクトリ）配下の
 * `projects/<dir>/<sessionId>.jsonl` を列挙する。stat / readdir のみを使い、ファイルの中身は
 * 一切読まない。例外は投げない（読み取り失敗は空配列 + 警告として返す）。
 * 戻り値の `sessions` は `jsonlPath` の小文字比較で昇順に安定ソートする。
 */
export async function locateClaudeSessions(root: string): Promise<LocateClaudeResult> {
  if (!path.isAbsolute(root)) {
    return {
      sessions: [],
      warnings: [
        "ルートディレクトリの指定が不正です（絶対パスではありません）。設定を確認してください。",
      ],
    };
  }

  const projectsDir = path.join(root, "projects");

  let projectEntries: Dirent[];
  try {
    projectEntries = await readdir(projectsDir, { withFileTypes: true });
  } catch (error) {
    const message =
      errorCode(error) === "ENOENT"
        ? "projects ディレクトリが見つかりません。Claude Code を一度起動するとセッションログが作成されます。"
        : "projects ディレクトリを読み取れませんでした。権限を確認してください。";
    return { sessions: [], warnings: [message] };
  }

  const sessions: ClaudeSessionFile[] = [];
  let failedDirCount = 0;

  for (const entry of projectEntries) {
    if (!entry.isDirectory()) {
      // projects/ 直下のファイル・シンボリックリンクは対象外（<dir> はディレクトリのみ）
      continue;
    }
    const projectDir = path.join(projectsDir, entry.name);

    let fileEntries: Dirent[];
    try {
      fileEntries = await readdir(projectDir, { withFileTypes: true });
    } catch {
      failedDirCount += 1;
      continue;
    }

    for (const fileEntry of fileEntries) {
      const session = await buildSessionFile(root, projectDir, fileEntry);
      if (session !== undefined) {
        sessions.push(session);
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

  const warnings: string[] =
    failedDirCount > 0
      ? [
          `プロジェクトディレクトリのうち ${failedDirCount} 件を読み取れませんでした。権限を確認してください。`,
        ]
      : [];

  return { sessions, warnings };
}
