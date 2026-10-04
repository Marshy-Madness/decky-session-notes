# Session Notes server API

Base URL: your server, e.g. `https://steamnotes.marshymadness.com` (or `http://192.168.0.144:8430` on the LAN).

## Accounts
People sign in on the website with Steam, or with an email and password (`POST /api/signup` `{name, email, password}`,
then `POST /api/login` `{email, password}`). New accounts are `pending` until the owner approves them under
Account → Users, unless "Let new people in without approval" is ticked. Invited Steam IDs skip the wait. If
`WEBHOOK_URLS` is set, the owner gets a `user.pending` notification for each request.

| Request | What it does |
| --- | --- |
| `POST /api/account/login` `{email?, password?, current?}` | Set or change your own email and password (`current` is needed once you have a password). For the owner, this password replaces `WEB_PASSWORD` |
| `POST /api/admin/users/{id}/approve` | Owner only: let a pending account in. Reject it with `DELETE /api/admin/users/{id}` |
| `POST /api/admin/users/{id}/password` `{password}` | Owner only: set a new password for someone who forgot theirs |

## Auth
Every request acts as one user. Get a device token for your account:
1. On the website: your name → **Devices** → **Connect a device**. Note the code (e.g. `K7P-4QX`).
2. `POST /api/pair` with `{"code": "K7P-4QX", "label": "My script"}` returns `{token, user}`.

Then send the token on every request (the owner's legacy `API_TOKEN` also works):

```
Authorization: Bearer <token>
```

Optional: `X-Client: n8n` (or any name) labels where a change came from in webhooks. It defaults to `deck`.

## Reading

| Request | Returns |
| --- | --- |
| `GET /api/games` | `[{appId, name, rev, noteCount, lastLaunched, updatedAt, aliases, icon, image, steamApp, customName}]` |
| `GET /api/games/{appId}` | `{game, rev}`: the whole record (notes, folders, counters, sessions, leftOff). Works with any of the game's IDs |
| `GET /api/steam/apps/{appId}` | `{appId, name, found, icon, image, steamApp, yours}`: what Steam calls an app ID, plus its icon and header art. `yours` is your game for that ID, if you have one |
| `GET /api/search?q=boss` | `[{appId, game, note}]`: matches in titles, information, tags and voice-note transcripts across all games |
| `GET /api/account` | `{user, speech}`: who the token belongs to, and whether speech to text is on for them |
| `GET /api/history/{appId}/{noteId}` | Earlier versions of a note, newest first: `[{savedAt, reason, note}]` |
| `GET /api/deleted/{appId}` | Deleted notes that can be restored: `[{deletedAt, note}]` |
| `GET /api/media/{appId}` | File names of screenshots and voice notes |
| `GET /api/media/{appId}/{file}` | The file itself |
| `GET /api/health` | `{ok: true}` (no auth needed) |

## Sharing

| Request | What it does |
| --- | --- |
| `GET /api/users` | Other people on the server: `[{id, name, avatar, steamId}]` |
| `POST /api/shares` `{appId, noteId, to}` | Share one of your notes (read-only) with a user |
| `GET /api/shares?appId=` | Notes you've shared, with recipient names |
| `DELETE /api/shares/{id}` | Stop sharing (either side can remove a share) |
| `GET /api/shared` | Notes shared with you: `[{shareId, fromName, appId, gameName, note}]` |
| `GET /api/shared/media/{shareId}/{file}` | A screenshot or voice note from a shared note |

## Writing

### Quick add a note (easiest for automations)
`POST /api/games/{appId}/notes`
```json
{ "title": "Buy the lantern", "body": "From the merchant at the bridge", "tags": ["todo"],
  "checklist": ["Get 500 gold", "Find the merchant"], "pinned": false }
```
Only `title` is required. If the game doesn't exist yet, add `"gameName": "Elden Ring"` to create it.
Returns `{note, rev}`. The Deck picks it up on its next sync.

```bash
curl -X POST https://steamnotes.marshymadness.com/api/games/1245620/notes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Try the bleed build","tags":["idea"]}'
```

### Games: add, rename, link more app IDs

| Request | What it does |
| --- | --- |
| `POST /api/games` `{appId, name?}` | Start a game. A Steam app gets its name from Steam (a different `name` becomes your own name for it). Any other ID, such as a non-Steam shortcut's, needs `name`. Returns `{game, existing}` |
| `POST /api/games/{appId}/name` `{name}` | Your own name for the game. It wins over the name the Deck reports. `""` goes back to that name |
| `POST /api/games/{appId}/aliases` `{appId}` | Make another app ID point at this game, e.g. a non-Steam game whose shortcut got a new ID. If that ID already has notes, they're merged in (its old record is kept in `merged/` on the server). Returns `{game, aliases}` |
| `DELETE /api/games/{appId}/aliases/{otherId}` | Unlink an ID again. Notes stay where they are; a device that still uses that ID starts a separate copy on its next sync |

Every endpoint accepts any of a game's IDs. Syncs answer under the ID you sent, so a Deck keeps its own shortcut ID.
`GET /api/games` lists each game once for the website. A device sees each game under the ID(s) it has synced it with.

### Copy a Bookstore post into your notes
`POST /api/import/bookstore` with `{"id": "<entry id>"}`. The server downloads the post and its media from
`BOOKSTORE_URL` and adds it to the post's game. Returns `{note, appId, gameName, existing}`. If you already copied that
post, `existing` is `true` and nothing new is added. It returns 403 if the poster turned off copying.
The website runs this when you open `/?import=bookstore:<id>`, which is where the Bookstore's "Save to my notes" button links.

### Full sync (what the Deck and website use)
`POST /api/sync/{appId}` with a whole game record. The server merges it with its copy and returns `{game, rev}`:
- Notes, folders and counters merge by `id`. The one with the newer `updatedAt` (ms since epoch) wins.
- To delete something, remove it and add `"deleted": {"<id>": <now ms>}`.
- To edit, change the item and set its `updatedAt` to now.

### Upload media
`PUT /api/media/{appId}/{file}` with the raw bytes. Then reference the file in a note's `screenshots`
(`{id, file, takenAt}`) or `recordings` (`{id, file, createdAt, durationSec}`) and sync.

## Speech to text

Runs on the server's Whisper container (`WHISPER_URL`). The owner always has it; other users only once the owner
ticks 🎤 Speech for them (website → Account → Users). Everyone else gets `403`.

| Request | What it does |
| --- | --- |
| `POST /api/transcribe?appId=&game=&lang=` (body: audio, any format) | `{text}`: dictation. `appId`/`game` help it spell game words; `lang` like `en` (empty = detect) |
| `POST /api/transcribe/{appId}/{file}` | `{text}`: transcribe a stored voice note now and save it on the note |
| `POST /api/admin/users/{id}/speech` `{allowed}` | Owner only: allow or block a user. Allowing also transcribes their existing voice notes |

Voice notes are transcribed in the background as they sync. The text lands on the recording as
`recordings[].transcript` and doesn't change the note's `updatedAt`. Dictation is limited to `SPEECH_PER_HOUR`
clips per user (default 120, `429` past that).

## Webhooks
Set `WEBHOOK_URLS` in docker-compose.yml (comma separated). After every change the server POSTs:

```json
{ "source": "web", "appId": "1245620", "game": "Elden Ring", "at": 1791063290014,
  "events": [{ "event": "note.created", "noteId": "…", "title": "Malenia tips" }],
  "summary": ["New note in Elden Ring: Malenia tips"], "url": "https://steamnotes.marshymadness.com" }
```

Events: `note.created`, `note.updated`, `note.deleted`, `leftoff.updated`, `counter.updated`, `game.launched`.

To get the summary as a phone notification through **ntfy**, put `ntfy+` in front of the topic URL:
`WEBHOOK_URLS=ntfy+https://ntfy.example.com/session-notes`. For **n8n**, use a Webhook node's URL as is.
