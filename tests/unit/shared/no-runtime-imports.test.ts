import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// T-002: 「shared は node:* / react を import しない」という受け入れ条件を検証する。
// T-003 引き継ぎ: node: 接頭辞なしの組み込みモジュール、副作用 import、動的 import も検出する。
// 行頭 import / export ... from の行だけでなく、行内どこにあっても検出すべきもの（動的 import）は
// 行全体（コメント行を除く）を対象にスキャンする。

const SHARED_DIR = path.join(process.cwd(), "src", "shared");

/** node:* 接頭辞なしでも Node.js 組み込みモジュールとして扱うべき名前の一覧。 */
const BARE_BUILTIN_MODULES = [
  "path",
  "fs",
  "os",
  "child_process",
  "util",
  "events",
  "stream",
  "crypto",
  "url",
  "http",
  "net",
];

/** 行頭が import、または export ... from の行かどうかを判定する。 */
function isImportLikeLine(trimmed: string): boolean {
  if (trimmed.startsWith("import")) {
    return true;
  }
  // export ... from "..." の形（export type { X } from "..." も含む）
  return /^export\b.*\bfrom\b/.test(trimmed);
}

/**
 * 行内から import/export/require が参照するモジュール指定子を抜き出す。
 * 誤検出を避けるため、行頭が import/export の「import 風の行」に限定して適用する
 * （そうでない行に from 節の正規表現をかけると、通常の文章中の
 * 「... from "node:fs" ...」のような偶然の一致まで拾ってしまうため）。
 */
function extractStaticModuleSpecifiers(trimmed: string): string[] {
  const specifiers: string[] = [];

  // import ... from "x" / export ... from "x"
  for (const m of trimmed.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    if (typeof m[1] === "string") {
      specifiers.push(m[1]);
    }
  }
  // 副作用 import: import "x";（from を伴わない）
  const sideEffect = /^import\s+["']([^"']+)["']/.exec(trimmed);
  if (sideEffect && typeof sideEffect[1] === "string") {
    specifiers.push(sideEffect[1]);
  }
  // require("x")（TS の import x = require("x") 含む）
  for (const m of trimmed.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    if (typeof m[1] === "string") {
      specifiers.push(m[1]);
    }
  }

  return specifiers;
}

/**
 * 行内の動的 import("x") / await import("x") を抜き出す。
 * `return import(...)` のように行頭が import/export でなくても書けるため、
 * 行頭形状に関わらず（コメント行を除き）全行を対象にする。
 */
function extractDynamicImportSpecifiers(trimmed: string): string[] {
  const specifiers: string[] = [];
  for (const m of trimmed.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    if (typeof m[1] === "string") {
      specifiers.push(m[1]);
    }
  }
  return specifiers;
}

/** モジュール指定子が禁止対象（node:*, react, 接頭辞なし組み込み）かどうかを判定する。 */
function isBannedSpecifier(specifier: string): boolean {
  if (specifier.startsWith("node:")) {
    return true;
  }
  if (specifier === "react" || specifier.startsWith("react/") || specifier.startsWith("react-")) {
    return true;
  }
  return BARE_BUILTIN_MODULES.some(
    (builtin) => specifier === builtin || specifier.startsWith(`${builtin}/`),
  );
}

/**
 * node:* / react の import、接頭辞なし組み込みモジュールの import、
 * 副作用 import、動的 import、require( の使用を検出する。
 * コメント行（行頭が // のもの）は対象外。
 */
function findRuntimeImportViolations(content: string): string[] {
  const violations: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("//")) {
      continue;
    }

    const specifiers: string[] = [...extractDynamicImportSpecifiers(trimmed)];
    if (isImportLikeLine(trimmed)) {
      specifiers.push(...extractStaticModuleSpecifiers(trimmed));
    }

    if (specifiers.length > 0 && specifiers.some(isBannedSpecifier)) {
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

  describe("node: 接頭辞なしの組み込みモジュール", () => {
    it.each(BARE_BUILTIN_MODULES)("%s を接頭辞なしで import すると検出する", (mod) => {
      const content = `import x from "${mod}";\n`;
      expect(findRuntimeImportViolations(content)).toHaveLength(1);
    });

    it("サブパス（例: fs/promises）でも検出する", () => {
      const content = 'import { readFile } from "fs/promises";\n';
      expect(findRuntimeImportViolations(content)).toHaveLength(1);
    });

    it("似た名前だが別モジュール（path-browserify 等）は誤検出しない", () => {
      const content = [
        'import p from "path-browserify";',
        'import u from "utility-belt";',
        "",
      ].join("\n");
      expect(findRuntimeImportViolations(content)).toHaveLength(0);
    });
  });

  describe("副作用 import（from を伴わない）", () => {
    it('import "node:fs"; を検出する', () => {
      const content = 'import "node:fs";\n';
      expect(findRuntimeImportViolations(content)).toHaveLength(1);
    });

    it('接頭辞なしの import "fs"; も検出する', () => {
      const content = "import 'fs';\n";
      expect(findRuntimeImportViolations(content)).toHaveLength(1);
    });

    it("自ファイル内の副作用 import（相対パス）は検出しない", () => {
      const content = 'import "./polyfill";\n';
      expect(findRuntimeImportViolations(content)).toHaveLength(0);
    });
  });

  describe("動的 import", () => {
    it('import("node:fs") を検出する', () => {
      const content = 'const mod = await import("node:fs");\n';
      expect(findRuntimeImportViolations(content)).toHaveLength(1);
    });

    it('接頭辞なしの import("fs") も検出する', () => {
      const content = "if (x) { void import('fs'); }\n";
      expect(findRuntimeImportViolations(content)).toHaveLength(1);
    });

    it("行頭が import/export でなくても検出する（変数代入など）", () => {
      const content = 'export function load() { return import("node:child_process"); }\n';
      expect(findRuntimeImportViolations(content)).toHaveLength(1);
    });

    it("動的 import でもローカルモジュールは検出しない", () => {
      const content = 'const mod = await import("./local-module");\n';
      expect(findRuntimeImportViolations(content)).toHaveLength(0);
    });

    it("コメント中の動的 import 文字列は無視する", () => {
      const content = [
        '// 禁止: import("node:fs") のような動的 import は使わないこと',
        "export const noop = (): void => {};",
        "",
      ].join("\n");
      expect(findRuntimeImportViolations(content)).toHaveLength(0);
    });
  });
});

describe("isImportLikeLine（従来の行頭判定、後方互換の確認）", () => {
  it("import で始まる行は true", () => {
    expect(isImportLikeLine('import x from "y";')).toBe(true);
  });

  it("export ... from の行は true", () => {
    expect(isImportLikeLine('export { x } from "y";')).toBe(true);
  });

  it("通常のコード行は false", () => {
    expect(isImportLikeLine("export const noop = () => {};")).toBe(false);
    expect(isImportLikeLine('const mod = await import("y");')).toBe(false);
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
    "%s に node:* / react /接頭辞なし組み込み / 動的 import の禁止参照が無い",
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
