import { useSyncExternalStore } from "react";
import { Navigation } from "@decky/ui";
import { getRunningGame } from "./hooks/useAppLifetime";
import { putAwayNote } from "./state/resume";
import { lastPlaceAddress, NOTES_ROUTE, WEB_ROUTE } from "./state/place";
import { mainMenuOpen, steamHistory, steamUiInFront } from "./steamWindow";

// Opening the full-screen page, kept apart from integrations.tsx so the panels can use it without an import loop.

export { NOTES_ROUTE, WEB_ROUTE };

const POLL_MS = 16; // about one frame
const MAX_WAIT_MS = 300; // give up waiting and show the page anyway
const FALLBACK_WAIT_MS = 200; // older Steam without the focus info: the fixed wait that used to be used

/**
 * Brings Steam's UI in front of the game, then calls `then`. In a game the overlay is hidden, and navigating
 * alone changes the page behind the game without showing it, so we open the Steam menu first (as picking an
 * entry from that menu does) and wait until gamescope reports that Steam's UI has the screen, checking every
 * frame, instead of guessing a delay. Outside a game, or when Steam's UI is already in front (from the Quick
 * Access menu), there's nothing to wait for.
 */
function withSteamInFront(then: () => void) {
  if (!getRunningGame() || pagesMounted > 0) return then(); // no game, or one of our pages is already up

  const alreadyInFront = steamUiInFront() === true;
  Navigation.OpenMainMenu();
  if (alreadyInFront) return then();
  const started = Date.now();
  const check = () => {
    const front = steamUiInFront();
    const waited = Date.now() - started;
    if (front === null) return void setTimeout(then, Math.max(0, FALLBACK_WAIT_MS - waited));
    if ((front && mainMenuOpen() !== false) || waited >= MAX_WAIT_MS) {
      console.info(`Session Notes: Steam UI in front after ${waited} ms${front ? "" : " (gave up waiting)"}`);
      return then();
    }
    setTimeout(check, POLL_MS);
  };
  check();
}

/** Shows one of our pages (`path` is its address), over the game if one is running. */
export function showPage(path: string) {
  withSteamInFront(() => {
    Navigation.Navigate(path);
    Navigation.CloseSideMenus();
  });
}

/** Shows the full-screen notes page, back where you were last time (including the browser, if it was open). */
export function openNotesPage() {
  showPage(lastPlaceAddress() ?? NOTES_ROUTE);
}

// ---- putting the page away again ----

// Steam's in-game page: showing it is how Steam hands the screen back to the game (it picks what's on
// screen from the current page, and this one means "just the game").
const APP_RUNNING_ROUTE = "/apprunning";

// When Steam goes back to the game it navigates to that page, so our pages unmount; being mounted means
// on screen. The notes page and the browser page each count.
let pagesMounted = 0;

export const isNotesPageShowing = () => pagesMounted > 0;

/** Called by the full-screen page and the browser page as they mount and unmount. */
export function setNotesPageMounted(mounted: boolean) {
  pagesMounted = Math.max(0, pagesMounted + (mounted ? 1 : -1));
}

/**
 * Closes the page and goes back to the game (or wherever you were), keeping your place: the open note and
 * any unsaved edits come back next time.
 */
export function closeNotesPage() {
  putAwayNote();
  Navigation.CloseSideMenus();
  // Give the note's window a moment to close; an open window keeps Steam's UI on screen.
  setTimeout(() => {
    if (getRunningGame()) Navigation.Navigate(APP_RUNNING_ROUTE);
    else leaveOurPages();
  }, 50);
}

/** Goes back to the page you were on before Session Notes (past the notes page and the browser both). */
function leaveOurPages() {
  const h = steamHistory() as any;
  if (!Array.isArray(h?.entries) || typeof h.index !== "number" || typeof h.go !== "function") return Navigation.NavigateBack();
  let steps = 1;
  while (h.index - steps > 0 && String(h.entries[h.index - steps]?.pathname ?? "").startsWith(NOTES_ROUTE)) steps++;
  h.go(-steps);
}

/** The button combo: opens the page, or puts it away if it's already showing. */
export function toggleNotesPage() {
  if (pagesMounted > 0) closeNotesPage();
  else openNotesPage();
}

// ---- what the button combo sees, shown live in Settings so you can tell whether Steam reports the buttons ----

export type SeenButtons = { names: string; source: string };

let seen: SeenButtons | null = null; // null until something has reported buttons at all
const seenListeners = new Set<() => void>();

export function reportButtons(names: string, source: string) {
  if (seen && names === seen.names && (source === seen.source || !names)) return;
  seen = { names, source };
  seenListeners.forEach((l) => l());
}

export function useSeenButtons(): SeenButtons | null {
  return useSyncExternalStore(
    (l) => {
      seenListeners.add(l);
      return () => seenListeners.delete(l);
    },
    () => seen
  );
}
