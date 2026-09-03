// アプリのルートコンポーネント。ページ骨格を組み立て、起動時の読み込み・URL 同期・自動更新を行い、
// 各 feature をスロットに差し込む（T-020 / T-025）。
import { type ReactNode, useEffect } from "react";
import { EmptyState, ErrorBanner, Loading } from "../components/index.js";
import { AccountStrip } from "../features/accounts/index.js";
import { BoardView } from "../features/board/index.js";
import { ComposeBox } from "../features/compose/index.js";
import { FilterBar } from "../features/filters/index.js";
import { ListView } from "../features/list/index.js";
import { LiveStatus, useAutoRefresh } from "../features/refresh/index.js";
import { DetailPanel } from "../features/session-detail/index.js";
import { selectCounts } from "../store/selectors.js";
import { startUrlSync } from "../store/url-sync.js";
import { useSessionStore } from "../store/useSessionStore.js";
import styles from "./App.module.css";
import { Header } from "./Header.js";
import { Layout } from "./Layout.js";

export function App() {
  const load = useSessionStore((state) => state.load);
  const sessions = useSessionStore((state) => state.sessions);
  const loading = useSessionStore((state) => state.status.loading);
  const error = useSessionStore((state) => state.status.error);
  const view = useSessionStore((state) => state.view);

  // 起動時に一覧を読み込む。
  useEffect(() => {
    void load();
  }, [load]);

  // 起動時に URL クエリと view / groupBy / filters の同期を開始する。アンマウント時に解除する。
  useEffect(() => {
    const unsubscribe = startUrlSync(useSessionStore);
    return unsubscribe;
  }, []);

  // SSE 購読 + ポーリングフォールバックによる自動更新（F-9 / T-025）。
  useAutoRefresh();

  // タイトルバーに稼働数を表示する。sessions が変わるたびに再計算する。
  useEffect(() => {
    const running = selectCounts({ ...useSessionStore.getState(), sessions }).running;
    document.title = `AI-Manager · ${running} 稼働`;
  }, [sessions]);

  const isInitialLoading = sessions.length === 0 && loading;
  // 読み取り失敗時は ErrorBanner が次の行動を示すので、誤誘導になる空状態は出さない
  const isEmpty = sessions.length === 0 && !loading && error === null;

  let body: ReactNode;
  if (isInitialLoading) {
    body = <Loading />;
  } else if (isEmpty) {
    body = (
      <EmptyState
        message="セッションがありません"
        action="Claude Code か Codex を一度起動してから「更新」を押してください"
      />
    );
  } else {
    body = (
      <div className={styles.body}>
        <div className={styles.view}>{view === "board" ? <BoardView /> : <ListView />}</div>
        <DetailPanel />
      </div>
    );
  }

  return (
    <Layout
      header={<Header extra={<LiveStatus />} />}
      compose={<ComposeBox />}
      accounts={<AccountStrip />}
      filters={<FilterBar />}
      main={
        <>
          {error ? <ErrorBanner message={error.message} hint={error.hint} /> : null}
          {body}
        </>
      }
    />
  );
}
