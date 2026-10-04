export interface Screenshot {
  id: string;
  file: string;
  thumb?: string;
  takenAt: number;
}

export interface Recording {
  id: string;
  file: string;
  createdAt: number;
  durationSec?: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Note {
  id: string;
  folderId: string | null;
  title: string;
  body: string;
  tags: string[];
  screenshots: Screenshot[];
  recordings: Recording[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  /** Which launch of the game this note was written during. */
  launchNumber: number | null;
  checklist?: ChecklistItem[];
  /** Hidden behind a "reveal" until you choose to look. */
  spoiler?: boolean;
}

export type CounterKind = "death" | "boss" | "custom";

export interface Counter {
  id: string;
  name: string;
  kind: CounterKind;
  count: number;
  sessionCount: number;
  defeated?: boolean;
  createdAt: number;
  updatedAt?: number;
}

export interface LeftOff {
  text: string;
  updatedAt: number;
  launchNumber: number | null;
}

export interface NoteVersion {
  savedAt: number;
  reason: "edited" | "deleted";
  note: Note;
}

export interface DeletedNote {
  deletedAt: number;
  note: Note;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

export interface Session {
  id: string;
  start: number;
  end: number | null;
}

export interface GameSummary {
  appId: string;
  name: string;
  launchCount: number;
  lastLaunched: number | null;
  firstSeen: number | null;
  playtimeSeconds: number;
  noteCount: number;
  folderCount: number;
  lastEdited: number | null;
  firstNoteCreated: number | null;
  leftOff: LeftOff | null;
}

export interface Game {
  appId: string;
  name: string;
  launchCount: number;
  lastLaunched: number | null;
  playtimeSeconds: number;
  folders: Folder[];
  notes: Note[];
  sessions: Session[];
  counters?: Counter[];
  leftOff?: LeftOff | null;
  summary: GameSummary;
}

export interface SteamScreenshot {
  path: string;
  takenAt: number;
  preview: string;
}

export type SortMode = "alpha" | "created" | "edited" | "recent";
export type PanelWidth = "normal" | "wide" | "extra";

export interface Settings {
  sort?: SortMode;
  panelWidth?: PanelWidth;
  sessionRecap?: boolean;
  screenshotPrompt?: boolean;
  syncUrl?: string;
  syncToken?: string;
  /** @deprecated replaced by syncInterval */
  autoBackup?: boolean;
  /** Minutes between checks for website edits; 0 = manual only. */
  syncInterval?: number;
}

export interface BackupStatus {
  lastBackup: number | null;
  lastError: string | null;
  running: boolean;
  pending: boolean;
}
