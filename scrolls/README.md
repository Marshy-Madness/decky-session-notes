# Scrolls

Scrolls are add-ons for Desk of Madness. They're listed in the Madness Workshop (📜 Scrolls), installed on the Deck
from Settings → 📜 Manage Scrolls (or the 📜 Scrolls button in the Workshop tab), and each one is turned on or off
there.

A Scroll is one JSON file. There are two kinds:

- **Data Scrolls** hold text, links, Note Packs and a Desk layout. Nothing in them can run, so anyone can publish one.
  On the Deck each becomes a Tome showing what's in it.
- **Code Scrolls** hold JavaScript that runs inside Steam with the same power as Desk itself. Desk only installs or
  runs a code Scroll signed with the Madness Workshop's key (`py_modules/scrolls.py` `TRUSTED_KEYS`), and the Workshop
  signs one only when its owner (`ADMIN_STEAM_IDS`) approves it in 🛡 Admin → Scrolls after reading the code. The
  signature is checked again every time the Scroll loads, so changing the file on the Deck turns it off.

## The format

```jsonc
{
  "format": 1,
  "id": "my-links",                 // 1–40 lowercase letters, digits, dashes; yours once you publish it
  "name": "My links",
  "icon": "🔗",
  "version": "1.0.0",               // raise it for every update
  "summary": "One line for lists",
  "description": "Longer text for its page",
  "author": "You",
  "minDesk": "0.3.0-beta.4",        // optional: the oldest Desk it works with
  "kind": "data",
  "data": {
    "text": "Shown at the top of the Tome",
    "links": [{ "title": "Wiki", "url": "https://…", "note": "optional" }],
    "packs": ["<Note Pack id>"],
    "layout": { "order": ["game-brain", "checklist"], "hidden": [], "collapsed": [] }
  }
}
```

A code Scroll has `"kind": "code"`, a `"code"` string instead of `"data"`, and `"permissions"`: what it touches, shown
to people before they install it. They are `tomes`, `library-page`, `main-menu`, `quick-access`, `decky-ui` and
`network` (see `PERMISSIONS` in `py_modules/scrollfmt.py`). New Scrolls that ask for `decky-ui` start turned off.

Upload a Scroll on the Workshop website: 📜 Scrolls → + Submit a Scroll. To update one, upload it again with a higher
version. The published version stays up while a new one waits for review.

## Writing a code Scroll

Each official Scroll lives in its own folder here: `scroll.json` (everything above except `code`) and `index.tsx`,
whose default export is `activate(desk)`:

```tsx
import type { DeskScrollApi } from "../../src/scrolls/api";

export default function activate(desk: DeskScrollApi) {
  desk.registerTome({ id: "hello", name: "Hello", icon: "👋", description: "Says hi", defaultOn: true, needsGame: false,
    component: () => <div>Hi!</div> });
  return () => {}; // optional cleanup
}
```

`desk` (see `src/scrolls/api.ts`) gives you Tomes, the Scroll's own synced settings and a ⚙ Settings page, Quick Access
tab and main-menu hooks, routes and route patches (`/library/app/:appid` and so on), Steam news, Workshop posts, the
reader view, and `disable(reason)` for when Steam or Decky changed and your hooks aren't there. Everything added through
`desk` is removed when the Scroll is turned off, so it can be switched without restarting. `react`, `react/jsx-runtime`
and `@decky/ui` come from Steam and Decky; other packages are bundled in.

Build them all with `node scrolls/build.mjs` (or `node scrolls/build.mjs game-news`). That writes
`workshop/scrolls/<id>.json`, which the Workshop image ships with and publishes, signed, when it starts.

The official Scrolls:
- **🧩 Plugin Shelf** (`plugin-shelf`): pin Decky plugins as their own Quick Access tab or in the Steam menu, and group
  Decky's list into folders. It patches Decky's own UI, so it starts off and turns itself off if Decky's parts move.
- **📰 Game News** (`game-news`): a News section on games' library pages (Steam's news and patch notes plus new
  Workshop books, hideable per game) and a Game News Tome.

## The signing key

The Workshop signs with `data/scroll_signing.key` (32 bytes as hex; or set `SCROLL_SIGNING_KEY` to another path). Its
public half is at `GET /api/scroll-key`. Keep a copy somewhere safe: Desk trusts only the keys in `TRUSTED_KEYS`, so a
new key means a new Desk release before anything signed with it will run.
