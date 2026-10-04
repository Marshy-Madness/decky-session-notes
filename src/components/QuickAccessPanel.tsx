import { FC, useState } from "react";
import { DialogButton, Focusable, quickAccessMenuClasses } from "@decky/ui";
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
 * Widens the Quick Access menu. The <style> lives inside our panel, so it only
 * applies while Session Notes is the open tab and disappears when you switch away.
 */
const WidePanelStyle: FC<{ width: number | null }> = ({ width }) => {
  if (!width) return null;
  const q = quickAccessMenuClasses;
  return (
    <style>{`
      .${q.Container} { width: ${width}px !important; max-width: 92vw !important; }
      .${q.TabContentColumn} { flex: 1 1 auto !important; width: auto !important; max-width: none !important; }
    `}</style>
  );
};

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
      flex: grow ? 1 : "0 0 auto",
      minWidth: 0,
      padding: "6px 14px",
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

  const setTab = (t: Tab) => {
    lastTab = t;
    setTabState(t);
  };
  const setOpenGame = (id: string | null) => {
    lastOpenedGame = id;
    setOpenGameState(id);
  };

  return (
    <div style={{ padding: "0 12px 16px" }}>
      <WidePanelStyle width={WIDTHS[settings.panelWidth ?? "extra"]} />

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
