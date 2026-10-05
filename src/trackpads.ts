import { useEffect } from "react";
import { getSettings } from "./state/notesStore";

// Trackpads as on Steam's store pages: the left one scrolls like a mouse wheel, the right one moves a mouse
// pointer and clicking it is a left click. This is Steam's own "web browser" controller mode, switched on while
// the notes page, a note or the browser is on screen. Everything holding it gets a release function; the mode
// goes off when the last one lets go.

let holders = 0;

function setMode(on: boolean) {
  try {
    (window as any).SteamClient?.Input?.SetWebBrowserActionset?.(on);
  } catch (e) {
    console.warn("Desk of Madness: couldn't switch the trackpad mode", e);
  }
}

/** Turns the mode on (unless it's turned off in Settings) until the returned function is called. */
export function holdTrackpadMouse(): () => void {
  if (getSettings().trackpadMouse === false) return () => {};
  if (holders++ === 0) setMode(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holders === 0) setMode(false);
  };
}

/** Holds the mode for as long as the component is mounted. */
export function useTrackpadMouse() {
  useEffect(() => holdTrackpadMouse(), []);
}

/** On plugin unload: hand the trackpads back to Steam whatever is still mounted. */
export function releaseTrackpads() {
  if (holders > 0) {
    holders = 0;
    setMode(false);
  }
}
