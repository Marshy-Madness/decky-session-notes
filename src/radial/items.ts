import { toaster } from "@decky/api";
import { getSettings, updateSettings } from "../state/notesStore";
import { RadialItem, Settings } from "../types";

// The radial menu's slots: which ones it has and in what order (Settings → Controls), and notes pinned to it
// from a note's window. Pinning a note here is separate from pinning it in the notes list.

export const DEFAULT_ITEMS: RadialItem[] = [{ type: "game" }, { type: "notes" }, { type: "desk" }, { type: "web" }];
export const MAX_ITEMS = 10;

/** The built-in slots, for the "Add" buttons. */
export const BUILT_IN: RadialItem[] = DEFAULT_ITEMS;

export const radialItems = (s: Settings = getSettings()): RadialItem[] => s.radial?.items ?? DEFAULT_ITEMS;

export const sameItem = (a: RadialItem, b: RadialItem) =>
  a.type === b.type && (a.type !== "note" || (b.type === "note" && a.noteId === b.noteId));

export function itemLabel(item: RadialItem): string {
  switch (item.type) {
    case "game":
      return "Current game";
    case "notes":
      return "Notes";
    case "desk":
      return "Desk";
    case "web":
      return "Web Browser";
    case "note":
      return item.title || "Untitled note";
  }
}

export const itemDescription = (item: RadialItem): string =>
  ({
    game: "The game you're playing (or played last). Opens a wheel of its notes.",
    notes: "The notes list for the game you're playing.",
    desk: "Your Desk of Tomes.",
    web: "The browser, back on the page you had open.",
    note: "A note pinned to the wheel.",
  })[item.type];

const save = (items: RadialItem[]) => updateSettings({ radial: { ...getSettings().radial, items } });

export function addItem(item: RadialItem): boolean {
  const items = radialItems();
  if (items.some((x) => sameItem(x, item))) return true;
  if (items.length >= MAX_ITEMS) {
    toaster.toast({ title: "Radial menu is full", body: `It holds ${MAX_ITEMS}. Remove one in Settings → Controls first.` });
    return false;
  }
  save([...items, item]);
  return true;
}

export const removeItem = (i: number) => save(radialItems().filter((_, j) => j !== i));

export function moveItem(i: number, by: -1 | 1) {
  const items = [...radialItems()];
  const j = i + by;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  save(items);
}

export const resetItems = () => updateSettings({ radial: { ...getSettings().radial, items: undefined } });

export const isNoteOnWheel = (noteId: string, s: Settings = getSettings()) =>
  radialItems(s).some((x) => x.type === "note" && x.noteId === noteId);

/** Pins a note to the wheel, or takes it off. Returns whether it's on the wheel now. */
export function toggleNoteOnWheel(appId: string, noteId: string, title: string): boolean {
  if (isNoteOnWheel(noteId)) {
    save(radialItems().filter((x) => !(x.type === "note" && x.noteId === noteId)));
    return false;
  }
  return addItem({ type: "note", appId, noteId, title });
}
