# Session Notes

Per-game notes for the Steam Deck, right in the Quick Access menu. Write down where you left off, boss tips, checklists,
voice memos and screenshots while you play. Optionally sync everything to your own server, then read and edit it from a
browser or an Android app.

Three parts, all in this repo:

| Part | Folder | What it is |
| --- | --- | --- |
| **Decky plugin** | `src/`, `main.py`, `py_modules/` | The Quick Access panel on the Deck |
| **Sync server** | `server/` | Small self-hosted container: two-way sync, web editor, API, webhooks |
| **Android app** | `android/` | Native shell around the web editor, with mic, photo picker and share sheet |

---

## Deck plugin

### Layout
- **Wide panel.** The Quick Access menu widens while Session Notes is open (Normal / Wide / Extra wide).
- **Current** tab: notes for the game you're playing right now.
- **All** tab: every game you've played or written notes for.
- **Sort** by Alphabetical, Created, Last Edited or Recent Games. Pinned notes stay on top.
- **Search** and **tag filters** inside each game.

### Notes
- Title plus free-form **information** text.
- **Screenshots**: attach several at once from the game's Steam screenshots, and place them inside the text with `[img:1]`.
- **Voice notes**: record from the Deck's microphone and play back from the note.
- **Checklists**: tick items off straight from the note view. The list shows progress like "3/7".
- **Spoiler** notes stay blurred until you choose **Reveal**.
- **Folders**, including folders inside folders. Move notes between them.
- **Pin** important notes to the top.
- **Tags**: your own `#tags`, plus automatic ones: created date, last edited date and time, and which launch of the game
  the note was written during (e.g. "Launch #12").
- **Version history**: every edit keeps the previous version. Preview any version and restore it.
- **Recently deleted**: bring back notes you deleted.

### While playing
- **Where I left off.** A pinned note per game that pops up every time you launch it.
- **Session recap** (optional): when you quit a game, it asks where you left off and pins your answer for next time.
- **Screenshot prompt.** Press STEAM + R1 and get offered "New note with it" or "Add to an existing note".
- **Counters.** Death counter, boss attempts (with **Defeated**) and custom counters, with − and + buttons and
  "+3 this session".
- **Stats** per game: launch count, playtime, last played and a session history.

### Sync (optional)
Connect the plugin to your own [sync server](#sync-server) under **gear tab → Sync**:
- Your Deck edits are sent ~20 seconds after you make them.
- **Check website for changes:** every 1 / 5 / 10 / 30 / 60 minutes, or **Manual only**.
- Edits made on the website or phone show up on the Deck automatically. The newest edit wins, and deletions sync too.

### Install
- From the **Madness Decky Store**, or
- Grab `decky-session-notes.zip` from [Releases](../../releases) and install it with Decky's developer "Install from zip", or
- Build and copy it yourself: `pnpm install && DECK_HOST=deck@<deck-ip> ./deploy.sh`

---

## Sync server

A dependency-free Python container (`server/`) that:
- **Syncs both ways** with the Deck, using the same merge rules on both sides (`py_modules/merge.py`).
- Serves a **web editor** with a phone layout. It can be installed to your home screen.
- Keeps **version history** for every note (last 50 versions) and the last 30 snapshots of each game.

### Web editor
Edit notes, information text, tags, folders, checklists, pin and spoiler. Upload screenshots, record or upload voice
notes, and edit the left-off pin and counters. Version history and Recently deleted are here too.

Voice recording in the browser needs the site served over **https**.

### Run it
```yaml
services:
  session-notes:
    build:
      context: /path/to/decky-session-notes
      dockerfile: server/Dockerfile
    container_name: session-notes
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

### Security
- The website uses a password login with a 30-day session cookie. Repeated wrong passwords are locked out for 15 minutes.
- The Deck and API clients use a bearer token.
- Changes made through a browser session require a custom header, which blocks cross-site request forgery.

### API and webhooks
See [`server/API.md`](server/API.md). In short:
- `POST /api/games/{appId}/notes` quick-adds a note. Handy for n8n, Home Assistant or phone shortcuts.
- `GET /api/search?q=` searches every game.
- **Webhooks:** set `WEBHOOK_URLS` to get a JSON event after every change. Prefix a URL with `ntfy+` for plain-text
  [ntfy](https://ntfy.sh) phone notifications.

---

## Android app

`android/` is a small Kotlin app that loads your server's web editor and adds:
- First-run **server address** setup. Change it later with the **Server** button.
- **Microphone** access for voice notes, and the **photo/file picker** for screenshots.
- **"Add to Session Notes"** in Android's share menu: share photos, recordings or text from any app into a new note.
- The **back button** closes dialogs first.

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
