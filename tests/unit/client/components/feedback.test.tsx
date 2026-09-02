// T-017: EmptyState / Loading / ErrorBanner の受け入れ条件を検証する。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "../../../../src/client/components/EmptyState.js";
import { ErrorBanner } from "../../../../src/client/components/ErrorBanner.js";
import { Loading } from "../../../../src/client/components/Loading.js";

// vitest.config.ts は globals: true を設定していないため自動 cleanup が働かない。明示的に行う。
afterEach(cleanup);

describe("EmptyState", () => {
  it("message のみを渡すと message が表示され action は表示されない", () => {
    render(<EmptyState message="このグループにセッションはありません" />);
    expect(screen.getByText("このグループにセッションはありません")).toBeInTheDocument();
  });

  it("message + action を渡すと両方表示される", () => {
    render(
      <EmptyState message="条件に合うセッションがありません" action="絞り込みを解除してください" />,
    );
    expect(screen.getByText("条件に合うセッションがありません")).toBeInTheDocument();
    expect(screen.getByText("絞り込みを解除してください")).toBeInTheDocument();
  });

  it("空文字の message でも例外なく描画される", () => {
    expect(() => render(<EmptyState message="" />)).not.toThrow();
  });
});

describe("Loading", () => {
  it("既定では 3 行のスケルトンを role=status の子要素として描画する", () => {
    render(<Loading />);
    const status = screen.getByRole("status");
    expect(status.children.length).toBe(3);
  });

  it("rows=5 を渡すと 5 行描画する", () => {
    render(<Loading rows={5} />);
    const status = screen.getByRole("status");
    expect(status.children.length).toBe(5);
  });

  it("rows=0 でも例外にならず 0 行になる", () => {
    expect(() => render(<Loading rows={0} />)).not.toThrow();
    const status = screen.getByRole("status");
    expect(status.children.length).toBe(0);
  });

  it("label 省略時は既定の aria-label『読み込み中』になる", () => {
    render(<Loading />);
    expect(screen.getByRole("status", { name: "読み込み中" })).toBeInTheDocument();
  });

  it("label を渡すと aria-label が上書きされる", () => {
    render(<Loading label="更新中" />);
    expect(screen.getByRole("status", { name: "更新中" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "読み込み中" })).not.toBeInTheDocument();
  });
});

describe("ErrorBanner", () => {
  it("role=alert で描画される", () => {
    render(
      <ErrorBanner
        message="セッションログを読めませんでした"
        hint="Claude Code を一度起動してから「更新」を押してください。"
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("message と hint の両方が表示される", () => {
    render(
      <ErrorBanner
        message="セッションログを読めませんでした"
        hint="Claude Code を一度起動してから「更新」を押してください。"
      />,
    );
    expect(screen.getByText("セッションログを読めませんでした")).toBeInTheDocument();
    expect(
      screen.getByText("Claude Code を一度起動してから「更新」を押してください。"),
    ).toBeInTheDocument();
  });

  it("空文字の message / hint でも例外なく描画される", () => {
    expect(() => render(<ErrorBanner message="" hint="" />)).not.toThrow();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
