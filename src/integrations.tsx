import { cloneElement, isValidElement, ReactElement, ReactNode } from "react";
import { routerHook } from "@decky/api";
import { afterPatch, beforePatch, ErrorBoundary, Focusable, Patch } from "@decky/ui";
import { FaRegStickyNote } from "react-icons/fa";
import { NotesPage } from "./components/NotesPage";
import { QuickAccessPanel } from "./components/QuickAccessPanel";
import { getSettings } from "./state/notesStore";
import { dictationChordEnabled, stopAnywhereDictation, toggleAnywhereDictation } from "./dictation";
import { NOTES_ROUTE, openNotesPage, reportButtons } from "./opening";
import { OpenChord } from "./types";

// ---- button combo ----

// Steam Deck button bits: ulButtons is the low 32 bits of the state, ulUpperButtons the high 32.
const CHORDS: Record<OpenChord, { lo: number; hi: number } | null> = {
  l4r4: { lo: 0, hi: 0x200 | 0x400 },
  l5r5: { lo: 0x8000 | 0x10000, hi: 0 },
  l3r3: { lo: 0x400000 | 0x4000000, hi: 0 },
  off: null,
};
const STEAM = 0x2000;
const DICTATE = STEAM | 0x8000 | 0x10000; // STEAM + L5 + R5

// Names for the live readout in Settings.
const LO_NAMES: [number, string][] = [
  [STEAM, "STEAM"],
  [0x8000, "L5"],
  [0x10000, "R5"],
  [0x400000, "L3"],
  [0x4000000, "R3"],
];
const HI_NAMES: [number, string][] = [
  [0x200, "L4"],
  [0x400, "R4"],
];
const buttonNames = (lo: number, hi: number) =>
  [...LO_NAMES.filter(([b]) => lo & b), ...HI_NAMES.filter(([b]) => hi & b)].map(([, n]) => n).join(" + ");

/**
 * Opens the full-screen page when the chosen combo is pressed, and runs speech to text on STEAM + L5 + R5 if
 * that's turned on. (B closes the page; a second press used to, but the page stays mounted behind a game
 * after you go back to it, so that press ended up doing nothing.)
 */
function startChordWatch(): () => void {
  const held = new Set<number>();
  const dictateHeld = new Set<number>();
  const registration = (window as any).SteamClient?.Input?.RegisterForControllerStateChanges?.(
    (changes: { unControllerIndex: number; ulButtons: number; ulUpperButtons: number }[]) => {
      const dictate = dictationChordEnabled();
      const chord = CHORDS[getSettings().openChord ?? "l4r4"];
      for (const c of changes) {
        reportButtons(buttonNames(c.ulButtons, c.ulUpperButtons));
        if (dictate) {
          if ((c.ulButtons & DICTATE) !== DICTATE) {
            dictateHeld.delete(c.unControllerIndex);
          } else if (!dictateHeld.has(c.unControllerIndex)) {
            dictateHeld.add(c.unControllerIndex);
            held.add(c.unControllerIndex); // L5 + R5 with STEAM held is for speaking, not the notes page
            toggleAnywhereDictation();
          }
          if (c.ulButtons & STEAM) continue;
        }
        if (!chord) continue;
        const down = (c.ulButtons & chord.lo) === chord.lo && (c.ulUpperButtons & chord.hi) === chord.hi;
        if (!down) {
          held.delete(c.unControllerIndex);
        } else if (!held.has(c.unControllerIndex)) {
          held.add(c.unControllerIndex);
          openNotesPage();
        }
      }
    }
  );
  return () => {
    registration?.unregister();
    stopAnywhereDictation();
  };
}

// ---- main Steam menu ----

const MENU_KEY = "session-notes";
type MenuItem = ReactElement & { key: string | null };

/** The menu's item list: either its children array, or an array nested one level inside it. */
function findMenuItems(children: ReactNode): MenuItem[] | null {
  if (!Array.isArray(children)) return null;
  const hasSettings = (list: unknown[]) => list.some((e) => isValidElement(e) && e.key === "settings");
  if (hasSettings(children)) return children as MenuItem[];
  return (children.find((c) => Array.isArray(c) && hasSettings(c)) as MenuItem[] | undefined) ?? null;
}

/**
 * Steam builds the main menu's items inside its own code, then renders them as children of its shared
 * Focusable. We add our item there, copied from the Downloads entry so it looks and behaves the same.
 */
function patchMainMenu(): Patch | null {
  const target = Focusable as any;
  if (typeof target?.render !== "function") return null;
  return beforePatch(target, "render", (args: any[]) => {
    const props = args[0];
    if (props?.role !== "menu" || !getSettings().mainMenuEntry) return;
    const items = findMenuItems(props.children);
    if (!items || items.some((e) => e.key === MENU_KEY)) return;
    const after = ["downloads", "media", "library"].map((k) => items.findIndex((e) => e.key === k)).find((i) => i >= 0);
    if (after === undefined) return;
    const item = cloneElement(items[after], {
      key: MENU_KEY,
      route: NOTES_ROUTE,
      routeState: undefined,
      active: "if-within-route",
      label: "Session Notes",
      icon: <FaRegStickyNote />,
    } as any);
    const next = [...items.slice(0, after + 1), item, ...items.slice(after + 1)];
    const children = props.children === items ? next : props.children.map((c: unknown) => (c === items ? next : c));
    args[0] = { ...props, children };
  });
}

// ---- own Quick Access tab ----

const QAM_TAB_KEY = 735101;

/**
 * Decky's own tab hook adds its tab to the Quick Access menu on every render; we ride along on it and
 * add (or remove) ours depending on the setting.
 */
function patchQamTabs(): Patch | null {
  const hook = (window as any).__TABS_HOOK_INSTANCE;
  if (typeof hook?.render !== "function") return null;
  return afterPatch(hook, "render", (args: any[], ret: any) => {
    const tabs = args[0];
    if (!Array.isArray(tabs)) return ret;
    const i = tabs.findIndex((t) => t?.key === QAM_TAB_KEY);
    if (getSettings().qamTab) {
      if (i < 0) {
        tabs.push({
          key: QAM_TAB_KEY,
          title: "Session Notes",
          tab: <FaRegStickyNote />,
          panel: (
            <ErrorBoundary>
              <QuickAccessPanel />
            </ErrorBoundary>
          ),
        });
      }
    } else if (i >= 0) {
      tabs.splice(i, 1);
    }
    return ret;
  });
}

/** Sets up the full-screen page, button combo, main-menu entry and Quick Access tab. Returns a cleanup. */
export function startIntegrations(): () => void {
  routerHook.addRoute(NOTES_ROUTE, NotesPage, { exact: true });
  const stopChord = startChordWatch();
  const patches = [patchMainMenu(), patchQamTabs()];
  return () => {
    stopChord();
    patches.forEach((p) => p?.unpatch());
    routerHook.removeRoute(NOTES_ROUTE);
  };
}
