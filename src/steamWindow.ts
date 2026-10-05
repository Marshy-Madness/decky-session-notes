import { useEffect, useState } from "react";
import { Router } from "@decky/ui";

// Bits of Steam's Gamepad UI window that @decky/ui doesn't wrap. Everything here is optional: if Steam renames
// something, callers get null and fall back to older behaviour. Names were checked against steamui on 2026-10-04.

type Location = { pathname: string; search: string };
export interface SteamHistory {
  location: Location;
  push(path: string): void;
  replace(path: string): void;
  goBack(): void;
  listen(cb: (location: Location) => void): () => void;
}

/** Steam's main Gamepad UI window (the one plugin pages render in). */
export function mainWindow(): any {
  return (Router as any)?.WindowStore?.GamepadUIMainWindowInstance ?? null;
}

/** The window's router history (react-router's memory history). */
export function steamHistory(): SteamHistory | null {
  const h = mainWindow()?.m_history;
  return h && typeof h.replace === "function" ? h : null;
}

export function currentPath(): string {
  const loc = steamHistory()?.location;
  return loc ? loc.pathname + (loc.search || "") : "";
}

/** Swaps the address of the page being shown without adding a step to Back. */
export function replacePath(path: string) {
  const h = steamHistory();
  if (h && currentPath() !== path) h.replace(path);
}

/** Follows the address as it changes. */
export function useSteamPath(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const h = steamHistory();
    if (!h) return;
    setPath(currentPath());
    return h.listen(() => setPath(currentPath()));
  }, []);
  return path;
}

// ---- header and footer ----

/** Height of Steam's top bar (clock, battery) and bottom bar (button hints) right now, in pixels. */
export function chromeHeights(): { header: number; footer: number } {
  const w = mainWindow();
  const header = Number(w?.HeaderStore?.m_flCurrentHeaderHeight);
  const footer = Number(w?.FooterStore?.m_flCurrentFooterHeight);
  return { header: Number.isFinite(header) ? header : 40, footer: Number.isFinite(footer) ? footer : 0 };
}

/** The header/footer heights, kept current: themes and Steam itself change them (the header hides in some states). */
export function useChromeHeights(): { header: number; footer: number } {
  const [h, setH] = useState(chromeHeights);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = chromeHeights();
      setH((cur) => (cur.header === next.header && cur.footer === next.footer ? cur : next));
    }, 250);
    return () => clearInterval(timer);
  }, []);
  return h;
}

// ---- is Steam's UI in front of the game? ----

const STEAM_UI_APPID = 769; // what gamescope reports as focused when Steam's own UI has the screen

/** True once gamescope has put Steam's UI in front, false while the game has it, null if we can't tell. */
export function steamUiInFront(): boolean | null {
  const store = mainWindow()?.CompositionStateStore;
  const focused = store?.GetCurrentlyFocusedAppidSubscribableValue?.()?.Value;
  return typeof focused === "number" ? focused === STEAM_UI_APPID : null;
}

/** Whether Steam's main (Steam button) menu is open. */
export function mainMenuOpen(): boolean | null {
  const store = mainWindow()?.MenuStore;
  return typeof store?.GetOpenSideMenu === "function" ? store.GetOpenSideMenu() === 1 : null;
}
