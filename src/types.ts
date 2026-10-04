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

export type NoteKind =
  | "note"
  | "guide"
  | "tip"
  | "walkthrough"
  | "boss"
  | "build"
  | "collectibles"
  | "secret"
  | "settings"
  | "achievement";

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
  /** What sort of note this is; "note" when missing. Guides also show in the virtual Guides folder. */
  kind?: NoteKind;
  /** Set when the note was copied from the Bookstore or a shared note. */
  source?: { type: "bookstore" | "shared"; id: string; author: string };
  /** Bookstore entry this note was published as. */
  bookstoreId?: string;
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

/** A note another user on your sync server shared with you (read-only). */
export interface SharedNote {
  shareId: string;
  fromId: string;
  fromName: string;
  note: Note;
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
  /** Notes other users shared with you for this game. */
  sharedCount?: number;
}

export interface ServerUser {
  id: string;
  name: string;
  avatar: string;
  steamId: string | null;
}

export interface Share {
  id: string;
  to: string;
  toName: string;
  noteId: string;
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
  /** Notes shared with you, cached from the sync server. */
  shared?: SharedNote[];
  summary: GameSummary;
}

export interface SteamScreenshot {
  path: string;
  takenAt: number;
  preview: string;
}

export type SortMode = "alpha" | "created" | "edited" | "recent";
export type PanelWidth = "normal" | "wide" | "extra";
export type OpenChord = "l4r4" | "l5r5" | "l3r3" | "off";

export interface Settings {
  sort?: SortMode;
  panelWidth?: PanelWidth;
  sessionRecap?: boolean;
  screenshotPrompt?: boolean;
  /** After a screenshot is attached to a note, delete it from Steam's screenshot library. */
  removeFromSteam?: boolean;
  syncUrl?: string;
  syncToken?: string;
  /** @deprecated replaced by syncInterval */
  autoBackup?: boolean;
  /** Minutes between checks for website edits; 0 = manual only. */
  syncInterval?: number;
  bookstoreUrl?: string;
  bookstoreUser?: BookstoreUser;
  /** Pin to screen: turn off Steam's own performance stats so only the to-do list shows. */
  overlayHideStats?: boolean;
  /** Pin to screen: where the overlay sits; unset = wherever Steam puts it (top left). */
  overlayPosition?: OverlayPosition;
  /** Button combo that opens the full-screen notes page; unset = L4 + R4. */
  openChord?: OpenChord;
  /** Add "Session Notes" to the main Steam-button menu. */
  mainMenuEntry?: boolean;
  /** Give Session Notes its own Quick Access tab, next to Decky's. */
  qamTab?: boolean;
}

export type OverlayPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface BookstoreUser {
  steamId: string;
  name: string;
  avatar: string;
}

export type EditPolicy = "owner" | "select" | "anyone";

export interface BookstoreSummary {
  id: string;
  appId: string;
  gameName: string;
  title: string;
  firstLine: string;
  kind: NoteKind;
  tags: string[];
  spoiler: boolean;
  spoilerLabel: string;
  author: BookstoreUser;
  likes: number;
  comments: number;
  allowCopy: boolean;
  hasScreenshots: boolean;
  hasVoice: boolean;
  hasChecklist: boolean;
  thumb: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BookstoreEntry extends BookstoreSummary {
  body: string;
  checklist: ChecklistItem[];
  screenshots: Screenshot[];
  recordings: Recording[];
  editPolicy: EditPolicy;
  editors: BookstoreUser[];
  canEdit: boolean;
  isAuthor: boolean;
  canDelete: boolean;
  liked: boolean;
  commentList: { id: string; text: string; createdAt: number; author: BookstoreUser }[];
}

export interface BookstoreGame {
  appId: string;
  gameName: string;
  count: number;
}

export interface BackupStatus {
  lastBackup: number | null;
  lastError: string | null;
  running: boolean;
  pending: boolean;
}
