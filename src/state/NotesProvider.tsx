import { FC, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { showModal } from "@decky/ui";
import { NotesContext } from "./notesStore";
import { Note, RunProfile, Session } from "../types";
import { backend } from "../api/backend";
import { useAppLifetime } from "../hooks/useAppLifetime";
import { SessionSummaryModal } from "../components/SessionSummaryModal";

function defaultProfile(appId: string): RunProfile {
  return { id: `${appId}-default`, appId, label: "Default", createdAt: Date.now() };
}

export const NotesProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const runningGame = useAppLifetime();
  const appId = runningGame?.appId ?? null;

  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [runProfiles, setRunProfiles] = useState<RunProfile[]>([]);
  const [activeRunProfile, setActiveRunProfile] = useState<RunProfile | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);

  const prevSessionRef = useRef<{ appId: string; runProfileId: string; start: number } | null>(null);

  useEffect(() => {
    if (!appId) {
      setSessionStart(null);
      return;
    }
    setSessionStart(Date.now());
  }, [appId]);

  useEffect(() => {
    if (!appId) {
      setRunProfiles([]);
      setActiveRunProfile(null);
      return;
    }
    (async () => {
      let profiles = await backend.getRunProfiles(appId);
      if (profiles.length === 0) {
        const created = await backend.saveRunProfile(appId, defaultProfile(appId));
        profiles = [created];
      }
      setRunProfiles(profiles);
      setActiveRunProfile(profiles[0]);
    })();
  }, [appId]);

  const refreshNotes = useCallback(async () => {
    if (!appId || !activeRunProfile) return;
    setNotes(await backend.getNotes(appId, activeRunProfile.id));
  }, [appId, activeRunProfile]);

  const refreshSessions = useCallback(async () => {
    if (!appId || !activeRunProfile) return;
    setSessions(await backend.getSessions(appId, activeRunProfile.id));
  }, [appId, activeRunProfile]);

  useEffect(() => {
    refreshNotes();
    refreshSessions();
  }, [refreshNotes, refreshSessions]);

  useEffect(() => {
    if (appId && activeRunProfile && sessionStart) {
      prevSessionRef.current = { appId, runProfileId: activeRunProfile.id, start: sessionStart };
      return;
    }
    if (!appId && prevSessionRef.current) {
      const closed = prevSessionRef.current;
      prevSessionRef.current = null;
      showModal(
        <SessionSummaryModal
          appId={closed.appId}
          runProfileId={closed.runProfileId}
          start={closed.start}
        />
      );
    }
  }, [appId, activeRunProfile, sessionStart]);

  return (
    <NotesContext.Provider
      value={{
        appId,
        gameName: runningGame?.name ?? null,
        sessionStart,
        runProfiles,
        activeRunProfile,
        setActiveRunProfile,
        notes,
        refreshNotes,
        sessions,
        refreshSessions,
      }}
    >
      {children}
    </NotesContext.Provider>
  );
};
