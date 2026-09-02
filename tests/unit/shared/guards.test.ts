import { describe, expect, it } from "vitest";
import {
  asNumber,
  asRecord,
  asString,
  isArray,
  isBoolean,
  isNumber,
  isRecord,
  isString,
} from "../../../src/shared/guards";

// T-002: src/shared/guards.ts の型ガードの受け入れ条件を検証する。
// 正常系・異常系（null, undefined, 配列, NaN, 空文字, 0, false, ネストしたオブジェクト）を網羅する。

describe("isRecord", () => {
  it("プレーンオブジェクトは true", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("ネストしたオブジェクトも true", () => {
    expect(isRecord({ a: { b: { c: 1 } } })).toBe(true);
  });

  it("null は false", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("undefined は false", () => {
    expect(isRecord(undefined)).toBe(false);
  });

  it("配列は false", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  it("文字列・数値・真偽値は false", () => {
    expect(isRecord("string")).toBe(false);
    expect(isRecord(0)).toBe(false);
    expect(isRecord(false)).toBe(false);
  });
});

describe("isString", () => {
  it("文字列は true", () => {
    expect(isString("hello")).toBe(true);
  });

  it("空文字は true", () => {
    expect(isString("")).toBe(true);
  });

  it("null / undefined は false", () => {
    expect(isString(null)).toBe(false);
    expect(isString(undefined)).toBe(false);
  });

  it("数値・真偽値・配列・オブジェクトは false", () => {
    expect(isString(0)).toBe(false);
    expect(isString(false)).toBe(false);
    expect(isString([])).toBe(false);
    expect(isString({})).toBe(false);
  });
});

describe("isNumber", () => {
  it("数値は true", () => {
    expect(isNumber(1)).toBe(true);
    expect(isNumber(-1.5)).toBe(true);
  });

  it("0 は true", () => {
    expect(isNumber(0)).toBe(true);
  });

  it("NaN は false（弾く）", () => {
    expect(isNumber(Number.NaN)).toBe(false);
  });

  it("null / undefined は false", () => {
    expect(isNumber(null)).toBe(false);
    expect(isNumber(undefined)).toBe(false);
  });

  it("数値の文字列は false", () => {
    expect(isNumber("1")).toBe(false);
  });

  it("配列・オブジェクトは false", () => {
    expect(isNumber([])).toBe(false);
    expect(isNumber({})).toBe(false);
  });
});

describe("isBoolean", () => {
  it("true / false はともに true", () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(false)).toBe(true);
  });

  it("null / undefined は false", () => {
    expect(isBoolean(null)).toBe(false);
    expect(isBoolean(undefined)).toBe(false);
  });

  it("0 / 1 / 空文字は false", () => {
    expect(isBoolean(0)).toBe(false);
    expect(isBoolean(1)).toBe(false);
    expect(isBoolean("")).toBe(false);
  });
});

describe("isArray", () => {
  it("配列は true", () => {
    expect(isArray([])).toBe(true);
    expect(isArray([1, "a", null])).toBe(true);
  });

  it("null / undefined は false", () => {
    expect(isArray(null)).toBe(false);
    expect(isArray(undefined)).toBe(false);
  });

  it("プレーンオブジェクトは false", () => {
    expect(isArray({})).toBe(false);
    expect(isArray({ length: 0 })).toBe(false);
  });

  it("文字列は false（配列風でも false）", () => {
    expect(isArray("abc")).toBe(false);
  });
});

describe("asString", () => {
  it("キーの値が文字列ならその値を返す", () => {
    expect(asString({ name: "太郎" }, "name")).toBe("太郎");
  });

  it("空文字でもその値を返す", () => {
    expect(asString({ name: "" }, "name")).toBe("");
  });

  it("キーが存在しない場合は undefined", () => {
    expect(asString({ other: "x" }, "name")).toBeUndefined();
  });

  it("値の型が違う場合は undefined", () => {
    expect(asString({ name: 123 }, "name")).toBeUndefined();
    expect(asString({ name: null }, "name")).toBeUndefined();
    expect(asString({ name: false }, "name")).toBeUndefined();
    expect(asString({ name: ["a"] }, "name")).toBeUndefined();
  });

  it("obj 自体が null / undefined / 配列 / プリミティブなら undefined", () => {
    expect(asString(null, "name")).toBeUndefined();
    expect(asString(undefined, "name")).toBeUndefined();
    expect(asString([], "name")).toBeUndefined();
    expect(asString("plain string", "name")).toBeUndefined();
  });

  it("ネストしたオブジェクトの深い階層は見ない（1 階層のみ）", () => {
    expect(asString({ nested: { name: "太郎" } }, "name")).toBeUndefined();
  });
});

describe("asNumber", () => {
  it("キーの値が数値ならその値を返す", () => {
    expect(asNumber({ age: 20 }, "age")).toBe(20);
  });

  it("0 でもその値を返す", () => {
    expect(asNumber({ age: 0 }, "age")).toBe(0);
  });

  it("NaN の場合は undefined", () => {
    expect(asNumber({ age: Number.NaN }, "age")).toBeUndefined();
  });

  it("キーが存在しない場合は undefined", () => {
    expect(asNumber({ other: 1 }, "age")).toBeUndefined();
  });

  it("値の型が違う場合は undefined", () => {
    expect(asNumber({ age: "20" }, "age")).toBeUndefined();
    expect(asNumber({ age: null }, "age")).toBeUndefined();
    expect(asNumber({ age: true }, "age")).toBeUndefined();
  });

  it("obj 自体が null / undefined / 配列なら undefined", () => {
    expect(asNumber(null, "age")).toBeUndefined();
    expect(asNumber(undefined, "age")).toBeUndefined();
    expect(asNumber([1, 2], "age")).toBeUndefined();
  });
});

describe("asRecord", () => {
  it("キーの値がオブジェクトならその値を返す", () => {
    const value = asRecord({ meta: { a: 1 } }, "meta");
    expect(value).toEqual({ a: 1 });
  });

  it("ネストしたオブジェクトを持つオブジェクトでも 1 階層だけ返す", () => {
    const value = asRecord({ meta: { a: { b: 2 } } }, "meta");
    expect(value).toEqual({ a: { b: 2 } });
  });

  it("キーが存在しない場合は undefined", () => {
    expect(asRecord({ other: {} }, "meta")).toBeUndefined();
  });

  it("値の型が違う場合は undefined（配列・文字列・null・数値）", () => {
    expect(asRecord({ meta: [] }, "meta")).toBeUndefined();
    expect(asRecord({ meta: "x" }, "meta")).toBeUndefined();
    expect(asRecord({ meta: null }, "meta")).toBeUndefined();
    expect(asRecord({ meta: 0 }, "meta")).toBeUndefined();
  });

  it("obj 自体が null / undefined / 配列なら undefined", () => {
    expect(asRecord(null, "meta")).toBeUndefined();
    expect(asRecord(undefined, "meta")).toBeUndefined();
    expect(asRecord([], "meta")).toBeUndefined();
  });
});
