import { useSyncExternalStore } from "react";
import { backend } from "../api/backend";
import { DeskLayout } from "../types";

// Speech to text runs on the sync server, and its owner turns it on per account. The answer is cached
// by the backend after every sync; refreshSpeech() asks the server right away.

let allowed = false;
const listeners = new Set<() => void>();

/** What the sync server's admins set for everyone (cached from the last sync). */
export interface ServerInfo {
  deskDefaults?: DeskLayout | null;
  workshopUrl?: string;
  allowedScrolls?: string[];
  scrollQuotaMb?: number;
}
let server: ServerInfo = {};
export const getServerInfo = () => server;

export function speechAllowed(): boolean {
  return allowed;
}

export async function refreshSpeech(fromServer = true) {
  try {
    const { allowed: next, ...info } = await backend.speechStatus(fromServer);
    const infoChanged = JSON.stringify(info) !== JSON.stringify(server);
    server = info;
    if (next !== allowed || infoChanged) {
      allowed = next;
      listeners.forEach((l) => l());
    }
  } catch {
    // keep the last answer
  }
}

export function useServerInfo(): ServerInfo {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => server
  );
}

export function useSpeechAllowed(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => allowed
  );
}

/** Put dictated words into `text` at the cursor (start..end), with spaces around them if needed. */
export function insertWords(text: string, words: string, start = text.length, end = start): string {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const pad = before && !/\s$/.test(before) ? " " : "";
  const tail = after && !/^\s/.test(after) ? " " : "";
  return before + pad + words + tail + after;
}
