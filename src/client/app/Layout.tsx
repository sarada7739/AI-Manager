// ページ骨格。ヘッダ帯 → 指示入力 → アカウント帯 → フィルタバー → 本体を縦積みにする（T-020）。
// 各領域は feature コンポーネントを差し込むスロット（ReactNode）にし、data-slot をテスト用に付ける。
import type { ReactNode } from "react";
import styles from "./Layout.module.css";

export interface LayoutProps {
  header: ReactNode;
  compose: ReactNode;
  accounts: ReactNode;
  filters: ReactNode;
  main: ReactNode;
}

/** ヘッダ帯は sticky にせず、絞り込み帯（フィルタバー）側の sticky を活かす（T-025）。 */
export function Layout({ header, compose, accounts, filters, main }: LayoutProps) {
  return (
    <div className={styles.layout}>
      <header data-slot="header">{header}</header>
      <section className={styles.compose} aria-label="指示入力" data-slot="compose">
        {compose}
      </section>
      <section className={styles.accounts} aria-label="アカウント" data-slot="accounts">
        {accounts}
      </section>
      <section aria-label="絞り込み" data-slot="filters">
        {filters}
      </section>
      <main className={styles.main} data-slot="main">
        {main}
      </main>
    </div>
  );
}
