import { cloneElement, FC, isValidElement, ReactElement, ReactNode } from "react";
import { ButtonItem, DialogButton, Dropdown, ErrorBoundary, Focusable, ModalRoot, PanelSection, PanelSectionRow, ToggleField, useParams } from "@decky/ui";
import { FaFolder, FaPuzzlePiece } from "react-icons/fa";
import type { DeskScrollApi } from "../../src/scrolls/api";
import type { TomeProps } from "../../src/tomes/registry";

// 🧩 Plugin Shelf: pin Decky plugins as Quick Access tabs or Steam-menu entries, and fold Decky's plugin list
// into folders. It leans on Decky's internals (window.DeckyPluginLoader, its DeckyState, and its Quick
// Access tab), so it checks they're there and turns itself off if they aren't.

interface Folder {
  id: string;
  name: string;
  plugins: string[];
}
interface ShelfSettings {
  /** Plugin name → where it's pinned. */
  pins?: Record<string, { qam?: boolean; menu?: boolean }>;
  folders?: Folder[];
  /** Show folders in Decky's own list. On unless turned off. */
  group?: boolean;
}

/** One of Decky's loaded plugins (the parts we use). */
interface DeckyPlugin {
  name: string;
  version?: string;
  icon?: ReactNode;
  content?: ReactNode;
  titleView?: ReactNode;
}

const ROUTE = "/desk-of-madness-shelf";
const DECKY_TAB = 999; // QuickAccessTab.Decky
const SELF = "Desk of Madness";

const loader = (): any => (window as any).DeckyPluginLoader;
const deckyPlugins = (): DeckyPlugin[] => (loader()?.plugins ?? []).filter((p: DeckyPlugin) => p?.name && p.name !== SELF && p.content);
const tabKey = (name: string) => 735200 + [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7);
const pagePath = (name: string) => `${ROUTE}/${encodeURIComponent(name)}`;
const iconOf = (p: DeckyPlugin): ReactElement => (isValidElement(p.icon) ? (p.icon as ReactElement) : <FaPuzzlePiece />);

function notify(ds: any) {
  if (typeof ds?.notifyUpdate === "function") ds.notifyUpdate();
  else ds?.eventBus?.dispatchEvent?.(new Event("update"));
}

/** Copies a React element tree down to the first element `match` finds, with that element replaced. */
function replaceIn(node: any, match: (el: any) => boolean, swap: (el: any) => any, depth = 0): any {
  if (!node || typeof node !== "object" || depth > 16) return null;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const r = replaceIn(node[i], match, swap, depth + 1);
      if (r) return Object.assign([...node], { [i]: r });
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (match(node)) return swap(node);
  const kids = (node.props as any)?.children;
  const r = kids ? replaceIn(kids, match, swap, depth + 1) : null;
  return r ? cloneElement(node as ReactElement, { children: r } as any) : null;
}

export default function activate(desk: DeskScrollApi) {
  const ld = loader();
  const ds = ld?.deckyState;
  if (!Array.isArray(ld?.plugins) || typeof ds?.publicState !== "function" || typeof ds?.setActivePlugin !== "function") {
    return desk.disable("Decky's plugin list wasn't where Plugin Shelf expects it (Decky has probably changed). It'll need an update.");
  }
  if (!desk.qamTabsAvailable()) {
    return desk.disable("Decky's Quick Access tab hook wasn't found, so Plugin Shelf can't add tabs.");
  }

  const settings = () => desk.settings.get<ShelfSettings>();
  const useShelf = () => desk.settings.use<ShelfSettings>();
  const save = (patch: ShelfSettings) => desk.settings.set<ShelfSettings>(patch);
  const pinned = (where: "qam" | "menu") => deckyPlugins().filter((p) => settings().pins?.[p.name]?.[where]);
  const open = (name: string) => desk.showPage(pagePath(name));

  // ---- a plugin as a full-screen page (where Steam-menu pins go) ----

  const ShelfPage: FC = () => {
    const { name } = useParams<{ name: string }>() ?? ({} as { name?: string });
    const plugin = deckyPlugins().find((p) => p.name === decodeURIComponent(name ?? ""));
    return (
      <div style={{ marginTop: "40px", height: "calc(100% - 40px)", overflowY: "auto", padding: "16px 24px 60px" }}>
        <div style={{ maxWidth: "520px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "22px", fontWeight: "bold", marginBottom: "12px" }}>
            {plugin ? iconOf(plugin) : <FaPuzzlePiece />} {plugin?.name ?? name}
          </div>
          {plugin ? <ErrorBoundary>{plugin.content}</ErrorBoundary> : <div style={{ opacity: 0.7 }}>That plugin isn't loaded in Decky right now.</div>}
        </div>
      </div>
    );
  };
  desk.addRoute(`${ROUTE}/:name`, ShelfPage);

  // ---- Quick Access tabs: pinned plugins, and folders inside Decky's tab ----

  let openFolder: string | null = null;
  const pseudoCache = new Map<string, any>();
  const pseudoName = (f: Folder) => `📁 ${f.name}`;

  const FolderPanel: FC<{ folderId: string }> = ({ folderId }) => {
    const folder = settings().folders?.find((f) => f.id === folderId);
    const plugins = deckyPlugins().filter((p) => folder?.plugins.includes(p.name));
    return (
      <PanelSection>
        {plugins.map((p) => (
          <PanelSectionRow key={p.name}>
            <ButtonItem
              layout="below"
              onClick={() => {
                openFolder = null;
                ds.setActivePlugin(p.name);
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {iconOf(p)}
                <span>{p.name}</span>
              </div>
            </ButtonItem>
          </PanelSectionRow>
        ))}
        {plugins.length === 0 && <div style={{ opacity: 0.7, padding: "8px 0" }}>This folder is empty.</div>}
      </PanelSection>
    );
  };

  /** Decky's list with folders: folder entries first, the plugins inside them left out of the main list. */
  function withFolders(state: any) {
    const s = settings();
    if (s.group === false || !s.folders?.length || !Array.isArray(state?.plugins)) return state;
    const names = new Set<string>(state.plugins.map((p: DeckyPlugin) => p.name));
    const folders = s.folders.filter((f) => f.plugins.some((n) => names.has(n)));
    if (!folders.length) return state;
    const grouped = new Set(folders.flatMap((f) => f.plugins));
    const pseudo = folders.map((f) => {
      const sig = `${f.id}|${f.name}`;
      if (!pseudoCache.has(sig)) {
        pseudoCache.set(sig, { name: pseudoName(f), version: "", icon: <FaFolder />, content: <FolderPanel folderId={f.id} />, __folder: f.id });
      }
      return pseudoCache.get(sig);
    });
    const active = openFolder ? pseudo.find((p) => p.__folder === openFolder) : null;
    return {
      ...state,
      plugins: [...pseudo, ...state.plugins.filter((p: DeckyPlugin) => !grouped.has(p.name))],
      pluginOrder: Array.isArray(state.pluginOrder) ? [...pseudo.map((p) => p.name), ...state.pluginOrder] : state.pluginOrder,
      activePlugin: active ?? state.activePlugin,
    };
  }

  // Decky's tab shows whatever its state provider hands out; we give that provider a stand-in for Decky's
  // state that adds the folders, so only Decky's Quick Access list changes (its settings pages don't).
  const proxy = new Proxy(ds, {
    get(target, key) {
      if (key === "publicState") return () => withFolders(target.publicState());
      if (key === "setActivePlugin")
        return (name: string) => {
          const folder = settings().folders?.find((f) => pseudoName(f) === name);
          if (folder) {
            openFolder = folder.id;
            notify(target);
          } else {
            openFolder = null;
            target.setActivePlugin(name);
          }
        };
      if (key === "closeActivePlugin")
        return () => {
          if (openFolder) {
            openFolder = null;
            notify(target);
          } else target.closeActivePlugin?.();
        };
      const v = Reflect.get(target, key, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  const wrapped = new WeakMap<object, any>();
  let warnedNoProvider = false;

  desk.onQamTabs((tabs) => {
    for (const p of pinned("qam")) {
      const key = tabKey(p.name);
      if (tabs.some((t) => t?.key === key)) continue;
      tabs.push({ key, title: p.name, tab: iconOf(p), panel: <ErrorBoundary>{p.content}</ErrorBoundary> });
    }
    const s = settings();
    if (s.group === false || !s.folders?.length) return;
    const decky = tabs.find((t) => t?.key === DECKY_TAB);
    if (!decky?.panel || typeof decky.panel !== "object") return;
    if (!wrapped.has(decky.panel)) {
      const swapped = replaceIn(decky.panel, (el) => el.props?.deckyState === ds, (el) => cloneElement(el, { deckyState: proxy }));
      if (!swapped && !warnedNoProvider) {
        warnedNoProvider = true;
        save({ group: false });
        desk.decky.toaster.toast({
          title: "🧩 Plugin Shelf",
          body: "Couldn't find Decky's plugin list to add folders, so folders are off. Pins still work.",
          duration: 8000,
        });
      }
      wrapped.set(decky.panel, swapped ?? decky.panel);
    }
    decky.panel = wrapped.get(decky.panel);
  });
  desk.onUnload(() => {
    openFolder = null;
    notify(ds);
  });

  // ---- the main Steam menu ----

  desk.onMainMenu((items, makeItem) => {
    const add = pinned("menu").map((p) => makeItem({ key: `dom-shelf-${tabKey(p.name)}`, label: p.name, route: pagePath(p.name), icon: iconOf(p) }));
    if (!add.length) return items;
    const at = items.findIndex((e) => e.key === "settings");
    const i = at < 0 ? items.length : at;
    return [...items.slice(0, i), ...add, ...items.slice(i)];
  });

  // ---- the Tome ----

  const ShelfTome: FC<TomeProps> = () => {
    const s = useShelf();
    const { Line, Hint } = desk.bits;
    const plugins = deckyPlugins();
    const pins = plugins.filter((p) => s.pins?.[p.name]?.qam || s.pins?.[p.name]?.menu);
    const folders = (s.folders ?? []).filter((f) => plugins.some((p) => f.plugins.includes(p.name)));
    return (
      <>
        {pins.map((p) => (
          <Line key={p.name} icon={iconOf(p)} onOpen={() => open(p.name)} okLabel="Open">
            {p.name}
          </Line>
        ))}
        {folders.map((f) => (
          <div key={f.id}>
            <div style={{ fontSize: "11px", fontWeight: "bold", letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.6, margin: "6px 0 3px" }}>
              📁 {f.name}
            </div>
            {plugins
              .filter((p) => f.plugins.includes(p.name))
              .map((p) => (
                <Line key={p.name} icon={iconOf(p)} onOpen={() => open(p.name)} okLabel="Open">
                  {p.name}
                </Line>
              ))}
          </div>
        ))}
        {!pins.length && !folders.length && <Hint>Pin plugins or make folders in Scrolls → Plugin Shelf → ⚙ Settings.</Hint>}
      </>
    );
  };
  desk.registerTome({
    id: "shelf",
    name: "Plugin Shelf",
    icon: "🧩",
    category: "deck",
    description: "Your pinned Decky plugins and folders, one tap away.",
    defaultOn: true,
    needsGame: false,
    component: ShelfTome,
  });

  // ---- ⚙ Settings ----

  const SettingsPage: FC<{ closeModal?: () => void }> = ({ closeModal }) => {
    const s = useShelf();
    const folders = s.folders ?? [];
    const plugins = deckyPlugins();
    const setPin = (name: string, where: "qam" | "menu", on: boolean) =>
      save({ pins: { ...s.pins, [name]: { ...s.pins?.[name], [where]: on } } });
    const setFolder = (name: string, folderId: string) =>
      save({ folders: folders.map((f) => ({ ...f, plugins: f.id === folderId ? [...f.plugins.filter((n) => n !== name), name] : f.plugins.filter((n) => n !== name) })) });
    const newFolder = async () => {
      const name = await desk.askText("New folder", "Folder name");
      if (name) save({ folders: [...folders, { id: Math.random().toString(36).slice(2, 10), name, plugins: [] }] });
    };
    const rename = async (f: Folder) => {
      const name = await desk.askText("Rename folder", "Folder name", f.name);
      if (name) save({ folders: folders.map((x) => (x.id === f.id ? { ...x, name } : x)) });
    };
    const folderOptions = [{ label: "No folder", data: "" }, ...folders.map((f) => ({ label: `📁 ${f.name}`, data: f.id }))];
    return (
      <ModalRoot onCancel={closeModal} closeModal={closeModal} bAllowFullSize>
        <h2 style={{ margin: "0 0 4px" }}>🧩 Plugin Shelf</h2>
        <div style={{ fontSize: "13px", opacity: 0.75, marginBottom: "8px" }}>
          Changes show the next time the Quick Access or Steam menu opens.
        </div>
        <ToggleField
          label="Folders in Decky's list"
          description="Plugins in a folder show inside it instead of in Decky's main list."
          checked={s.group !== false}
          onChange={(v) => save({ group: v })}
        />
        <div style={{ fontSize: "12px", fontWeight: "bold", letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.6, margin: "10px 0 4px" }}>
          Folders
        </div>
        <Focusable flow-children="row" style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
          {folders.map((f) => (
            <Focusable key={f.id} flow-children="row" style={{ display: "flex", gap: "4px" }}>
              <DialogButton style={{ width: "auto", padding: "4px 12px" }} onClick={() => rename(f)}>
                📁 {f.name} ({f.plugins.length})
              </DialogButton>
              <DialogButton
                style={{ width: "auto", minWidth: 0, padding: "4px 10px" }}
                onClick={() => save({ folders: folders.filter((x) => x.id !== f.id) })}
              >
                ✕
              </DialogButton>
            </Focusable>
          ))}
          <DialogButton style={{ width: "auto", padding: "4px 12px" }} onClick={newFolder}>
            + New folder
          </DialogButton>
        </Focusable>
        <div style={{ fontSize: "12px", fontWeight: "bold", letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.6, margin: "10px 0 4px" }}>
          Plugins
        </div>
        <Focusable style={{ maxHeight: "50vh", overflowY: "auto" }}>
          {plugins.length === 0 && <div style={{ opacity: 0.7 }}>No other Decky plugins are loaded.</div>}
          {plugins.map((p) => (
            <div key={p.name} style={{ padding: "6px 10px", marginBottom: "6px", borderRadius: "4px", background: "rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
                {iconOf(p)} {p.name}
              </div>
              <ToggleField label="Own Quick Access tab" checked={!!s.pins?.[p.name]?.qam} onChange={(v) => setPin(p.name, "qam", v)} />
              <ToggleField label="In the Steam menu" checked={!!s.pins?.[p.name]?.menu} onChange={(v) => setPin(p.name, "menu", v)} />
              {folders.length > 0 && (
                <Dropdown
                  rgOptions={folderOptions}
                  selectedOption={folders.find((f) => f.plugins.includes(p.name))?.id ?? ""}
                  onChange={(o: { data: string }) => setFolder(p.name, o.data)}
                />
              )}
            </div>
          ))}
        </Focusable>
        <DialogButton style={{ marginTop: "10px" }} onClick={() => closeModal?.()}>
          Close
        </DialogButton>
      </ModalRoot>
    );
  };
  desk.setSettingsPage(SettingsPage);
  return undefined;
}
