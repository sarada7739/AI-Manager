// 更新ボタン。クリックでサーバに再走査を要求してから一覧を再取得する（T-020）。
import { Button } from "../../components/index.js";
import { useSessionStore } from "../../store/useSessionStore.js";

/** ghost ボタン「更新」。読み込み中は無効化する（理由の表示は無し。DESIGN.md §6.6）。 */
export function RefreshButton() {
  const loading = useSessionStore((state) => state.status.loading);
  const refresh = useSessionStore((state) => state.refresh);

  return (
    <Button variant="ghost" disabled={loading} onClick={() => void refresh()}>
      更新
    </Button>
  );
}
