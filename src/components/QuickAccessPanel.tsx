import { FC, useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FaCog, FaExpand, FaGamepad, FaStore, FaThList } from "react-icons/fa";
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

const TabButton: FC<{ active: boolean; onClick: () => void; children: React.ReactNode; grow?: boolean; label?: string }> = ({
  active,
  onClick,
  children,
  grow = true,
  label,
}) => (
  <DialogButton
    onClick={onClick}
    aria-label={label}
    style={{
      // Every box property is pinned so Steam/theme DialogButton rules can't stagger the row.
      flex: grow ? "1 1 0" : "0 0 44px",
      width: grow ? "auto" : "44px",
      minWidth: grow ? 0 : "44px",
      height: "40px",
      minHeight: "40px",
      margin: 0,
      alignSelf: "stretch",
      padding: grow ? "0 8px" : 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      fontWeight: active ? "bold" : undefined,
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
      <Focusable
        flow-children="row"
        style={{ display: "flex", flexWrap: "nowrap", alignItems: "stretch", gap: "6px", marginBottom: "14px", width: "100%" }}
      >
        <TabButton active={tab === "current"} onClick={() => setTab("current")}>
          {fullScreen ? <><FaGamepad /> This game</> : "Current"}
        </TabButton>
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          {fullScreen ? <><FaThList /> All games</> : "All"}
        </TabButton>
        <TabButton active={tab === "bookstore"} onClick={() => setTab("bookstore")} grow={fullScreen} label="Bookstore">
          <FaStore /> {fullScreen && "Bookstore"}
        </TabButton>
        <TabButton active={tab === "settings"} onClick={() => setTab("settings")} grow={fullScreen} label="Settings">
          <FaCog /> {fullScreen && "Settings"}
        </TabButton>
        {!fullScreen && (
          <TabButton active={false} onClick={openNotesPage} grow={false} label="Open full screen">
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
            No game is running. Launch one to take notes for it, or check <b>{fullScreen ? "All games" : "All"}</b>.
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
