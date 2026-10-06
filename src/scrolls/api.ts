import type * as React from "react";
import type { FC } from "react";
import type * as DFL from "@decky/ui";
import type { routerHook, toaster } from "@decky/api";
import type { TomeDef } from "../tomes/registry";
import type { Line, Buttons, Btn, Hint } from "../tomes/bits";
import type { MainMenuHook, QamTabsHook } from "./hooks";
import type { SteamNewsItem, WorkshopSummary } from "../types";

// What a code Scroll gets. A Scroll's code is a function `activate(desk)` (the default export of its
// index.tsx, see scrolls/README.md); it may return a cleanup. Everything it adds through `desk` is removed
// again when the Scroll is turned off, so Scrolls can be switched on and off without restarting.

export interface DeskScrollApi {
  scroll: { id: string; name: string; version: string };
  /** Steam's React, and Decky's UI library (the same ones the plugin uses). */
  React: typeof React;
  ui: typeof DFL;
  decky: { routerHook: typeof routerHook; toaster: typeof toaster };

  /** Adds a Tome to the Desk (the id is prefixed with the Scroll's, so it can't clash with built-in ones). */
  registerTome(def: Omit<TomeDef, "scroll" | "category"> & { category?: TomeDef["category"] }): void;
  /** The small building blocks the built-in Tomes use. */
  bits: { Line: typeof Line; Buttons: typeof Buttons; Btn: typeof Btn; Hint: typeof Hint };

  /** This Scroll's own settings, saved with Desk's settings (and synced with them). */
  settings: {
    get<T extends object>(): Partial<T>;
    set<T extends object>(patch: Partial<T>): Promise<void>;
    /** React hook: the settings, re-rendering when they change. */
    use<T extends object>(): Partial<T>;
  };
  /** A page for the Scroll's ⚙ Settings button in Scrolls. */
  setSettingsPage(page: FC<{ closeModal?: () => void }>): void;

  /** Quick Access tabs: change Steam's tab list as the menu draws. */
  onQamTabs(hook: QamTabsHook): void;
  qamTabsAvailable(): boolean;
  /** Main Steam menu: change its entries as it draws. */
  onMainMenu(hook: MainMenuHook): void;
  /** A full-screen page at `path` (removed when the Scroll stops). */
  addRoute(path: string, component: FC, exact?: boolean): void;
  /** Decky's route patch (e.g. "/library/app/:appid"), removed when the Scroll stops. */
  patchRoute(path: string, patch: (tree: any) => any): void;
  /** Shows one of Desk's pages or a Scroll's route, over the game if one is running. */
  showPage(path: string): void;
  /** Opens a web page in Desk's browser (reader view by default). */
  openUrl(url: string): void;

  /** Steam's news for a game, newest first. */
  steamNews(appId: string, count?: number): Promise<SteamNewsItem[]>;
  /** Madness Workshop posts (same filters as the Workshop tab: appId, sort, kind…). */
  workshopEntries(params: Record<string, string>): Promise<WorkshopSummary[]>;
  /** Shows a Workshop post in Desk's reader. */
  openWorkshopEntry(id: string, appId: string): void;
  /** Asks for a line of text; null if cancelled. */
  askText(heading: string, label?: string, initial?: string): Promise<string | null>;

  /** Runs when the Scroll stops. */
  onUnload(fn: () => void): void;
  /** Turns the Scroll off (e.g. Steam or Decky changed and its hooks are gone), telling the person why. */
  disable(reason: string): void;
  log(...args: unknown[]): void;
}

export type ScrollActivate = (desk: DeskScrollApi) => void | (() => void) | Promise<void | (() => void)>;
