import { createElement, Fragment, ReactNode } from "react";

// Shows a reader page's article. The markup comes from a web page (cleaned by py_modules/reader.py), and this
// runs inside Steam's UI with full access to Steam, so it's never handed to innerHTML: it's parsed and rebuilt
// as React elements, keeping only the tags and attributes below and only http(s) links and images.

const ALLOWED = new Set([
  "p", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "a", "img", "figure", "figcaption", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "strong", "em", "b", "i", "u", "s", "sub", "sup",
  "br", "hr", "dl", "dt", "dd", "div", "small", "mark", "kbd",
]);
const VOID = new Set(["br", "hr", "img"]);
// Dropped with everything inside (their text isn't part of the article).
const SKIP = new Set(["script", "style", "noscript", "template", "iframe", "object", "embed", "svg", "math", "head", "title", "textarea", "select", "button"]);
const httpUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

export const READER_CSS = `
.sn-reader { line-height: 1.6; overflow-wrap: anywhere; }
.sn-reader p, .sn-reader ul, .sn-reader ol, .sn-reader dl, .sn-reader blockquote, .sn-reader pre, .sn-reader figure { margin: 0 0 0.9em; }
.sn-reader h2 { font-size: 1.45em; margin: 1.2em 0 0.5em; line-height: 1.25; }
.sn-reader h3 { font-size: 1.25em; margin: 1.1em 0 0.45em; }
.sn-reader h4, .sn-reader h5, .sn-reader h6 { font-size: 1.08em; margin: 1em 0 0.4em; }
.sn-reader a { color: #59bfff; text-decoration: underline; }
.sn-reader a.sn-picked { background: #1a9fff; color: white; outline: 2px solid #1a9fff; border-radius: 3px; }
.sn-reader img { max-width: 100%; max-height: 70vh; width: auto; height: auto; border-radius: 4px; display: block; margin: 0.4em 0; }
.sn-reader figcaption { font-size: 0.85em; opacity: 0.75; }
.sn-reader blockquote { border-left: 3px solid rgba(255,255,255,0.3); padding-left: 0.9em; opacity: 0.9; }
.sn-reader pre { white-space: pre-wrap; background: rgba(0,0,0,0.3); padding: 0.6em 0.8em; border-radius: 4px; }
.sn-reader code, .sn-reader kbd { background: rgba(0,0,0,0.3); padding: 0 0.25em; border-radius: 3px; font-size: 0.92em; }
.sn-reader .sn-table { overflow-x: auto; margin: 0 0 0.9em; }
.sn-reader table { border-collapse: collapse; font-size: 0.92em; }
.sn-reader td, .sn-reader th { border: 1px solid rgba(255,255,255,0.18); padding: 0.3em 0.55em; vertical-align: top; }
.sn-reader th { background: rgba(255,255,255,0.07); }
.sn-reader hr { border: 0; border-top: 1px solid rgba(255,255,255,0.2); margin: 1.2em 0; }
`;

function build(node: Node, key: string): ReactNode {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const kids = () => Array.from(el.childNodes).map((c, i) => build(c, `${key}.${i}`));
  if (SKIP.has(tag)) return null;
  if (!ALLOWED.has(tag)) return createElement(Fragment, { key }, ...kids());
  const props: Record<string, unknown> = { key };
  if (tag === "a") {
    const href = httpUrl(el.getAttribute("href"));
    if (!href) return createElement(Fragment, { key }, ...kids());
    props.href = href;
    props["data-href"] = href;
  } else if (tag === "img") {
    const src = httpUrl(el.getAttribute("src"));
    if (!src) return null;
    props.src = src;
    props.alt = (el.getAttribute("alt") ?? "").slice(0, 300);
    props.loading = "lazy";
    props.referrerPolicy = "no-referrer";
  } else if (tag === "td" || tag === "th") {
    for (const [attr, prop] of [["colspan", "colSpan"], ["rowspan", "rowSpan"]] as const) {
      const n = Number(el.getAttribute(attr));
      if (n > 1) props[prop] = Math.min(n, 50);
    }
  }
  if (VOID.has(tag)) return createElement(tag, props);
  const element = createElement(tag, props, ...kids());
  // Wide tables scroll sideways on their own instead of stretching the page.
  return tag === "table" ? createElement("div", { key: `${key}t`, className: "sn-table" }, element) : element;
}

/** The article as React elements (safe to render; see above). */
export function articleElements(html: string): ReactNode {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return Array.from(doc.body.childNodes).map((n, i) => build(n, String(i)));
}
