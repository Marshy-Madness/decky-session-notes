import { FC, useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FaCog, FaExpand, FaStore } from "react-icons/fa";
import { openNotesPage } from "../opening";
import { useRunningGame } from "../hooks/useAppLifetime";
import { NotesProvider } from "../state/NotesProvider";
import { NoteList } from "./NoteList";
import { Library } from "./Library";
import { SettingsView } from "./SettingsView";
import { BookstoreView } from "./Bookstore";

type Tab = "current" | "all" | "bookstore" | "settings";

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

// Fits Steam's normal Quick Access width; for more room, use the full-screen page.
export const QuickAccessPanel: FC = () => {
  return (
    <div style={{ padding: "0 12px 16px", maxWidth: "100%", overflowX: "hidden", boxSizing: "border-box" }}>
      <NotesBrowser />
    </div>
  );
};

/** The tabs and their contents; shared by the Quick Access panel and the full-screen page. */
export const NotesBrowser: FC<{ fullScreen?: boolean }> = ({ fullScreen = false }) => {
  const running = useRunningGame();
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
    <>
      <Focusable style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
        <TabButton active={tab === "current"} onClick={() => setTab("current")}>
          Current
        </TabButton>
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          All
        </TabButton>
        <TabButton active={tab === "bookstore"} onClick={() => setTab("bookstore")} grow={false}>
          <FaStore />
        </TabButton>
        <TabButton active={tab === "settings"} onClick={() => setTab("settings")} grow={false}>
          <FaCog />
        </TabButton>
        {!fullScreen && (
          <TabButton active={false} onClick={openNotesPage} grow={false}>
            <FaExpand />
          </TabButton>
        )}
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
    </>
  );
};
