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

/** ヘッダ帯だけ sticky にする（絞り込み帯の sticky は T-021 に任せる）。 */
export function Layout({ header, compose, accounts, filters, main }: LayoutProps) {
  return (
    <div className={styles.layout}>
      <header className={styles.header} data-slot="header">
        {header}
      </header>
      <section className={styles.compose} aria-label="指示入力" data-slot="compose">
        {compose}
      </section>
      <section className={styles.accounts} aria-label="アカウント" data-slot="accounts">
        {accounts}
      </section>
      <section className={styles.filters} aria-label="絞り込み" data-slot="filters">
        {filters}
      </section>
      <main className={styles.main} data-slot="main">
        {main}
      </main>
    </div>
  );
}
