import { useSyncExternalStore } from "react";
import { getSettings } from "./state/notesStore";
import { ComboAction, OpenChord } from "./types";

// Button combos: which buttons each action needs, and recording a new combo by holding it.

export const BUTTONS = [
  "STEAM", "QAM", "VIEW", "MENU",
  "A", "B", "X", "Y",
  "UP", "DOWN", "LEFT", "RIGHT",
  "L1", "R1", "L2", "R2",
  "L3", "R3", "L4", "R4", "L5", "R5",
  "LPAD", "RPAD",
] as const;
export type Button = (typeof BUTTONS)[number];

export const MAX_COMBO = 4;

const LABELS: Partial<Record<Button, string>> = {
  QAM: "···",
  VIEW: "View",
  MENU: "Menu",
  UP: "D-pad ↑",
  DOWN: "D-pad ↓",
  LEFT: "D-pad ←",
  RIGHT: "D-pad →",
  L3: "L3 (stick click)",
  R3: "R3 (stick click)",
  LPAD: "Left trackpad click",
  RPAD: "Right trackpad click",
};

export const buttonLabel = (b: Button) => LABELS[b] ?? b;
export const comboLabel = (combo: Button[] | null) =>
  combo?.length ? combo.map(buttonLabel).join(" + ") : "Off";

/** Puts buttons in a fixed order, so the same combo always reads the same way. */
export const sortButtons = (list: Iterable<string>): Button[] =>
  BUTTONS.filter((b) => new Set(list).has(b));

const OLD_CHORDS: Record<OpenChord, Button[]> = {
  l4r4: ["L4", "R4"],
  l5r5: ["L5", "R5"],
  l3r3: ["L3", "R3"],
  off: [],
};

// Desk and Web Browser start off: they're for people who want a button straight to them.
export const DEFAULT_COMBOS: Record<ComboAction, Button[]> = {
  radial: ["R4", "R5"],
  open: ["L4", "R4"],
  desk: [],
  web: [],
  dictate: ["STEAM", "L5", "R5"],
  voice: ["STEAM", "L4", "R4"],
};

/** The combo for an action, or null if it's off. Settings from before custom combos still count. */
export function getCombo(action: ComboAction): Button[] | null {
  const s = getSettings();
  let combo = s.combos?.[action] as Button[] | undefined;
  if (!combo && action === "open" && s.openChord) combo = OLD_CHORDS[s.openChord];
  if (!combo && action === "radial") combo = (s.combos?.tomes as Button[] | undefined) ?? (s.desk?.radial === false ? [] : undefined);
  combo = combo ? sortButtons(combo) : DEFAULT_COMBOS[action];
  return combo.length ? combo : null;
}

// ---- recording a combo: hold the buttons, let go, and the most you held at once becomes the combo ----

// Several feeds report the same buttons; the first one to see a button press is the one we listen to, so
// another feed reporting "nothing held" can't end the recording early.
type Recording = { action: ComboAction; most: Button[]; source: string | null; onDone: (combo: Button[]) => void };
let recording: Recording | null = null;
let preview: Button[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function startRecordingCombo(action: ComboAction, onDone: (combo: Button[]) => void) {
  recording = { action, most: [], source: null, onDone };
  preview = [];
  emit();
}

export function cancelRecordingCombo() {
  recording = null;
  preview = [];
  emit();
}

/** While recording, the combo watcher hands every change here and doesn't run any combos. */
export function isRecordingCombo(): boolean {
  return recording !== null;
}

export function feedRecording(source: string, down: Set<Button>) {
  const r = recording;
  if (!r) return;
  if (!r.source && down.size) r.source = source;
  if (r.source !== source) return;
  const now = sortButtons(down);
  if (now.length > r.most.length) r.most = now.slice(0, MAX_COMBO);
  preview = now.length ? now.slice(0, MAX_COMBO) : r.most;
  if (!now.length && r.most.length) {
    recording = null;
    r.onDone(r.most);
  }
  emit();
}

export function useComboRecording(): { action: ComboAction | null; preview: Button[] } {
  const action = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => recording?.action ?? null
  );
  const shown = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => preview
  );
  return { action, preview: shown };
}
