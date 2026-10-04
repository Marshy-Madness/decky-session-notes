import { cloneElement, isValidElement, ReactElement, ReactNode } from "react";
import { routerHook } from "@decky/api";
import { afterPatch, beforePatch, ErrorBoundary, findModuleExport, Focusable, Patch } from "@decky/ui";
import { FaRegStickyNote } from "react-icons/fa";
import { NotesPage } from "./components/NotesPage";
import { QuickAccessPanel } from "./components/QuickAccessPanel";
import { getSettings } from "./state/notesStore";
import { dictationChordEnabled, stopAnywhereDictation, toggleAnywhereDictation } from "./dictation";
import { NOTES_ROUTE, openNotesPage, reportButtons } from "./opening";
import { OpenChord } from "./types";

// ---- button combo ----

type Button = "STEAM" | "L4" | "R4" | "L5" | "R5" | "L3" | "R3";

const CHORDS: Record<OpenChord, Button[] | null> = {
  l4r4: ["L4", "R4"],
  l5r5: ["L5", "R5"],
  l3r3: ["L3", "R3"],
  off: null,
};
const DICTATE: Button[] = ["STEAM", "L5", "R5"];
const ORDER: Button[] = ["STEAM", "L4", "R4", "L5", "R5", "L3", "R3"];

// The older feed's bits: ulButtons is the low 32 bits of the state, ulUpperButtons the high 32.
const LO_BITS: [number, Button][] = [
  [0x2000, "STEAM"],
  [0x8000, "L5"],
  [0x10000, "R5"],
  [0x400000, "L3"],
  [0x4000000, "R3"],
];
const HI_BITS: [number, Button][] = [
  [0x200, "L4"],
  [0x400, "R4"],
];

// Steam's own button feed (what its controller test page uses). Each controller has to be asked to stream.
type InputService = {
  StartControllerStateFlow(req: { controller_index: number; flow_mode: number }): unknown;
  RegisterForNotifyButtonStateChanged(cb: (msg: { Body(): { toObject(): any } }) => void): { unregister(): void } | null;
};
const BUTTON_FLOW = 0;
const MAX_CONTROLLERS = 8;
const FLOW_REFRESH_MS = 30_000; // Steam's test page ends the flow when it closes; start it again now and then

function findInputService(): InputService | null {
  try {
    return (
      findModuleExport(
        (e: any) => typeof e?.RegisterForNotifyButtonStateChanged === "function" && typeof e?.StartControllerStateFlow === "function"
      ) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Opens the full-screen page when the chosen combo is pressed, and runs speech to text on STEAM + L5 + R5 if
 * that's turned on. Listens to Steam's newer button feed, with the older controller-state callback as a
 * fallback (that one has a single slot, so another plugin can take it, and newer Steam may not send it at all).
 */
function startChordWatch(): () => void {
  const held = new Set<string>();
  const dictateHeld = new Set<string>();

  const onButtons = (controller: string, down: Set<Button>) => {
    reportButtons(ORDER.filter((b) => down.has(b)).join(" + "));
    const all = (list: Button[]) => list.every((b) => down.has(b));
    if (dictationChordEnabled()) {
      if (!all(DICTATE)) {
        dictateHeld.delete(controller);
      } else if (!dictateHeld.has(controller)) {
        dictateHeld.add(controller);
        held.add(controller); // L5 + R5 with STEAM held is for speaking, not the notes page
        toggleAnywhereDictation();
      }
      if (down.has("STEAM")) return;
    }
    const chord = CHORDS[getSettings().openChord ?? "l4r4"];
    if (!chord) return;
    if (!all(chord)) {
      held.delete(controller);
    } else if (!held.has(controller)) {
      held.add(controller);
      openNotesPage();
    }
  };

  const cleanups: (() => void)[] = [];

  const service = findInputService();
  const feed = service?.RegisterForNotifyButtonStateChanged((msg) => {
    const t = msg.Body().toObject();
    const down = new Set<Button>();
    if (t.button_steam) down.add("STEAM");
    if (t.l4) down.add("L4");
    if (t.r4) down.add("R4");
    if (t.l5) down.add("L5");
    if (t.r5) down.add("R5");
    if (t.left_stick_click) down.add("L3");
    if (t.right_stick_click) down.add("R3");
    onButtons(`feed${t.controller_index}`, down);
  });
  if (service && feed) {
    const startFlows = () => {
      for (let i = 0; i < MAX_CONTROLLERS; i++) {
        try {
          // Controllers that aren't connected just fail; that's fine.
          Promise.resolve(service.StartControllerStateFlow({ controller_index: i, flow_mode: BUTTON_FLOW })).catch(() => {});
        } catch (e) {
          console.warn("Session Notes: couldn't start the button feed", i, e);
        }
      }
    };
    startFlows();
    const timer = setInterval(startFlows, FLOW_REFRESH_MS);
    cleanups.push(() => {
      clearInterval(timer);
      feed.unregister();
    });
  } else {
    console.warn("Session Notes: Steam's button feed wasn't found; using the older controller callback only");
  }

  const legacy = (window as any).SteamClient?.Input?.RegisterForControllerStateChanges?.(
    (changes: { unControllerIndex: number; ulButtons: number; ulUpperButtons: number }[]) => {
      for (const c of changes) {
        const lo = Number(c.ulButtons) || 0;
        const hi = Number(c.ulUpperButtons) || 0;
        const down = new Set<Button>([
          ...LO_BITS.filter(([b]) => lo & b).map(([, n]) => n),
          ...HI_BITS.filter(([b]) => hi & b).map(([, n]) => n),
        ]);
        onButtons(`state${c.unControllerIndex}`, down);
      }
    }
  );
  if (legacy) cleanups.push(() => legacy.unregister());

  return () => {
    cleanups.forEach((c) => c());
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
