import { cloneElement, isValidElement, ReactElement } from "react";
import { addEventListener, removeEventListener, routerHook } from "@decky/api";
import { afterPatch, ErrorBoundary, findModuleExport, Focusable, Patch } from "@decky/ui";
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

// Steam's navigation button codes (EGamepadButton), sent while Steam's own screens have focus.
const NAV_BUTTONS: Record<number, Button> = {
  34: "STEAM",
  44: "L4",
  45: "R4",
  32: "L5",
  33: "R5",
  25: "L3",
  41: "R3",
};

// Steam's own button feed (what its controller test page uses). Each controller has to be asked to stream.
type InputService = {
  StartControllerStateFlow(req: { controller_index: number; flow_mode: number }): unknown;
  RegisterForNotifyButtonStateChanged(cb: (msg: { Body(): { toObject(): any } }) => void): { unregister(): void } | null;
};
const BUTTON_FLOW = 0;
const MAX_CONTROLLERS = 8;
const FLOW_REFRESH_MS = 30_000; // Steam's test page ends the flow when it closes; start it again now and then
const REFIRE_MS = 800; // several feeds can report the same press; act on it once

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
 * that's turned on. The main source is the backend reading the Deck's controller directly, since Steam's
 * callbacks don't reach plugins in a game on current SteamOS. Steam's own feeds are kept as extras, for other
 * controllers and older Steam versions.
 */
function startChordWatch(): () => void {
  const held = new Set<string>();
  const dictateHeld = new Set<string>();
  let lastOpen = 0;
  let lastDictate = 0;

  const onButtons = (controller: string, down: Set<Button>, source: string) => {
    reportButtons(ORDER.filter((b) => down.has(b)).join(" + "), source);
    const all = (list: Button[]) => list.every((b) => down.has(b));
    if (dictationChordEnabled()) {
      if (!all(DICTATE)) {
        dictateHeld.delete(controller);
      } else if (!dictateHeld.has(controller)) {
        dictateHeld.add(controller);
        held.add(controller); // L5 + R5 with STEAM held is for speaking, not the notes page
        if (Date.now() - lastDictate > REFIRE_MS) {
          lastDictate = Date.now();
          toggleAnywhereDictation();
        }
      }
      if (down.has("STEAM")) return;
    }
    const chord = CHORDS[getSettings().openChord ?? "l4r4"];
    if (!chord) return;
    if (!all(chord)) {
      held.delete(controller);
    } else if (!held.has(controller)) {
      held.add(controller);
      if (Date.now() - lastOpen > REFIRE_MS) {
        lastOpen = Date.now();
        openNotesPage();
      }
    }
  };

  const cleanups: (() => void)[] = [];

  // The Deck's own controller, read by the backend.
  const onDeck = (names: string[]) => onButtons("deck", new Set(names as Button[]), "Deck controller");
  addEventListener("buttons", onDeck);
  cleanups.push(() => removeEventListener("buttons", onDeck));

  // Steam's navigation input: only while Steam's screens have focus, but covers any controller.
  const navDown = new Map<number, Set<Button>>();
  const nav = (window as any).SteamClient?.Input?.RegisterForControllerInputMessages?.(
    (index: number, button: number, pressed: boolean) => {
      const name = NAV_BUTTONS[button];
      if (!name) return;
      const down = navDown.get(index) ?? new Set<Button>();
      navDown.set(index, down);
      if (pressed) down.add(name);
      else down.delete(name);
      onButtons(`nav${index}`, new Set(down), "Steam menus");
    }
  );
  if (nav) cleanups.push(() => nav.unregister());

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
    onButtons(`feed${t.controller_index}`, down, "Steam Input");
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
        onButtons(`state${c.unControllerIndex}`, down, "Steam controller state");
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

const hasSettings = (list: unknown[]) => list.some((e) => isValidElement(e) && e.key === "settings");

/** Returns the menu's item list with our entry added, or null if it's not the main menu or already has it. */
function withNotesItem(items: unknown): MenuItem[] | null {
  if (!Array.isArray(items) || !hasSettings(items)) return null;
  const list = items as MenuItem[];
  if (list.some((e) => e.key === MENU_KEY)) return null;
  const after = ["downloads", "media", "library"].map((k) => list.findIndex((e) => e.key === k)).find((i) => i >= 0);
  if (after === undefined) return null;
  const item = cloneElement(list[after], {
    key: MENU_KEY,
    route: NOTES_ROUTE,
    routeState: undefined,
    active: "if-within-route",
    label: "Session Notes",
    icon: <FaRegStickyNote />,
  } as any);
  return [...list.slice(0, after + 1), item, ...list.slice(after + 1)];
}

/**
 * Steam builds the main menu's items inside its own code, then passes them as children to its shared
 * Focusable. Newer Steam makes Focusable a plain function we can't patch in place, so we watch for it at
 * React.createElement instead and add our item there, copied from the Downloads entry so it looks and
 * behaves the same.
 */
function patchMainMenu(): (() => void) | null {
  const react = (window as any).SP_REACT;
  if (!Focusable || typeof react?.createElement !== "function") return null;
  const original = react.createElement;
  const patched = function (this: unknown, type: unknown, props: any, ...children: unknown[]) {
    if (type === Focusable && props?.role === "menu" && getSettings().mainMenuEntry) {
      try {
        // Children come either as extra arguments or in props.children, possibly one array deep.
        if (children.length) {
          children = children.map((c) => withNotesItem(c) ?? c);
        } else if (props.children) {
          const kids = props.children;
          const direct = withNotesItem(kids);
          props = {
            ...props,
            children: direct ?? (Array.isArray(kids) ? kids.map((c: unknown) => withNotesItem(c) ?? c) : kids),
          };
        }
      } catch (e) {
        console.warn("Session Notes: couldn't add the Steam menu entry", e);
      }
    }
    return original.call(this, type, props, ...children);
  };
  react.createElement = patched;
  return () => {
    if (react.createElement === patched) react.createElement = original;
  };
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
  const patches = [patchQamTabs()];
  const unpatchMenu = patchMainMenu();
  return () => {
    stopChord();
    patches.forEach((p) => p?.unpatch());
    unpatchMenu?.();
    routerHook.removeRoute(NOTES_ROUTE);
  };
}
