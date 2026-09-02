import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// T-002: 「shared は node:* / react を import しない」という受け入れ条件を検証する。
// 行頭 import / export ... from の行だけを対象にし、コメント中の文字列は除外する。

const SHARED_DIR = path.join(process.cwd(), "src", "shared");

/** 対象行かどうか（行頭が import、または export ... from）を判定する。 */
function isImportLikeLine(trimmed: string): boolean {
  if (trimmed.startsWith("import")) {
    return true;
  }
  // export ... from "..." の形（export type { X } from "..." も含む）
  return /^export\b.*\bfrom\b/.test(trimmed);
}

/** node:* / react の import、および require( の使用を検出する（対象行のみ）。 */
function findRuntimeImportViolations(content: string): string[] {
  const violations: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!isImportLikeLine(trimmed)) {
      continue;
    }
    if (
      /from\s+["']node:/.test(trimmed) ||
      /from\s+["']react/.test(trimmed) ||
      /require\(/.test(trimmed)
    ) {
      violations.push(trimmed);
    }
  }
  return violations;
}

function listTsFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...listTsFilesRecursive(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("findRuntimeImportViolations（検出ロジック自体の単体テスト）", () => {
  it("node: からの import を検出する", () => {
    const content = 'import { readFileSync } from "node:fs";\n';
    expect(findRuntimeImportViolations(content)).toHaveLength(1);
  });

  it("react からの import を検出する", () => {
    const content = "import { useState } from 'react';\n";
    expect(findRuntimeImportViolations(content)).toHaveLength(1);
  });

  it("react-dom のような react 接頭の import も検出する", () => {
    const content = 'import ReactDOM from "react-dom";\n';
    expect(findRuntimeImportViolations(content)).toHaveLength(1);
  });

  it("export ... from 形式の node:*/react も検出する", () => {
    const content = 'export { something } from "node:path";\n';
    expect(findRuntimeImportViolations(content)).toHaveLength(1);
  });

  it("require( の使用を検出する（対象行内のみ）", () => {
    const content = 'import x = require("node:fs");\n';
    expect(findRuntimeImportViolations(content).length).toBeGreaterThan(0);
  });

  it("コメント中の文字列は無視する", () => {
    const content = [
      "// この関数は node:fs や react を import してはいけない",
      '// import { x } from "node:fs"; のような実装は禁止',
      "export const noop = (): void => {};",
      "",
    ].join("\n");
    expect(findRuntimeImportViolations(content)).toHaveLength(0);
  });

  it("行頭が import/export 以外の行にある文字列は無視する（行途中の require 等）", () => {
    const content = 'const msg = "call require(\\"node:fs\\") is banned";\n';
    expect(findRuntimeImportViolations(content)).toHaveLength(0);
  });

  it("許可された import（他の shared ファイルや型のみの import）は検出しない", () => {
    const content = [
      'import type { AppError } from "./result";',
      'import { isRecord } from "./guards";',
      'export type { ToolKind } from "./types";',
      "",
    ].join("\n");
    expect(findRuntimeImportViolations(content)).toHaveLength(0);
  });

  it("空ファイルでは違反なし", () => {
    expect(findRuntimeImportViolations("")).toHaveLength(0);
  });
});

describe("src/shared/**/*.ts の実ファイル検証", () => {
  it("src/shared ディレクトリが存在する", () => {
    expect(statSync(SHARED_DIR).isDirectory()).toBe(true);
  });

  const files = statSync(SHARED_DIR).isDirectory() ? listTsFilesRecursive(SHARED_DIR) : [];

  it("少なくとも 1 つの .ts ファイルが存在する", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.length > 0 ? files : ["(no-file)"])(
    "%s に node:* / react の import / require が無い",
    (file) => {
      if (file === "(no-file)") {
        return;
      }
      const content = readFileSync(file, "utf-8");
      const violations = findRuntimeImportViolations(content);
      expect(violations, `違反行: ${violations.join(", ")}`).toHaveLength(0);
    },
  );
});
