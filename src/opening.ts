import { useSyncExternalStore } from "react";
import { Navigation } from "@decky/ui";
import { getRunningGame } from "./hooks/useAppLifetime";

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

// ---- what the button combo sees, shown live in Settings so you can tell whether Steam reports the buttons ----

let seen = "";
const seenListeners = new Set<() => void>();

export function reportButtons(names: string) {
  if (names === seen) return;
  seen = names;
  seenListeners.forEach((l) => l());
}

export function useSeenButtons(): string {
  return useSyncExternalStore(
    (l) => {
      seenListeners.add(l);
      return () => seenListeners.delete(l);
    },
    () => seen
  );
}
