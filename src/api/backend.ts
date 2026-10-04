import { call } from "@decky/api";
import { BookstoreEntry, BookstoreGame, BookstoreSummary, BookstoreUser, ServerUser, Share, BackupStatus, Counter, DeletedNote, Folder, NoteVersion, LeftOff, Game, GameSummary, Note, Recording, Screenshot, Settings, SteamScreenshot } from "../types";

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
  saveMediaData: (appId: string, base64: string, ext: string) =>
    call<[string, string, string], string>("save_media_data", appId, base64, ext),
  copySharedNote: (appId: string, shareId: string) => call<[string, string], Note>("copy_shared_note", appId, shareId),
  getMedia: (appId: string, file: string) => call<[string, string], string | null>("get_media", appId, file),
  deleteMedia: (appId: string, item: Screenshot | Recording) =>
    call<[string, Screenshot | Recording], void>("delete_media", appId, item),
  startRecording: (appId: string) => call<[string], Recording>("start_recording", appId),
  stopRecording: () => call<[], Recording | null>("stop_recording"),

  speechStatus: (refresh = false) => call<[boolean], { allowed: boolean }>("speech_status", refresh),
  startDictation: () => call<[], boolean>("start_dictation"),
  /** Stops listening and returns the words ("" if nothing was heard). */
  stopDictation: (appId = "", game = "") => call<[string, string], string>("stop_dictation", appId, game),
  cancelDictation: () => call<[], void>("cancel_dictation"),
  transcribeRecording: (appId: string, file: string) => call<[string, string], string>("transcribe_recording", appId, file),

  syncNow: () => call<[], { pushed: number; pulled: number }>("sync_now"),
  pairDevice: (code: string) => call<[string], ServerUser>("pair_device", code),
  serverUsers: () => call<[], ServerUser[]>("server_users"),
  noteShares: (appId: string, noteId: string) => call<[string, string], Share[]>("note_shares", appId, noteId),
  shareNote: (appId: string, noteId: string, to: string) => call<[string, string, string], Share>("share_note", appId, noteId, to),
  unshareNote: (shareId: string) => call<[string], void>("unshare_note", shareId),
  testBackupServer: () => call<[], { ok: boolean }>("test_backup_server"),
  backupStatus: () => call<[], BackupStatus>("backup_status"),

  bsGames: (q = "") => call<[string], BookstoreGame[]>("bs_games", q),
  bsEntries: (params: Record<string, string>) => call<[Record<string, string>], BookstoreSummary[]>("bs_entries", params),
  bsEntry: (id: string) => call<[string], BookstoreEntry>("bs_entry", id),
  bsMedia: (file: string) => call<[string], string | null>("bs_media", file),
  bsStartLink: () =>
    call<[], { deviceCode: string; userCode: string; verifyUrl: string; interval: number; expiresIn: number }>("bs_start_link"),
  bsPollLink: (deviceCode: string) => call<[string], { status: string; user?: BookstoreUser }>("bs_poll_link", deviceCode),
  bsUnlink: () => call<[], void>("bs_unlink"),
  bsLike: (id: string) => call<[string], BookstoreEntry>("bs_like", id),
  bsComment: (id: string, text: string) => call<[string, string], BookstoreEntry>("bs_comment", id, text),
  bsUsers: (q: string) => call<[string], BookstoreUser[]>("bs_users", q),
  bsUpdate: (id: string, fields: Record<string, unknown>) => call<[string, Record<string, unknown>], BookstoreEntry>("bs_update", id, fields),
  bsPublish: (appId: string, noteId: string, options: Record<string, unknown>) =>
    call<[string, string, Record<string, unknown>], BookstoreEntry>("bs_publish", appId, noteId, options),
  bsCopy: (id: string, appId: string) => call<[string, string], Note>("bs_copy", id, appId),

  pinOverlay: (appId: string, noteId: string) =>
    call<[string, string], { overlayRunning: boolean; pinned: boolean }>("pin_overlay", appId, noteId),
  unpinOverlay: () => call<[], { overlayRunning: boolean; pinned: boolean }>("unpin_overlay"),
  overlayStatus: () =>
    call<[], { overlayRunning: boolean; pinned: boolean; pin?: { appId: string; noteId: string } }>("overlay_status"),

  getSettings: () => call<[], Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<[Settings], void>("save_settings", settings),
};
