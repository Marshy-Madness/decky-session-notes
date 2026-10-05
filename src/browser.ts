import { getSettings } from "./state/notesStore";
import { putAwayNote } from "./state/resume";
import { WEB_ROUTE } from "./state/place";
import { showPage } from "./opening";
import { BrowserMode } from "./types";

// Opening links from notes in Session Notes' own browser page (components/BrowserPage.tsx).

export interface LinkSource {
  appId: string;
  noteId: string;
  noteTitle: string;
}

let source: LinkSource | null = null;

/** The note the browser was opened from, for "Add this page to the note". */
export const linkSource = () => source;

export const defaultBrowserMode = (): BrowserMode => getSettings().browserMode ?? "reader";

export function webPath(url: string, mode: BrowserMode = defaultBrowserMode()): string {
  return `${WEB_ROUTE}?url=${encodeURIComponent(url)}&mode=${mode}`;
}

export function parseWebPath(path: string): { url: string; mode: BrowserMode } | null {
  const [pathname, search = ""] = path.split("?");
  if (pathname !== WEB_ROUTE) return null;
  const q = new URLSearchParams(search);
  const url = q.get("url");
  if (!url) return null;
  return { url, mode: q.get("mode") === "full" ? "full" : "reader" };
}

/** Turns what someone typed into an address: adds https://, or searches for it if it isn't one. */
export function toUrl(typed: string): string {
  const t = typed.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[^\s/]+\.[a-z]{2,}(\/|$|:|\?)/i.test(t)) return `https://${t}`;
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(t)}`;
}

/** Opens a link in the browser page. The note it came from is put away and comes back when you leave. */
export function openLink(url: string, from?: LinkSource) {
  source = from ?? null;
  putAwayNote();
  // Let the note's window close first; an open window would stay on top of the page.
  setTimeout(() => showPage(webPath(url)), 60);
}

/** Splits text into plain parts and web links (http(s)://… or www.…), for showing links as buttons. */
export function splitLinks(text: string): { text: string; url?: string }[] {
  const out: { text: string; url?: string }[] = [];
  const re = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    let link = m[0];
    // Sentence punctuation after a link isn't part of it; a closing bracket is only if it opened inside.
    const count = (s: string, c: string) => s.split(c).length - 1;
    while (/[.,;:!?'"\]]$/.test(link) || (link.endsWith(")") && count(link, "(") < count(link, ")"))) {
      link = link.slice(0, -1);
    }
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: link, url: link.startsWith("www.") ? `https://${link}` : link });
    last = start + link.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
