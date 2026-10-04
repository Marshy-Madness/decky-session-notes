# Session Notes server API

Base URL: your server, e.g. `https://steamnotes.marshymadness.com` (or `http://192.168.0.144:8430` on the LAN).

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
| `GET /api/games` | `[{appId, name, rev, noteCount, lastLaunched, updatedAt}]` |
| `GET /api/games/{appId}` | `{game, rev}`: the whole record (notes, folders, counters, sessions, leftOff) |
| `GET /api/search?q=boss` | `[{appId, game, note}]`: matches in titles, information and tags across all games |
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
