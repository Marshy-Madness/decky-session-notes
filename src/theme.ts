import { mainWindow } from "./steamWindow";

// Readable buttons whatever Steam theme is installed. Some CSS Loader themes restyle every DialogButton
// with !important (white pills with pale text), which turned our buttons unreadable and hid which tab is
// picked. Inside our own panels, pages and windows these rules win instead: the two :not(#id) parts lift
// them above any class-only theme selector. Coloured buttons set --dom-bg / --dom-fg (styles.ts tint()).

const NOT = ":not(#dom-a):not(#dom-b)";
const SCOPES = [".dom-root", ".dom-modal"];
const btn = (suffix = "") => SCOPES.map((s) => `${s} .DialogButton${NOT}${suffix}`).join(",\n");

const CSS = `
${btn()} {
  background: var(--dom-bg, rgba(255, 255, 255, 0.13)) !important;
  color: var(--dom-fg, #f2f4f7) !important;
  border: none !important;
  box-shadow: none !important;
  text-shadow: none !important;
  filter: none !important;
  opacity: 1 !important;
}
${btn(".gpfocus")},
${btn(":focus-visible")},
${btn(":hover:enabled")} {
  background: var(--dom-focus-bg, #f2f4f7) !important;
  color: var(--dom-focus-fg, #0e141b) !important;
  box-shadow: 0 0 0 2px #f2f4f7 !important;
}
${btn(":disabled")} {
  opacity: 0.45 !important;
}
${btn(" svg:not([fill=none])")} {
  color: inherit !important;
  fill: currentColor !important;
}
`;

const ID = "desk-of-madness-theme";
const added: HTMLStyleElement[] = [];

/**
 * Puts the stylesheet into Steam's main window (where the Quick Access menu, our pages and windows draw) and
 * this plugin's own document. Safe to call again: a document that already has it is skipped, so panels call
 * it as they mount in case the main window wasn't there yet when the plugin loaded.
 */
export function ensureTheme() {
  const docs = new Set<Document>([document]);
  try {
    const main = mainWindow()?.BrowserWindow?.document;
    if (main) docs.add(main);
  } catch {}
  for (const doc of docs) {
    if (doc.getElementById(ID)) continue;
    const el = doc.createElement("style");
    el.id = ID;
    el.textContent = CSS;
    doc.head.appendChild(el);
    added.push(el);
  }
}

/** Takes the stylesheet out again (plugin unloading). */
export function removeTheme() {
  added.splice(0).forEach((el) => el.remove());
}
