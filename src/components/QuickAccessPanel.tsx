import { FC, useLayoutEffect, useRef, useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FaCog } from "react-icons/fa";
import { useRunningGame } from "../hooks/useAppLifetime";
import { NotesProvider } from "../state/NotesProvider";
import { useSettings } from "../state/notesStore";
import { PanelWidth } from "../types";
import { NoteList } from "./NoteList";
import { Library } from "./Library";
import { SettingsView } from "./SettingsView";
import { BookstoreView } from "./Bookstore";

type Tab = "current" | "all" | "bookstore" | "settings";

const WIDTHS: Record<PanelWidth, number | null> = { normal: null, wide: 620, extra: 860 };

/**
 * Widens the Quick Access menu while Session Notes is open. Steam's class names change between client
 * versions, so instead of CSS we walk up from our own panel and widen every ancestor up to the menu's
 * outer frame (the first one that's nearly full-screen stops the walk). Everything is put back on close.
 */
function useWidePanel(width: number | null) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!width || !root) return;
    const touched: { el: HTMLElement; width: string; maxWidth: string; minWidth: string }[] = [];
    const widen = () => {
      const win = root.ownerDocument.defaultView ?? window;
      const target = Math.min(width, win.innerWidth * 0.92);
      const contentWidth = root.parentElement?.getBoundingClientRect().width ?? 0;
      if (!contentWidth) return false; // not laid out yet
      if (contentWidth >= target) return true;
      const extra = target - contentWidth;
      for (let el = root.parentElement; el && el !== root.ownerDocument.body; el = el.parentElement) {
        const w = el.getBoundingClientRect().width;
        if (w >= win.innerWidth * 0.9) break;
        if (w < contentWidth - 1) continue;
        touched.push({ el, width: el.style.width, maxWidth: el.style.maxWidth, minWidth: el.style.minWidth });
        el.style.setProperty("width", `${w + extra}px`, "important");
        el.style.setProperty("max-width", "none", "important");
        el.style.setProperty("min-width", `${w + extra}px`, "important");
      }
      return true;
    };
    // The menu can still be hidden when we mount; try again for a second or so.
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      if (!widen() && tries++ < 60) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => {
      cancelAnimationFrame(frame);
      for (const t of touched) {
        t.el.style.width = t.width;
        t.el.style.maxWidth = t.maxWidth;
        t.el.style.minWidth = t.minWidth;
      }
    };
  }, [width]);
  return ref;
}

// Remember where you were between QAM opens.
let lastTab: Tab | null = null;
let lastOpenedGame: string | null = null;

const TabButton: FC<{ active: boolean; onClick: () => void; children: React.ReactNode; grow?: boolean }> = ({
  active,
  onClick,
  children,
  grow = true,
}) => (
  <DialogButton
    onClick={onClick}
    style={{
      flex: grow ? "1 1 0" : "0 0 40px",
      width: grow ? "auto" : "40px",
      minWidth: grow ? 0 : "40px",
      padding: grow ? "6px 4px" : "6px 0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      whiteSpace: "nowrap",
      background: active ? "#1a9fff" : undefined,
      color: active ? "white" : undefined,
    }}
  >
    {children}
  </DialogButton>
);

export const QuickAccessPanel: FC = () => {
  const running = useRunningGame();
  const settings = useSettings();
  const [tab, setTabState] = useState<Tab>(lastTab ?? (running ? "current" : "all"));
  const [openGame, setOpenGameState] = useState<string | null>(lastOpenedGame);

  const panelRef = useWidePanel(WIDTHS[settings.panelWidth ?? "extra"]);

  const setTab = (t: Tab) => {
    lastTab = t;
    setTabState(t);
  };
  const setOpenGame = (id: string | null) => {
    lastOpenedGame = id;
    setOpenGameState(id);
  };

  return (
    <div ref={panelRef} style={{ padding: "0 12px 16px" }}>

      <Focusable style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
        <TabButton active={tab === "current"} onClick={() => setTab("current")}>
          Current
        </TabButton>
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          All
        </TabButton>
        <TabButton active={tab === "bookstore"} onClick={() => setTab("bookstore")}>
          Bookstore
        </TabButton>
        <TabButton active={tab === "settings"} onClick={() => setTab("settings")} grow={false}>
          <FaCog />
        </TabButton>
      </Focusable>

      {tab === "current" &&
        (running ? (
          <NotesProvider key={running.appId} appId={running.appId}>
            <NoteList live />
          </NotesProvider>
        ) : (
          <div style={{ opacity: 0.8, padding: "8px 0" }}>
            No game is running. Launch one to take notes for it, or check the <b>All</b> tab.
          </div>
        ))}

      {tab === "all" &&
        (openGame ? (
          <NotesProvider key={openGame} appId={openGame}>
            <NoteList live={openGame === running?.appId} onBack={() => setOpenGame(null)} />
          </NotesProvider>
        ) : (
          <Library onOpen={setOpenGame} runningAppId={running?.appId} />
        ))}

      {tab === "bookstore" && <BookstoreView />}
      {tab === "settings" && <SettingsView />}
    </div>
  );
};
