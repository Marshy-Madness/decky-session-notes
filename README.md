# Desk of Madness

*Your Deck. Your Notes. Your Madness.* Formerly **Session Notes**; installing Desk of Madness copies your Session Notes notes and settings across on first start.

Per-game notes for the Steam Deck, right in the Quick Access menu. Write down where you left off, boss tips, checklists,
voice memos and screenshots while you play. Optionally sync everything to your own server, then read and edit it from a
browser or an Android app.

Four parts, all in this repo:

| Part | Folder | What it is |
| --- | --- | --- |
| **Decky plugin** | `src/`, `main.py`, `py_modules/` | The Quick Access panel on the Deck |
| **Sync server** | `server/` | Self-hosted, multi-user: two-way sync, web editor, sharing, API, webhooks |
| **Madness Workshop** | `workshop/` | Public library where players post notes, guides and tips for everyone |
| **Android app** | `android/` | Native shell around the web editor, with mic, photo picker and share sheet |

---

## Deck plugin

### The Desk and Tomes
The **Desk** tab is a stream of **Tomes** (widgets) for the game you're playing, or the one you played last
(🔁 switches game). Tomes work on your real notes: ticking a checklist item there ticks it in the note.

- **My Desk:** 🧠 Game Brain (left off, next checklist item, last guide, top counter, last note), ⚡ Quick Actions,
  📍 Where I Left Off, ☑️ Active Checklist (unfinished items from every note; A ticks off, Options opens the note),
  ⚔️ Counters (A or ▶ +1, ◀ −1, X +3).
- **Gaming:** 📝 Recent Notes (All / Notes / Guides / Tips / Boss / Builds), 📚 Guides, 📊 Game Stats,
  🎙️ Voice Notes (one press records a new note; its words become the title), 📸 Screenshot → Note.
- **Workshop:** 🏭 Madness Workshop (popular books, a "new" badge), 👥 Shared Notes, 📌 Pinned Notes.
- **Deck** (off by default): 🌡️ System, 💾 Storage, 🌐 Network.

✏️ Edit Desk moves, folds and hides Tomes; ➕ opens the picker (category tabs and tiles). Changes made while a game
shows give that game its own layout (Settings → Desk turns that off). The **Tome wheel** (◎, or hold R4 + R5 even in a
game) is a radial menu: aim with the right stick or D-pad, L1/R1 change the ring, let go or press A to jump to a Tome.
The website has the Desk too (🗂 Desk / 📝 Notes in a game).

### Scrolls
Add-ons from the Madness Workshop: Settings → **📜 Manage Scrolls** (or 📜 Scrolls in the Workshop tab) installs,
updates, turns on and off, and removes them, and opens each one's ⚙ Settings. **Data Scrolls** (links, text, Note Packs,
a Desk layout) become a Tome. **Code Scrolls** only install and run when the Workshop's owner has signed them. The first two:
- **🧩 Plugin Shelf:** pin any Decky plugin as its own Quick Access tab or in the Steam menu, and group Decky's plugin
  list into folders. It changes Decky's own menus, so it starts off and turns itself off if a Decky update moves them.
- **📰 Game News:** a News section under Play/Install on each game's library page (Steam news and patch notes, plus new
  Workshop books; tap one to read it in the reader view; hide it per game), and a Game News Tome.

Your Desk server's admin can limit which Scrolls may be installed and how much space they use. Making one:
[`scrolls/README.md`](scrolls/README.md).

### Layout
- **Desk** tab: the Tomes above. 📝 opens the game's full notes list.
- **All** tab: every game you've played or written notes for.
- **Workshop** tab: browse what other players posted for your game (see [Workshop](#madness-workshop)).
- **Sort** by Alphabetical, Created, Last Edited or Recent Games. Pinned notes stay on top.
- **Search** and **tag filters** inside each game.

### Notes
- Title plus free-form **information** text.
- **Types:** Note, Guide, Tip, Walkthrough, Boss strategy, Build / loadout, Collectibles / map, Secret / easter egg,
  Deck settings, Achievement guide. Filter by type. Guides, walkthroughs and achievement guides also gather in a
  built-in **Guides** folder.
- **Screenshots**: attach several at once from the game's Steam screenshots, and place them inside the text with `[img:1]`.
  **Crop** them with four sliders (gamepad friendly). Optionally **remove them from Steam's screenshot library**
  once they're attached (the note keeps its own copy), so your Steam screenshots don't fill up.
- **Voice notes**: record from the Deck's microphone and play back from the note.
- **Checklists**: tick items off straight from the note view. The list shows progress like "3/7".
- **Spoiler** notes stay blurred until you choose **Reveal**.
- **Folders**, including folders inside folders. Move notes between them.
- **Pin** important notes to the top.
- **Tags**: your own `#tags`, plus automatic ones: created date, last edited date and time, and which launch of the game
  the note was written during (e.g. "Launch #12").
- **Version history**: every edit keeps the previous version. Preview any version and restore it.
- **Recently deleted**: bring back notes you deleted.

### Links and the browser
- **Links in notes** (`https://…` or `www.…`) can be selected and open in Desk of Madness' own browser page.
- **Reader view** (default): just the article, without ads, menus, pop-ups or cookie banners. The sync server makes it
  and keeps a copy, so a page opens instantly the next time on any device; without a server the Deck makes it itself.
  Fandom, wiki.gg and Wikipedia pages come straight from their wiki API. Pages the reader can't handle open in full.
- **Full page**: the real site in Steam's browser, with Steam's keyboard for text boxes.
- **Buttons:** B back (closes at the first page) · X reader / full page · Y menu (address or search, add the page to
  the note, save it as a new note, text size) · L1 / R1 back / forward · L2 / R2 page up / down. In the reader the
  D-pad scrolls (up/down) and picks links on screen (left/right), and A opens the picked link.
- **Trackpads** work as on Steam's store pages on the notes page, in notes and in the browser: the left one scrolls,
  the right one is a mouse and clicking it clicks. Turn it off under Settings → Browser and controls.
- Server admins choose how long unread reader pages are kept (30, 60, 90, 180 or 365 days, or never) on the website
  (Admin → Features & limits, also in the Android app) or on the Deck (Settings → Browser and controls).

### While playing
- **Where I left off.** A pinned note per game that pops up every time you launch it.
- **Session recap** (optional): when you quit a game, it asks where you left off and pins your answer for next time.
- **Screenshot prompt.** Press STEAM + R1 and get offered "New note with it" or "Add to an existing note".
- **Pin to screen** (experimental): show a note's unchecked to-dos over the game, through Steam's performance overlay.
  Turn the overlay on (Quick Access → ⚡ → Level 1 or higher). Ticking items off updates it, and it clears when you quit.
- **Counters.** Death counter, boss attempts (with **Defeated**) and custom counters, with − and + buttons and
  "+3 this session".
- **Stats** per game: launch count, playtime, last played and a session history.

### Sync and sharing (optional)
Connect the plugin to your own [sync server](#sync-server) under **gear tab → Sync**. Enter the server address and
the one-time **pairing code** shown on the website (your name → Devices → Connect a device). Then:
- Your Deck edits are sent ~20 seconds after you make them.
- **Check website for changes:** every 1 / 5 / 10 / 30 / 60 minutes, or **Manual only**.
- Edits made on the website or phone show up on the Deck automatically. The newest edit wins, and deletions sync too.
- **Share with…** (a note's ☰ menu): share a note with other people on your server, picked by their Steam name.
  It shows up read-only in their game's **Shared Notes** folder, and they can **copy it** into their own notes to
  edit (for example, to fill out a checklist).

### Install
- From the **Madness Decky Store**, or
- Grab `desk-of-madness.zip` from [Releases](../../releases) and install it with Decky's developer "Install from zip", or
- Build and copy it yourself: `pnpm install && DECK_HOST=deck@<deck-ip> ./deploy.sh`

---

## Sync server

A dependency-free Python container (`server/`) that:
- Has **accounts per person**: sign in with **Steam**, so everyone is known by Steam ID and name. The server owner
  invites people by Steam ID, or opens sign-ups to anyone. Each person's notes are stored separately.
- **Syncs both ways** with the Deck, using the same merge rules on both sides (`py_modules/merge.py`).
- Serves a **web editor** with a phone layout. It can be installed to your home screen.
- Keeps **version history** for every note (last 50 versions) and the last 30 snapshots of each game.

### Web editor
Edit notes, information text, tags, folders, checklists, pin and spoiler. Upload screenshots, record or upload voice
notes, and edit the left-off pin and counters. Version history and Recently deleted are here too. Each game opens
on its **Desk** (Game Brain, checklist, counters, recent notes, guides and more; ＋ Tomes and ✏️ Edit arrange it, saved in
that browser) with **📝 Notes** for the full list.

Voice recording in the browser needs the site served over **https**.

### Run it
```yaml
services:
  desk-of-madness:
    build:
      context: /path/to/desk-of-madness
      dockerfile: server/Dockerfile
    container_name: desk-of-madness
    restart: unless-stopped
    ports:
      - "8430:8430"
    volumes:
      - ./data:/data
    environment:
      - API_TOKEN=pick-a-token-for-the-deck          # entered in the plugin's Sync settings
      - WEB_PASSWORD=pick-a-website-password         # defaults to AdminPassword, so change it
      - PUBLIC_URL=https://notes.example.com         # used for links in notifications
      - WEBHOOK_URLS=                                # optional, see below
```
Put it behind a reverse proxy (e.g. Nginx Proxy Manager) with HTTPS to use it away from home.

### Admin: Desk & Workshop
🛡 Admin → Settings → **Desk & Workshop**: the **starting Desk** (which Tomes, in what order) for everyone who hasn't
arranged their own, on the Deck and the website; the **Workshop address** (overrides WORKSHOP_URL, and Decks use it
unless they set their own); and **Scrolls** (which ones people may install, and their space per person).

### Accounts and security
- **Steam sign-in** (OpenID, no API key needed) for everyone. The owner can also use the password from `WEB_PASSWORD`,
  and can link their Steam account from the account menu.
- **Invite-only** by default. Account → Users: invite by Steam ID or profile link, allow open sign-ups, remove people.
- **Devices** (Deck, scripts) link with a one-time pairing code and get their own token, which can be unlinked any time.
- Sessions last 30 days. Repeated wrong passwords or codes are locked out for 15 minutes.
- Changes made through a browser session require a custom header, which blocks cross-site request forgery.

### API and webhooks
See [`server/API.md`](server/API.md). In short:
- `POST /api/games/{appId}/notes` quick-adds a note. Handy for n8n, Home Assistant or phone shortcuts.
- `GET /api/search?q=` searches every game.
- **Webhooks:** set `WEBHOOK_URLS` to get a JSON event after every change. Prefix a URL with `ntfy+` for plain-text
  [ntfy](https://ntfy.sh) phone notifications.

---

## Madness Workshop

**Sections:** ⭐ **Featured** (picked by admins), 🔥 **Trending** (likes, and saves to notes, in the last 7 days; admins
change the window), 📦 **Note Packs** (collections of posts you save to your notes in one go: “Save all” on the website,
“Copy all” on the Deck; each post goes into its own game), and 🧰 **My Workshop** (your posts, packs, likes and how often
they were saved). Anyone signed in can make a pack from their own posts and ones they liked, or add a post to a pack from
its page. Admins get ⭐ Feature on posts and packs, a Note Packs page, and Site → Featured & trending.

A separate public container (`workshop/`) where players publish notes for everyone. It shows up as the
**Workshop** tab on the Deck and as a website.

- **Browse** by game, filter by type (Guide, Tip, Boss strategy, …) and by what a post contains (📷 screenshots,
  🎙 voice recordings, ☑ checklists). Sort by most liked, newest or recently updated.
- **Publish** any of your notes from its ☰ menu (with its screenshots, voice notes and checklist). Publishing again
  updates the same post.
- **Who can edit:** Only me, Me and people I choose (picked by Steam name), or Anyone signed in. Every edit is kept
  in the post's history.
- **Allow copies:** let people copy a post into their own notes, where their copy is private (e.g. to tick off a
  checklist). Copies go to their own notes and sync server, never back into the Workshop.
  On the website, **📥 Save to my notes** opens your Desk of Madness site at `/?import=workshop:<id>`, which does the
  copy (it asks for your Desk of Madness address once). The Android app does this from its Workshop tab.
- **Spoiler tag:** hide a post until readers choose to reveal it, with a label like "Beat the first boss" so they
  know when it's safe.
- **Likes and comments.**
- **Sign in with Steam** to post. On the Deck: gear tab → Workshop → **Link your Steam account**. It shows a code
  to enter at `<workshop>/link` on your phone.
- Admins (`ADMIN_STEAM_IDS`) can delete any post or comment and ban users.
- **📜 Scrolls:** add-ons for Desk (see [Scrolls](#scrolls)). Anyone signed in can submit one; code Scrolls wait in
  🛡 Admin → Scrolls until a site owner reads the code and approves it, which signs it with `data/scroll_signing.key`
  (created by you; keep a backup). The official Scrolls ship in the image (`workshop/scrolls/`, built with
  `node scrolls/build.mjs`) and are published and signed when the Workshop starts.

```yaml
services:
  workshop:
    build:
      context: /path/to/desk-of-madness
      dockerfile: workshop/Dockerfile
    restart: unless-stopped
    ports:
      - "8431:8431"
    volumes:
      - ./data:/data
    environment:
      - ADMIN_STEAM_IDS=7656119xxxxxxxxxx
```

The plugin points at `https://workshop.marshymadness.com` by default. Change it under gear tab → Workshop.

---

## Android app

`android/` is a small Kotlin app that loads your server's web editor and adds:
- First-run **server address** setup. Change it later with the **Server** button.
- **Microphone** access for voice notes, and the **photo/file picker** for screenshots.
- **"Add to Desk of Madness"** in Android's share menu: share photos, recordings or text from any app into a new note.
- The **back button** closes dialogs first.
- A **Workshop** tab (bottom bar) with Steam sign-in inside the app. **📥 Save to my notes** on a post copies it
  into your notes and opens it on the Notes tab. The Workshop address is under "Workshop address" on the setup screen.

Download the APK from [Releases](../../releases), or from your server at `/download/android`.
To build it: `cd android && ./gradlew dist`, which needs JDK 17 or newer and the Android SDK.

---

## Development
```bash
pnpm install
pnpm run build                 # plugin -> dist/
DECK_HOST=deck@<ip> ./deploy.sh
cd server && python app.py     # sync server on :8430 (needs py_modules/merge.py next to it, or use Docker)
```

Releases: bump `version` in `package.json`, then tag `v<version>` and push. The workflow builds the plugin zip.
