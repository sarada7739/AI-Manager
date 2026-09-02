import { describe, expect, it } from "vitest";
import { maskSecrets, maskSecretsWithCount, SECRET_PATTERNS } from "../../../src/shared/masking";

// T-003: src/shared/masking.ts の秘密情報マスク関数の受け入れ条件を検証する。
// 注意: フィクスチャの鍵・トークンはすべて「明らかなダミー値」（DUMMY 等を含む）であり、
// 実在しうる形式の鍵は書かない。

describe("maskSecrets: 各パターンの正常系", () => {
  it("Anthropic の API キー（sk-ant-...）を先頭4文字+••••に置換する", () => {
    const input = "key=sk-ant-DUMMYABCDEFG1234567890 end";
    expect(maskSecrets(input)).toBe("key=sk-a•••• end");
  });

  it("汎用の sk- 系キー（sk- + 20文字以上）を先頭4文字+••••に置換する", () => {
    const input = `key=sk-${"a".repeat(20)} end`;
    expect(maskSecrets(input)).toBe("key=sk-a•••• end");
  });

  it("GitHub トークン（ghp_/gho_/ghu_/ghs_/ghr_）を先頭4文字+••••に置換する", () => {
    const prefixes = ["ghp", "gho", "ghu", "ghs", "ghr"] as const;
    for (const prefix of prefixes) {
      const input = `token=${prefix}_DUMMY1234567890ABCDEFabcdef end`;
      expect(maskSecrets(input)).toBe(`token=${prefix}_•••• end`);
    }
  });

  it("GitHub の細粒度 PAT（github_pat_...）を先頭4文字+••••に置換する", () => {
    const input = "token=github_pat_DUMMY1234567890ABCDEFabcdef1234567890ABCDEFabcdef end";
    expect(maskSecrets(input)).toBe("token=gith•••• end");
  });

  it("AWS アクセスキー ID（AKIA + 大文字英数字16文字）を先頭4文字+••••に置換する", () => {
    const input = `AKIA${"A".repeat(16)}`;
    expect(maskSecrets(input)).toBe("AKIA••••");
  });

  it("Slack トークン（xoxb-/xoxp-...）を先頭4文字+••••に置換する", () => {
    expect(maskSecrets("xoxb-DUMMY-1234567890-abcdefgHIJKLMN")).toBe("xoxb••••");
    expect(maskSecrets("xoxp-DUMMY-1234567890-abcdefgHIJKLMN")).toBe("xoxp••••");
  });

  it("Bearer トークン: 'Bearer ' の語は残し、トークン本体は先頭文字も含めて全て伏せる（keepPrefix=0）", () => {
    const input = `Authorization: Bearer ${"x".repeat(16)}`;
    expect(maskSecrets(input)).toBe("Authorization: Bearer ••••");
  });

  it("メールアドレスを ***@*** に置換する", () => {
    expect(maskSecrets("contact: taro.yamada@example.com please")).toBe("contact: ***@*** please");
  });
});

describe("maskSecrets: 境界値", () => {
  it("sk- + 19文字は置換されない", () => {
    const input = `key=sk-${"a".repeat(19)} end`;
    expect(maskSecrets(input)).toBe(input);
  });

  it("sk- + 20文字は置換される", () => {
    const input = `key=sk-${"a".repeat(20)} end`;
    expect(maskSecrets(input)).not.toBe(input);
    expect(maskSecrets(input)).toBe("key=sk-a•••• end");
  });

  it("AKIA + 15文字は置換されない", () => {
    const input = `AKIA${"A".repeat(15)}`;
    expect(maskSecrets(input)).toBe(input);
  });

  it("AKIA + 16文字は置換される", () => {
    const input = `AKIA${"A".repeat(16)}`;
    expect(maskSecrets(input)).toBe("AKIA••••");
  });

  it("AKIA + 17文字は{16,}の欲張りマッチにより全体がマッチし、末尾も残らない", () => {
    const input = `AKIA${"A".repeat(17)}`;
    expect(maskSecrets(input)).toBe("AKIA••••");
  });

  it("ASIA（一時アクセスキー ID）+ 16文字も置換される", () => {
    const input = `ASIA${"A".repeat(16)}`;
    expect(maskSecrets(input)).toBe("ASIA••••");
  });

  it("Bearer + 15文字（トークン部）は置換されない", () => {
    const input = `Authorization: Bearer ${"x".repeat(15)}`;
    expect(maskSecrets(input)).toBe(input);
  });

  it("Bearer + 16文字（トークン部）は置換され、トークン本体は先頭文字も残らない", () => {
    const input = `Authorization: Bearer ${"x".repeat(16)}`;
    expect(maskSecrets(input)).toBe("Authorization: Bearer ••••");
  });
});

describe("maskSecrets: 複数出現・複数行・複合", () => {
  it("同一行に2種類の秘密情報がある場合、両方とも置換される", () => {
    const input = `AKIA${"B".repeat(16)} and ghp_${"c".repeat(20)}`;
    expect(maskSecrets(input)).toBe("AKIA•••• and ghp_••••");
  });

  it("複数行にまたがる複数の出現をすべて置換する", () => {
    const input = [
      "1行目: sk-ant-DUMMYAAA1111",
      `2行目: AKIA${"B".repeat(16)} と ghp_${"c".repeat(20)}`,
      "3行目: user@example.com",
    ].join("\n");
    const result = maskSecrets(input);
    expect(result).toBe(
      ["1行目: sk-a••••", "2行目: AKIA•••• と ghp_••••", "3行目: ***@***"].join("\n"),
    );
  });

  it("同じ種類の秘密情報が複数回出現しても全て置換される", () => {
    const input = "sk-ant-DUMMYAAA1111 and sk-ant-DUMMYBBB2222";
    expect(maskSecrets(input)).toBe("sk-a•••• and sk-a••••");
  });
});

describe("maskSecrets: 該当なし・無変更", () => {
  it("普通の日本語の文章は無変更", () => {
    const input = "これは普通の日本語の文章です。秘密情報はありません。";
    expect(maskSecrets(input)).toBe(input);
  });

  it("通常の URL は無変更", () => {
    const input = "詳細は https://example.com/path?query=1 を参照";
    expect(maskSecrets(input)).toBe(input);
  });

  it("'sk-' だけの文字列（続く文字が無い/短い）は無変更", () => {
    const input = "sk- だけの文字列です";
    expect(maskSecrets(input)).toBe(input);
  });

  it("'Bearer' だけの文字列（トークンが無い/短い）は無変更", () => {
    const input = "Bearer だけの文字列です";
    expect(maskSecrets(input)).toBe(input);
  });
});

describe("maskSecrets: 空文字", () => {
  it("空文字は空文字のまま", () => {
    expect(maskSecrets("")).toBe("");
  });
});

describe("maskSecrets: マスク後の残存トークン確認", () => {
  it("置換後、元のトークンの先頭4文字は残るが、残りの部分は含まれない", () => {
    const secret = "sk-ant-DUMMYABCDEFG1234567890";
    const input = `key=${secret} end`;
    const output = maskSecrets(input);
    const remainder = secret.slice(4); // "nt-DUMMYABCDEFG1234567890"
    expect(output).toContain(secret.slice(0, 4)); // "sk-a"
    expect(output).not.toContain(remainder);
    expect(output).not.toContain(secret);
  });

  it("AKIA キーの置換後も元のキー全体は含まれない", () => {
    const secret = `AKIA${"A".repeat(16)}`;
    const output = maskSecrets(secret);
    expect(output).not.toContain(secret);
    expect(output.startsWith("AKIA")).toBe(true);
  });
});

describe("maskSecrets: 呼び出しの冪等性（lastIndex 非依存）", () => {
  it("同じ入力に対して2回連続で呼び出しても同じ結果になる", () => {
    const input = "sk-ant-DUMMYAAA1111 and sk-ant-DUMMYBBB2222";
    const first = maskSecretsWithCount(input);
    const second = maskSecretsWithCount(input);
    expect(second).toEqual(first);
    expect(second.text).toBe("sk-a•••• and sk-a••••");
    expect(second.count).toBe(2);
  });

  it("異なる入力を連続で処理しても、前回の状態を引きずらない", () => {
    const withMatch = maskSecretsWithCount(`AKIA${"A".repeat(16)}`);
    const withoutMatch = maskSecretsWithCount("普通の文章");
    expect(withMatch.count).toBe(1);
    expect(withoutMatch.count).toBe(0);
    expect(withoutMatch.text).toBe("普通の文章");
  });
});

describe("maskSecretsWithCount", () => {
  it("該当なしの場合、text は無変更で count は 0", () => {
    const input = "これは普通の日本語の文章です。";
    expect(maskSecretsWithCount(input)).toEqual({ text: input, count: 0 });
  });

  it("空文字の場合、{ text: '', count: 0 } を返す", () => {
    expect(maskSecretsWithCount("")).toEqual({ text: "", count: 0 });
  });

  it("1件マッチした場合、count は 1", () => {
    const result = maskSecretsWithCount(`AKIA${"A".repeat(16)}`);
    expect(result.count).toBe(1);
    expect(result.text).toBe("AKIA••••");
  });

  it("複数種類・複数件マッチした場合、件数を正しく積算する", () => {
    const input = [
      "sk-ant-DUMMYAAA1111",
      `AKIA${"B".repeat(16)}`,
      `ghp_${"c".repeat(20)}`,
      "user@example.com",
    ].join(" / ");
    const result = maskSecretsWithCount(input);
    expect(result.count).toBe(4);
  });

  it("maskSecrets は maskSecretsWithCount の text と一致する", () => {
    const input = "key=sk-ant-DUMMYAAA1111 mail=user@example.com";
    expect(maskSecrets(input)).toBe(maskSecretsWithCount(input).text);
  });
});

describe("メールアドレスの検出", () => {
  it("通常のメールアドレス", () => {
    expect(maskSecrets("user@example.com")).toBe("***@***");
  });

  it("サブドメインを含むメールアドレス", () => {
    expect(maskSecrets("user@mail.sub.example.co.jp")).toBe("***@***");
  });

  it("ローカル部に + を含むメールアドレス", () => {
    expect(maskSecrets("user+tag@example.com")).toBe("***@***");
  });

  it("文中に複数のメールアドレスがあればすべて置換する", () => {
    const input = "from: a@example.com, to: b@example.co.jp";
    const result = maskSecretsWithCount(input);
    expect(result.text).toBe("from: ***@***, to: ***@***");
    expect(result.count).toBe(2);
  });
});

describe("SECRET_PATTERNS: 名前付き配列であること", () => {
  it("配列であり、要素数が1以上", () => {
    expect(Array.isArray(SECRET_PATTERNS)).toBe(true);
    expect(SECRET_PATTERNS.length).toBeGreaterThan(0);
  });

  it("各要素が name（文字列）と source（文字列）を持つ", () => {
    for (const pattern of SECRET_PATTERNS) {
      expect(typeof pattern.name).toBe("string");
      expect(pattern.name.length).toBeGreaterThan(0);
      expect(typeof pattern.source).toBe("string");
      expect(pattern.source.length).toBeGreaterThan(0);
    }
  });

  it("name はすべて一意", () => {
    const names = SECRET_PATTERNS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("受け入れ条件にある主要種別がすべて名前付きで含まれる", () => {
    const names = SECRET_PATTERNS.map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "anthropic-api-key",
        "generic-sk-key",
        "github-token",
        "github-pat",
        "aws-access-key-id",
        "slack-token",
        "bearer-token",
      ]),
    );
  });

  it("readonly 配列のため push できない（型レベルの検証）", () => {
    // @ts-expect-error - SECRET_PATTERNS は readonly SecretPattern[] であり push は存在しない
    SECRET_PATTERNS.push({ name: "should-not-compile", source: "x" });
  });
});

describe("maskSecrets: 汎用 sk- 系キーの各種プレフィックス形式（sk-proj- / sk-svcacct- / sk-or-v1-）", () => {
  it("sk-proj- 形式のキーがマスクされる", () => {
    const input = `key=sk-proj-DUMMY${"A".repeat(20)} end`;
    expect(maskSecrets(input)).toBe("key=sk-p•••• end");
  });

  it("sk-svcacct- 形式のキーがマスクされる", () => {
    const input = `key=sk-svcacct-DUMMY${"A".repeat(20)} end`;
    expect(maskSecrets(input)).toBe("key=sk-s•••• end");
  });

  it("sk-or-v1- 形式のキーがマスクされる", () => {
    const input = `key=sk-or-v1-DUMMY${"A".repeat(20)} end`;
    expect(maskSecrets(input)).toBe("key=sk-o•••• end");
  });

  it("配列順に依存しないこと: 汎用パターン単体では sk-ant- 形式にマッチしない（否定先読みの検証）", () => {
    const antPattern = SECRET_PATTERNS.find((p) => p.name === "anthropic-api-key");
    const genericPattern = SECRET_PATTERNS.find((p) => p.name === "generic-sk-key");
    if (!antPattern || !genericPattern) {
      throw new Error("anthropic-api-key / generic-sk-key パターンが見つからない");
    }

    const antRegex = new RegExp(antPattern.source, antPattern.flags ?? "g");
    const genericRegex = new RegExp(genericPattern.source, genericPattern.flags ?? "g");
    const input = "sk-ant-DUMMYABCDEFG1234567890";

    // sk-ant- 専用パターンは単体でマッチする
    expect(antRegex.test(input)).toBe(true);
    // 汎用パターンは配列内の並び順に頼らず、単体でも sk-ant- 形式を除外する
    expect(genericRegex.test(input)).toBe(false);
  });

  it("引き続き sk-ant- は sk-a•••• にマスクされる（回帰確認）", () => {
    const input = "key=sk-ant-DUMMYABCDEFG1234567890 end";
    expect(maskSecrets(input)).toBe("key=sk-a•••• end");
  });
});

describe("maskSecrets: Bearer の大文字小文字非依存とJSON中の保持", () => {
  it("bearer（小文字）もマスクされる", () => {
    const input = `Authorization: bearer ${"y".repeat(20)}`;
    expect(maskSecrets(input)).toBe("Authorization: bearer ••••");
  });

  it("BEARER（大文字）もマスクされる", () => {
    const input = `Authorization: BEARER ${"y".repeat(20)}`;
    expect(maskSecrets(input)).toBe("Authorization: BEARER ••••");
  });

  it("BearEr のような混在ケースもマスクされる", () => {
    const input = `Authorization: BearEr ${"y".repeat(20)}`;
    expect(maskSecrets(input)).toBe("Authorization: BearEr ••••");
  });

  it("JSON 内の Bearer トークンをマスクしても閉じ引用符と閉じ括弧が保持される", () => {
    const input = '{"Authorization":"Bearer abcdefghijklmnopqrst"}';
    const expected = '{"Authorization":"Bearer ••••"}';
    expect(maskSecrets(input)).toBe(expected);
  });
});

describe("maskSecrets: AWS AKIA/ASIA の追加境界値", () => {
  it("AKIA + 15文字は置換されない（既存境界の再確認）", () => {
    const input = `AKIA${"A".repeat(15)}`;
    expect(maskSecrets(input)).toBe(input);
  });

  it("AKIA + 17文字はマスクされ、末尾の1文字も残らない", () => {
    const input = `AKIA${"A".repeat(17)}`;
    expect(maskSecrets(input)).toBe("AKIA••••");
    expect(maskSecrets(input)).not.toContain("A".repeat(17));
  });

  it("ASIA + 16文字はマスクされる", () => {
    const input = `ASIA${"A".repeat(16)}`;
    expect(maskSecrets(input)).toBe("ASIA••••");
  });
});

describe("maskSecrets: GitHub トークンの短い識別子は無変更", () => {
  it("ghs_1 のような短い識別子はマスクされない", () => {
    const input = "id=ghs_1 end";
    expect(maskSecrets(input)).toBe(input);
  });

  it("ghp_abc のような短いトークンはマスクされない", () => {
    const input = "token=ghp_abc end";
    expect(maskSecrets(input)).toBe(input);
  });

  it("ghp_ + 20文字はマスクされる", () => {
    const input = `token=ghp_${"a".repeat(20)} end`;
    expect(maskSecrets(input)).toBe("token=ghp_•••• end");
  });
});

describe("maskSecrets: ReDoS 回帰（メール正規表現の長さ上限）", () => {
  it("巨大な疑似メール様文字列を渡しても短時間で処理を終える", () => {
    // ローカル部を極端に長く、ドメイン部を極端に多階層にした、メール形式に「見えかねない」文字列。
    // 長さ上限のない正規表現だと多項式的なバックトラッキングで極端に遅くなる形。
    const input = `${"a".repeat(120_000)}@${"b.".repeat(20_000)}`;
    const start = performance.now();
    maskSecrets(input);
    const elapsed = performance.now() - start;
    // CI の揺らぎを見込んで余裕を持たせつつ、ReDoS の指数/多項式的な遅延は確実に検出できる閾値
    expect(elapsed).toBeLessThan(500);
  });
});
