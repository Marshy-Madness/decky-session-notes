import { getSettings, updateSettings, useSettings } from "../state/notesStore";
import { DeskLayout, DeskSettings } from "../types";
import { allTomes, TomeDef, useTomes } from "./registry";

// Which Tomes the Desk shows and in what order. There's one layout for every game, and (unless per-game
// layouts are turned off) a game gets its own the first time you change the Desk while it's showing.

export const DEFAULT_ORDER = [
  "game-brain",
  "quick-actions",
  "left-off",
  "checklist",
  "counters",
  "recent-notes",
  "guides",
  "voice-notes",
  "screenshot",
  "game-stats",
  "workshop",
  "pinned-notes",
  "shared-notes",
  "system",
  "storage",
  "network",
];

const desk = (): DeskSettings => getSettings().desk ?? {};

export const perGameOn = (d: DeskSettings = desk()) => d.perGame !== false;

/** The default layout knows no Tomes, so each one shows in the built-in order, on if it's on by default. */
export const defaultLayout = (): DeskLayout => ({ order: [], hidden: [], collapsed: [] });

/** The layout to use for a game (null = no game showing). */
export function layoutFor(appId: string | null, d: DeskSettings = desk()): DeskLayout {
  return (appId && perGameOn(d) && d.games?.[appId]) || d.layout || defaultLayout();
}

/** True when this game has a layout of its own. */
export const hasOwnLayout = (appId: string | null, d: DeskSettings = desk()) => !!(appId && perGameOn(d) && d.games?.[appId]);

/** Every known Tome in display order, with whether it's on and folded. */
export function arrange(layout: DeskLayout, tomes: readonly TomeDef[]) {
  const ids = tomes.map((t) => t.id);
  const order = [
    ...layout.order.filter((id) => ids.includes(id)),
    // Tomes the layout doesn't know yet (newly added or from a Scroll): in default order at the end.
    ...ids.filter((id) => !layout.order.includes(id)).sort((a, b) => rank(a) - rank(b)),
  ];
  return order.map((id) => {
    const def = tomes.find((t) => t.id === id)!;
    const known = layout.order.includes(id);
    return {
      def,
      on: known ? !layout.hidden.includes(id) : def.defaultOn,
      collapsed: layout.collapsed.includes(id),
    };
  });
}

const rank = (id: string) => {
  const i = DEFAULT_ORDER.indexOf(id);
  return i < 0 ? DEFAULT_ORDER.length : i;
};

/** Saves a change to the layout: to the game's own layout when per-game layouts are on and a game shows. */
export function changeLayout(appId: string | null, change: (l: DeskLayout) => DeskLayout) {
  const d = desk();
  const current = layoutFor(appId, d);
  // Fold in Tomes the saved layout didn't know about, so they keep their place once it's saved.
  const full = arrange(current, allTomes());
  const base: DeskLayout = {
    order: full.map((x) => x.def.id),
    hidden: full.filter((x) => !x.on).map((x) => x.def.id),
    collapsed: full.filter((x) => x.collapsed).map((x) => x.def.id),
  };
  const next = change(base);
  if (appId && perGameOn(d)) return updateSettings({ desk: { ...d, games: { ...d.games, [appId]: next } } });
  return updateSettings({ desk: { ...d, layout: next } });
}

const without = (list: string[], id: string) => list.filter((x) => x !== id);

export const setTomeOn = (appId: string | null, id: string, on: boolean) =>
  changeLayout(appId, (l) => ({ ...l, hidden: on ? without(l.hidden, id) : [...without(l.hidden, id), id] }));

export const setCollapsed = (appId: string | null, id: string, collapsed: boolean) =>
  changeLayout(appId, (l) => ({ ...l, collapsed: collapsed ? [...without(l.collapsed, id), id] : without(l.collapsed, id) }));

/** Moves a Tome up (-1) or down (+1) among the Tomes that are on. */
export const moveTome = (appId: string | null, id: string, by: -1 | 1) =>
  changeLayout(appId, (l) => {
    const visible = l.order.filter((x) => !l.hidden.includes(x));
    const i = visible.indexOf(id);
    const target = visible[i + by];
    if (i < 0 || !target) return l;
    const order = [...l.order];
    const a = order.indexOf(id);
    const b = order.indexOf(target);
    [order[a], order[b]] = [order[b], order[a]];
    return { ...l, order };
  });

/** Makes this game's layout the one every game uses (and drops the game's own copy). */
export function useForAllGames(appId: string) {
  const d = desk();
  const own = d.games?.[appId];
  if (!own) return;
  const games = { ...d.games };
  delete games[appId];
  return updateSettings({ desk: { ...d, layout: own, games } });
}

/** Back to the layout every game uses. */
export function resetGameLayout(appId: string) {
  const d = desk();
  const games = { ...d.games };
  delete games[appId];
  return updateSettings({ desk: { ...d, games } });
}

/** The arranged Tomes for a game, re-rendering when settings or the registered Tomes change. */
export function useArrangement(appId: string | null) {
  const settings = useSettings();
  const tomes = useTomes();
  const d = settings.desk ?? {};
  return { items: arrange(layoutFor(appId, d), tomes), own: hasOwnLayout(appId, d), perGame: perGameOn(d) };
}
