import { closeNotesPage, isNotesPageShowing, showPage } from "../opening";
import { getRunningGame } from "../hooks/useAppLifetime";
import { deskGame, pointDeskAt } from "../state/deskGame";
import { lastPlaceAddress, NOTES_ROUTE, parsePlace, RADIAL_ROUTE, WEB_ROUTE } from "../state/place";
import { webPath } from "../browser";

// Where the radial menu's slots and the Notes / Desk / Web Browser button combos take you.

const enc = encodeURIComponent;

/** The game to show: the one running, else the one the Desk showed last. */
export const currentGameId = (): string | null => getRunningGame()?.appId ?? deskGame.last;

/** The game's notes list (on the Desk tab), or the list of games when there's no game. */
export function goNotes(appId: string | null = currentGameId()) {
  if (!appId) return showPage(`${NOTES_ROUTE}/all`);
  pointDeskAt(appId);
  showPage(`${NOTES_ROUTE}/desk/${enc(appId)}/view/notes`);
}

export function goDesk(appId: string | null = currentGameId()) {
  pointDeskAt(appId);
  showPage(`${NOTES_ROUTE}/desk${appId ? `/${enc(appId)}` : ""}`);
}

/** Opens one note in its game's notes list. */
export function goNote(appId: string, noteId: string) {
  pointDeskAt(appId);
  showPage(`${NOTES_ROUTE}/desk/${enc(appId)}/view/notes/note/${enc(noteId)}`);
}

let lastWeb: string | null = null;
/** Called by the browser page as its address changes, so the Web Browser slot goes back to it. */
export const rememberWebAddress = (path: string) => (lastWeb = path);

/** The browser: a set page, or the page you had open last (a search page the first time). */
export function goWeb(url?: string) {
  showPage(url ? webPath(url) : lastWeb ?? WEB_ROUTE);
}

// ---- the combos: each opens its page, or puts our pages away if one is already showing ----

/** Notes combo: back where you were if that was this game's notes, otherwise this game's notes list. */
export function notesCombo() {
  if (isNotesPageShowing()) return closeNotesPage();
  const last = lastPlaceAddress();
  const p = last ? parsePlace(last) : null;
  const running = getRunningGame()?.appId;
  const inNotes = p && ((p.tab === "all" && p.openGame) || (p.tab === "desk" && p.appId && p.deskView === "notes"));
  if (last && inNotes && (!running || p.appId === running)) return showPage(last);
  goNotes();
}

export const deskCombo = () => (isNotesPageShowing() ? closeNotesPage() : goDesk());
export const webCombo = () => (isNotesPageShowing() ? closeNotesPage() : goWeb());

// ---- the radial menu ----

let radialCombo: { buttons: string[]; at: number } | null = null;

/** Opens the radial menu (or closes our pages if one is showing). `buttons`: letting go of them picks. */
export function radialComboPressed(buttons: string[]) {
  if (isNotesPageShowing()) return closeNotesPage();
  radialCombo = { buttons, at: Date.now() };
  showPage(RADIAL_ROUTE);
}

/** The combo that opened the menu, taken once by the page as it mounts (stale ones are dropped). */
export function takeRadialCombo(): string[] {
  const r = radialCombo;
  radialCombo = null;
  return r && Date.now() - r.at < 3000 ? r.buttons : [];
}
