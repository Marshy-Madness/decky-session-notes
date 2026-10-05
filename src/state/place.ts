import { replacePath } from "../steamWindow";

// Where you are in Desk of Madness, written into the page's address on the full-screen page:
//   /desk-of-madness/<tab>[/<appId>[/folder/<folderId>][/note/<noteId> | /edit/<noteId or "new">]]
// so Steam's Back, the main-menu entry and the button combo all bring you back to the same spot, and the
// browser page (its own address, /desk-of-madness-web?url=…) can hand you back to the note you came from.

export const NOTES_ROUTE = "/desk-of-madness";
export const WEB_ROUTE = "/desk-of-madness-web";

export type Tab = "current" | "all" | "workshop" | "settings";
const TABS: Tab[] = ["current", "all", "workshop", "settings"];

export interface OpenNoteRef {
  type: "view" | "edit";
  /** null for a new note. */
  id: string | null;
}

export interface NotesPlace {
  tab: Tab | null;
  /** The game picked on the All games tab. */
  openGame: string | null;
  /** The game whose notes are showing (on either tab). */
  appId: string | null;
  folderId: string | null;
  note: OpenNoteRef | null;
}

const place: NotesPlace = { tab: null, openGame: null, appId: null, folderId: null, note: null };
let pageShowing = false;
/** The full address you were last at (notes or browser), to go back to when Desk of Madness opens again. */
let lastAddress: string | null = null;

export const getPlace = (): Readonly<NotesPlace> => place;
export const lastPlaceAddress = () => lastAddress;
export const rememberAddress = (path: string) => (lastAddress = path);

const enc = encodeURIComponent;

export function placePath(p: NotesPlace = place): string {
  let path = `${NOTES_ROUTE}/${p.tab ?? "all"}`;
  const appId = p.tab === "all" ? p.openGame : p.tab === "current" ? p.appId : null;
  if (appId) {
    path += `/${enc(appId)}`;
    if (p.folderId) path += `/folder/${enc(p.folderId)}`;
    if (p.note) path += `/${p.note.type === "edit" ? "edit" : "note"}/${p.note.id ? enc(p.note.id) : "new"}`;
  }
  return path;
}

/** Reads a notes address; null for the bare /desk-of-madness (no place in it). */
export function parsePlace(path: string): NotesPlace | null {
  const pathname = path.split("?")[0];
  if (!pathname.startsWith(NOTES_ROUTE + "/")) return null;
  const parts = pathname.slice(NOTES_ROUTE.length + 1).split("/").filter(Boolean).map(decodeURIComponent);
  const tab = parts[0] as Tab;
  if (!TABS.includes(tab)) return null;
  const out: NotesPlace = { tab, openGame: null, appId: null, folderId: null, note: null };
  const appId = parts[1] ?? null;
  if (appId) {
    out.appId = appId;
    if (tab === "all") out.openGame = appId;
    for (let i = 2; i + 1 < parts.length; i += 2) {
      const [key, value] = [parts[i], parts[i + 1]];
      if (key === "folder") out.folderId = value;
      else if (key === "note" || key === "edit") out.note = { type: key === "edit" ? "edit" : "view", id: value === "new" ? null : value };
    }
  }
  return out;
}

function write() {
  if (!pageShowing) return;
  const path = placePath();
  lastAddress = path;
  replacePath(path);
}

/** Records a change of place; on the full-screen page the address follows. */
export function setPlace(patch: Partial<NotesPlace>) {
  let changed = false;
  for (const [k, v] of Object.entries(patch) as [keyof NotesPlace, any][]) {
    if (place[k] !== v) {
      (place as any)[k] = v;
      changed = true;
    }
  }
  if (changed) write();
}

/** Takes on the place in a notes address, if it has one (the bare /desk-of-madness doesn't). */
export function takePlaceFromAddress(address: string): NotesPlace | null {
  const fromAddress = parsePlace(address);
  if (fromAddress) Object.assign(place, fromAddress);
  return fromAddress;
}

/** Called by the full-screen page as it mounts/unmounts; while it's up, the address follows your place. */
export function notesPageShowing(showing: boolean) {
  pageShowing = showing;
  if (showing) write();
}
