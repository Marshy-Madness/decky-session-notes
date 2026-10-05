import { FC, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  DialogButton,
  Focusable,
  GamepadButton,
  GamepadEvent,
  Menu,
  MenuItem,
  ModalRoot,
  Navigation,
  Spinner,
  TextField,
  showContextMenu,
  showModal,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { FaArrowLeft, FaArrowRight, FaBars, FaBookOpen, FaGlobe, FaRedo, FaTimes } from "react-icons/fa";
import { backend } from "../api/backend";
import { defaultBrowserMode, linkSource, parseWebPath, toUrl, webPath } from "../browser";
import { closeNotesPage, setNotesPageMounted } from "../opening";
import { getRunningGame } from "../hooks/useAppLifetime";
import { NOTES_ROUTE, placePath, rememberAddress } from "../state/place";
import { emitDataChanged, updateSettings, useSettings } from "../state/notesStore";
import { currentPath, mainWindow, replacePath, steamHistory, useChromeHeights } from "../steamWindow";
import { useTrackpadMouse } from "../trackpads";
import { BrowserMode, ReaderPage } from "../types";
import { errText } from "../utils/errors";
import { newId } from "../utils/format";
import { articleElements, READER_CSS } from "./ReaderArticle";
import * as s from "./styles";

// Desk of Madness' browser, for links in notes. Two ways to show a page:
// - Reader (default): just the article, made by the sync server (or the Deck) without ads, menus or pop-ups,
//   drawn by us so every button does something sensible.
// - Full page: the real site in a Steam browser view, for pages the reader can't handle.
// Buttons: B back · X reader/full page · Y menu · L1/R1 back/forward · L2/R2 page up/down · in the reader the
// D-pad scrolls (up/down) and picks links (left/right), A follows the picked link. Trackpads work as on the
// store: left scrolls, right is a mouse.

type Entry = { url: string; mode: BrowserMode };

const MIN_ARTICLE = 250; // characters; less than this and the page isn't really an article
const pageCache = new Map<string, ReaderPage>(); // this session's reader pages, for instant Back

/** Steam's browser view (BrowserViewPopup); typed loosely since only a few calls are used. */
type View = any;

let covers = 0;
const coverListeners = new Set<(n: number) => void>();
/** Something (a menu or window) is over the page; the full-page view is a separate layer that would cover it, so it hides. */
function cover(): () => void {
  covers++;
  coverListeners.forEach((l) => l(covers));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    covers--;
    coverListeners.forEach((l) => l(covers));
  };
}
/** Put inside a menu or modal shown over the browser. */
const Cover: FC = () => {
  useEffect(() => cover(), []);
  return null;
};

const isTextInput = (tag: string, type: string) =>
  /^(input|textarea)$/i.test(tag) && !/^(button|checkbox|radio|submit|reset|file|image|range|color|hidden)$/i.test(type || "");

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export const BrowserPage: FC = () => {
  const start = useMemo<Entry>(
    () => parseWebPath(currentPath()) ?? { url: "https://duckduckgo.com/html/", mode: defaultBrowserMode() },
    []
  );
  const [cur, setCur] = useState<Entry>(start);
  const back = useRef<Entry[]>([]);
  const forward = useRef<Entry[]>([]);
  const [page, setPage] = useState<ReaderPage | null>(pageCache.get(start.url) ?? null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refreshNext = useRef(false);
  const [title, setTitle] = useState("");
  const [viewNav, setViewNav] = useState({ back: false, forward: false });
  const [covered, setCovered] = useState(covers);
  const [picked, setPicked] = useState<HTMLAnchorElement | null>(null);
  const [viewState, setViewState] = useState<"none" | "ready" | "unavailable">("none");

  const settings = useSettings();
  const textSize = settings.readerTextSize ?? 17;
  const { header, footer } = useChromeHeights();
  const scroller = useRef<HTMLDivElement>(null);
  const viewHost = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const viewUrl = useRef<string>("");
  const keyboard = useRef<any>(null);
  const curRef = useRef(cur);
  curRef.current = cur;

  useTrackpadMouse();
  useEffect(() => {
    setNotesPageMounted(true);
    coverListeners.add(setCovered);
    return () => {
      coverListeners.delete(setCovered);
      setNotesPageMounted(false);
      if (view.current) {
        try {
          view.current.SetVisible(false);
          (window as any).SteamClient.BrowserView.Destroy(view.current);
        } catch (e) {
          console.warn("Desk of Madness: couldn't close the browser view", e);
        }
        view.current = null;
      }
    };
  }, []);

  // The address follows the page, so putting Desk of Madness away and opening it again comes back here.
  useEffect(() => {
    const path = webPath(cur.url, cur.mode);
    rememberAddress(path);
    replacePath(path);
  }, [cur.url, cur.mode]);

  // ---- moving around ----

  const go = (url: string, mode: BrowserMode = defaultBrowserMode()) => {
    back.current.push(curRef.current);
    forward.current = [];
    setNotice(null);
    setCur({ url, mode });
  };

  const close = () => {
    const h = steamHistory() as any;
    const prev: string | undefined = h?.entries?.[h.index - 1]?.pathname;
    rememberAddress(placePath());
    if (prev?.startsWith(NOTES_ROUTE)) Navigation.NavigateBack(); // back to the note you came from
    else if (getRunningGame()) closeNotesPage();
    else Navigation.NavigateBack();
  };

  const goBack = (orClose = true) => {
    if (curRef.current.mode === "full" && viewNav.back && view.current) return view.current.GoBack();
    const prev = back.current.pop();
    if (prev) {
      forward.current.push(curRef.current);
      setNotice(null);
      setCur(prev);
    } else if (orClose) close();
  };

  const goForward = () => {
    if (curRef.current.mode === "full" && viewNav.forward && view.current) return view.current.GoForward();
    const next = forward.current.pop();
    if (next) {
      back.current.push(curRef.current);
      setCur(next);
    }
  };

  const setMode = (mode: BrowserMode) => {
    setNotice(null);
    setCur((c) => ({ ...c, mode }));
  };
  const toggleMode = () => setMode(curRef.current.mode === "reader" ? "full" : "reader");

  const reload = () => {
    if (curRef.current.mode === "full") return view.current?.Reload();
    refreshNext.current = true;
    pageCache.delete(curRef.current.url);
    setReloadKey((k) => k + 1);
  };

  // ---- reader ----

  useEffect(() => {
    if (cur.mode !== "reader") return;
    const cached = !refreshNext.current && pageCache.get(cur.url);
    setPicked(null);
    if (cached) {
      setPage(cached);
      scroller.current?.scrollTo({ top: 0 });
      return;
    }
    let gone = false;
    const refresh = refreshNext.current;
    refreshNext.current = false;
    setLoading(true);
    backend
      .readerPage(cur.url, refresh)
      .then((p) => {
        if (gone) return;
        if (p.length < MIN_ARTICLE) {
          setNotice("This page has no article to read, so here's the full page.");
          setCur((c) => ({ ...c, mode: "full" }));
          return;
        }
        pageCache.set(cur.url, p);
        if (p.url && p.url !== cur.url) pageCache.set(p.url, p);
        setPage(p);
        scroller.current?.scrollTo({ top: 0 });
      })
      .catch((e) => {
        if (gone) return;
        setNotice(`No reader view (${errText(e)}), so here's the full page.`);
        setCur((c) => ({ ...c, mode: "full" }));
      })
      .finally(() => !gone && setLoading(false));
    return () => {
      gone = true;
    };
  }, [cur.url, cur.mode, reloadKey]);

  const article = useMemo(() => (page ? articleElements(page.html) : null), [page]);

  const visibleLinks = (): HTMLAnchorElement[] => {
    const box = scroller.current?.getBoundingClientRect();
    if (!box) return [];
    return Array.from(scroller.current!.querySelectorAll<HTMLAnchorElement>("a[data-href]")).filter((a) => {
      const r = a.getBoundingClientRect();
      return r.bottom > box.top + 4 && r.top < box.bottom - 4 && r.width > 0;
    });
  };

  useEffect(() => {
    picked?.classList.add("sn-picked");
    picked?.scrollIntoView({ block: "nearest" });
    return () => picked?.classList.remove("sn-picked");
  }, [picked]);

  const scrollBy = (fraction: number) => {
    const el = scroller.current;
    if (el) el.scrollBy({ top: el.clientHeight * fraction, behavior: "smooth" });
  };

  const onScroll = () => {
    if (picked && !visibleLinks().includes(picked)) setPicked(null);
  };

  const pickLink = (step: 1 | -1) => {
    const links = visibleLinks();
    if (!links.length) return;
    const i = picked ? links.indexOf(picked) : -1;
    setPicked(links[i < 0 ? (step > 0 ? 0 : links.length - 1) : (i + step + links.length) % links.length]);
  };

  const onReaderDirection = (evt: GamepadEvent) => {
    const el = scroller.current;
    switch (evt.detail.button) {
      case GamepadButton.DIR_UP:
        if (!el || el.scrollTop <= 2) return false; // at the top: up moves to the toolbar
        scrollBy(-0.45);
        return;
      case GamepadButton.DIR_DOWN:
        scrollBy(0.45);
        return;
      case GamepadButton.DIR_LEFT:
        pickLink(-1);
        return;
      case GamepadButton.DIR_RIGHT:
        pickLink(1);
        return;
    }
    return false;
  };

  const linksMenu = () => {
    const links = visibleLinks();
    if (!links.length) {
      toaster.toast({ title: "No links here", body: "Scroll to a link, or use the right trackpad to click one." });
      return;
    }
    showContextMenu(
      <Menu label="Links on screen">
        <Cover />
        {links.slice(0, 15).map((a, i) => (
          <MenuItem key={i} onSelected={() => go(a.dataset.href!)}>
            {(a.textContent || a.dataset.href!).trim().slice(0, 70)} <span style={{ opacity: 0.6 }}>· {host(a.dataset.href!)}</span>
          </MenuItem>
        ))}
      </Menu>
    );
  };

  const onReaderActivate = () => (picked?.dataset.href ? go(picked.dataset.href) : linksMenu());

  // Right-trackpad clicks on links (they're plain links in the page, so stop Steam from opening them itself).
  const onReaderClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.("a[data-href]") as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    go(a.dataset.href!);
  };

  // ---- full page ----

  const ensureView = (): View | null => {
    if (view.current) return view.current;
    const steam = (window as any).SteamClient;
    if (!steam?.BrowserView?.Create) {
      setViewState("unavailable");
      return null;
    }
    const win = mainWindow()?.BrowserWindow;
    const v: View = steam.BrowserView.Create({
      parentPopupBrowserID: win?.SteamClient?.Browser?.GetBrowserID?.(),
      strUserAgentIdentifier: "Valve Steam Client",
      strInitialURL: curRef.current.url,
    });
    viewUrl.current = curRef.current.url;
    v.SetName?.("DeskOfMadnessBrowser");
    v.SetWindowStackingOrder?.(1);
    v.on("finished-request", (url: string) => {
      if (!url || url.startsWith("data:")) return;
      viewUrl.current = url;
      setCur((c) => (c.mode === "full" && c.url !== url ? { ...c, url } : c));
    });
    v.on("set-title", (t: string) => setTitle(t));
    v.on("can-go-back-forward-changed", (b: boolean, f: boolean) => setViewNav({ back: b, forward: f }));
    v.on("new-tab", (url: string) => url && v.LoadURL(url)); // links that open a new tab load here instead
    v.on("node-has-focus", (_id: string, tag: string, type: string) => {
      if (isTextInput(tag, type)) showKeyboard();
    });
    view.current = v;
    setViewState("ready");
    return v;
  };

  // Steam's on-screen keyboard for text boxes on the site; keys are typed into the page.
  const showKeyboard = () => {
    try {
      if (!keyboard.current) {
        keyboard.current = mainWindow()?.VirtualKeyboardManager?.CreateVirtualKeyboardRef?.({
          onTextEntered: (key: string) => {
            view.current?.SetFocus(false);
            view.current?.SetFocus(true);
            const special: Record<string, string> = { Backspace: "\b", Enter: "\n", Tab: "\t" };
            if (key.startsWith("Arrow")) return;
            (window as any).SteamClient?.Input?.ControllerKeyboardSendText?.(special[key] ?? key);
          },
        });
      }
      keyboard.current?.ShowVirtualKeyboard?.();
    } catch (e) {
      console.warn("Desk of Madness: no keyboard", e);
    }
  };

  // Load the page when switching to full, or when Back/Forward/a link changes it.
  useEffect(() => {
    if (cur.mode !== "full") return;
    const v = ensureView();
    if (v && viewUrl.current !== cur.url) {
      viewUrl.current = cur.url;
      v.LoadURL(cur.url);
    }
  }, [cur.url, cur.mode]);

  // Keep the view over its box, and hidden whenever it isn't wanted (reader mode, or a menu is open).
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const show = cur.mode === "full" && covered === 0;
    let last = "";
    const place = () => {
      const r = viewHost.current?.getBoundingClientRect();
      if (!r) return;
      const key = `${r.left},${r.top},${r.width},${r.height}`;
      if (key !== last) {
        last = key;
        v.SetBounds(r.left, r.top, r.width, r.height);
      }
    };
    if (show) place();
    v.SetVisible(show);
    v.SetFocus(show);
    const timer = show ? setInterval(place, 500) : undefined;
    return () => clearInterval(timer);
  }, [cur.mode, covered, header, footer, viewState]);

  // ---- menu ----

  const addToNote = async () => {
    const src = linkSource();
    if (!src) return;
    try {
      const game = await backend.getGame(src.appId);
      const note = game.notes.find((n) => n.id === src.noteId);
      if (!note) throw new Error("The note is gone");
      if (!note.body.includes(cur.url)) {
        await backend.saveNote(src.appId, { ...note, body: `${note.body.replace(/\s+$/, "")}\n${cur.url}` });
        emitDataChanged();
      }
      toaster.toast({ title: "Link added", body: `to “${src.noteTitle}”` });
    } catch (e) {
      toaster.toast({ title: "Couldn't add the link", body: errText(e) });
    }
  };

  const newNote = async () => {
    const game = getRunningGame() ?? (linkSource() ? { appId: linkSource()!.appId, name: "" } : null);
    if (!game) return;
    try {
      if (game.name) await backend.ensureGame(game.appId, game.name);
      const name = (curRef.current.mode === "reader" ? page?.title : title) || host(cur.url);
      await backend.saveNote(game.appId, {
        id: newId(), folderId: null, title: name.slice(0, 120), body: cur.url, tags: ["link"], screenshots: [],
        recordings: [], pinned: false, createdAt: 0, updatedAt: 0, launchNumber: null,
      });
      emitDataChanged();
      toaster.toast({ title: "Saved as a note", body: name });
    } catch (e) {
      toaster.toast({ title: "Couldn't save the note", body: errText(e) });
    }
  };

  const openAddress = () =>
    showModal(<AddressModal url={cur.url} onGo={(typed) => go(toUrl(typed), /duckduckgo\.com\/html/.test(toUrl(typed)) ? "full" : undefined)} />);

  const menu = () => {
    const src = linkSource();
    const reader = curRef.current.mode === "reader";
    showContextMenu(
      <Menu label={host(cur.url)}>
        <Cover />
        <MenuItem onSelected={openAddress}>Go to address or search…</MenuItem>
        <MenuItem onSelected={toggleMode}>{reader ? "Show the full page" : "Show the reader view"}</MenuItem>
        <MenuItem onSelected={reload}>{reader ? "Make the reader view again" : "Reload"}</MenuItem>
        {src && <MenuItem onSelected={addToNote}>Add this page to “{src.noteTitle}”</MenuItem>}
        {(getRunningGame() || src) && <MenuItem onSelected={newNote}>Save this page as a new note</MenuItem>}
        {reader && <MenuItem onSelected={() => updateSettings({ readerTextSize: Math.min(28, textSize + 2) })}>Bigger text</MenuItem>}
        {reader && <MenuItem onSelected={() => updateSettings({ readerTextSize: Math.max(12, textSize - 2) })}>Smaller text</MenuItem>}
        {!reader && <MenuItem onSelected={showKeyboard}>Keyboard</MenuItem>}
        <MenuItem onSelected={() => updateSettings({ browserMode: reader ? "reader" : "full" })}>
          Always open links like this ({reader ? "reader" : "full page"})
        </MenuItem>
        <MenuItem tone="destructive" onSelected={close}>Close the browser</MenuItem>
      </Menu>
    );
  };

  const onButtonDown = (evt: GamepadEvent) => {
    switch (evt.detail.button) {
      case GamepadButton.BUMPER_LEFT:
        return goBack(false);
      case GamepadButton.BUMPER_RIGHT:
        return goForward();
      case GamepadButton.TRIGGER_LEFT:
        if (curRef.current.mode === "reader") scrollBy(-0.9);
        return;
      case GamepadButton.TRIGGER_RIGHT:
        if (curRef.current.mode === "reader") scrollBy(0.9);
        return;
    }
  };

  const reader = cur.mode === "reader";
  const shownTitle = reader ? page?.title || host(cur.url) : title || host(cur.url);
  const canBack = back.current.length > 0 || (!reader && viewNav.back);

  return (
    <Focusable
      style={{ position: "absolute", inset: 0, paddingTop: `${header}px`, paddingBottom: `${footer}px`, display: "flex", flexDirection: "column", boxSizing: "border-box" }}
      onCancelButton={() => goBack()}
      onCancelActionDescription={canBack ? "Back" : "Close"}
      onSecondaryButton={toggleMode}
      onSecondaryActionDescription={reader ? "Full page" : "Reader"}
      onOptionsButton={menu}
      onOptionsActionDescription="Menu"
      onButtonDown={onButtonDown}
    >
      <style>{READER_CSS}</style>
      <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", flex: "0 0 auto" }}>
        <ToolButton label="Back" onClick={() => goBack()} disabled={!canBack}><FaArrowLeft /></ToolButton>
        <ToolButton label="Forward" onClick={goForward} disabled={!forward.current.length && !(viewNav.forward && !reader)}><FaArrowRight /></ToolButton>
        <ToolButton label="Reload" onClick={reload}><FaRedo /></ToolButton>
        <DialogButton
          onClick={openAddress}
          style={{ ...s.smallButton, flex: "1 1 auto", minWidth: 0, justifyContent: "flex-start", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", textAlign: "left" }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            <b>{shownTitle}</b> <span style={{ opacity: 0.6 }}>{host(cur.url)}</span>
          </span>
        </DialogButton>
        <ToolButton label={reader ? "Full page" : "Reader"} onClick={toggleMode} wide>
          {reader ? <><FaGlobe /> Full page</> : <><FaBookOpen /> Reader</>}
        </ToolButton>
        <ToolButton label="Menu" onClick={menu}><FaBars /></ToolButton>
        <ToolButton label="Close" onClick={close}><FaTimes /></ToolButton>
      </Focusable>

      {notice && <div style={{ fontSize: "13px", opacity: 0.85, padding: "0 16px 6px" }}>ℹ️ {notice}</div>}

      {reader ? (
        <Focusable
          ref={scroller}
          onActivate={onReaderActivate}
          onOKActionDescription={picked ? "Open link" : "Links"}
          onGamepadDirection={onReaderDirection as any}
          onScroll={onScroll}
          onClick={onReaderClick}
          noFocusRing
          preferredFocus
          style={{ flex: "1 1 auto", overflowY: "auto", padding: "8px 24px 40px" }}
        >
          {loading && !page && <Spinner style={{ width: "40px", margin: "40px auto", display: "block" }} />}
          {page && (
            <div style={{ maxWidth: "820px", margin: "0 auto", fontSize: `${textSize}px`, opacity: loading ? 0.5 : 1 }}>
              <div style={{ fontSize: "0.8em", opacity: 0.65, marginBottom: "4px" }}>
                {page.site}
                {page.cached && " · saved copy"}
              </div>
              <h1 style={{ fontSize: "1.7em", lineHeight: 1.2, margin: "0 0 0.6em" }}>{page.title || host(page.url)}</h1>
              <div className="sn-reader">{article}</div>
            </div>
          )}
        </Focusable>
      ) : (
        <Focusable
          onActivate={() => view.current?.SetFocus(true)}
          onOKActionDescription="Use the page"
          noFocusRing
          preferredFocus
          style={{ flex: "1 1 auto", display: "flex" }}
        >
          <div ref={viewHost} style={{ flex: "1 1 auto", background: "#fff1" }}>
            {viewState === "unavailable" && (
              <div style={{ padding: "24px", opacity: 0.8 }}>Steam's browser isn't available here. Switch back to the reader with X.</div>
            )}
          </div>
        </Focusable>
      )}
    </Focusable>
  );
};

const ToolButton: FC<{ label: string; onClick: () => void; disabled?: boolean; wide?: boolean; children: ReactNode }> = ({
  label,
  onClick,
  disabled,
  wide,
  children,
}) => (
  <DialogButton
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
    style={{ ...s.smallButton, flex: "0 0 auto", width: wide ? "auto" : "44px", minWidth: wide ? 0 : "44px", padding: wide ? "0 12px" : 0, justifyContent: "center", gap: "6px" }}
  >
    {children}
  </DialogButton>
);

const AddressModal: FC<{ url: string; onGo: (typed: string) => void; closeModal?: () => void }> = ({ url, onGo, closeModal }) => {
  const [text, setText] = useState(url);
  const submit = () => {
    if (!text.trim()) return;
    closeModal?.();
    onGo(text);
  };
  return (
    <ModalRoot onCancel={closeModal} onOK={submit}>
      <Cover />
      <h3 style={{ marginTop: 0 }}>Go to an address or search</h3>
      <TextField value={text} onChange={(e) => setText(e.target.value)} focusOnMount />
      <Focusable style={{ display: "flex", gap: "8px", marginTop: "12px" }} flow-children="row">
        <DialogButton style={s.primaryButton} onClick={submit}>Go</DialogButton>
        <DialogButton style={s.smallButton} onClick={closeModal}>Cancel</DialogButton>
      </Focusable>
    </ModalRoot>
  );
};
