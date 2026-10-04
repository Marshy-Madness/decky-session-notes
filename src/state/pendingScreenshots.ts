import { useSyncExternalStore } from "react";

/** Screenshots taken in-game that haven't been attached to a note or dismissed yet. */
export interface PendingShots {
  appId: string;
  paths: string[];
}

let pending: PendingShots | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export function addPendingScreenshot(appId: string, path: string) {
  if (pending?.appId !== appId) pending = { appId, paths: [] };
  if (!pending.paths.includes(path)) pending = { appId, paths: [...pending.paths, path] };
  emit();
}

export function clearPendingScreenshots() {
  pending = null;
  emit();
}

export function getPendingScreenshots() {
  return pending;
}

export function usePendingScreenshots(): PendingShots | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending
  );
}
