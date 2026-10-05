import { useSyncExternalStore } from "react";
import { Navigation } from "@decky/ui";
import { getRunningGame } from "./hooks/useAppLifetime";
import { putAwayNote } from "./state/resume";

// Opening the full-screen page, kept apart from integrations.tsx so the panels can use it without an import loop.

export const NOTES_ROUTE = "/session-notes";

/**
 * Shows the full-screen notes page. In a game Steam's overlay is hidden, and navigating alone changes the
 * page behind the game without showing it, so we bring the overlay up through the Steam menu first, the
 * same way picking an entry from that menu does.
 */
export function openNotesPage() {
  const show = () => {
    Navigation.Navigate(NOTES_ROUTE);
    Navigation.CloseSideMenus();
  };
  if (getRunningGame()) {
    Navigation.OpenMainMenu();
    setTimeout(show, 200);
  } else {
    show();
  }
}

// ---- putting the page away again ----

// Steam's in-game page: showing it is how Steam hands the screen back to the game (it picks what's on
// screen from the current page, and this one means "just the game").
const APP_RUNNING_ROUTE = "/apprunning";

// When Steam goes back to the game it navigates to that page, so the notes page unmounts; being mounted
// means it's on screen.
let pageMounted = false;

export const isNotesPageShowing = () => pageMounted;

/** Called by the full-screen page as it mounts and unmounts. */
export function setNotesPageMounted(mounted: boolean) {
  pageMounted = mounted;
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
    else Navigation.NavigateBack();
  }, 50);
}

/** The button combo: opens the page, or puts it away if it's already showing. */
export function toggleNotesPage() {
  if (pageMounted) closeNotesPage();
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
