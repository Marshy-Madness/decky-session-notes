import { FC, useEffect, useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FaBookOpen, FaCog, FaExpand, FaStore, FaThList } from "react-icons/fa";
import { openNotesPage } from "../opening";
import { useRunningGame } from "../hooks/useAppLifetime";
import { NotesProvider } from "../state/NotesProvider";
import { Library } from "./Library";
import { NoteList } from "./NoteList";
import { SettingsView } from "./SettingsView";
import { WorkshopView } from "./Workshop";
import { getPlace, setPlace, Tab } from "../state/place";
import { Desk } from "../tomes/Desk";
import { ensureTheme } from "../theme";
import * as s from "./styles";

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
      fontSize: "14px",
      fontWeight: active ? "bold" : undefined,
      ...(active ? s.tint("#1a9fff") : {}),
    }}
  >
    {children}
  </DialogButton>
);

// Fits Steam's normal Quick Access width; for more room, use the full-screen page.
export const QuickAccessPanel: FC = () => {
  useEffect(ensureTheme, []);
  return (
    <div className="dom-root" style={{ padding: "0 12px 16px", maxWidth: "100%", overflowX: "hidden", boxSizing: "border-box" }}>
      <NotesBrowser />
    </div>
  );
};

/** The tabs and their contents; shared by the Quick Access panel and the full-screen page. */
export const NotesBrowser: FC<{ fullScreen?: boolean }> = ({ fullScreen = false }) => {
  const running = useRunningGame();
  // Where you were is remembered between Quick Access opens, and on the full-screen page it's in the address.
  const [tab, setTabState] = useState<Tab>(() => getPlace().tab ?? "desk");
  const [openGame, setOpenGameState] = useState<string | null>(() => getPlace().openGame);
  useEffect(() => setPlace({ tab }), []);

  const setTab = (t: Tab) => {
    setPlace({ tab: t, note: null });
    setTabState(t);
  };
  const setOpenGame = (id: string | null) => {
    setPlace({ openGame: id, note: null });
    setOpenGameState(id);
  };

  return (
    <>
      <Focusable
        flow-children="row"
        style={{ display: "flex", flexWrap: "nowrap", alignItems: "stretch", gap: "6px", marginBottom: "14px", width: "100%" }}
      >
        <TabButton active={tab === "desk"} onClick={() => setTab("desk")}>
          {fullScreen ? <><FaBookOpen /> Desk</> : "Desk"}
        </TabButton>
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          {fullScreen ? <><FaThList /> All games</> : "Games"}
        </TabButton>
        <TabButton active={tab === "workshop"} onClick={() => setTab("workshop")} grow={fullScreen} label="Workshop">
          <FaStore /> {fullScreen && "Workshop"}
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

      {tab === "desk" && <Desk fullScreen={fullScreen} goTab={setTab} />}

      {tab === "all" &&
        (openGame ? (
          <NotesProvider key={openGame} appId={openGame}>
            <NoteList live={openGame === running?.appId} onBack={() => setOpenGame(null)} />
          </NotesProvider>
        ) : (
          <Library onOpen={setOpenGame} runningAppId={running?.appId} />
        ))}

      {tab === "workshop" && <WorkshopView />}
      {tab === "settings" && <SettingsView />}
    </>
  );
};
