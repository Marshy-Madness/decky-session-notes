import { FC, useState } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Focusable } from "@decky/ui";
import { FaCog, FaChartBar } from "react-icons/fa";
import { NotesProvider } from "../state/NotesProvider";
import { useNotesContext } from "../state/notesStore";
import { RunProfileSelector } from "./RunProfileSelector";
import { NoteList } from "./NoteList";
import { SessionList } from "./SessionList";
import { Library } from "./Library";
import { StatsView } from "./StatsView";
import { SettingsView } from "./SettingsView";

type View = "notes" | "sessions" | "library" | "stats" | "settings";

const Shell: FC = () => {
  const { gameName } = useNotesContext();
  const [view, setView] = useState<View>("notes");

  return (
    <PanelSection title={gameName ?? "Session Notes"}>
      <PanelSectionRow>
        <Focusable style={{ display: "flex", gap: "4px" }}>
          <ButtonItem layout="below" onClick={() => setView("notes")}>
            Notes
          </ButtonItem>
          <ButtonItem layout="below" onClick={() => setView("sessions")}>
            Sessions
          </ButtonItem>
          <ButtonItem layout="below" onClick={() => setView("library")}>
            Library
          </ButtonItem>
          <ButtonItem layout="below" onClick={() => setView("stats")}>
            <FaChartBar />
          </ButtonItem>
          <ButtonItem layout="below" onClick={() => setView("settings")}>
            <FaCog />
          </ButtonItem>
        </Focusable>
      </PanelSectionRow>

      {view === "notes" && (
        <>
          <PanelSectionRow>
            <RunProfileSelector />
          </PanelSectionRow>
          <NoteList />
        </>
      )}
      {view === "sessions" && <SessionList />}
      {view === "library" && <Library />}
      {view === "stats" && <StatsView />}
      {view === "settings" && <SettingsView />}
    </PanelSection>
  );
};

export const QuickAccessPanel: FC = () => (
  <NotesProvider>
    <Shell />
  </NotesProvider>
);
