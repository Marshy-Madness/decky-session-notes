import { useSyncExternalStore } from "react";
import { isNotesPageShowing, showPage } from "../opening";
import { NOTES_ROUTE, getPlace, setPlace } from "../state/place";

// The Tome wheel's button combo: shows the full-screen Desk with the wheel open on it. The Desk picks the
// request up when it mounts (or straight away if it's already showing).

export interface WheelRequest {
  /** The combo that opened it: letting go of it picks what the stick points at. */
  combo: string[];
  at: number;
}

let request: WheelRequest | null = null;
const listeners = new Set<() => void>();

export function openTomeWheel(combo: string[]) {
  request = { combo, at: Date.now() };
  listeners.forEach((l) => l());
  if (!isNotesPageShowing()) {
    const appId = getPlace().tab === "desk" ? getPlace().appId : null;
    setPlace({ tab: "desk", deskView: "desk", note: null });
    showPage(`${NOTES_ROUTE}/desk${appId ? `/${encodeURIComponent(appId)}` : ""}`);
  }
}

/** Takes the waiting request (once). Old ones (the page never showed) are dropped. */
export function takeWheelRequest(): WheelRequest | null {
  const r = request;
  request = null;
  return r && Date.now() - r.at < 5000 ? r : null;
}

export function useWheelRequest(): WheelRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => request
  );
}

// ---- jumping to a Tome on the Desk ----

const tomeElements = new Map<string, HTMLElement>();

export function registerTomeElement(id: string, el: HTMLElement | null) {
  if (el) tomeElements.set(id, el);
  else tomeElements.delete(id);
}

/** Scrolls a Tome into view and gives it the focus. */
export function jumpToTome(id: string) {
  // Give a just-added or just-unfolded Tome a frame to draw first.
  setTimeout(() => {
    const el = tomeElements.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    (el.querySelector("[data-tome-head]") as HTMLElement | null)?.focus?.();
  }, 80);
}
