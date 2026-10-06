import { CSSProperties, FC, useEffect, useState } from "react";
import { afterPatch, appDetailsClasses, createReactTreePatcher, DialogButton, ErrorBoundary, findInReactTree, Focusable, useParams } from "@decky/ui";
import type { DeskScrollApi } from "../../src/scrolls/api";
import type { TomeProps } from "../../src/tomes/registry";
import type { SteamNewsItem, WorkshopSummary } from "../../src/types";

// 📰 Game News: Steam's news for a game (plus new Workshop books for it) on its library page and as a Tome.

interface NewsSettings {
  /** The section on library pages. On unless turned off. */
  libraryPage?: boolean;
  /** New Workshop books next to the news. On unless turned off. */
  workshop?: boolean;
  /** How many news posts to show; unset = 3. */
  count?: number;
  /** App IDs the library section is hidden for. */
  hidden?: string[];
}

const SECTION_KEY = "desk-of-madness-game-news";
const WORKSHOP_DAYS = 30;

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString();
}

export default function activate(desk: DeskScrollApi) {
  const settings = () => desk.settings.get<NewsSettings>();
  const useNewsSettings = () => desk.settings.use<NewsSettings>();

  /** News and fresh Workshop books for a game. */
  function useNews(appId: string | undefined) {
    const s = useNewsSettings();
    const count = s.count ?? 3;
    const [news, setNews] = useState<SteamNewsItem[] | null>(null);
    const [books, setBooks] = useState<WorkshopSummary[]>([]);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
      if (!appId) return;
      let live = true;
      setNews(null);
      setError(null);
      desk
        .steamNews(appId, count)
        .then((n) => live && setNews(n))
        .catch((e) => live && (setError(String(e?.message ?? e)), setNews([])));
      if (s.workshop !== false) {
        desk
          .workshopEntries({ appId, sort: "new" })
          .then((list) => live && setBooks(list.filter((e) => e.createdAt > Date.now() - WORKSHOP_DAYS * 86400_000).slice(0, 2)))
          .catch(() => live && setBooks([]));
      } else setBooks([]);
      return () => {
        live = false;
      };
    }, [appId, count, s.workshop]);
    return { news, books, error };
  }

  const NewsRow: FC<{ item: SteamNewsItem; big?: boolean }> = ({ item, big }) => (
    <Focusable
      style={{ display: "flex", gap: "12px", padding: "8px", borderRadius: "4px", background: "rgba(255,255,255,0.04)", marginBottom: "6px" }}
      onActivate={() => desk.openUrl(item.url)}
      onClick={() => desk.openUrl(item.url)}
      onOKActionDescription="Read"
    >
      {big && item.image && (
        <img src={item.image} style={{ width: "128px", height: "60px", objectFit: "cover", borderRadius: "3px", flex: "0 0 auto" }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: big ? "15px" : "14px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.official ? "🛠 " : ""}
          {item.title}
        </div>
        <div style={{ fontSize: "12px", opacity: 0.6 }}>
          {ago(item.date)}
          {item.feed ? ` · ${item.feed}` : ""}
        </div>
        {big && item.summary && (
          <div style={{ fontSize: "13px", opacity: 0.8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as CSSProperties}>
            {item.summary}
          </div>
        )}
      </div>
    </Focusable>
  );

  const BookRow: FC<{ book: WorkshopSummary; appId: string }> = ({ book, appId }) => (
    <Focusable
      style={{ display: "flex", gap: "10px", padding: "8px", borderRadius: "4px", background: "rgba(255,200,44,0.07)", marginBottom: "6px" }}
      onActivate={() => desk.openWorkshopEntry(book.id, appId)}
      onClick={() => desk.openWorkshopEntry(book.id, appId)}
      onOKActionDescription="Read"
    >
      <span>🏭</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{book.title}</div>
        <div style={{ fontSize: "12px", opacity: 0.6 }}>
          New on the Madness Workshop · by {book.author.name} · {ago(book.createdAt)}
        </div>
      </div>
    </Focusable>
  );

  // ---- the library page section ----

  const LibrarySection: FC = () => {
    const { appid } = useParams<{ appid: string }>() ?? ({} as { appid?: string });
    const s = useNewsSettings();
    const hidden = !appid || s.libraryPage === false || (s.hidden ?? []).includes(appid);
    const { news, books, error } = useNews(hidden ? undefined : appid);
    if (hidden || (news && !news.length && !books.length && !error)) return null;
    const hide = () => desk.settings.set<NewsSettings>({ hidden: [...(settings().hidden ?? []), appid!] });
    return (
      <div style={{ margin: "12px 2.8vw", padding: "12px 16px", borderRadius: "6px", background: "rgba(14, 20, 27, 0.72)" }}>
        <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <div style={{ flex: 1, fontSize: "16px", fontWeight: "bold", letterSpacing: "0.04em", textTransform: "uppercase" }}>📰 News</div>
          <DialogButton style={{ width: "auto", minWidth: 0, padding: "4px 12px", fontSize: "12px", height: "28px", margin: 0 }} onClick={hide}>
            Hide for this game
          </DialogButton>
        </Focusable>
        {!news && <div style={{ fontSize: "13px", opacity: 0.6 }}>Loading news…</div>}
        {error && <div style={{ fontSize: "13px", opacity: 0.6 }}>⚠️ {error}</div>}
        {books.map((b) => (
          <BookRow key={b.id} book={b} appId={appid!} />
        ))}
        {news?.map((n) => (
          <NewsRow key={n.id} item={n} big />
        ))}
      </div>
    );
  };

  // The same route patch Decky plugins use to add to the library page (e.g. ProtonDB Badges): find the page's
  // inner container as it renders and put the section right after the Play/Install bar.
  desk.patchRoute("/library/app/:appid", (tree: any) => {
    const routeProps = findInReactTree(tree, (x: any) => x?.renderFunc);
    if (routeProps) {
      const handler = createReactTreePatcher(
        [(t: any) => findInReactTree(t, (x: any) => x?.props?.children?.props?.overview)?.props?.children],
        (_: unknown, ret: any) => {
          const container = findInReactTree(
            ret,
            (x: any) => Array.isArray(x?.props?.children) && x?.props?.className?.includes(appDetailsClasses.InnerContainer)
          );
          if (typeof container !== "object") return ret;
          if (!container.props.children.some((c: any) => c?.key === SECTION_KEY)) {
            container.props.children.splice(
              1,
              0,
              <ErrorBoundary key={SECTION_KEY}>
                <LibrarySection />
              </ErrorBoundary>
            );
          }
          return ret;
        }
      );
      afterPatch(routeProps, "renderFunc", handler);
    }
    return tree;
  });

  // ---- the Tome ----

  const NewsTome: FC<TomeProps> = ({ game }) => {
    const { news, books, error } = useNews(game?.appId);
    const { Hint } = desk.bits;
    if (!game) return null;
    return (
      <>
        {error && <Hint>⚠️ {error}</Hint>}
        {!news && !error && <Hint>Loading…</Hint>}
        {news?.length === 0 && !books.length && !error && <Hint>No news for {game.name}.</Hint>}
        {books.map((b) => (
          <BookRow key={b.id} book={b} appId={game.appId} />
        ))}
        {news?.map((n) => (
          <NewsRow key={n.id} item={n} />
        ))}
      </>
    );
  };
  desk.registerTome({
    id: "news",
    name: "Game News",
    icon: "📰",
    category: "gaming",
    description: "The game's latest Steam news and patch notes, and new Workshop books.",
    defaultOn: true,
    needsGame: true,
    component: NewsTome,
  });

  // ---- ⚙ Settings ----

  const SettingsPage: FC<{ closeModal?: () => void }> = ({ closeModal }) => {
    const { ModalRoot, ToggleField, Dropdown } = desk.ui;
    const s = useNewsSettings();
    const set = (patch: NewsSettings) => desk.settings.set<NewsSettings>(patch);
    const hidden = s.hidden ?? [];
    return (
      <ModalRoot onCancel={closeModal} closeModal={closeModal}>
        <h2 style={{ marginTop: 0 }}>📰 Game News</h2>
        <ToggleField
          label="News on library pages"
          description="A News section under Play/Install on each game's page."
          checked={s.libraryPage !== false}
          onChange={(v) => set({ libraryPage: v })}
        />
        <ToggleField
          label="New Workshop books"
          description={`Madness Workshop books for the game from the last ${WORKSHOP_DAYS} days, next to the news.`}
          checked={s.workshop !== false}
          onChange={(v) => set({ workshop: v })}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "10px 0" }}>
          <div style={{ flex: 1 }}>News posts to show</div>
          <div style={{ minWidth: "120px" }}>
            <Dropdown
              rgOptions={[2, 3, 5, 8].map((n) => ({ label: String(n), data: n }))}
              selectedOption={s.count ?? 3}
              onChange={(o: { data: number }) => set({ count: o.data })}
            />
          </div>
        </div>
        <div style={{ fontSize: "13px", opacity: 0.75, margin: "8px 0 4px" }}>
          Hidden for {hidden.length} {hidden.length === 1 ? "game" : "games"}
        </div>
        <Focusable flow-children="row" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {hidden.length > 0 && (
            <DialogButton style={{ width: "auto" }} onClick={() => set({ hidden: [] })}>
              Show it for every game again
            </DialogButton>
          )}
          <DialogButton style={{ width: "auto" }} onClick={() => closeModal?.()}>
            Close
          </DialogButton>
        </Focusable>
      </ModalRoot>
    );
  };
  desk.setSettingsPage(SettingsPage);
}
