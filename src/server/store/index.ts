// セッション索引（SessionIndex）。sources（locator / parser / running / process）の結果を
// SessionSummary[] / Account[] に組み立てるインメモリ索引。routes（T-013）はこの索引だけを見る
// （ARCHITECTURE.md §2.1「server/routes → sources は禁止」）。
// node:path は使ってよいが node:fs は import しない（custom-title.json のパス組み立てのみ
// build-summary.ts に許可されている。詳細はそちらのコメント参照）。

import path from "node:path";
import type { Account, SessionSummary, ToolKind } from "../../shared/types.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../log.js";
import type { ClaudeSessionFile, LocateClaudeResult } from "../sources/claude/locator.js";
import { locateClaudeSessions } from "../sources/claude/locator.js";
import type { ReadRunningMetaResult, RunningMeta } from "../sources/claude/running.js";
import { matchRunning, readRunningMeta } from "../sources/claude/running.js";
import type { CodexSessionFile, LocateCodexResult } from "../sources/codex/locator.js";
import { locateCodexSessions } from "../sources/codex/locator.js";
import { readHeadLines } from "../sources/fs/head.js";
import { readTailLines } from "../sources/fs/tail.js";
import type { ProcessInfo } from "../sources/process/list.js";
import { listProcesses } from "../sources/process/list.js";
import type { IndexedSession } from "./build-summary.js";
import {
  buildClaudeFailedSummary,
  buildClaudeSession,
  buildCodexFailedSummary,
  buildCodexSession,
  deriveClaudeState,
} from "./build-summary.js";

/** 差し替え可能な依存（テストではフェイクを注入する）。省略時は実物。 */
export interface SessionIndexDeps {
  locateClaudeSessions?: typeof locateClaudeSessions;
  locateCodexSessions?: typeof locateCodexSessions;
  readRunningMeta?: typeof readRunningMeta;
  listProcesses?: typeof listProcesses;
  readHeadLines?: typeof readHeadLines;
  readTailLines?: typeof readTailLines;
  /** epoch ms。既定 Date.now。 */
  now?: () => number;
}

/** `rebuild` / `refreshFiles` の戻り値。 */
export interface RebuildResult {
  scanned: number;
  durationMs: number;
  warnings: string[];
}

/** 1 度に同時実行するファイル読み取りの上限。 */
const READ_CONCURRENCY = 8;

/** root の分類。「両方を試す」は claude / codex どちらのロケータも呼ぶ。 */
type RootKind = "claude" | "codex" | "both";

/** 内部で保持する必須依存（コンストラクタで既定値を埋めた後の形）。 */
interface ResolvedDeps {
  locateClaudeSessions: typeof locateClaudeSessions;
  locateCodexSessions: typeof locateCodexSessions;
  readRunningMeta: typeof readRunningMeta;
  listProcesses: typeof listProcesses;
  readHeadLines: typeof readHeadLines;
  readTailLines: typeof readTailLines;
  now: () => number;
}

/** root の basename（小文字）から分類する。 */
function classifyRoot(root: string): RootKind {
  const base = path.basename(root).toLowerCase();
  if (base === ".claude") {
    return "claude";
  }
  if (base === ".codex") {
    return "codex";
  }
  return "both";
}

/** ディレクトリ未検出系の警告かどうかを判定する（「両方を試す」root でのノイズ除去に使う）。 */
function isDirNotFoundWarning(message: string): boolean {
  return message.includes("見つかりません");
}

/**
 * items を worker に渡し、同時実行数を limit までに制限しつつ全件処理する。
 * 依存追加禁止のため、自前の小さなキューで実装する。
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runOne(): Promise<void> {
    for (;;) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }
      // current < items.length はループ条件で保証済みのため、要素は必ず存在する。
      const item = items[current] as T;
      results[current] = await worker(item);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runOne()));
  return results;
}

/** claude:<uuid> のラベル採番・codex のプロバイダ多重判定に使う集計単位。 */
interface AccountGroup {
  key: string;
  tool: ToolKind;
  sessionCount: number;
  runningCount: number;
  runningStartedAts: string[];
  /** ラベル採番用の並べ替えキー（firstAt ?? updatedAt の epoch ms）。 */
  earliestMs: number;
}

/** セッション一覧からアカウント集計（ADR-0004）を組み立てる。 */
function computeAccounts(
  sessions: readonly SessionSummary[],
  accountLabels: Readonly<Record<string, string>>,
): Account[] {
  const groups = new Map<string, AccountGroup>();

  for (const session of sessions) {
    let group = groups.get(session.accountKey);
    if (group === undefined) {
      group = {
        key: session.accountKey,
        tool: session.tool,
        sessionCount: 0,
        runningCount: 0,
        runningStartedAts: [],
        earliestMs: Number.POSITIVE_INFINITY,
      };
      groups.set(session.accountKey, group);
    }
    group.sessionCount += 1;
    if (session.state === "running") {
      group.runningCount += 1;
      if (session.startedAt !== null) {
        group.runningStartedAts.push(session.startedAt);
      }
    }
    const sortMs = Date.parse(session.firstAt ?? session.updatedAt);
    if (Number.isFinite(sortMs) && sortMs < group.earliestMs) {
      group.earliestMs = sortMs;
    }
  }

  // claude:<uuid>（claude:cli を除く）を最古の firstAt 順に 1 から採番する。
  const claudeUuidGroups = [...groups.values()]
    .filter((group) => group.tool === "claude" && group.key !== "claude:cli")
    .sort((a, b) => a.earliestMs - b.earliestMs);
  const uuidRank = new Map<string, number>();
  claudeUuidGroups.forEach((group, index) => {
    uuidRank.set(group.key, index + 1);
  });

  // codex:<provider> の provider が 2 種類以上あるときだけ「Codex (provider)」にする。
  const codexProviders = new Set(
    [...groups.keys()]
      .filter((key) => key.startsWith("codex:"))
      .map((key) => key.slice("codex:".length)),
  );
  const useProviderSuffix = codexProviders.size > 1;

  function defaultLabel(group: AccountGroup): string {
    if (group.key === "claude:cli") {
      return "Claude CLI";
    }
    if (group.tool === "claude") {
      return `Claude Desktop ${uuidRank.get(group.key) ?? 1}`;
    }
    const provider = group.key.slice("codex:".length);
    return useProviderSuffix ? `Codex (${provider})` : "Codex";
  }

  const accounts: Account[] = [...groups.values()].map((group) => ({
    key: group.key,
    label: accountLabels[group.key] ?? defaultLabel(group),
    tool: group.tool,
    running: group.runningCount > 0,
    runningCount: group.runningCount,
    sessionCount: group.sessionCount,
    startedAt:
      group.runningStartedAts.length > 0
        ? group.runningStartedAts.reduce((min, current) => (current < min ? current : min))
        : null,
  }));

  const toolOrder: Record<ToolKind, number> = { claude: 0, codex: 1 };
  accounts.sort((a, b) => {
    if (toolOrder[a.tool] !== toolOrder[b.tool]) {
      return toolOrder[a.tool] - toolOrder[b.tool];
    }
    return a.label.localeCompare(b.label, "ja");
  });

  return accounts;
}

/** SessionIndex: sources の結果を集約するインメモリ索引。 */
export class SessionIndex {
  private readonly config: AppConfig;
  private readonly log: Logger;
  private readonly deps: ResolvedDeps;

  private index: Map<string, IndexedSession> = new Map();
  private warnings: string[] = [];
  private processInfoAvailable = false;

  constructor(config: AppConfig, log: Logger, deps?: SessionIndexDeps) {
    this.config = config;
    this.log = log;
    this.deps = {
      locateClaudeSessions: deps?.locateClaudeSessions ?? locateClaudeSessions,
      locateCodexSessions: deps?.locateCodexSessions ?? locateCodexSessions,
      readRunningMeta: deps?.readRunningMeta ?? readRunningMeta,
      listProcesses: deps?.listProcesses ?? listProcesses,
      readHeadLines: deps?.readHeadLines ?? readHeadLines,
      readTailLines: deps?.readTailLines ?? readTailLines,
      now: deps?.now ?? Date.now,
    };
  }

  /** 1 件の Claude セッションを安全に組み立てる（想定外の例外を外に投げない）。 */
  private async buildClaudeSafe(
    file: ClaudeSessionFile,
    root: string,
    metas: readonly RunningMeta[],
    processes: readonly ProcessInfo[],
  ): Promise<{ item: IndexedSession; failed: boolean }> {
    try {
      const item = await buildClaudeSession({
        file,
        root,
        metas,
        processes,
        processInfoAvailable: this.processInfoAvailable,
        activeWindowMinutes: this.config.activeWindowMinutes,
        nowMs: this.deps.now(),
        readHeadLines: this.deps.readHeadLines,
        readTailLines: this.deps.readTailLines,
      });
      return { item, failed: false };
    } catch {
      const meta = metas.find((candidate) => candidate.sessionId === file.id);
      return { item: buildClaudeFailedSummary(file, root, meta, null), failed: true };
    }
  }

  /** 1 件の Codex セッションを安全に組み立てる（想定外の例外を外に投げない）。 */
  private async buildCodexSafe(
    file: CodexSessionFile,
    root: string,
    processes: readonly ProcessInfo[],
  ): Promise<{ item: IndexedSession; failed: boolean }> {
    try {
      const item = await buildCodexSession({
        file,
        root,
        processes,
        processInfoAvailable: this.processInfoAvailable,
        activeWindowMinutes: this.config.activeWindowMinutes,
        nowMs: this.deps.now(),
        readHeadLines: this.deps.readHeadLines,
        readTailLines: this.deps.readTailLines,
      });
      return { item, failed: false };
    } catch {
      return { item: buildCodexFailedSummary(file, root), failed: true };
    }
  }

  /**
   * 組み立て結果を索引に反映する。同じ key が既にあれば mtime の新しい方を採用する。
   * mtime が同値の場合は jsonlPath の小文字比較で辞書順が先の方を採用する
   * （root の処理順にも走査順にも依存しない決定的な tie-break。レビュー Round 2 引き継ぎ）。
   */
  private upsert(target: Map<string, IndexedSession>, item: IndexedSession): void {
    const existing = target.get(item.summary.key);
    if (existing === undefined || item.mtimeMs > existing.mtimeMs) {
      target.set(item.summary.key, item);
      return;
    }
    if (
      item.mtimeMs === existing.mtimeMs &&
      item.jsonlPath.toLowerCase() < existing.jsonlPath.toLowerCase()
    ) {
      target.set(item.summary.key, item);
    }
  }

  /** 全走査。roots を分類し、locator / running / process を呼んで索引を作り直す。 */
  async rebuild(): Promise<RebuildResult> {
    const start = this.deps.now();

    const processResult = await this.deps.listProcesses();
    this.processInfoAvailable = processResult.available;
    const processes = processResult.available ? processResult.processes : [];

    const warnings: string[] = [];
    if (!processResult.available) {
      warnings.push(processResult.reason);
    }

    const newIndex = new Map<string, IndexedSession>();
    let claudeCount = 0;
    let codexCount = 0;
    let failedCount = 0;

    for (const root of this.config.roots) {
      const kind = classifyRoot(root);
      const wantsClaude = kind === "claude" || kind === "both";
      const wantsCodex = kind === "codex" || kind === "both";

      let claudeResult: LocateClaudeResult | undefined;
      let runningResult: ReadRunningMetaResult | undefined;
      let codexResult: LocateCodexResult | undefined;

      await Promise.all([
        wantsClaude
          ? this.deps.locateClaudeSessions(root).then((r) => {
              claudeResult = r;
            })
          : Promise.resolve(),
        wantsClaude
          ? this.deps.readRunningMeta(root).then((r) => {
              runningResult = r;
            })
          : Promise.resolve(),
        wantsCodex
          ? this.deps.locateCodexSessions(root).then((r) => {
              codexResult = r;
            })
          : Promise.resolve(),
      ]);

      // 「両方を試す」root では、片方のディレクトリ未検出警告は、もう片方でセッションが
      // 見つかった場合はノイズなので捨てる。
      if (kind === "both") {
        const claudeHasSessions = (claudeResult?.sessions.length ?? 0) > 0;
        const codexHasSessions = (codexResult?.sessions.length ?? 0) > 0;
        if (codexHasSessions && claudeResult !== undefined) {
          claudeResult = {
            ...claudeResult,
            warnings: claudeResult.warnings.filter((w) => !isDirNotFoundWarning(w)),
          };
        }
        if (codexHasSessions && runningResult !== undefined) {
          runningResult = {
            ...runningResult,
            warnings: runningResult.warnings.filter((w) => !isDirNotFoundWarning(w)),
          };
        }
        if (claudeHasSessions && codexResult !== undefined) {
          codexResult = {
            ...codexResult,
            warnings: codexResult.warnings.filter((w) => !isDirNotFoundWarning(w)),
          };
        }
      }

      if (claudeResult !== undefined) {
        warnings.push(...claudeResult.warnings);
      }
      if (runningResult !== undefined) {
        warnings.push(...runningResult.warnings);
      }
      if (codexResult !== undefined) {
        warnings.push(...codexResult.warnings);
      }

      if (claudeResult !== undefined && claudeResult.sessions.length > 0) {
        const metas = runningResult?.metas ?? [];
        const built = await mapWithConcurrency(claudeResult.sessions, READ_CONCURRENCY, (file) =>
          this.buildClaudeSafe(file, root, metas, processes),
        );
        for (const { item, failed } of built) {
          this.upsert(newIndex, item);
          claudeCount += 1;
          if (failed) {
            failedCount += 1;
          }
        }
      }

      if (codexResult !== undefined && codexResult.sessions.length > 0) {
        const built = await mapWithConcurrency(codexResult.sessions, READ_CONCURRENCY, (file) =>
          this.buildCodexSafe(file, root, processes),
        );
        for (const { item, failed } of built) {
          this.upsert(newIndex, item);
          codexCount += 1;
          if (failed) {
            failedCount += 1;
          }
        }
      }
    }

    if (failedCount > 0) {
      warnings.push(`セッションの組み立てのうち ${failedCount} 件に失敗しました。`);
    }

    this.index = newIndex;
    this.warnings = warnings;

    const runningNow = [...newIndex.values()].filter(
      (item) => item.summary.state === "running",
    ).length;
    const durationMs = this.deps.now() - start;
    const scanned = claudeCount + codexCount;

    this.log.info("索引を再構築しました", {
      scanned,
      durationMs,
      claude: claudeCount,
      codex: codexCount,
      running: runningNow,
    });
    if (warnings.length > 0) {
      this.log.warn("索引の再構築で警告がありました", { count: warnings.length });
    }

    return { scanned, durationMs, warnings };
  }

  /**
   * 差分更新。`paths` の各要素を判定し、該当セッションだけ／稼働メタだけを再計算するか、
   * 索引に無い新規パスが含まれる場合は rebuild() にフォールバックする。
   */
  async refreshFiles(paths: readonly string[]): Promise<RebuildResult> {
    const start = this.deps.now();

    if (paths.length === 0) {
      return { scanned: 0, durationMs: this.deps.now() - start, warnings: this.warnings };
    }

    const normalized = paths.map((p) => path.resolve(p).toLowerCase());

    const matchedKeys = new Set<string>();
    const remaining: string[] = [];
    for (const candidate of normalized) {
      let matched = false;
      for (const [key, indexed] of this.index) {
        if (path.resolve(indexed.jsonlPath).toLowerCase() === candidate) {
          matchedKeys.add(key);
          matched = true;
          break;
        }
      }
      if (!matched) {
        remaining.push(candidate);
      }
    }

    const claudeRoots = this.config.roots.filter((root) => classifyRoot(root) !== "codex");

    let needsRunningRefresh = false;
    const unknown: string[] = [];
    for (const candidate of remaining) {
      // ここでの path.join は「稼働メタ配下のパスかどうか」を文字列だけで判定するための計算であり、
      // ファイルを開かない・読み取りは行わない（読み取りは sources/claude/running.ts の
      // readRunningMeta のみが行う。レビュー Round 2 引き継ぎ）。
      const underSessionsDir = claudeRoots.some((root) => {
        const sessionsDir = path.resolve(path.join(root, "sessions")).toLowerCase();
        return candidate === sessionsDir || candidate.startsWith(`${sessionsDir}${path.sep}`);
      });
      if (underSessionsDir) {
        needsRunningRefresh = true;
      } else {
        unknown.push(candidate);
      }
    }

    // 索引に無い新規ファイル等が混じっている場合は簡潔さを優先し、全走査にフォールバックする。
    if (unknown.length > 0) {
      return this.rebuild();
    }

    let scanned = 0;
    const warnings: string[] = [];
    let cachedProcesses: readonly ProcessInfo[] = [];
    let processFetched = false;

    const ensureProcesses = async (): Promise<readonly ProcessInfo[]> => {
      if (processFetched) {
        return cachedProcesses;
      }
      const result = await this.deps.listProcesses();
      this.processInfoAvailable = result.available;
      cachedProcesses = result.available ? result.processes : [];
      if (!result.available) {
        warnings.push(result.reason);
      }
      processFetched = true;
      return cachedProcesses;
    };

    if (matchedKeys.size > 0) {
      const rootsNeeded = new Map<string, { claudeKeys: Set<string>; codexKeys: Set<string> }>();
      for (const key of matchedKeys) {
        const indexed = this.index.get(key);
        if (indexed === undefined) {
          continue;
        }
        const entry = rootsNeeded.get(indexed.root) ?? {
          claudeKeys: new Set<string>(),
          codexKeys: new Set<string>(),
        };
        if (indexed.summary.tool === "claude") {
          entry.claudeKeys.add(key);
        } else {
          entry.codexKeys.add(key);
        }
        rootsNeeded.set(indexed.root, entry);
      }

      const currentProcesses = await ensureProcesses();

      for (const [root, entry] of rootsNeeded) {
        if (entry.claudeKeys.size > 0) {
          const [claudeResult, runningResult] = await Promise.all([
            this.deps.locateClaudeSessions(root),
            this.deps.readRunningMeta(root),
          ]);
          warnings.push(...claudeResult.warnings, ...runningResult.warnings);
          const foundKeys = new Set(claudeResult.sessions.map((file) => `claude:${file.id}`));
          const targetFiles = claudeResult.sessions.filter((file) =>
            entry.claudeKeys.has(`claude:${file.id}`),
          );
          const built = await mapWithConcurrency(targetFiles, READ_CONCURRENCY, (file) =>
            this.buildClaudeSafe(file, root, runningResult.metas, currentProcesses),
          );
          for (const { item, failed } of built) {
            this.index.set(item.summary.key, item);
            scanned += 1;
            if (failed) {
              warnings.push("セッションの組み立てに 1 件失敗しました。");
            }
          }
          // 索引に既知の jsonlPath だったのに locator の結果に出てこないセッションは、
          // ファイルが削除された（または移動した）とみなして索引から落とす（レビュー Round 2 引き継ぎ）。
          for (const key of entry.claudeKeys) {
            if (!foundKeys.has(key)) {
              this.index.delete(key);
              scanned += 1;
            }
          }
        }
        if (entry.codexKeys.size > 0) {
          const codexResult = await this.deps.locateCodexSessions(root);
          warnings.push(...codexResult.warnings);
          const foundKeys = new Set(codexResult.sessions.map((file) => `codex:${file.id}`));
          const targetFiles = codexResult.sessions.filter((file) =>
            entry.codexKeys.has(`codex:${file.id}`),
          );
          const built = await mapWithConcurrency(targetFiles, READ_CONCURRENCY, (file) =>
            this.buildCodexSafe(file, root, currentProcesses),
          );
          for (const { item, failed } of built) {
            this.index.set(item.summary.key, item);
            scanned += 1;
            if (failed) {
              warnings.push("セッションの組み立てに 1 件失敗しました。");
            }
          }
          for (const key of entry.codexKeys) {
            if (!foundKeys.has(key)) {
              this.index.delete(key);
              scanned += 1;
            }
          }
        }
      }
    }

    if (needsRunningRefresh) {
      const currentProcesses = await ensureProcesses();

      const metas: RunningMeta[] = [];
      for (const root of claudeRoots) {
        const runningResult = await this.deps.readRunningMeta(root);
        warnings.push(...runningResult.warnings);
        metas.push(...runningResult.metas);
      }

      for (const [key, indexed] of this.index) {
        if (indexed.summary.tool !== "claude") {
          continue;
        }
        // 読み取り失敗で state: "error" にした項目は、稼働メタだけの再計算では触らない。
        // resolveState の結果で無条件に上書きすると、lastMessage がエラー文言のまま
        // state だけ active / idle に静かに戻ってしまい矛盾する（レビュー Round 2 BLOCKING）。
        // 本来の状態を復元するには、そのセッション自体の再読み込み（rebuild または
        // ファイル変更検知による refreshFiles）が必要。
        if (indexed.summary.state === "error") {
          continue;
        }
        const meta = metas.find((candidate) => candidate.sessionId === indexed.summary.id);
        const match = meta !== undefined ? matchRunning(meta, currentProcesses) : null;
        const derived = deriveClaudeState(
          meta,
          match,
          this.processInfoAvailable,
          indexed.mtimeMs,
          this.deps.now(),
          this.config.activeWindowMinutes,
        );

        const updatedSummary: SessionSummary = {
          ...indexed.summary,
          state: derived.state,
          stateReason: derived.stateReason,
          pid: derived.pid,
          startedAt: derived.startedAt,
        };
        this.index.set(key, { ...indexed, summary: updatedSummary });
        scanned += 1;
      }
    }

    this.warnings = warnings;
    const durationMs = this.deps.now() - start;

    this.log.info("索引を差分更新しました", { scanned, durationMs });
    if (warnings.length > 0) {
      this.log.warn("索引の差分更新で警告がありました", { count: warnings.length });
    }

    return { scanned, durationMs, warnings };
  }

  /** updatedAt 降順、同値なら key 昇順のコピー配列。 */
  getAll(): SessionSummary[] {
    const list = [...this.index.values()].map((item) => item.summary);
    list.sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) {
        return a.updatedAt > b.updatedAt ? -1 : 1;
      }
      if (a.key === b.key) {
        return 0;
      }
      return a.key < b.key ? -1 : 1;
    });
    return list;
  }

  get(key: string): SessionSummary | undefined {
    return this.index.get(key)?.summary;
  }

  /** tool（claude → codex）→ label の順に並んだアカウント一覧。 */
  getAccounts(): Account[] {
    return computeAccounts(this.getAll(), this.config.accounts);
  }

  /** 直近の rebuild / refreshFiles の警告（実パスなし）。 */
  getWarnings(): string[] {
    return [...this.warnings];
  }

  /** 直近の listProcesses が available だったか（health 用）。 */
  isProcessInfoAvailable(): boolean {
    return this.processInfoAvailable;
  }
}
