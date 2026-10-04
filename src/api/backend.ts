import { call } from "@decky/api";
import { BackupStatus, Counter, DeletedNote, Folder, NoteVersion, LeftOff, Game, GameSummary, Note, Recording, Screenshot, Settings, SteamScreenshot } from "../types";

export const backend = {
  listGames: () => call<[], GameSummary[]>("list_games"),
  getGame: (appId: string) => call<[string], Game>("get_game", appId),
  recordLaunch: (appId: string, name: string) => call<[string, string], GameSummary>("record_launch", appId, name),
  recordExit: (appId: string) => call<[string], GameSummary>("record_exit", appId),
  ensureGame: (appId: string, name: string) => call<[string, string], GameSummary>("ensure_game", appId, name),

  saveNote: (appId: string, note: Note) => call<[string, Note], Note>("save_note", appId, note),
  deleteNote: (appId: string, noteId: string) => call<[string, string], void>("delete_note", appId, noteId),
  getNoteHistory: (appId: string, noteId: string) =>
    call<[string, string], NoteVersion[]>("get_note_history", appId, noteId),
  listDeletedNotes: (appId: string) => call<[string], DeletedNote[]>("list_deleted_notes", appId),
  restoreNote: (appId: string, note: Note) => call<[string, Note], Note>("restore_note", appId, note),
  saveFolder: (appId: string, folder: Folder) => call<[string, Folder], Folder>("save_folder", appId, folder),
  deleteFolder: (appId: string, folderId: string) => call<[string, string], void>("delete_folder", appId, folderId),

  setLeftOff: (appId: string, text: string) => call<[string, string], LeftOff | null>("set_left_off", appId, text),

  saveCounter: (appId: string, counter: Counter) => call<[string, Counter], Counter>("save_counter", appId, counter),
  bumpCounter: (appId: string, counterId: string, delta: number) =>
    call<[string, string, number], Counter | null>("bump_counter", appId, counterId, delta),
  deleteCounter: (appId: string, counterId: string) => call<[string, string], void>("delete_counter", appId, counterId),

  findNewScreenshot: (appId: string, afterMs: number) =>
    call<[string, number], string | null>("find_new_screenshot", appId, afterMs),
  listSteamScreenshots: (appId: string, limit = 30) =>
    call<[string, number], SteamScreenshot[]>("list_steam_screenshots", appId, limit),
  attachScreenshot: (appId: string, path: string) => call<[string, string], Screenshot>("attach_screenshot", appId, path),
  getMedia: (appId: string, file: string) => call<[string, string], string | null>("get_media", appId, file),
  deleteMedia: (appId: string, item: Screenshot | Recording) =>
    call<[string, Screenshot | Recording], void>("delete_media", appId, item),
  startRecording: (appId: string) => call<[string], Recording>("start_recording", appId),
  stopRecording: () => call<[], Recording | null>("stop_recording"),

  syncNow: () => call<[], { pushed: number; pulled: number }>("sync_now"),
  testBackupServer: () => call<[], { ok: boolean }>("test_backup_server"),
  backupStatus: () => call<[], BackupStatus>("backup_status"),

  getSettings: () => call<[], Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<[Settings], void>("save_settings", settings),
};
