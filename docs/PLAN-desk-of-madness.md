# Desk of Madness: plan

Status: **approved** (2026-10-04). Phase 1 shipped 2026-10-05 as 0.3.0-beta.1 (overlay bug deferred). Phase 2 shipped 2026-10-05 as 0.3.0-beta.2. Phase 3 shipped 2026-10-05 as 0.3.0-beta.3 (Workshop password login not added: it stays Steam-only). Phase 4 shipped 2026-10-05 as 0.3.0-beta.4 (Scroll format and Ed25519 signing, Workshop listing and review queue, Plugin Shelf and Game News; gg.deals and Smart Launcher Scrolls still to come).

## 1. Names and terms

| Old | New | Slug / id |
|---|---|---|
| Session Notes (Decky plugin) | **Desk of Madness** | `desk-of-madness` |
| Session Notes sync site + web editor (:8430) | **Desk of Madness** (the web version of the Desk) | `deskofmadness.marshymadness.com` |
| Session Notes Android app | **Desk of Madness** | new package id (see 2.4) |
| Bookstore (:8431) | **Madness Workshop** | `workshop.marshymadness.com` |
| Widgets | **Tomes** | `tome` in code |
| Optional downloadable integrations | **Scrolls** | `scroll` in code |
| Notes collectively (folders, guides, collections, Workshop packs) | **Books** | UI word only |

"Books" is the collective word only. Single items stay "notes": *New note*, *Where I left off*, but *Guides book*, *3 books from the Workshop*.

Taglines:
- Desk of Madness: *Your Deck. Your Notes. Your Madness.*
- Madness Workshop: *More things for your Desk.* / *Discover, download, and share notes, collections, and more.*

Workshop sections: 📦 Note Packs, ⭐ Featured, 🔥 Trending, 🧰 My Workshop.

## 2. Phase 1: rename everything (one beta release)

### 2.1 UI text
- Decky: plugin.json name, QAM title, page headers, toasts, settings labels, voice-command help.
- Desk website (`server/index.html`, manifest, sw.js cache name, icon title), `server/API.md`.
- Workshop (`bookstore/index.html`): titles, meta, "Bookstore" everywhere → "Madness Workshop", plus the new section names.
- Android: app label, offline page, setup screen.
- READMEs, store README row.

### 2.2 GitHub and the store
- Rename `Marshy-Madness/decky-session-notes` → `Marshy-Madness/desk-of-madness` (GitHub redirects old URLs and clones).
- Store: move submodule `plugins/decky-session-notes` → `plugins/desk-of-madness`, update `.gitmodules`, `store.toml` name. **Keep id 3.**
- Move `bookstore/` → `workshop/` in the repo.

### 2.3 Internals
- Routes: `/session-notes/...` → `/desk-of-madness/...`, `/session-notes-web` → `/desk-of-madness-web`. Old routes stay registered as redirects for one release.
- Window globals (`window.SessionNotesApp`, `snResume`, `snDictation`): rename to `DeskApp`/`deskResume`/`deskDictation`, keep the old names as aliases so an old APK still works with the new site.
- Settings keys and storage keys: unchanged (no reason to churn data formats).
- Docker: `Docker Compose/Session Notes` → `Docker Compose/Desk of Madness`, `Session Notes Bookstore` → `Madness Workshop`; container names follow. Data dirs move with them (stop, `mv`, start).
- Plugin default Workshop URL → `https://workshop.marshymadness.com`.

### 2.4 Migration (the part that can lose data if done wrong)
- **Deck:** a new plugin name means a new folder under `~/homebrew/plugins`, `settings` and `data`. On first load, Desk of Madness looks for the old Session Notes data/settings folders; if its own are empty, it copies them over (copy, never move) and shows a one-time "Imported your Session Notes data. You can uninstall Session Notes now." toast. To verify: the exact folder names Decky uses for the old plugin on the Deck.
- The last Session Notes release (a tiny final beta) shows a "Replaced by Desk of Madness" banner linking to the new repo.
- **Android:** new package id `com.marshymadness.deskofmadness`: a new app; uninstall the old one and enter the server address again.
- **Domains:** don't 301 the old hostnames, because redirects can drop the Deck's bearer token on POSTs. Instead point `steamnotes.` and `bookstore.` at the same containers as the new names, so old installs keep working. Drop them later.

### 2.5 Fixes in the same release
- **Confirm password:** a second "Retype password" field that must match, on the Desk site for: first owner setup (replacing AdminPassword), Account → Sign-in password change, email sign-up, and the admin "Set password" action (which uses a `prompt()` today and becomes a small dialog). The Workshop gets the same when password login is added there (it's Steam-only today).
- **Overlay broken when adding a note:** deferred.

## 3. Phase 2: the Desk and Tomes

### 3.1 Shape
- The Desk of Madness **QAM tab is the Desk**: one customizable, game-aware stream of Tomes for the game you're playing (or last played, when no game is running). The full-screen notes page is one button away.
- **Tomes are views and actions over existing data**, not a second notes system. Ticking a checklist item edits the same note; Edit opens the existing editor; Voice uses the existing recorder and whisper path; Workshop uses the existing Workshop API.

### 3.2 Framework (`src/tomes/`)
- Registry entry: `{ id, name, icon, category, component, defaultOn, needsGame, settings? }`.
- Categories (picker only, not pages): **My Desk**, **Gaming**, **Workshop**, **Deck**.
- Layout: an ordered list of `{ id, on, collapsed, options }`. One global layout, plus optional per-game overrides. Stored in settings and synced, so the website can show the same Desk.
- Each Tome is collapsible, reorderable (move up/down in edit mode), and can be hidden.
- Scrolls register Tomes through the same registry (Phase 4).

### 3.3 First batch (all of them)
**My Desk**
1. 🧠 **Game Brain**: left off, next checklist item, last-used guide, top counter, last note. Default hero.
2. 📍 **Where I Left Off**: the pinned note with [Open] [Edit]; when there isn't one, [+ Add].
3. ☑️ **Active Checklist**: unfinished items gathered from all of this game's notes. Tap an item to complete it; tap the header to open the source note; "3 / 4 remaining".
4. ⚔️ **Counters**: deaths, boss attempts, custom counters. A = +1, D-pad down = −1, hold A = +N (configurable); shows "+3 this session".
5. ⚡ **Quick Actions**: New note, Voice note, Screenshot, Open Desk page, Pin to screen.

**Gaming**
6. 📝 **Recent Notes**: by type, filter chips All | Notes | Guides | Tips | Boss | Builds, [+ New note].
7. 📚 **Guides**: counts per guide type plus the most recently used guides, [Browse Guides].
8. 📊 **Game Stats**: playtime, launches, last played, this session, [Session History].

**Media** (picker category: Gaming)
9. 🎙️ **Voice Notes**: record (hold a button), recent recordings with transcripts.
10. 📸 **Screenshot → Note**: latest screenshot, [New note] [Add to existing note].

**Workshop**
11. 🏭 **Madness Workshop**: popular and new books for this game, likes, a "3 new community guides" badge, [Browse Workshop].
12. 🤝 **Shared Notes** and 📌 **Pinned Notes**.

**Deck**
13. 🖥 **System**: CPU/GPU temperature, RAM, battery. 💾 **Storage**: free space. 🌐 **Network**: SSID, signal, sync status.

### 3.4 Pickers (both)
- **Category grid** (always there): Edit Desk → [+ Add Tome] → category tabs with a grid of tiles, D-pad and A. Works with Steam's normal focus.
- **Radial quick-switcher** (custom, drawn by us): hold a configurable combo, aim with the right stick, release to jump to or add a Tome. L1/R1 switch category rings. Steam's own radial menus can't be opened by plugins, so this one is ours. Stick input comes from the hidraw reader (`py_modules/buttons.py`), extended to read stick axes. To verify on a Deck: the axis offsets in report 0x09, and whether gamescope passes input to the game while the radial is up.

## 4. Phase 3: settings and admin

**User settings (Deck and site)**
- Tome order, visibility, per-game layouts, compact mode, the radial combo, the hold-A amount, the Workshop badge on/off, where Desk appears (QAM tab / Steam main menu / both).

**Admin (Desk site, 🛡 Admin)**
- Default Tome layout for new users, allowed Scrolls (allowlist), the default Workshop URL, a per-user Scroll quota.

**Admin (Workshop)**
- Featured picks, Trending rules (time window, likes vs downloads), Note Pack curation, Scroll review queue (see 5.2), and password-login settings with the confirm field.

## 5. Phase 4: Scrolls

### 5.1 What a Scroll is
A downloadable add-on bundle, listed in the Madness Workshop, installed into Desk's data folder, and enabled per user. A Scroll can add Tomes, Steam UI tweaks, or settings pages.

The first Scrolls:
- **Plugin Shelf**: pin any installed Decky plugin into Steam's main menu or as its own QAM tab, and group Decky's plugin list into folders. This patches Decky's own UI, so it can break on Decky updates. It ships off by default and turns itself off if its hooks aren't found.
- **Game News**: a News section on a game's library page, near Play/Install, built from Steam's `GetNewsForApp` (keyless) plus new Workshop books for that game. It can be hidden per game.
- Later: gg.deals and Smart Launcher Scrolls that bring those plugins' data into Tomes when they're installed.

### 5.2 Security (important)
Scroll code would run inside Steam's UI with full `SteamClient` access, the same power as the plugin itself. So:
- Only Scrolls **signed by the Workshop** (an admin-approved build, with the Workshop's key baked into Desk) can run code.
- Unsigned or community Scrolls can only be **data Scrolls** (Tome layouts, note packs, link lists) with no code.
- Admins review code Scrolls in the Workshop moderation queue.

## 6. Order of work

1. Phase 1: rename, migration, domains, confirm password, overlay bug → beta, tried on the Deck before going further.
2. Phase 2: the Tome framework, grid picker, then Tomes 1–5, 6–10, 11–13, then the radial picker.
3. Phase 3: settings and admin.
4. Phase 4: Scroll format, signing, Workshop listing, then the Plugin Shelf and Game News Scrolls.

## 7. Decisions (2026-10-04)

- Q1. Overlay bug: deferred, to be looked at later.
- Q2. The last Session Notes release shows "Replaced by Desk of Madness" with a link to the new GitHub repo. It keeps syncing.
- Q3. Android: a new package id (`com.marshymadness.deskofmadness`), so it's a reinstall.
- Q4. Per-game layouts: on by default.
- Q5. Deck Tomes (System/Storage/Network): off by default.
- Q6. Code Scrolls: only the owner (Marshy) can approve/sign them.
- Q7. The website (phone) gets the Tome Desk too.
