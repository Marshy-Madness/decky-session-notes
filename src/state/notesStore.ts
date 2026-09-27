import { createContext, useContext } from "react";
import { Note, RunProfile, Session } from "../types";

export interface NotesContextValue {
  appId: string | null;
  gameName: string | null;
  sessionStart: number | null;
  runProfiles: RunProfile[];
  activeRunProfile: RunProfile | null;
  setActiveRunProfile: (profile: RunProfile) => void;
  notes: Note[];
  refreshNotes: () => Promise<void>;
  sessions: Session[];
  refreshSessions: () => Promise<void>;
}

export const NotesContext = createContext<NotesContextValue | null>(null);

export function useNotesContext() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotesContext must be used within NotesProvider");
  return ctx;
}
