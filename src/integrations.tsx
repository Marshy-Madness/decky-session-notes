import { cloneElement, isValidElement, ReactElement, ReactNode } from "react";
import { routerHook } from "@decky/api";
import { afterPatch, beforePatch, ErrorBoundary, Focusable, Navigation, Patch } from "@decky/ui";
import { FaRegStickyNote } from "react-icons/fa";
import { isNotesPageOpen, NotesPage } from "./components/NotesPage";
import { QuickAccessPanel } from "./components/QuickAccessPanel";
import { getSettings } from "./state/notesStore";
import { OpenChord } from "./types";

export const NOTES_ROUTE = "/session-notes";

export function openNotesPage() {
  Navigation.CloseSideMenus();
  Navigation.Navigate(NOTES_ROUTE);
}

// ---- button combo ----

// Steam Deck button bits: ulButtons is the low 32 bits of the state, ulUpperButtons the high 32.
const CHORDS: Record<OpenChord, { lo: number; hi: number } | null> = {
  l4r4: { lo: 0, hi: 0x200 | 0x400 },
  l5r5: { lo: 0x8000 | 0x10000, hi: 0 },
  l3r3: { lo: 0x400000 | 0x4000000, hi: 0 },
  off: null,
};

/** Opens the full-screen page when the chosen combo is pressed (and closes it on a second press). */
function startChordWatch(): () => void {
  const held = new Set<number>();
  const registration = (window as any).SteamClient?.Input?.RegisterForControllerStateChanges?.(
    (changes: { unControllerIndex: number; ulButtons: number; ulUpperButtons: number }[]) => {
      const chord = CHORDS[getSettings().openChord ?? "l4r4"];
      if (!chord) return;
      for (const c of changes) {
        const down = (c.ulButtons & chord.lo) === chord.lo && (c.ulUpperButtons & chord.hi) === chord.hi;
        if (!down) {
          held.delete(c.unControllerIndex);
        } else if (!held.has(c.unControllerIndex)) {
          held.add(c.unControllerIndex);
          if (isNotesPageOpen()) Navigation.NavigateBack();
          else openNotesPage();
        }
      }
    }
  );
  return () => registration?.unregister();
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
