import { FC, useLayoutEffect, useRef, useState } from "react";
import { DialogButton, Focusable, findSP, quickAccessMenuClasses } from "@decky/ui";
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

type BrowserView = { SetBounds: (x: number, y: number, width: number, height: number) => void };

/** Steam's placeholder for the Quick Access menu in its main window, plus the browser view it sizes. */
function findQamView(): { placeholder: HTMLElement; browser: BrowserView } | null {
  const doc = findSP()?.document;
  const cls = quickAccessMenuClasses?.ViewPlaceholder;
  if (!doc || !cls) return null;
  for (const el of Array.from(doc.getElementsByClassName(cls)) as HTMLElement[]) {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
    let fiber = key ? (el as any)[key] : null;
    for (let i = 0; fiber && i < 10; i++, fiber = fiber.return) {
      const browser = fiber.memoizedProps?.browser;
      if (typeof browser?.SetBounds === "function") return { placeholder: el, browser };
    }
  }
  return null;
}

/**
 * Widens the Quick Access menu while Session Notes is on screen. On the Deck the menu is its own browser
 * view, sized from a 348px placeholder in Steam's main window (that's how Steam itself sizes it), so we
 * widen that placeholder, push the new bounds to the view, and lift the 300px cap inside the menu.
 * Everything is put back when the panel is hidden or closed.
 */
function useWidePanel(width: number | null) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!width || !root) return;
    let undo: (() => void) | null = null;

    const widen = () => {
      if (undo) return true;
      const view = findQamView();
      if (!view) return false;
      const { placeholder, browser } = view;
      const sp = placeholder.ownerDocument.defaultView ?? window;
      const prevWidth = placeholder.style.width;
      const setBounds = () => {
        const r = placeholder.getBoundingClientRect();
        browser.SetBounds(r.left, r.top, r.width, r.height);
      };
      placeholder.style.setProperty("width", `${Math.round(Math.min(width, sp.innerWidth * 0.85))}px`, "important");
      setBounds();

      const capped: { el: HTMLElement; maxWidth: string }[] = [];
      const qamWin = root.ownerDocument.defaultView ?? window;
      for (let el = root.parentElement; el && el !== root.ownerDocument.body; el = el.parentElement) {
        if (qamWin.getComputedStyle(el).maxWidth === "none") continue;
        capped.push({ el, maxWidth: el.style.maxWidth });
        el.style.setProperty("max-width", "none", "important");
      }

      undo = () => {
        placeholder.style.width = prevWidth;
        setBounds();
        for (const c of capped) c.el.style.maxWidth = c.maxWidth;
        undo = null;
      };
      return true;
    };

    // The menu can still be laying out when we mount; try again for a second or so.
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      if (!widen() && tries++ < 60) frame = requestAnimationFrame(attempt);
    };

    // Only stay wide while our panel is actually showing (not when another Quick Access tab is open).
    const Observer = (root.ownerDocument.defaultView ?? window).IntersectionObserver ?? IntersectionObserver;
    const observer = new Observer((entries) => {
      const shown = entries[entries.length - 1]?.isIntersecting;
      cancelAnimationFrame(frame);
      if (shown) {
        tries = 0;
        attempt();
      } else {
        undo?.();
      }
    });
    observer.observe(root);
    attempt();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      undo?.();
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
