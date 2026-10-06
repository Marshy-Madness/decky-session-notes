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
  /** What was said, written out by the sync server's speech to text. */
  transcript?: string;
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
  /** Set when the note was copied from the Workshop or a shared note. */
  source?: { type: "bookstore" | "shared"; id: string; author: string };
  /** Workshop entry this note was published as. */
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
/** @deprecated the old fixed choices for the open combo; see Settings.combos */
export type OpenChord = "l4r4" | "l5r5" | "l3r3" | "off";
/**
 * What a button combo does: the radial menu, open the notes page ("open"), the Desk, the web browser, speech
 * to text or a voice command. "tomes" is the old name of the radial combo, still read as its fallback.
 */
export type ComboAction = "radial" | "open" | "desk" | "web" | "dictate" | "voice";

/** One slot on the radial menu. */
export type RadialItem =
  /** The game you're playing (or played last): opens a second wheel of its notes. */
  | { type: "game" }
  | { type: "notes" }
  | { type: "desk" }
  | { type: "web"; url?: string }
  /** A note pinned to the wheel (separate from pinning in the notes list). */
  | { type: "note"; appId: string; noteId: string; title: string; gameName?: string };

export interface RadialSettings {
  /** The wheel's slots, clockwise from the top; unset = the default four. */
  items?: RadialItem[];
}
/** What a voice command does with words that don't start with a command. */
export type VoiceFallback = "note" | "append" | "nothing";
/** Where STEAM + L5 + R5 dictation goes: typed into whatever is focused, or saved as a note. */
export type DictateTarget = "type" | "note";

export interface Settings {
  sort?: SortMode;
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
  bookstoreUser?: WorkshopUser;
  /** Pin to screen: turn off Steam's own performance stats so only the to-do list shows. */
  overlayHideStats?: boolean;
  /** Pin to screen: where the overlay sits; unset = wherever Steam puts it (top left). Older setting, used
   * when overlayX/overlayY aren't set. */
  overlayPosition?: OverlayPosition;
  /** Pin to screen: exact top-left corner of the list in screen pixels (1280 x 800). */
  overlayX?: number;
  overlayY?: number;
  /** Pin to screen: text size in pixels; unset = 13 (MangoHud's small font). */
  overlayTextSize?: number;
  /** Pin to screen: background opacity, 0-100; unset = 50. */
  overlayOpacity?: number;
  overlayRounded?: boolean;
  /** @deprecated replaced by combos.open */
  openChord?: OpenChord;
  /** Buttons (1 to 4) for each combo; [] = off, unset = the default. */
  combos?: Partial<Record<ComboAction | "tomes", string[]>>;
  /** The radial menu's slots. */
  radial?: RadialSettings;
  /** Add "Desk of Madness" to the main Steam-button menu. */
  mainMenuEntry?: boolean;
  /** Give Desk of Madness its own Quick Access tab, next to Decky's. */
  qamTab?: boolean;
  /** The dictate combo starts and stops speech to text anywhere. Off unless turned on. */
  dictateChord?: boolean;
  dictateTarget?: DictateTarget;
  /** The voice combo listens for a spoken command (keywords, see voice.ts). Off unless turned on. */
  voiceCommands?: boolean;
  /** Words that aren't a command: "note" (default) saves a new note, "append" adds to the last note. */
  voiceFallback?: VoiceFallback;
  /** Language code for speech to text ("" = detect). */
  speechLanguage?: string;
  /** While notes or the browser are on screen, the trackpads work as on Steam's store pages: the left one
   * scrolls, the right one is a mouse (click = left click). On unless turned off. */
  trackpadMouse?: boolean;
  /** How links in notes open: "reader" (default: just the article, no ads) or "full" (the whole site). */
  browserMode?: BrowserMode;
  /** Reader view text size in pixels; unset = 17. */
  readerTextSize?: number;
  /** The Desk: which Tomes show, in what order, and Tome options. */
  desk?: DeskSettings;
  /** Installed Scrolls: on or off, and each Scroll's own settings. */
  scrolls?: Record<string, ScrollState>;
}

/** One installed Scroll's switch and settings on this Deck. */
export interface ScrollState {
  enabled?: boolean;
  /** Turned itself off (hooks missing, an error): why. Cleared when you turn it on again. */
  offReason?: string;
  settings?: Record<string, unknown>;
}

export type ScrollKind = "code" | "data";

/** What a data Scroll holds (nothing in it can run). */
export interface ScrollData {
  text?: string;
  links?: { title: string; url: string; note?: string }[];
  packs?: string[];
  layout?: DeskLayout;
}

/** An installed Scroll as the backend lists it (no code). */
export interface InstalledScroll {
  id: string;
  name: string;
  icon?: string;
  version?: string;
  kind?: ScrollKind;
  summary?: string;
  description?: string;
  author?: string;
  minDesk?: string;
  permissions?: string[];
  data?: ScrollData;
  size: number;
  signed?: boolean;
  /** Didn't pass the checks on this Deck (changed on disk, or a format this Desk doesn't know). */
  broken?: string;
}

/** A Scroll as the Workshop lists it. */
export interface WorkshopScroll {
  id: string;
  name: string;
  icon: string;
  version: string;
  kind: ScrollKind;
  summary: string;
  description?: string;
  author: WorkshopUser;
  status: string;
  signed: boolean;
  official: boolean;
  size: number;
  installs: number;
  minDesk: string;
  permissions: { id: string; text: string }[];
  contents?: Record<string, number | boolean>;
  updatedAt: number;
}

/** One arrangement of the Desk's Tomes. Tomes not in `order` (new ones) go at the end. */
export interface DeskLayout {
  order: string[];
  /** Tomes taken off the Desk. */
  hidden: string[];
  /** Tomes folded down to their title bar. */
  collapsed: string[];
}

export interface DeskSettings {
  /** The layout for games without their own, and when no game is picked. */
  layout?: DeskLayout;
  /** Each game's own layout (per-game layouts). */
  games?: Record<string, DeskLayout>;
  /** Changes made while a game is showing apply to that game only. On unless turned off. */
  perGame?: boolean;
  /** How much Y adds on a counter; unset = 3. */
  counterStep?: number;
  /** Notes opened lately, newest first, per game (for Game Brain and Guides). */
  recent?: Record<string, string[]>;
  /** When the Workshop Tome was last looked at, per game, for its "new" badge. */
  workshopSeen?: Record<string, number>;
  /** @deprecated the old Tome wheel's on/off; false still turns the radial combo off until one is set. */
  radial?: boolean;
  /** Tighter Tomes, to fit more in the Quick Access menu. */
  compact?: boolean;
  /** The Workshop Tome's "new books" badge. On unless turned off. */
  workshopBadge?: boolean;
}

export type BrowserMode = "reader" | "full";

/** A web page boiled down to its article (py_modules/reader.py), made by the server or the Deck itself. */
export interface ReaderPage {
  url: string;
  title: string;
  site: string;
  image: string | null;
  excerpt: string;
  /** Plain article markup; still filtered again before it's shown. */
  html: string;
  /** Characters of text in the article. */
  length: number;
  fetchedAt: number;
  cached?: boolean;
  source?: "server" | "device";
}

/** The server's reader cache settings (admins only). readerCacheDays 0 = never delete. */
export interface ReaderCacheSettings {
  readerCacheDays: number;
  readerCacheChoices: number[];
  readerCache: { pages: number; bytes: number };
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

export interface WorkshopUser {
  steamId: string;
  name: string;
  avatar: string;
}

export type EditPolicy = "owner" | "select" | "anyone";

export interface WorkshopSummary {
  id: string;
  appId: string;
  gameName: string;
  title: string;
  firstLine: string;
  kind: NoteKind;
  tags: string[];
  spoiler: boolean;
  spoilerLabel: string;
  author: WorkshopUser;
  likes: number;
  comments: number;
  allowCopy: boolean;
  hasScreenshots: boolean;
  hasVoice: boolean;
  hasChecklist: boolean;
  thumb: string | null;
  createdAt: number;
  updatedAt: number;
  /** ⭐ picked by the Workshop's admins. */
  featured?: boolean;
  /** Times saved to someone's notes. */
  copies?: number;
}

/** 📦 A Note Pack: a collection of Workshop posts, saved to your notes in one go. */
export interface WorkshopPack {
  id: string;
  title: string;
  description: string;
  appId: string | null;
  gameName: string;
  author: WorkshopUser;
  count: number;
  copies: number;
  featured: boolean;
  status: string;
  createdAt: number;
  updatedAt: number;
  entries?: WorkshopSummary[];
}

export interface WorkshopEntry extends WorkshopSummary {
  body: string;
  checklist: ChecklistItem[];
  screenshots: Screenshot[];
  recordings: Recording[];
  editPolicy: EditPolicy;
  editors: WorkshopUser[];
  canEdit: boolean;
  isAuthor: boolean;
  canDelete: boolean;
  liked: boolean;
  commentList: { id: string; text: string; createdAt: number; author: WorkshopUser }[];
}

export interface WorkshopGame {
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

/** A Steam news post for a game (py_modules/news.py). */
export interface SteamNewsItem {
  id: string;
  title: string;
  url: string;
  author: string;
  feed: string;
  /** ms */
  date: number;
  summary: string;
  image: string;
  official: boolean;
}
