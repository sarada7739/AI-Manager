import { describe, expect, it } from "vitest";
import {
  formatBytes,
  normalizeBranch,
  shortenPath,
  truncateStart,
} from "../../../src/shared/format";

// T-005: shortenPath / truncateStart / formatBytes / normalizeBranch の受け入れ条件を検証する。
// 実在のユーザー名・パスは使わず、ダミー値（someone 等）のみを使う。

describe("shortenPath", () => {
  it("Windows 区切り: ホーム配下のパスは ~ に置換され / 区切りになる", () => {
    expect(shortenPath("C:\\Users\\someone\\project\\file.txt", "C:\\Users\\someone")).toBe(
      "~/project/file.txt",
    );
  });

  it("混在区切り: \\ と / が混ざっていても正しく短縮される", () => {
    expect(shortenPath("C:\\Users\\someone/project\\sub/file.txt", "C:\\Users\\someone")).toBe(
      "~/project/sub/file.txt",
    );
  });

  it("大文字小文字違いのホーム: 判定は大文字小文字を無視する", () => {
    expect(shortenPath("c:\\users\\SOMEONE\\Project", "C:\\Users\\someone")).toBe("~/Project");
  });

  it("ホーム直下: path === homeDir は ~ を返す", () => {
    expect(shortenPath("C:\\Users\\someone", "C:\\Users\\someone")).toBe("~");
  });

  it("ホーム直下（大文字小文字違い）でも ~ を返す", () => {
    expect(shortenPath("c:\\USERS\\someone", "C:\\Users\\someone")).toBe("~");
  });

  it("ホーム外: ホーム配下でなければそのまま（区切りのみ統一）", () => {
    expect(shortenPath("D:\\other\\file.txt", "C:\\Users\\someone")).toBe("D:/other/file.txt");
  });

  it("ホームに前方一致するが別ディレクトリ: someone2 は someone の配下ではない", () => {
    expect(shortenPath("C:\\Users\\someone2\\x", "C:\\Users\\someone")).toBe("C:/Users/someone2/x");
  });

  it("homeDir 空: 区切り文字の統一のみ行う", () => {
    expect(shortenPath("C:\\Users\\dummy\\file.txt", "")).toBe("C:/Users/dummy/file.txt");
  });

  it("末尾区切り付きの homeDir でも正しく短縮される", () => {
    expect(shortenPath("C:\\Users\\someone\\project", "C:\\Users\\someone\\")).toBe("~/project");
  });

  // T-005 Round 2: 比較前に path / homeDir それぞれの末尾区切りを 1 つ落とす仕様の固定。
  it("末尾区切り付きの path・区切りなしの homeDir がホーム直下: ~ を返す", () => {
    expect(shortenPath("C:\\Users\\someone\\", "C:\\Users\\someone")).toBe("~");
  });

  it("区切りなしの path・末尾区切り付きの homeDir がホーム直下: ~ を返す", () => {
    expect(shortenPath("C:\\Users\\someone", "C:\\Users\\someone\\")).toBe("~");
  });

  it("末尾区切り付きの path がホーム配下のサブパス: ~/proj を返す", () => {
    expect(shortenPath("C:\\Users\\someone\\proj\\", "C:\\Users\\someone")).toBe("~/proj");
  });

  it("`..` を含むパスは正規化しない（表示専用の仕様固定）", () => {
    expect(shortenPath("C:\\Users\\someone\\..\\other", "C:\\Users\\someone")).toBe("~/../other");
  });
});

describe("truncateStart", () => {
  it("超過なし: text.length < max はそのまま返す", () => {
    expect(truncateStart("short", 10)).toBe("short");
  });

  it("ちょうど max: text.length === max はそのまま返す", () => {
    expect(truncateStart("12345", 5)).toBe("12345");
  });

  it("超過: 先頭を削り … を付けて max 文字に収める", () => {
    const result = truncateStart("abcdefghij", 5);
    expect(result).toBe("…ghij");
    expect(result.length).toBe(5);
  });

  it("max = 0 は常に …", () => {
    expect(truncateStart("abcdef", 0)).toBe("…");
  });

  it("max = 1 は常に …", () => {
    expect(truncateStart("abcdef", 1)).toBe("…");
  });

  it("max = 2: … + 末尾 1 文字で 2 文字に収める", () => {
    const result = truncateStart("abcdef", 2);
    expect(result).toBe("…f");
    expect(result.length).toBe(2);
  });

  it("空文字: 超過しないのでそのまま返す", () => {
    expect(truncateStart("", 5)).toBe("");
  });

  it("空文字 かつ max <= 1 は … を返す", () => {
    expect(truncateStart("", 1)).toBe("…");
  });

  it("日本語（BMP 内）: 文字数基準で先頭を削る", () => {
    const result = truncateStart("あいうえおかきくけこ", 5);
    expect(result).toBe("…きくけこ");
    expect(result.length).toBe(5);
  });
});

describe("formatBytes", () => {
  it("0 は「0 B」", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("1 は「1 B」", () => {
    expect(formatBytes(1)).toBe("1 B");
  });

  it("1023 は「1023 B」（KB 未満は整数表示）", () => {
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("1024 は「1.0 KB」", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("1536 は「1.5 KB」", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("1024**2 * 3.8 付近は「3.8 MB」", () => {
    expect(formatBytes(1024 ** 2 * 3.8)).toBe("3.8 MB");
  });

  it("1024**3 * 1.2 付近は「1.2 GB」", () => {
    expect(formatBytes(1024 ** 3 * 1.2)).toBe("1.2 GB");
  });

  it("負数は「—」", () => {
    expect(formatBytes(-1)).toBe("—");
  });

  it("NaN は「—」", () => {
    expect(formatBytes(Number.NaN)).toBe("—");
  });

  it("Infinity は「—」", () => {
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
  });

  // T-005 Round 2: 丸め後の値で単位を決める仕様の固定（1023 / 1024 / 1536 は既存テストで確認済み）。
  it("1048575（1MB 弱、丸めで 1024.0 KB になり得る値）は「1.0 MB」に繰り上がる", () => {
    expect(formatBytes(1048575)).toBe("1.0 MB");
  });

  it("1073741823（1GB 弱、丸めで 1024.0 MB になり得る値）は「1.0 GB」に繰り上がる", () => {
    expect(formatBytes(1073741823)).toBe("1.0 GB");
  });

  it("1024 ** 4 - 1（TB 境界直下）は「1.0 TB」に繰り上がる", () => {
    expect(formatBytes(1024 ** 4 - 1)).toBe("1.0 TB");
  });
});

describe("normalizeBranch", () => {
  it("null は null", () => {
    expect(normalizeBranch(null)).toBeNull();
  });

  it("undefined は null", () => {
    expect(normalizeBranch(undefined)).toBeNull();
  });

  it("空文字は null", () => {
    expect(normalizeBranch("")).toBeNull();
  });

  it('"HEAD" は null', () => {
    expect(normalizeBranch("HEAD")).toBeNull();
  });

  it('"main" はそのまま', () => {
    expect(normalizeBranch("main")).toBe("main");
  });

  it('"feature/x" はそのまま', () => {
    expect(normalizeBranch("feature/x")).toBe("feature/x");
  });

  it('前後に空白を含む " HEAD " は "HEAD" と厳密一致しないためそのまま返る', () => {
    expect(normalizeBranch(" HEAD ")).toBe(" HEAD ");
  });
});
