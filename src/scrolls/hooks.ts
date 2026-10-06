import { ReactElement } from "react";

// Where Scrolls hook into Steam's menus. integrations.tsx runs these as the main menu and the Quick Access
// menu draw; kept apart so Scrolls don't import integrations.tsx (and everything it pulls in).

export type MenuItem = ReactElement & { key: string | null };

/** Props for a main-menu entry made by copying one of Steam's own (see onMainMenu). */
export interface MenuItemProps {
  key: string;
  label: string;
  route: string;
  icon?: ReactElement;
}
/** Changes the main menu's items: gets them plus a way to make an entry like Steam's, returns the new list. */
export type MainMenuHook = (items: MenuItem[], makeItem: (props: MenuItemProps) => MenuItem) => MenuItem[];
export const menuHooks = new Set<MainMenuHook>();

/** Lets a Scroll add to (or change) the main Steam menu. Returns a cleanup. */
export function onMainMenu(hook: MainMenuHook): () => void {
  menuHooks.add(hook);
  return () => void menuHooks.delete(hook);
}

/** Changes the Quick Access menu's tabs in place (Steam's tab objects: { key, title, tab, panel }). */
export type QamTabsHook = (tabs: any[]) => void;
export const tabHooks = new Set<QamTabsHook>();
let tabsPatched = false;
export const setTabsPatched = (on: boolean) => (tabsPatched = on);

/** Lets a Scroll add or change Quick Access tabs (the menu picks it up the next time it draws). Returns a cleanup. */
export function onQamTabs(hook: QamTabsHook): () => void {
  tabHooks.add(hook);
  return () => void tabHooks.delete(hook);
}
/** False when Decky's tab hook wasn't there, so Quick Access changes can't work. */
export const qamTabsAvailable = () => tabsPatched;


// The Workshop tab registers how to show one of its posts, so Scrolls can open them without importing it.
let entryOpener: ((id: string, appId: string) => void) | null = null;
export const setEntryOpener = (fn: (id: string, appId: string) => void) => (entryOpener = fn);
export const openWorkshopEntry = (id: string, appId: string) => entryOpener?.(id, appId);
