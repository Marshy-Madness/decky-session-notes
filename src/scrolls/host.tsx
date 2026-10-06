import * as React from "react";
import { FC, useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as DFL from "@decky/ui";
import { showModal } from "@decky/ui";
import { routerHook, toaster } from "@decky/api";
import { backend } from "../api/backend";
import { getSettings, loadSettings, updateSettings, useSettings, emitDataChanged } from "../state/notesStore";
import { registerTome, TomeProps } from "../tomes/registry";
import { Btn, Buttons, Hint, Line, ellipsis } from "../tomes/bits";
import { onMainMenu, onQamTabs, openWorkshopEntry, qamTabsAvailable } from "./hooks";
import { openLink } from "../browser";
import { showPage } from "../opening";
import { NameModal } from "../components/NameModal";
import { InstalledScroll, ScrollState, WorkshopPack } from "../types";
import { errText } from "../utils/errors";
import { DeskScrollApi, ScrollActivate } from "./api";

// Runs the installed Scrolls. Code Scrolls come from the backend only after their Workshop signature checks
// out (py_modules/scrolls.py); data Scrolls never run anything and become a Tome showing what's in them.

interface Running {
  cleanups: (() => void)[];
  settingsPage?: FC<{ closeModal?: () => void }>;
}

export type ScrollStatus = { state: "on" } | { state: "off" } | { state: "starting" } | { state: "error"; error: string };

const running = new Map<string, Running>();
const status = new Map<string, ScrollStatus>();
let installed: InstalledScroll[] = [];
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Re-renders when Scrolls are installed, started or stopped. */
export function useScrolls() {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version
  );
  return { installed, status: (id: string): ScrollStatus => status.get(id) ?? { state: "off" }, settingsPage: (id: string) => running.get(id)?.settingsPage };
}

const stateOf = (id: string): ScrollState => getSettings().scrolls?.[id] ?? {};

async function setState(id: string, patch: Partial<ScrollState> | null) {
  const all = { ...getSettings().scrolls };
  if (patch === null) delete all[id];
  else all[id] = { ...all[id], ...patch };
  await updateSettings({ scrolls: all });
}

function stop(id: string) {
  const r = running.get(id);
  running.delete(id);
  r?.cleanups.reverse().forEach((c) => {
    try {
      c();
    } catch (e) {
      console.warn(`Desk of Madness: Scroll ${id} didn't stop cleanly`, e);
    }
  });
  status.set(id, { state: "off" });
  changed();
}

/** NameModal that answers null when it's closed without saving. */
const AskModal: FC<{ heading: string; label?: string; initial?: string; resolve: (v: string | null) => void; closeModal?: () => void }> = ({
  resolve,
  closeModal,
  ...rest
}) => {
  const done = useRef(false);
  return (
    <NameModal
      {...rest}
      onSubmit={(text) => {
        done.current = true;
        resolve(text);
      }}
      closeModal={() => {
        if (!done.current) resolve(null);
        closeModal?.();
      }}
    />
  );
};

function makeApi(scroll: InstalledScroll, r: Running): DeskScrollApi {
  const id = scroll.id;
  const settingsOf = () => (stateOf(id).settings ?? {}) as any;
  return {
    scroll: { id, name: scroll.name, version: scroll.version ?? "" },
    React,
    ui: DFL,
    decky: { routerHook, toaster },
    registerTome: (def) =>
      r.cleanups.push(registerTome({ category: "desk", ...def, id: `${id}:${def.id}`, scroll: id } as any)),
    bits: { Line, Buttons, Btn, Hint },
    settings: {
      get: () => settingsOf(),
      set: (patch) => setState(id, { settings: { ...settingsOf(), ...patch } }),
      use: function useScrollSettings() {
        useSettings();
        return settingsOf();
      },
    },
    setSettingsPage: (page) => {
      r.settingsPage = page;
      changed();
    },
    onQamTabs: (hook) => r.cleanups.push(onQamTabs(hook)),
    qamTabsAvailable,
    onMainMenu: (hook) => r.cleanups.push(onMainMenu(hook)),
    addRoute: (path, component, exact) => {
      routerHook.addRoute(path, component, exact ? { exact: true } : undefined);
      r.cleanups.push(() => routerHook.removeRoute(path));
    },
    patchRoute: (path, patch) => {
      const p = routerHook.addPatch(path, patch);
      r.cleanups.push(() => routerHook.removePatch(path, p));
    },
    showPage,
    openUrl: (url) => openLink(url),
    steamNews: (appId, count) => backend.steamNews(appId, count),
    workshopEntries: (params) => backend.bsEntries(params),
    openWorkshopEntry,
    askText: (heading, label, initial) =>
      new Promise((resolve) => showModal(<AskModal heading={heading} label={label} initial={initial} resolve={resolve} />)),
    onUnload: (fn) => r.cleanups.push(fn),
    disable: (reason) => {
      console.warn(`Desk of Madness: Scroll ${id} turned itself off: ${reason}`);
      // Later, so a Scroll can call this while it's still starting.
      setTimeout(() => {
        stop(id);
        setState(id, { enabled: false, offReason: reason });
        toaster.toast({ title: `${scroll.icon ?? "📜"} ${scroll.name} turned off`, body: reason, duration: 8000 });
      }, 0);
    },
    log: (...args) => console.info(`[Scroll ${id}]`, ...args),
  };
}

async function start(id: string) {
  if (running.has(id)) return;
  const r: Running = { cleanups: [] };
  running.set(id, r);
  status.set(id, { state: "starting" });
  changed();
  try {
    const scroll = await backend.scrollLoad(id);
    if (!running.has(id)) return; // turned off while loading
    if (scroll.kind === "data") {
      r.cleanups.push(registerDataTome(scroll));
    } else if (scroll.code && scroll.signedBy) {
      const api = makeApi(scroll, r);
      // The bundle sets `__scroll` to its activate function (scrolls/build.mjs makes it so).
      const activate = new Function("desk", `"use strict";\n${scroll.code}\n;return typeof __scroll === "undefined" ? undefined : __scroll;`)(api) as
        | ScrollActivate
        | undefined;
      if (typeof activate !== "function") throw new Error("The Scroll has no activate function");
      const cleanup = await activate(api);
      if (typeof cleanup === "function") r.cleanups.push(cleanup);
    } else {
      throw new Error("Not signed by the Madness Workshop");
    }
    if (running.get(id) === r) status.set(id, { state: "on" });
  } catch (e) {
    console.error(`Desk of Madness: Scroll ${id} failed to start`, e);
    stop(id);
    status.set(id, { state: "error", error: errText(e) });
  }
  changed();
}

/** Reads the installed list again (after an install or removal). */
export async function refreshInstalled() {
  try {
    installed = await backend.scrollsInstalled();
  } catch (e) {
    console.warn("Desk of Madness: couldn't list Scrolls", e);
  }
  changed();
  return installed;
}

/** Starts every installed Scroll that's turned on. Returns a cleanup that stops them all. */
export function startScrolls(): () => void {
  (async () => {
    await loadSettings();
    for (const s of await refreshInstalled()) {
      if (!s.broken && stateOf(s.id).enabled) await start(s.id);
    }
  })();
  return () => [...running.keys()].forEach(stop);
}

export async function setScrollEnabled(id: string, on: boolean) {
  await setState(id, { enabled: on, offReason: undefined });
  if (on) await start(id);
  else stop(id);
}

/** Installs (or updates) a Scroll from the Workshop and starts it if it's on. */
export async function installScroll(id: string): Promise<InstalledScroll> {
  const wasRunning = running.has(id);
  const meta = await backend.scrollInstall(id);
  await refreshInstalled();
  const first = !getSettings().scrolls?.[id];
  // New Scrolls start on, except ones that change Decky itself: those wait until you turn them on.
  if (first) await setState(id, { enabled: !(meta.permissions ?? []).includes("decky-ui") });
  if (wasRunning) stop(id);
  if (stateOf(id).enabled) await start(id);
  return meta;
}

export async function removeScroll(id: string) {
  stop(id);
  await backend.scrollRemove(id);
  await loadSettings(); // the backend dropped its settings too
  status.delete(id);
  await refreshInstalled();
}

// ---------- data Scrolls: a Tome with their text, links, Note Packs and Desk layout ----------

const PackLine: FC<{ id: string }> = ({ id }) => {
  const [pack, setPack] = useState<WorkshopPack | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    backend.bsPack(id).then(setPack).catch(() => setPack(null));
  }, [id]);
  const copy = async () => {
    setBusy(true);
    try {
      const r = await backend.bsCopyPack(id);
      emitDataChanged();
      toaster.toast({ title: "Madness Workshop", body: `Copied ${r.copied} from “${r.title}”${r.skipped ? ` (${r.skipped} already in your notes)` : ""}.` });
    } catch (e) {
      toaster.toast({ title: "Madness Workshop", body: errText(e) });
    }
    setBusy(false);
  };
  return (
    <Line icon="📦" onOpen={busy ? undefined : copy} okLabel="Copy to my notes">
      <div style={ellipsis}>{pack?.title ?? "Note Pack"}</div>
      <div className="dom-sub" style={{ fontSize: "12px", opacity: 0.6 }}>
        {busy ? "Copying…" : pack ? `${pack.count} books · tap to copy them to your notes` : "Loading…"}
      </div>
    </Line>
  );
};

function registerDataTome(scroll: InstalledScroll): () => void {
  const data = scroll.data ?? {};
  const DataTome: FC<TomeProps> = () => (
    <>
      {data.text && <div style={{ fontSize: "13px", whiteSpace: "pre-wrap", marginBottom: "6px", opacity: 0.9 }}>{data.text}</div>}
      {data.links?.map((l, i) => (
        <Line key={i} icon="🔗" onOpen={() => openLink(l.url)} okLabel="Open">
          <div style={ellipsis}>{l.title}</div>
          {l.note && <div className="dom-sub" style={{ fontSize: "12px", opacity: 0.6 }}>{l.note}</div>}
        </Line>
      ))}
      {data.packs?.map((p) => <PackLine key={p} id={p} />)}
      {data.layout && (
        <Buttons>
          <Btn
            onClick={() => {
              const desk = getSettings().desk ?? {};
              updateSettings({ desk: { ...desk, layout: data.layout } });
              toaster.toast({ title: "Desk of Madness", body: `Using the Desk layout from “${scroll.name}” for games without their own.` });
            }}
          >
            Use this Desk layout
          </Btn>
        </Buttons>
      )}
    </>
  );
  return registerTome({
    id: `scroll:${scroll.id}`,
    name: scroll.name,
    icon: scroll.icon ?? "📜",
    category: "desk",
    description: scroll.summary || "From a Scroll",
    defaultOn: true,
    needsGame: false,
    component: DataTome,
    scroll: scroll.id,
  });
}
