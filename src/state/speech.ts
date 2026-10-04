import { useSyncExternalStore } from "react";
import { backend } from "../api/backend";

// Speech to text runs on the sync server, and its owner turns it on per account. The answer is cached
// by the backend after every sync; refreshSpeech() asks the server right away.

let allowed = false;
const listeners = new Set<() => void>();

export function speechAllowed(): boolean {
  return allowed;
}

export async function refreshSpeech(fromServer = true) {
  try {
    const next = (await backend.speechStatus(fromServer)).allowed;
    if (next !== allowed) {
      allowed = next;
      listeners.forEach((l) => l());
    }
  } catch {
    // keep the last answer
  }
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
