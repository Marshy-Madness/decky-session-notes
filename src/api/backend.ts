import { call } from "@decky/api";
import { Note, RunProfile, Session, Settings } from "../types";

export const backend = {
  getNotes: (appId: string, runProfileId: string) =>
    call<[string, string], Note[]>("get_notes", appId, runProfileId),

  saveNote: (appId: string, runProfileId: string, note: Note) =>
    call<[string, string, Note], Note>("save_note", appId, runProfileId, note),

  deleteNote: (appId: string, runProfileId: string, noteId: string) =>
    call<[string, string, string], void>("delete_note", appId, runProfileId, noteId),

  getSessions: (appId: string, runProfileId: string) =>
    call<[string, string], Session[]>("get_sessions", appId, runProfileId),

  saveSession: (appId: string, runProfileId: string, session: Session) =>
    call<[string, string, Session], Session>("save_session", appId, runProfileId, session),

  getRunProfiles: (appId: string) =>
    call<[string], RunProfile[]>("get_run_profiles", appId),

  saveRunProfile: (appId: string, profile: RunProfile) =>
    call<[string, RunProfile], RunProfile>("save_run_profile", appId, profile),

  listGamesWithNotes: () =>
    call<[], { appId: string; noteCount: number }[]>("list_games_with_notes"),

  getSettings: () => call<[], Settings>("get_settings"),

  saveSettings: (settings: Settings) => call<[Settings], void>("save_settings", settings),
};
