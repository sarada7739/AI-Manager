// セッション一覧のグルーピング・絞り込み・並べ替えを行う純粋関数。
// F-3（グルーピング）/ F-4（絞り込み・並べ替え）のロジックを UI から切り離したもの。
// ARCHITECTURE.md §6「派生データはここの純粋関数で useMemo 計算する」に対応する。
// node:* / react への依存禁止。

import type { Account, SessionState, SessionSummary, ToolKind } from "./types.js";

/** グルーピングの軸。 */
export type GroupBy = "account" | "folder" | "state" | "tool";

/** 一覧の絞り込み条件。 */
export interface SessionFilters {
  /** ツール種別。"all" は絞り込みなし。 */
  tool: ToolKind | "all";
  /** アカウント識別キー。null は絞り込みなし。 */
  accountKey: string | null;
  /** 作業ディレクトリの絞り込み。区切り境界を見て、cwd が folder と一致するかそのサブフォルダのときだけ一致する。null は絞り込みなし。 */
  folder: string | null;
  /** 直近何日以内の更新に絞るか。null は絞り込みなし。 */
  sinceDays: number | null;
  /** true なら稼働中（running / active）のみに絞る。 */
  runningOnly: boolean;
  /** キーワード検索。空文字は絞り込みなし。 */
  query: string;
}

/** リスト表示の並べ替え条件。 */
export interface SortSpec {
  /** 並べ替えキー。 */
  key: "updatedAt" | "title" | "logSizeBytes" | "state";
  /** 昇順・降順。 */
  dir: "asc" | "desc";
}

/** グルーピング後の 1 列分のデータ。 */
export interface SessionGroup {
  /** 列を一意に識別するキー。 */
  key: string;
  /** 列見出しに表示するラベル。 */
  label: string;
  /** 列全体としての稼働状態（内訳は下記の判定順を参照）。 */
  state: SessionState;
  /** 列に属するセッション（updatedAt 降順）。 */
  sessions: SessionSummary[];
  /** 列内の running 件数。 */
  runningCount: number;
}

/** 絞り込み条件の既定値。 */
export const DEFAULT_FILTERS: SessionFilters = {
  tool: "all",
  accountKey: null,
  folder: null,
  sinceDays: 14,
  runningOnly: false,
  query: "",
};

/** 並べ替え条件の既定値。 */
export const DEFAULT_SORT: SortSpec = {
  key: "updatedAt",
  dir: "desc",
};

/** 1 日をミリ秒に換算した値。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 稼働状態の固定順（state 軸のグルーピング・並べ替え共通）。 */
const STATE_ORDER: SessionState[] = ["running", "active", "idle", "error"];

/** state 軸の列ラベル。 */
const STATE_LABELS: Record<SessionState, string> = {
  running: "稼働中",
  active: "作業中",
  idle: "停止",
  error: "エラー",
};

/** state の並べ替え時の優先順位（昇順で running が先頭）。 */
const STATE_RANK: Record<SessionState, number> = {
  running: 0,
  active: 1,
  idle: 2,
  error: 3,
};

/** ツール種別の固定順（tool 軸のグルーピング）。 */
const TOOL_ORDER: ToolKind[] = ["claude", "codex"];

/** tool 軸の列ラベル。 */
const TOOL_LABELS: Record<ToolKind, string> = {
  claude: "Claude",
  codex: "Codex",
};

/**
 * パス比較用に区切り文字を `/` に統一し、小文字化し、末尾の区切り文字を除去する。表示には使わない。
 * folder 軸の絞り込み・グルーピング・選択肢一覧すべてで同じキーを使うための共通正規化関数。
 * 末尾の区切り文字は 1 つだけ落とす（例: `a/b//` → `a/b/` のまま残る）。区切り文字が連続する入力は
 * 別キー扱いになるが、Windows の cwd ではこの形は実質発生しない。
 * `\` → `/` の統一処理は src/shared/format.ts の（非公開の）toSlash と重複している。
 * format.ts はこのタスクの変更範囲外のため export 化はせず、重複はそのまま残している。
 */
function normalizeForCompare(path: string): string {
  const unified = path.replace(/\\/g, "/").toLowerCase();
  return unified.length > 1 && unified.endsWith("/") ? unified.slice(0, -1) : unified;
}

/** キーワード 1 語が、検索対象の 4 フィールドのいずれかに部分一致するか判定する。 */
function matchesWord(session: SessionSummary, lowerWord: string): boolean {
  if (session.title.toLowerCase().includes(lowerWord)) {
    return true;
  }
  if (session.lastMessage.toLowerCase().includes(lowerWord)) {
    return true;
  }
  if (session.cwd.toLowerCase().includes(lowerWord)) {
    return true;
  }
  if (session.branch?.toLowerCase().includes(lowerWord)) {
    return true;
  }
  return false;
}

/** 空白区切りの複数語すべてが（AND で）一致するか判定する。words は呼び出し側で小文字化済みであること。 */
function matchesAllWords(session: SessionSummary, lowerWords: string[]): boolean {
  return lowerWords.every((word) => matchesWord(session, word));
}

/**
 * 絞り込み条件を AND で適用する。
 * 各条件は「対象外を示す値（"all" / null / false / 空文字）」であればスキップする。
 */
export function applyFilters(
  sessions: SessionSummary[],
  filters: SessionFilters,
  nowMs: number,
): SessionSummary[] {
  const trimmedQuery = filters.query.trim();
  // セッションごとに toLowerCase() し直さないよう、ここで一度だけ小文字化しておく。
  const queryWords =
    trimmedQuery.length > 0 ? trimmedQuery.split(/\s+/).map((word) => word.toLowerCase()) : [];
  const folderPrefix = filters.folder !== null ? normalizeForCompare(filters.folder) : null;
  const sinceThresholdMs = filters.sinceDays !== null ? nowMs - filters.sinceDays * DAY_MS : null;

  return sessions.filter((session) => {
    if (filters.tool !== "all" && session.tool !== filters.tool) {
      return false;
    }
    if (filters.accountKey !== null && session.accountKey !== filters.accountKey) {
      return false;
    }
    if (folderPrefix !== null) {
      const cwdKey = normalizeForCompare(session.cwd);
      const isSameFolder = cwdKey === folderPrefix;
      const isSubFolder = cwdKey.startsWith(`${folderPrefix}/`);
      if (!isSameFolder && !isSubFolder) {
        return false;
      }
    }
    if (sinceThresholdMs !== null) {
      const updatedAtMs = new Date(session.updatedAt).getTime();
      // updatedAt が不正な ISO 文字列だと Date.parse は NaN になり、NaN との比較は常に false になる
      // ため、不正な値は「期間外」として除外される（意図した挙動）。
      if (!(updatedAtMs >= sinceThresholdMs)) {
        return false;
      }
    }
    if (filters.runningOnly && session.state !== "running" && session.state !== "active") {
      return false;
    }
    if (queryWords.length > 0 && !matchesAllWords(session, queryWords)) {
      return false;
    }
    return true;
  });
}

/** updatedAt 降順で複製・整列する（入力配列は破壊しない）。 */
function sortByUpdatedAtDesc(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/**
 * グループ全体としての稼働状態を判定する。
 * running が 1 件以上 → running。次に active が 1 件以上 → active。
 * 0 件でなく全件が error → error。それ以外（idle が混ざる、または 0 件）は idle。
 */
function computeGroupState(sessions: SessionSummary[]): SessionState {
  if (sessions.some((session) => session.state === "running")) {
    return "running";
  }
  if (sessions.some((session) => session.state === "active")) {
    return "active";
  }
  if (sessions.length > 0 && sessions.every((session) => session.state === "error")) {
    return "error";
  }
  return "idle";
}

/** グループを組み立てる（updatedAt 降順・稼働状態・running 件数を計算する）。 */
function buildGroup(key: string, label: string, sessions: SessionSummary[]): SessionGroup {
  const sorted = sortByUpdatedAtDesc(sessions);
  return {
    key,
    label,
    state: computeGroupState(sorted),
    sessions: sorted,
    runningCount: sorted.filter((session) => session.state === "running").length,
  };
}

/** account 軸でグルーピングする。accounts の順に列を作り、未知の accountKey は末尾に追加する。 */
function groupByAccount(sessions: SessionSummary[], accounts: Account[]): SessionGroup[] {
  const sessionsByAccount = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const list = sessionsByAccount.get(session.accountKey);
    if (list) {
      list.push(session);
    } else {
      sessionsByAccount.set(session.accountKey, [session]);
    }
  }

  const knownKeys = new Set(accounts.map((account) => account.key));
  const groups = accounts.map((account) =>
    buildGroup(account.key, account.label, sessionsByAccount.get(account.key) ?? []),
  );

  // accounts に無い accountKey は、セッションに現れた順で末尾に追加する（ラベルは accountKey そのもの）。
  for (const session of sessions) {
    if (!knownKeys.has(session.accountKey)) {
      knownKeys.add(session.accountKey);
      groups.push(
        buildGroup(
          session.accountKey,
          session.accountKey,
          sessionsByAccount.get(session.accountKey) ?? [],
        ),
      );
    }
  }

  return groups;
}

/** folder 軸の集計バケット。 */
interface FolderBucket {
  /** 列に表示するラベル（最初に出現した表記のまま）。 */
  label: string;
  /** バケットに属するセッション。 */
  sessions: SessionSummary[];
}

/**
 * folder 軸でグルーピングする。
 * cwd は大文字小文字・区切り文字（`\` / `/`）を無視して同一視し、表示ラベルは最初に出現した表記を使う。
 * 列の順序は runningCount 降順 → キー（normalizeForCompare 済み・ロケール ja）昇順。
 * ラベルの生文字列（大文字小文字・区切り文字）は順序に影響しない。
 */
function groupByFolder(sessions: SessionSummary[]): SessionGroup[] {
  const buckets = new Map<string, FolderBucket>();
  for (const session of sessions) {
    const key = normalizeForCompare(session.cwd);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.sessions.push(session);
    } else {
      buckets.set(key, { label: session.cwd, sessions: [session] });
    }
  }

  const groups = Array.from(buckets.entries()).map(([key, bucket]) =>
    buildGroup(key, bucket.label, bucket.sessions),
  );

  groups.sort((a, b) => {
    if (a.runningCount !== b.runningCount) {
      return b.runningCount - a.runningCount;
    }
    // group.key は normalizeForCompare 済み（folder 軸のみ）なので、大文字小文字・区切り文字に
    // 依存しない順序になる。
    return a.key.localeCompare(b.key, "ja");
  });

  return groups;
}

/**
 * セッション一覧を指定した軸でグルーピングする。
 * - account: accounts の順に列を作る（0 件でも列は残す）。未知の accountKey は末尾。
 * - folder: cwd ごと（大文字小文字・区切り文字を無視して同一視）。runningCount 降順 → label 昇順。
 * - state: running → active → idle → error の固定順（0 件でも 4 列返す）。
 * - tool: claude → codex の固定順（0 件でも 2 列返す）。
 */
export function groupSessions(
  sessions: SessionSummary[],
  groupBy: GroupBy,
  accounts: Account[],
): SessionGroup[] {
  switch (groupBy) {
    case "account":
      return groupByAccount(sessions, accounts);
    case "folder":
      return groupByFolder(sessions);
    case "state":
      return STATE_ORDER.map((state) =>
        buildGroup(
          state,
          STATE_LABELS[state],
          sessions.filter((session) => session.state === state),
        ),
      );
    case "tool":
      return TOOL_ORDER.map((tool) =>
        buildGroup(
          tool,
          TOOL_LABELS[tool],
          sessions.filter((session) => session.tool === tool),
        ),
      );
  }
}

/** 並べ替えキー 1 つ分の比較関数（昇順基準）。 */
function compareByKey(a: SessionSummary, b: SessionSummary, key: SortSpec["key"]): number {
  switch (key) {
    case "updatedAt":
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    case "title":
      // ロケール依存の曖昧な比較を避けるため、日本語ロケールを明示する。
      return a.title.localeCompare(b.title, "ja");
    case "logSizeBytes":
      return a.logSizeBytes - b.logSizeBytes;
    case "state":
      return STATE_RANK[a.state] - STATE_RANK[b.state];
  }
}

/** 指定した条件でセッション一覧を安定ソートする（入力配列は破壊しない）。 */
export function sortSessions(sessions: SessionSummary[], sort: SortSpec): SessionSummary[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...sessions].sort((a, b) => factor * compareByKey(a, b, sort.key));
}

/**
 * cwd の選択肢一覧を作る。
 * 大文字小文字・区切り文字を無視して重複排除し、表示は最初に出現した表記を使う。
 * count 降順 → キー（normalizeForCompare 済み・ロケール ja）昇順。
 * 表示用の folder（生文字列）は順序に影響しない。
 */
export function folderOptions(
  sessions: SessionSummary[],
): Array<{ folder: string; count: number }> {
  const buckets = new Map<string, { folder: string; count: number }>();
  for (const session of sessions) {
    const key = normalizeForCompare(session.cwd);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
    } else {
      buckets.set(key, { folder: session.cwd, count: 1 });
    }
  }

  return Array.from(buckets.entries())
    .sort(([keyA, a], [keyB, b]) => {
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      return keyA.localeCompare(keyB, "ja");
    })
    .map(([, bucket]) => bucket);
}
