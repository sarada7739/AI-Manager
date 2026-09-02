import { describe, expect, it } from "vitest";

// T-001: プロジェクト初期化が正しく動くことを確認するダミーテスト
describe("smoke", () => {
  it("テストランナーが動く", () => {
    expect(1 + 1).toBe(2);
  });
});
