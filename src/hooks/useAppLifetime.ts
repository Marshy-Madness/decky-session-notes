import { useSyncExternalStore } from "react";
import { Router } from "@decky/ui";
import { toaster } from "@decky/api";
import { backend } from "../api/backend";
import { emitDataChanged } from "../state/notesStore";

export interface RunningGame {
  appId: string;
  name: string;
}

let current: RunningGame | null = null;
const listeners = new Set<() => void>();
let onSessionEnd: ((game: RunningGame) => void) | null = null;

function setCurrent(game: RunningGame | null) {
  current = game;
  listeners.forEach((l) => l());
}

function appName(appId: number | string): string {
  return (window as any).appStore?.GetAppOverviewByAppID?.(Number(appId))?.display_name ?? String(appId);
}

/**
 * Runs for the plugin's whole lifetime (not just while the panel is open), so
 * launches are counted and the running game is known as soon as the panel opens.
 */
export function startLifetimeTracking(sessionEnded: (game: RunningGame) => void): () => void {
  onSessionEnd = sessionEnded;

  const main = Router.MainRunningApp;
  if (main) {
    const game = { appId: String(main.appid), name: main.display_name ?? appName(main.appid) };
    setCurrent(game);
    backend.ensureGame(game.appId, game.name).then(emitDataChanged);
  }

  const registration = (window as any).SteamClient?.GameSessions?.RegisterForAppLifetimeNotifications(
    async (n: { unAppID: number; bRunning: boolean }) => {
      const appId = String(n.unAppID);
      if (n.bRunning) {
        if (current?.appId === appId) return; // extra process for the same game
        const game = { appId, name: appName(appId) };
        setCurrent(game);
        const summary = await backend.recordLaunch(appId, game.name);
        emitDataChanged();
        if (summary.leftOff?.text) {
          toaster.toast({ title: `📍 ${game.name}: where you left off`, body: summary.leftOff.text, duration: 8000 });
        }
      } else if (current?.appId === appId) {
        const ended = current;
        setCurrent(null);
        await backend.recordExit(appId);
        emitDataChanged();
        onSessionEnd?.(ended);
      }
    }
  );

  return () => {
    registration?.unregister();
    onSessionEnd = null;
    listeners.clear();
  };
}

export function getRunningGame(): RunningGame | null {
  return current;
}

export function useRunningGame(): RunningGame | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current
  );
}
