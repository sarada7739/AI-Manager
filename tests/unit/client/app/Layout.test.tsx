// T-020 受け入れ条件:
// 「レイアウトは ヘッダ帯 → 指示入力 → アカウント帯 → フィルタバー → 本体 の縦積み。各領域はスロット」
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Layout } from "../../../../src/client/app/Layout.js";

afterEach(cleanup);

describe("Layout", () => {
  it("5 つのスロットがこの順（header, compose, accounts, filters, main）で並び、渡した ReactNode が各領域に描画される", () => {
    const { container } = render(
      <Layout
        header={<span>ヘッダの中身</span>}
        compose={<span>指示入力の中身</span>}
        accounts={<span>アカウントの中身</span>}
        filters={<span>絞り込みの中身</span>}
        main={<span>本体の中身</span>}
      />,
    );

    const slots = Array.from(container.querySelectorAll<HTMLElement>("[data-slot]"));
    const slotNames = slots.map((el) => el.dataset.slot);
    expect(slotNames).toEqual(["header", "compose", "accounts", "filters", "main"]);

    expect(slots[0]).toHaveTextContent("ヘッダの中身");
    expect(slots[1]).toHaveTextContent("指示入力の中身");
    expect(slots[2]).toHaveTextContent("アカウントの中身");
    expect(slots[3]).toHaveTextContent("絞り込みの中身");
    expect(slots[4]).toHaveTextContent("本体の中身");
  });

  it("header は <header> 要素、compose/accounts/filters は <section> 要素、main は <main> 要素になる", () => {
    const { container } = render(
      <Layout header={null} compose={null} accounts={null} filters={null} main={null} />,
    );

    expect(container.querySelector('header[data-slot="header"]')).not.toBeNull();
    expect(container.querySelector('section[data-slot="compose"]')).not.toBeNull();
    expect(container.querySelector('section[data-slot="accounts"]')).not.toBeNull();
    expect(container.querySelector('section[data-slot="filters"]')).not.toBeNull();
    expect(container.querySelector('main[data-slot="main"]')).not.toBeNull();
  });

  it("compose/accounts/filters には aria-label（指示入力・アカウント・絞り込み）が付く", () => {
    const { container } = render(
      <Layout header={null} compose={null} accounts={null} filters={null} main={null} />,
    );

    expect(container.querySelector('[data-slot="compose"]')).toHaveAttribute(
      "aria-label",
      "指示入力",
    );
    expect(container.querySelector('[data-slot="accounts"]')).toHaveAttribute(
      "aria-label",
      "アカウント",
    );
    expect(container.querySelector('[data-slot="filters"]')).toHaveAttribute(
      "aria-label",
      "絞り込み",
    );
  });

  it("空（null）のスロットでも 5 つの領域要素はすべて存在する", () => {
    const { container } = render(
      <Layout header={null} compose={null} accounts={null} filters={null} main={null} />,
    );

    const slots = container.querySelectorAll("[data-slot]");
    expect(slots).toHaveLength(5);
  });
});
