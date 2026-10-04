import { cloneElement, isValidElement, ReactElement } from "react";
import { addEventListener, removeEventListener, routerHook } from "@decky/api";
import { afterPatch, ErrorBoundary, findModuleExport, Focusable, Patch } from "@decky/ui";
import { FaRegStickyNote } from "react-icons/fa";
import { NotesPage } from "./components/NotesPage";
import { QuickAccessPanel } from "./components/QuickAccessPanel";
import { getSettings } from "./state/notesStore";
import { dictationBusy, dictationChordEnabled, stopAnywhereDictation, toggleAnywhereDictation } from "./dictation";
import { NOTES_ROUTE, reportButtons, toggleNotesPage } from "./opening";
import { Button, feedRecording, getCombo, isRecordingCombo, sortButtons } from "./combos";
import { speechAllowed } from "./state/speech";
import { stopVoiceCommand, toggleVoiceCommand, voiceBusy } from "./voice";
import { ComboAction } from "./types";

// ---- button combos ----

// Steam's navigation button codes (EGamepadButton), sent while Steam's own screens have focus.
const NAV_BUTTONS: Record<number, Button> = {
  0: "A",
  1: "B",
  2: "X",
  3: "Y",
  4: "UP",
  5: "RIGHT",
  6: "DOWN",
  7: "LEFT",
  8: "MENU",
  9: "VIEW",
  25: "L3",
  28: "L2",
  29: "R2",
  30: "L1",
  31: "R1",
  32: "L5",
  33: "R5",
  34: "STEAM",
  35: "VIEW",
  36: "MENU",
  37: "LPAD",
  39: "RPAD",
  41: "R3",
  44: "L4",
  45: "R4",
};

// The older feed's bits: ulButtons is the low 32 bits of the state, ulUpperButtons the high 32.
const LO_BITS: [number, Button][] = [
  [0x1, "R2"], [0x2, "L2"], [0x4, "R1"], [0x8, "L1"],
  [0x10, "Y"], [0x20, "B"], [0x40, "X"], [0x80, "A"],
  [0x100, "UP"], [0x200, "RIGHT"], [0x400, "LEFT"], [0x800, "DOWN"],
  [0x1000, "VIEW"], [0x2000, "STEAM"], [0x4000, "MENU"],
  [0x8000, "L5"], [0x10000, "R5"], [0x20000, "LPAD"], [0x40000, "RPAD"],
  [0x400000, "L3"], [0x4000000, "R3"],
];
const HI_BITS: [number, Button][] = [
  [0x200, "L4"],
  [0x400, "R4"],
  [0x40000, "QAM"],
];

// Fields of Steam Input's button messages.
const FEED_FIELDS: [string, Button][] = [
  ["button_steam", "STEAM"], ["button_quick_access", "QAM"], ["button_back_view", "VIEW"], ["button_start_options", "MENU"],
  ["button_south", "A"], ["button_east", "B"], ["button_west", "X"], ["button_north", "Y"],
  ["dpad_up", "UP"], ["dpad_down", "DOWN"], ["dpad_left", "LEFT"], ["dpad_right", "RIGHT"],
  ["left_bumper", "L1"], ["right_bumper", "R1"], ["left_trigger", "L2"], ["right_trigger", "R2"],
  ["left_stick_click", "L3"], ["right_stick_click", "R3"],
  ["l4", "L4"], ["r4", "R4"], ["l5", "L5"], ["r5", "R5"],
  ["left_trackpad_click", "LPAD"], ["right_trackpad_click", "RPAD"],
];

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

const ACTIONS: ComboAction[] = ["open", "dictate", "voice"];

function enabledCombos(): { action: ComboAction; buttons: Button[] }[] {
  const s = getSettings();
  const on: Record<ComboAction, boolean> = {
    open: true,
    dictate: dictationChordEnabled(),
    voice: !!s.voiceCommands && speechAllowed(),
  };
  return ACTIONS.flatMap((action) => {
    const buttons = on[action] ? getCombo(action) : null;
    return buttons ? [{ action, buttons }] : [];
  });
}

function runCombo(action: ComboAction) {
  if (action === "open") toggleNotesPage();
  else if (action === "dictate") {
    if (voiceBusy()) return;
    toggleAnywhereDictation();
  } else {
    if (dictationBusy()) return;
    toggleVoiceCommand();
  }
}

/**
 * Runs the button combos: the full-screen page, speech to text and voice commands, each on whatever 1 to 4
 * buttons were set for it. When combos overlap (L4 + R4 and STEAM + L4 + R4), the one with the most buttons
 * held wins, and a combo doesn't fire again until its buttons are let go. The main source is the backend
 * reading the Deck's controller directly, since Steam's callbacks don't reach plugins in a game on current
 * SteamOS. Steam's own feeds are kept as extras, for other controllers and older Steam versions.
 */
function startChordWatch(): () => void {
  // Per controller: the combo that last fired, until its buttons are let go.
  const active = new Map<string, Button[]>();
  const lastFired = new Map<ComboAction, number>();

  const onButtons = (controller: string, down: Set<Button>, source: string) => {
    reportButtons(sortButtons(down).join(" + "), source);
    if (isRecordingCombo()) {
      feedRecording(controller, down);
      active.set(controller, sortButtons(down)); // nothing fires until the recorded buttons are let go
      return;
    }
    const all = (list: Button[]) => list.every((b) => down.has(b));
    const held = active.get(controller);
    if (held && !all(held)) active.delete(controller);

    const best = enabledCombos()
      .filter((c) => all(c.buttons))
      .sort((a, b) => b.buttons.length - a.buttons.length)[0];
    if (!best) return;
    const current = active.get(controller);
    // Still holding the combo that fired, or a smaller one inside it: nothing new.
    if (current && best.buttons.every((b) => current.includes(b))) return;
    active.set(controller, best.buttons);
    if (Date.now() - (lastFired.get(best.action) ?? 0) > REFIRE_MS) {
      lastFired.set(best.action, Date.now());
      runCombo(best.action);
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
    const down = new Set<Button>(FEED_FIELDS.filter(([f]) => t[f]).map(([, b]) => b));
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
    stopVoiceCommand();
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
