"""Desk of Madness sync server (formerly Session Notes): multi-user two-way sync for the Decky plugin, web editor, sharing, API, webhooks.

Sign-in:
- Website: "Sign in with Steam", email + password, or the owner password (WEB_PASSWORD until one is set on the website).
  New accounts wait for the owner's approval unless sign-ups are open.
- Deck / Android / API: a device token, obtained with a pairing code from the website.
  The legacy API_TOKEN still works and belongs to the owner.
"""
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import shutil
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import merge
import reader_cache
import speech
import steam
from accounts import OWNER_ID, Accounts, check_password

DATA = os.environ.get("DATA_DIR", "/data")
WEB_PASSWORD = os.environ.get("WEB_PASSWORD") or "AdminPassword"
HISTORY_KEEP = int(os.environ.get("HISTORY_KEEP", "30"))
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
OWNER_WEBHOOKS = [u.strip() for u in os.environ.get("WEBHOOK_URLS", "").split(",") if u.strip()]
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")
BOOKSTORE_URL = (os.environ.get("WORKSHOP_URL") or os.environ.get("BOOKSTORE_URL") or "https://workshop.marshymadness.com").rstrip("/")
MAX_BODY = 60 * 1024 * 1024
SPEECH_PER_HOUR = int(os.environ.get("SPEECH_PER_HOUR", "120"))
SAFE = re.compile(r"^[A-Za-z0-9._-]+$")
HERE = os.path.dirname(os.path.abspath(__file__))
COOKIE = "sn_session"
STATIC = {"manifest.webmanifest": "application/manifest+json", "icon.svg": "image/svg+xml", "sw.js": "text/javascript"}
APK_PATH = os.path.join(DATA, "app", "DeskOfMadness.apk")
SHARES_PATH = os.path.join(DATA, "shares.json")
MEDIA_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
               ".wav": "audio/wav", ".webm": "audio/webm", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp3": "audio/mpeg"}

accounts = Accounts()
write_lock = threading.RLock()
speech_limit = speech.RateLimit(SPEECH_PER_HOUR)
shares_lock = threading.Lock()
failed_logins: dict = {}
STARTED = time.time()
SETTING_KEYS = {"emailSignups": bool, "speechDefault": bool, "quotaMb": int, "announcement": str, "maxDevices": int}
readers = reader_cache.ReaderCache(DATA)


def reader_cache_days() -> int:
    return reader_cache.clean_days(accounts.setting("readerCacheDays", reader_cache.DEFAULT_DAYS))


def now_ms() -> int:
    return int(time.time() * 1000)


def safe(name: str) -> str:
    name = urllib.parse.unquote(name)
    if not SAFE.match(name) or name in (".", ".."):
        raise ValueError("bad name")
    return name


# ---------- per-user game storage ----------

class Store:
    """One user's games. A game can answer to several app IDs (e.g. a non-Steam game whose shortcut ID changed,
    or the same game on two devices): aliases.json maps each extra ID to the game's main ID, and everything
    (record, media, history) lives under the main ID."""

    def __init__(self, uid: str):
        self.uid = uid
        self.root = accounts.user_dir(uid)
        self.history = merge.NoteHistory(os.path.join(self.root, "note_history"))
        self.transcripts = speech.Transcripts(os.path.join(self.root, "transcripts.json"))
        self.aliases_path = os.path.join(self.root, "aliases.json")
        self.devices_path = os.path.join(self.root, "device_ids.json")

    def aliases(self) -> dict:
        if os.path.exists(self.aliases_path):
            with open(self.aliases_path) as f:
                return json.load(f)
        return {}

    def _save_json(self, path: str, data):
        os.makedirs(self.root, exist_ok=True)
        with open(path + ".tmp", "w") as f:
            json.dump(data, f, indent=2)
        os.replace(path + ".tmp", path)

    def canon(self, appid: str) -> str:
        return self.aliases().get(str(appid), str(appid))

    def aliases_of(self, appid: str) -> list:
        return sorted(a for a, c in self.aliases().items() if c == appid)

    def game_path(self, appid: str) -> str:
        return os.path.join(self.root, "games", f"{self.canon(appid)}.json")

    def media_path(self, appid: str, file: str = "") -> str:
        return os.path.join(self.root, "media", self.canon(appid), file)

    def add_alias(self, appid: str, other: str, source: str) -> dict:
        """Make `other` another ID for `appid`. If `other` already has notes, they're merged in."""
        with write_lock:
            target, other = self.canon(appid), str(other)
            if self.canon(other) == target:
                return self.read(target)[0]
            aliases = self.aliases()
            old_main = aliases.get(other, other)
            old_path = os.path.join(self.root, "games", f"{old_main}.json")
            old = None
            if os.path.exists(old_path):
                with open(old_path) as f:
                    old = json.load(f)
            # The other game (and any IDs that already pointed at it) now point here.
            for a, c in list(aliases.items()):
                if c == old_main:
                    aliases[a] = target
            aliases[old_main] = target
            aliases[other] = target
            self._save_json(self.aliases_path, aliases)
            if old is not None:
                src = os.path.join(self.root, "media", old_main)
                if os.path.isdir(src):
                    dst = self.media_path(target)
                    os.makedirs(dst, exist_ok=True)
                    for name in os.listdir(src):
                        if not os.path.exists(os.path.join(dst, name)):
                            shutil.move(os.path.join(src, name), os.path.join(dst, name))
                for key, entry in self.transcripts.load().items():
                    if key.startswith(old_main + "/"):
                        self.transcripts.put(target, key.split("/", 1)[1], entry)
                hist = os.path.join(self.root, "note_history", old_main)
                if os.path.isdir(hist):
                    dst = os.path.join(self.root, "note_history", target)
                    os.makedirs(dst, exist_ok=True)
                    for name in os.listdir(hist):
                        if not os.path.exists(os.path.join(dst, name)):
                            shutil.move(os.path.join(hist, name), os.path.join(dst, name))
                mine, _ = self.read(target)
                old.pop("customName", None), old.pop("customNameAt", None)  # keep this game's name
                if mine and mine.get("name") and mine.get("name") != target:
                    old["name"] = mine["name"]
                old["appId"] = target
                self.sync(target, old, source)
                kept = os.path.join(self.root, "merged", f"{old_main}-{now_ms()}.json")
                os.makedirs(os.path.dirname(kept), exist_ok=True)
                shutil.move(old_path, kept)
        return self.read(target)[0]

    def remove_alias(self, appid: str, other: str) -> bool:
        with write_lock:
            aliases = self.aliases()
            if aliases.get(str(other)) != self.canon(appid):
                return False
            del aliases[str(other)]
            self._save_json(self.aliases_path, aliases)
            return True

    # Each device keeps games under the IDs it knows. Remember which ones it used, so the game list
    # shows a device a game under its own ID instead of handing it a duplicate under the main one.
    def device_ids(self, device: str) -> set:
        if os.path.exists(self.devices_path):
            with open(self.devices_path) as f:
                return set(json.load(f).get(device, []))
        return set()

    def mark_device_id(self, device: str, appid: str):
        if appid in self.device_ids(device):
            return
        with write_lock:
            data = {}
            if os.path.exists(self.devices_path):
                with open(self.devices_path) as f:
                    data = json.load(f)
            data[device] = sorted(set(data.get(device, [])) | {appid})
            self._save_json(self.devices_path, data)

    def read(self, appid: str):
        path = self.game_path(appid)
        if not os.path.exists(path):
            return None, None
        with open(path, "rb") as f:
            raw = f.read()
        return json.loads(raw), hashlib.sha1(raw).hexdigest()[:16]

    def write(self, appid: str, game: dict) -> str:
        path = self.game_path(appid)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if os.path.exists(path):
            hist = os.path.join(self.root, "history", appid)
            os.makedirs(hist, exist_ok=True)
            shutil.copy2(path, os.path.join(hist, f"{now_ms()}.json"))
            for old in sorted(os.listdir(hist))[:-HISTORY_KEEP]:
                os.remove(os.path.join(hist, old))
        raw = json.dumps(game, indent=2).encode()
        with open(path + ".tmp", "wb") as f:
            f.write(raw)
        os.replace(path + ".tmp", path)
        return hashlib.sha1(raw).hexdigest()[:16]

    def appids(self) -> list:
        gdir = os.path.join(self.root, "games")
        return sorted(n[:-5] for n in os.listdir(gdir) if n.endswith(".json")) if os.path.isdir(gdir) else []

    def sync(self, appid: str, incoming: dict, source: str) -> dict:
        appid = self.canon(appid)
        incoming["appId"] = appid
        with write_lock:
            stored, rev = self.read(appid)
            merged = merge.merge_games(incoming, stored or {}, now_ms())
            missing = self.fill_transcripts(appid, merged)
            if stored is None or json.dumps(merged, sort_keys=True) != json.dumps(stored, sort_keys=True):
                self.history.record(appid, (stored or {}).get("notes", []), merged.get("notes", []), now_ms())
                rev = self.write(appid, merged)
                hooks = user_webhooks(self.uid)
                if hooks:
                    events = describe_changes(stored or {}, merged)
                    if events:
                        threading.Thread(target=send_webhooks, args=(hooks, merged, events, source), daemon=True).start()
        if missing and accounts.speech_allowed(accounts.get(self.uid)):
            for file in missing:
                transcriber.add(self.uid, appid, file)
        return {"game": merged, "rev": rev}

    def fill_transcripts(self, appid: str, game: dict) -> list:
        """Copy known transcripts onto voice notes (in place). Returns the files that still need one."""
        appid = self.canon(appid)
        cache, missing = None, []
        for n in game.get("notes", []):
            for r in n.get("recordings") or []:
                if r.get("transcript") or not r.get("file"):
                    continue
                if cache is None:
                    cache = self.transcripts.load()
                hit = cache.get(f"{appid}/{r['file']}")
                if hit and hit.get("text"):
                    r["transcript"] = hit["text"]
                elif not hit and os.path.exists(self.media_path(appid, r["file"])):
                    missing.append(r["file"])
        return missing

    def transcribe_file(self, appid: str, file: str) -> str:
        """Transcribe one stored voice note, remember the text and add it to the note."""
        appid = self.canon(appid)
        with open(self.media_path(appid, file), "rb") as f:
            audio = f.read()
        game, _ = self.read(appid)
        try:
            text = speech.transcribe(audio, file, prompt=speech_prompt((game or {}).get("name")))
        except ValueError as e:  # too long: don't retry
            self.transcripts.put(appid, file, {"error": str(e)})
            raise
        self.transcripts.put(appid, file, {"text": text} if text else {"error": "no speech"})
        if text:
            with write_lock:
                game, _ = self.read(appid)
                before = json.dumps(game)
                if game:
                    self.fill_transcripts(appid, game)
                    if json.dumps(game) != before:
                        self.write(appid, game)
        return text


# ---------- sharing ----------

def load_shares() -> list:
    if os.path.exists(SHARES_PATH):
        with open(SHARES_PATH) as f:
            return json.load(f)
    return []


def save_shares(shares: list):
    with open(SHARES_PATH + ".tmp", "w") as f:
        json.dump(shares, f, indent=2)
    os.replace(SHARES_PATH + ".tmp", SHARES_PATH)


def resolve_share(share: dict):
    """The live note behind a share, or None if it was deleted."""
    game, _ = Store(share["from"]).read(share["appId"])
    if not game:
        return None, None
    note = next((n for n in game.get("notes", []) if n["id"] == share["noteId"]), None)
    return game, note


# ---------- Madness Workshop import (the Workshop was called the Bookstore) ----------

def bookstore_get(path: str) -> bytes:
    req = urllib.request.Request(BOOKSTORE_URL + path, headers={"User-Agent": "DeskOfMadness-Server"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def import_from_bookstore(store: "Store", entry_id: str, source: str) -> dict:
    """Copy a public Madness Workshop entry into this user's notes (same shape as the Deck plugin's copy)."""
    if not SAFE.match(entry_id):
        raise ValueError("bad id")
    try:
        e = json.loads(bookstore_get(f"/api/entries/{urllib.parse.quote(entry_id)}"))
    except urllib.error.HTTPError as err:
        raise LookupError("That Workshop post doesn't exist anymore" if err.code == 404 else f"Workshop error {err.code}")
    if not e.get("allowCopy"):
        raise PermissionError("The poster turned off copying for this one")
    appid = safe(str(e["appId"]))
    stored, _ = store.read(appid)
    existing = next((n for n in (stored or {}).get("notes", []) if (n.get("source") or {}).get("id") == e["id"]), None)
    if existing:
        return {"note": existing, "appId": appid, "gameName": stored.get("name"), "existing": True}

    os.makedirs(store.media_path(appid), exist_ok=True)

    def fetch(name: str, thumb: bool = False) -> str:
        ext = safe(name).rsplit(".", 1)[-1]
        new = f"{uuid.uuid4()}{'.thumb' if thumb else ''}.{ext}"
        with open(store.media_path(appid, new), "wb") as f:
            f.write(bookstore_get(f"/api/media/{urllib.parse.quote(name)}"))
        return new

    now = now_ms()
    shots = []
    for s in e.get("screenshots", []):
        item = {"id": str(uuid.uuid4()), "file": fetch(s["file"]), "takenAt": e["createdAt"]}
        if s.get("thumb"):
            item["thumb"] = fetch(s["thumb"], True)
        shots.append(item)
    recs = [{"id": str(uuid.uuid4()), "file": fetch(r["file"]), "createdAt": e["createdAt"],
             **({"durationSec": r["durationSec"]} if r.get("durationSec") else {})} for r in e.get("recordings", [])]
    note = {"id": str(uuid.uuid4()), "folderId": None, "title": e["title"], "body": e.get("body", ""), "tags": e.get("tags", []),
            "screenshots": shots, "recordings": recs, "pinned": False, "createdAt": now, "updatedAt": now, "launchNumber": None,
            "kind": e.get("kind", "note"), "spoiler": bool(e.get("spoiler")),
            "source": {"type": "bookstore", "id": e["id"], "author": e["author"]["name"]}}
    if e.get("checklist"):
        note["checklist"] = [{"id": str(uuid.uuid4()), "text": c["text"], "done": False} for c in e["checklist"]]
    name = (stored or {}).get("name") or e.get("gameName") or appid
    store.sync(appid, {"appId": appid, "name": name, "notes": [note]}, source)
    return {"note": note, "appId": appid, "gameName": name, "existing": False}


# ---------- speech to text ----------

def speech_prompt(game_name: str = None) -> str:
    """Whisper spells game-specific names better when it knows what the clip is about."""
    return f"Notes about the game {game_name}." if game_name else ""


def speech_on(user: dict) -> bool:
    return speech.enabled() and accounts.speech_allowed(user)


class Transcriber:
    """Background queue that transcribes voice notes, one at a time."""

    def __init__(self):
        self.q = queue.Queue()
        self.pending = set()
        self.lock = threading.Lock()
        self.started = False

    def add(self, uid: str, appid: str, file: str):
        if not speech.enabled() or not speech.is_audio(file):
            return
        key = (uid, appid, file)
        with self.lock:
            if key in self.pending:
                return
            self.pending.add(key)
            if not self.started:
                self.started = True
                threading.Thread(target=self.run, daemon=True).start()
        self.q.put(key)

    def backfill(self, uid: str):
        """Queue every voice note this user has that has no transcript yet."""
        store = Store(uid)
        for appid in store.appids():
            game, _ = store.read(appid)
            for file in store.fill_transcripts(appid, game or {}):
                self.add(uid, appid, file)

    def run(self):
        while True:
            uid, appid, file = key = self.q.get()
            try:
                store = Store(uid)
                if accounts.speech_allowed(accounts.get(uid)) and not store.transcripts.get(store.canon(appid), file) \
                        and os.path.exists(store.media_path(appid, file)):
                    store.transcribe_file(appid, file)
                    print(f"transcribed {uid}/{appid}/{file}", flush=True)
            except Exception as e:
                print(f"transcribing {appid}/{file} failed: {e}", flush=True)
                time.sleep(5)  # Whisper may be starting up; the next sync queues it again
            finally:
                with self.lock:
                    self.pending.discard(key)


transcriber = Transcriber()


# ---------- webhooks ----------

def user_webhooks(uid: str) -> list:
    user = accounts.get(uid) or {}
    return (OWNER_WEBHOOKS if uid == OWNER_ID else []) + list(user.get("webhooks", []))


def describe_changes(old: dict, new: dict) -> list:
    events = []
    old_notes = {n["id"]: n for n in old.get("notes", [])}
    new_notes = {n["id"]: n for n in new.get("notes", [])}
    for nid, n in new_notes.items():
        if nid not in old_notes:
            events.append({"event": "note.created", "noteId": nid, "title": n.get("title")})
        elif merge._stamp(n) != merge._stamp(old_notes[nid]):
            events.append({"event": "note.updated", "noteId": nid, "title": n.get("title")})
    for nid, n in old_notes.items():
        if nid not in new_notes:
            events.append({"event": "note.deleted", "noteId": nid, "title": n.get("title")})
    lo_old, lo_new = old.get("leftOff") or {}, new.get("leftOff") or {}
    if lo_new.get("updatedAt") != lo_old.get("updatedAt"):
        events.append({"event": "leftoff.updated", "text": lo_new.get("text", "")})
    old_c = {c["id"]: c for c in old.get("counters", [])}
    for c in new.get("counters", []):
        prev = old_c.get(c["id"])
        if not prev or prev.get("count") != c.get("count") or prev.get("defeated") != c.get("defeated"):
            events.append({"event": "counter.updated", "counterId": c["id"], "name": c.get("name"),
                           "count": c.get("count"), "defeated": bool(c.get("defeated"))})
    if new.get("launchCount", 0) > old.get("launchCount", 0):
        events.append({"event": "game.launched", "launchCount": new.get("launchCount")})
    return events


def _summary_line(game: dict, e: dict) -> str:
    name = game.get("name") or game.get("appId")
    return {
        "note.created": f"New note in {name}: {e.get('title')}",
        "note.updated": f"Note edited in {name}: {e.get('title')}",
        "note.deleted": f"Note deleted in {name}: {e.get('title')}",
        "leftoff.updated": f"{name}: left off at \"{e.get('text')}\"" if e.get("text") else f"{name}: left-off pin cleared",
        "counter.updated": f"{name}: {e.get('name')} = {e.get('count')}" + (" (defeated!)" if e.get("defeated") else ""),
        "game.launched": f"Started {name} (launch #{e.get('launchCount')})",
    }.get(e["event"], e["event"])


def send_webhooks(urls: list, game: dict, events: list, source: str):
    """POST JSON to each URL. Prefix a URL with ntfy+ for ntfy-style plain text."""
    payload = {"source": source, "appId": game.get("appId"), "game": game.get("name"), "at": now_ms(),
               "events": events, "summary": [_summary_line(game, e) for e in events], "url": PUBLIC_URL or None}
    for url in urls:
        try:
            if url.startswith("ntfy+"):
                req = urllib.request.Request(url[5:], data="\n".join(payload["summary"]).encode(), method="POST")
                req.add_header("Title", f"Desk of Madness · {game.get('name')}")
                req.add_header("Tags", "memo")
                if PUBLIC_URL:
                    req.add_header("Click", PUBLIC_URL)
            else:
                req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST")
                req.add_header("Content-Type", "application/json")
            urllib.request.urlopen(req, timeout=10).read()
        except Exception as e:  # never let a webhook break a save
            print(f"webhook to {url.split('?')[0]} failed: {e}", flush=True)


def notify_owner(event: str, text: str, **extra):
    """Tell the owner something about the server itself (e.g. someone asked for an account)."""
    payload = {"source": "server", "event": event, "at": now_ms(), "summary": [text], "url": PUBLIC_URL or None, **extra}

    def post():
        for url in user_webhooks(OWNER_ID):
            try:
                if url.startswith("ntfy+"):
                    req = urllib.request.Request(url[5:], data=text.encode(), method="POST")
                    req.add_header("Title", "Desk of Madness")
                    req.add_header("Tags", "bust_in_silhouette")
                    if PUBLIC_URL:
                        req.add_header("Click", PUBLIC_URL)
                else:
                    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST")
                    req.add_header("Content-Type", "application/json")
                urllib.request.urlopen(req, timeout=10).read()
            except Exception as e:
                print(f"webhook to {url.split('?')[0]} failed: {e}", flush=True)
    threading.Thread(target=post, daemon=True).start()


def user_is_pending(user: dict):
    if user and user.get("status") == "pending":
        how = user.get("email") or f"Steam {user.get('steamId')}"
        notify_owner("user.pending", f"{user.get('name')} ({how}) asked for an account. Approve it under Admin → Requests.",
                     userId=user["id"])
        accounts.log("user.pending", f"{user.get('name')} ({how}) asked for an account", target=user["id"])


# ---------- admin helpers ----------

def dir_size(path: str) -> int:
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def user_stats(uid: str) -> dict:
    store = Store(uid)
    ids = store.appids()
    notes = 0
    for appid in ids:
        g, _ = store.read(appid)
        notes += len((g or {}).get("notes", []))
    return {"games": len(ids), "notes": notes, "bytes": dir_size(store.root)}


def can_manage(actor: dict, target: dict) -> bool:
    """Admins look after ordinary users; only the owner looks after other admins. Nobody manages the owner."""
    if not target or target.get("role") == "owner" or target["id"] == actor["id"]:
        return False
    return actor.get("role") == "owner" or target.get("role") != "admin"


def admin_user(u: dict, sessions: dict, stats: bool = True) -> dict:
    out = {**accounts.public(u), "speech": accounts.speech_allowed(u), "email": u.get("email"),
           "status": u.get("status", "active"), "createdAt": u.get("createdAt"), "lastLogin": u.get("lastLogin"),
           "devices": len(u.get("tokens", [])), "sessions": sessions.get(u["id"], 0), "hasPassword": bool(u.get("password"))}
    if stats:
        out.update(user_stats(u["id"]))
    return out


def admin_settings() -> dict:
    return {"signupMode": accounts.signup_mode(), "emailSignups": accounts.setting("emailSignups", True),
            "speechDefault": accounts.setting("speechDefault", False), "quotaMb": accounts.setting("quotaMb", 0),
            "maxDevices": accounts.setting("maxDevices", 0), "announcement": accounts.setting("announcement", ""),
            "readerCacheDays": reader_cache_days(), "readerCacheChoices": list(reader_cache.DAY_CHOICES),
            "readerCache": readers.stats()}


def overview() -> dict:
    users = list(accounts.db["users"].values())
    by_status = {}
    for u in users:
        by_status[u.get("status", "active")] = by_status.get(u.get("status", "active"), 0) + 1
    games = notes = 0
    for u in users:
        st = user_stats(u["id"])
        games += st["games"]
        notes += st["notes"]
    disk = shutil.disk_usage(DATA)
    return {"users": len(users), "active": by_status.get("active", 0), "pending": by_status.get("pending", 0),
            "suspended": by_status.get("suspended", 0), "admins": sum(1 for u in users if accounts.is_admin(u)),
            "games": games, "notes": notes, "devices": sum(len(u.get("tokens", [])) for u in users),
            "sessions": sum(accounts.session_counts().values()), "shares": len(load_shares()), "invites": len(accounts.db.get("invites", [])),
            "dataBytes": dir_size(DATA), "diskFree": disk.free, "diskTotal": disk.total,
            "speech": speech.enabled(), "androidApp": os.path.exists(APK_PATH),
            "androidAppAt": int(os.path.getmtime(APK_PATH) * 1000) if os.path.exists(APK_PATH) else None,
            "page": page_version(), "uptime": int(time.time() - STARTED), "publicUrl": PUBLIC_URL, "bookstoreUrl": BOOKSTORE_URL,
            "legacyToken": bool(os.environ.get("API_TOKEN")),
            "defaultPassword": WEB_PASSWORD == "AdminPassword" and not (accounts.get(OWNER_ID) or {}).get("password")}


def over_quota(user: dict, adding: int) -> bool:
    quota = int(accounts.setting("quotaMb", 0) or 0)
    if not quota or accounts.is_admin(user):
        return False
    return dir_size(Store(user["id"]).root) + adding > quota * 1024 * 1024


def make_backup(with_media: bool) -> str:
    """Zip the data folder into a temp file (the caller deletes it). Leaves out removed users and the APK."""
    fd, path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(DATA):
            rel = os.path.relpath(root, DATA)
            top = rel.split(os.sep)[0]
            if top in ("removed-users", "app"):
                dirs[:] = []
                continue
            if not with_media and "media" in rel.split(os.sep):
                dirs[:] = []
                continue
            for f in files:
                if f.endswith(".tmp"):
                    continue
                full_path = os.path.join(root, f)
                if os.path.abspath(full_path) == os.path.abspath(path):
                    continue
                try:
                    z.write(full_path, os.path.join(rel, f) if rel != "." else f)
                except OSError:
                    pass
    return path


# ---------- HTTP ----------


def page_version() -> str:
    """Short hash of index.html, so an open page (e.g. the Android app left running) can tell it's out of date."""
    with open(os.path.join(HERE, "index.html"), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]

class Handler(BaseHTTPRequestHandler):
    server_version = "DeskOfMadness/3"

    def log_message(self, fmt, *args):
        print(f"{self.client_ip()} {fmt % args}", flush=True)

    def client_ip(self) -> str:
        return self.headers.get("X-Real-IP") or self.headers.get("X-Forwarded-For", "").split(",")[0].strip() or self.client_address[0]

    def base_url(self) -> str:
        proto = self.headers.get("X-Forwarded-Proto") or "http"
        return f"{proto}://{self.headers.get('Host', 'localhost')}"

    def send(self, code: int, body=b"", ctype="application/json", headers=None):
        if not isinstance(body, (bytes, bytearray)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        if ctype.startswith("text/html"):
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location: str, cookie: str = None):
        headers = {"Location": location}
        if cookie:
            headers["Set-Cookie"] = cookie
        self.send(302, b"", "text/plain", headers)

    def session_id(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        return cookie[COOKIE].value if COOKIE in cookie else None

    def cookie_for(self, sid: str) -> str:
        c = f"{COOKIE}={sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}"
        return c + ("; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else "")

    def current_user(self, mutating: bool = False):
        """The signed-in user (device token or web session), or None. Sets self.device to the token's ID."""
        self.device = None
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            user, self.device = accounts.token_lookup(auth[7:])
            return user
        user = accounts.session_user(self.session_id())
        # Browser changes need a custom header, which other sites can't send (CSRF protection).
        if user and mutating and self.headers.get("X-Requested-With") not in ("desk-of-madness", "session-notes"):
            return None
        return user

    def source(self) -> str:
        return "web" if not self.headers.get("Authorization", "").startswith("Bearer ") else (self.headers.get("X-Client") or "deck")

    def body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_BODY:
            raise ValueError("too large")
        return self.rfile.read(length)

    def json_body(self) -> dict:
        return json.loads(self.body() or b"{}")

    def query(self) -> dict:
        return {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).items()}

    def parts(self):
        return [p for p in urllib.parse.urlsplit(self.path).path.split("/") if p]

    def throttled(self) -> bool:
        recent = [t for t in failed_logins.get(self.client_ip(), []) if t > time.time() - 900]
        failed_logins[self.client_ip()] = recent
        return len(recent) >= 8

    def failed(self):
        failed_logins.setdefault(self.client_ip(), []).append(time.time())
        time.sleep(1)

    def serve_file(self, path: str):
        if not os.path.exists(path):
            return self.send(404, {"error": "no such file"})
        with open(path, "rb") as f:
            return self.send(200, f.read(), MEDIA_TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream"),
                             {"Cache-Control": "private, max-age=86400"})

    # ---------- GET ----------
    def do_GET(self):
        try:
            return self._get()
        except ValueError:
            return self.send(400, {"error": "bad request"})

    def _get(self):
        p = self.parts()
        if not p or p == ["index.html"]:
            with open(os.path.join(HERE, "index.html"), "rb") as f:
                return self.send(200, f.read().replace(b"__PAGE_VERSION__", page_version().encode()), "text/html; charset=utf-8")
        if len(p) == 1 and p[0] in STATIC:
            with open(os.path.join(HERE, p[0]), "rb") as f:
                return self.send(200, f.read(), STATIC[p[0]], {"Cache-Control": "no-cache"})
        if p == ["download", "android"]:
            if not os.path.exists(APK_PATH):
                return self.send(404, b"The Android app hasn't been uploaded to this server yet.", "text/plain")
            with open(APK_PATH, "rb") as f:
                return self.send(200, f.read(), "application/vnd.android.package-archive",
                                 {"Content-Disposition": 'attachment; filename="DeskOfMadness.apk"'})
        if p == ["auth", "steam"]:
            back = f"{self.base_url()}/auth/steam/callback" + ("?link=1" if self.query().get("link") else "")
            return self.redirect(steam.login_url(back, self.base_url() + "/"))
        if p == ["auth", "steam", "callback"]:
            return self.steam_callback()
        if p[0] != "api":
            return self.send(404, {"error": "not found"})

        if p[1:] == ["health"]:
            return self.send(200, {"ok": True})
        if p[1:] == ["me"]:
            u = accounts.session_user(self.session_id())
            return self.send(200, {"loggedIn": bool(u), "user": {**accounts.public(u), "email": u.get("email"),
                                                                  "hasPassword": bool(u.get("password"))} if u else None,
                                   "page": page_version(), "androidApp": os.path.exists(APK_PATH), "bookstoreUrl": BOOKSTORE_URL,
                                   "speech": speech_on(u), "signups": accounts.signup_mode(),
                                   "emailSignups": accounts.signup_mode() != "invite" and accounts.setting("emailSignups", True),
                                   "admin": accounts.is_admin(u), "announcement": accounts.setting("announcement", ""),
                                   "pendingUsers": len(accounts.pending()) if accounts.is_admin(u) else 0})

        user = self.current_user()
        if not user:
            return self.send(401, {"error": "unauthorized"})
        store = Store(user["id"])

        if p[1:] == ["account"]:  # for devices: who am I, and what may I use
            return self.send(200, {"user": accounts.public(user), "speech": speech_on(user),
                                   "announcement": accounts.setting("announcement", ""), "admin": accounts.is_admin(user)})
        if p[1:] == ["reader"]:  # GET /api/reader?url=…[&refresh=1]: a page as a clean reader view
            url = self.query().get("url", "")
            try:
                return self.send(200, readers.get(url, refresh=self.query().get("refresh") == "1"))
            except ValueError as err:
                return self.send(422, {"error": str(err)})
            except Exception as err:
                return self.send(502, {"error": f"Couldn't make a reader view: {err}"})
        if p[1:] == ["games"]:
            return self.send(200, self.list_games(store))
        if len(p) == 3 and p[1] == "games":
            appid = safe(p[2])
            g, rev = store.read(appid)
            return self.send(200, {"game": {**g, "appId": appid}, "rev": rev}) if g else self.send(404, {"error": "no such game"})
        if len(p) == 4 and p[1:3] == ["steam", "apps"]:  # name + icon for an app ID, to show before adding it
            appid = safe(p[3])
            info = steam.apps([appid]).get(appid) or {"appId": appid, "name": None, "found": False, "icon": None, "image": None}
            g, _ = store.read(appid) if appid.isdigit() else (None, None)
            return self.send(200, {**info, "steamApp": steam.is_steam_app(appid),
                                   "yours": {"appId": g["appId"], "name": g.get("name")} if g else None})
        if p[1:] == ["search"]:
            q = self.query().get("q", "").lower().strip()
            hits = []
            for appid in store.appids() if q else []:
                g, _ = store.read(appid)
                for n in g.get("notes", []):
                    said = "\n".join(r.get("transcript", "") for r in n.get("recordings") or [])
                    if q in (n.get("title", "") + "\n" + n.get("body", "") + "\n" + " ".join(n.get("tags", [])) + "\n" + said).lower():
                        hits.append({"appId": g.get("appId"), "game": g.get("name"), "note": n})
            return self.send(200, hits)
        if len(p) == 4 and p[1] == "history":
            return self.send(200, list(reversed(store.history.get(store.canon(safe(p[2])), safe(p[3])))))
        if len(p) == 3 and p[1] == "deleted":
            g, _ = store.read(safe(p[2]))
            return self.send(200, store.history.deleted(store.canon(safe(p[2])), (g or {}).get("notes", [])))
        if len(p) == 3 and p[1] == "media":
            d = store.media_path(safe(p[2]))
            return self.send(200, sorted(os.listdir(d)) if os.path.isdir(d) else [])
        if len(p) == 4 and p[1] == "media":
            return self.serve_file(store.media_path(safe(p[2]), safe(p[3])))

        # --- people & sharing ---
        if p[1:] == ["users"]:
            return self.send(200, [u for u in accounts.list_public() if u["id"] != user["id"]])
        if p[1:] == ["shares"]:  # notes I shared
            appid = self.query().get("appId")
            out = []
            for s in load_shares():
                if s["from"] == user["id"] and (not appid or s["appId"] == appid):
                    to = accounts.get(s["to"])
                    out.append({**s, "toName": (to or {}).get("name", "?")})
            return self.send(200, out)
        if p[1:] == ["shared"]:  # notes shared with me
            out = []
            for s in load_shares():
                if s["to"] != user["id"]:
                    continue
                game, note = resolve_share(s)
                if note:
                    frm = accounts.get(s["from"]) or {}
                    out.append({"shareId": s["id"], "fromId": s["from"], "fromName": frm.get("name", "?"),
                                "appId": s["appId"], "gameName": game.get("name"), "note": note})
            return self.send(200, out)
        if len(p) == 5 and p[1:3] == ["shared", "media"]:
            share = next((s for s in load_shares() if s["id"] == p[3] and s["to"] == user["id"]), None)
            if not share:
                return self.send(404, {"error": "no such share"})
            _, note = resolve_share(share)
            file = safe(p[4])
            if not note or file not in {x.get(k) for x in note.get("screenshots", []) + note.get("recordings", []) for k in ("file", "thumb")}:
                return self.send(404, {"error": "no such file"})
            return self.serve_file(Store(share["from"]).media_path(share["appId"], file))

        # --- account ---
        if p[1:] == ["devices"]:
            return self.send(200, [{k: t[k] for k in ("id", "label", "createdAt", "lastUsed")} for t in user.get("tokens", [])])
        if p[1:] == ["settings"]:
            return self.send(200, {"webhooks": user.get("webhooks", [])})
        if len(p) >= 2 and p[1] == "admin" and accounts.is_admin(user):
            return self.admin_get(user, p[2:])
        return self.send(404, {"error": "not found"})

    def admin_get(self, user: dict, rest: list):
        if not rest:  # everything the People pages need
            sessions = accounts.session_counts()
            return self.send(200, {"users": [{**admin_user(u, sessions), "canManage": can_manage(user, u)}
                                             for u in accounts.db["users"].values()],
                                   "invites": accounts.db.get("invites", []), "allowSignups": accounts.signup_mode() == "open",
                                   "settings": admin_settings(), "speechAvailable": speech.enabled(), "you": user["id"],
                                   "youAreOwner": user.get("role") == "owner"})
        if rest == ["reader"]:  # just the reader cache settings, for the Deck's Settings page
            st = admin_settings()
            return self.send(200, {k: st[k] for k in ("readerCacheDays", "readerCacheChoices", "readerCache")})
        if rest == ["overview"]:
            return self.send(200, overview())
        if rest == ["activity"]:
            names = {u["id"]: u.get("name") for u in accounts.db["users"].values()}
            return self.send(200, [{**e, "actorName": names.get(e.get("actor"))} for e in reversed(accounts.activity)])
        if rest == ["shares"]:
            names = {u["id"]: u.get("name") for u in accounts.db["users"].values()}
            out = []
            for s in load_shares():
                game, note = resolve_share(s)
                out.append({**s, "fromName": names.get(s["from"], "?"), "toName": names.get(s["to"], "?"),
                            "gameName": (game or {}).get("name"), "noteTitle": (note or {}).get("title"), "missing": not note})
            return self.send(200, out)
        if len(rest) == 3 and rest[0] == "users" and rest[2] == "devices":
            target = accounts.get(safe(rest[1]))
            if not target:
                return self.send(404, {"error": "no such user"})
            return self.send(200, [{k: t.get(k) for k in ("id", "label", "createdAt", "lastUsed")} for t in target.get("tokens", [])])
        if rest == ["backup"]:
            path = make_backup(self.query().get("media") == "1")
            accounts.log("server.backup", "downloaded a backup" + (" with media" if self.query().get("media") == "1" else ""), actor=user["id"])
            try:
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Length", str(os.path.getsize(path)))
                self.send_header("Content-Disposition", f'attachment; filename="desk-of-madness-{time.strftime("%Y%m%d-%H%M")}.zip"')
                self.end_headers()
                with open(path, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
            finally:
                os.remove(path)
            return None
        return self.send(404, {"error": "not found"})

    def list_games(self, store: Store) -> list:
        """Every game once, under its main ID with its other IDs in `aliases`. A device instead sees each game
        under the ID(s) it has used for it, so it never gets a second copy under an ID it doesn't know."""
        aliases = store.aliases()
        appids = store.appids()
        art = steam.apps(appids + list(aliases), fetch=not self.device)  # devices: don't wait on Steam
        seen = store.device_ids(self.device) if self.device else None
        out = []
        for appid in appids:
            g, rev = store.read(appid)
            ids = [appid] + sorted(a for a, c in aliases.items() if c == appid)
            pic = next((art[i] for i in ids if i in art and art[i]["found"]), {})
            entry = {"appId": appid, "name": g.get("name"), "rev": rev, "noteCount": len(g.get("notes", [])),
                     "lastLaunched": g.get("lastLaunched"), "updatedAt": int(os.path.getmtime(store.game_path(appid)) * 1000),
                     "aliases": ids[1:], "icon": pic.get("icon"), "image": pic.get("image"),
                     "steamApp": any(steam.is_steam_app(i) for i in ids), "customName": bool(g.get("customName"))}
            if seen is None:
                out.append(entry)
            else:
                out += [{**entry, "appId": i} for i in ([i for i in ids if i in seen] or [appid])]
        return out

    def sync_game(self, store: Store, appid: str) -> dict:
        """A sync answered under the ID the client asked with, even when that's another ID for the game."""
        res = store.sync(appid, self.json_body(), self.source())
        if self.device:
            store.mark_device_id(self.device, appid)
        return res if res["game"]["appId"] == appid else {"game": {**res["game"], "appId": appid}, "rev": res["rev"]}

    def steam_callback(self):
        q = self.query()
        link = "link" in q
        expected = f"{self.base_url()}/auth/steam/callback"
        try:
            steam_id = steam.verify(q, expected)
        except Exception as e:
            print(f"steam verify failed: {e}", flush=True)
            steam_id = None
        if not steam_id:
            return self.redirect("/?error=" + urllib.parse.quote("Steam sign-in failed. Try again."))
        current = accounts.session_user(self.session_id())
        new = not accounts.by_steam(steam_id)
        user, err = accounts.login_steam(steam_id, steam.profile(steam_id), current["id"] if (link and current) else None)
        if err:
            if new:
                user_is_pending(accounts.by_steam(steam_id))
            return self.redirect("/?error=" + urllib.parse.quote(err))
        return self.redirect("/", self.cookie_for(accounts.new_session(user["id"])))

    # ---------- POST ----------
    def do_POST(self):
        try:
            return self._post()
        except ValueError:
            return self.send(400, {"error": "bad request"})

    def _post(self):
        p = self.parts()
        if p == ["api", "login"]:  # email + password, or just the owner password
            if self.throttled():
                return self.send(429, {"error": "Too many attempts. Try again in 15 minutes."})
            data = self.json_body()
            password, email = str(data.get("password") or ""), str(data.get("email") or "").strip()
            if email:
                user, err = accounts.login_email(email, password)
                if not user:
                    if "approve" not in err:
                        self.failed()
                    return self.send(403 if "approve" in err else 401, {"error": err})
                uid = user["id"]
            elif accounts.check_owner_password(password):
                uid = OWNER_ID
            else:
                self.failed()
                return self.send(401, {"error": "Wrong password"})
            return self.send(200, {"ok": True}, headers={"Set-Cookie": self.cookie_for(accounts.new_session(uid))})
        if p == ["api", "signup"]:
            if self.throttled():
                return self.send(429, {"error": "Too many attempts. Try again in 15 minutes."})
            data = self.json_body()
            user, err = accounts.signup_email(str(data.get("email") or ""), str(data.get("password") or ""), str(data.get("name") or ""))
            if not user:
                self.failed()  # also slows down guessing which emails have accounts
                return self.send(400, {"error": err})
            if not accounts.active(user):
                user_is_pending(user)
                return self.send(200, {"pending": True})
            accounts.log("user.signup", f"{user.get('name')} ({user.get('email')}) signed up", target=user["id"])
            return self.send(200, {"pending": False}, headers={"Set-Cookie": self.cookie_for(accounts.new_session(user["id"]))})
        if p == ["api", "logout"]:
            accounts.end_session(self.session_id())
            return self.send(200, {"ok": True}, headers={"Set-Cookie": f"{COOKIE}=; Path=/; Max-Age=0"})
        if p == ["api", "pair"]:  # device exchanges a pairing code for a token
            if self.throttled():
                return self.send(429, {"error": "Too many attempts. Try again in 15 minutes."})
            data = self.json_body()
            user, token = accounts.redeem_pairing_code(data.get("code", ""), data.get("label", "Device"))
            if not user:
                self.failed()
                return self.send(401, {"error": "That code is wrong or expired. Make a new one on the website."})
            return self.send(200, {"token": token, "user": accounts.public(user)})

        user = self.current_user(mutating=True)
        if not user:
            return self.send(401, {"error": "unauthorized"})
        store = Store(user["id"])

        if len(p) == 3 and p[:2] == ["api", "sync"]:
            return self.send(200, self.sync_game(store, safe(p[2])))
        if len(p) == 4 and p[:2] == ["api", "games"] and p[3] == "notes":
            return self.add_note(store, safe(p[2]), self.json_body())
        if p == ["api", "games"]:
            return self.add_game(store, self.json_body())
        if len(p) == 4 and p[:2] == ["api", "games"] and p[3] == "name":
            return self.rename_game(store, safe(p[2]), str(self.json_body().get("name") or "").strip())
        if len(p) == 4 and p[:2] == ["api", "games"] and p[3] == "aliases":
            appid, other = safe(p[2]), str(self.json_body().get("appId") or "").strip()
            if not other.isdigit():
                return self.send(400, {"error": "An app ID is a number, e.g. 1245620"})
            if not store.read(appid)[0]:
                return self.send(404, {"error": "no such game"})
            game = store.add_alias(appid, other, self.source())
            return self.send(200, {"game": game, "aliases": store.aliases_of(game["appId"])})
        if p == ["api", "account", "login"]:  # set my email and/or password
            data = self.json_body()
            if user.get("password") and not check_password(str(data.get("current") or ""), user["password"]):
                return self.send(403, {"error": "Your current password is wrong"})
            err = accounts.set_login(user["id"], email=data["email"] if "email" in data else None,
                                     password=data["password"] if data.get("password") else None)
            u = accounts.get(user["id"])
            return self.send(400, {"error": err}) if err else self.send(200, {"email": u.get("email"), "hasPassword": bool(u.get("password"))})
        if p in (["api", "import", "workshop"], ["api", "import", "bookstore"]):
            try:
                return self.send(200, import_from_bookstore(store, str(self.json_body().get("id", "")), self.source()))
            except (LookupError, PermissionError) as err:
                return self.send(404 if isinstance(err, LookupError) else 403, {"error": str(err)})
            except (urllib.error.URLError, OSError) as err:
                return self.send(502, {"error": f"Couldn't reach the Madness Workshop: {err}"})
        if len(p) >= 2 and p[:2] == ["api", "transcribe"]:
            return self.transcribe(user, store, p[2:])
        if p == ["api", "devices", "code"]:
            limit = int(accounts.setting("maxDevices", 0) or 0)
            if limit and not accounts.is_admin(user) and len(user.get("tokens", [])) >= limit:
                return self.send(400, {"error": f"You can link up to {limit} devices. Unlink one first."})
            return self.send(200, accounts.new_pairing_code(user["id"]))
        if p == ["api", "shares"]:
            data = self.json_body()
            appid, note_id, to = safe(str(data.get("appId", ""))), str(data.get("noteId", "")), str(data.get("to", ""))
            game, _ = store.read(appid)
            if not game or not any(n["id"] == note_id for n in game.get("notes", [])):
                return self.send(404, {"error": "no such note"})
            if to == user["id"] or not accounts.get(to):
                return self.send(400, {"error": "no such user"})
            with shares_lock:
                shares = load_shares()
                existing = next((s for s in shares if s["from"] == user["id"] and s["noteId"] == note_id and s["to"] == to), None)
                if existing:
                    return self.send(200, existing)
                share = {"id": secrets.token_hex(8), "from": user["id"], "to": to, "appId": appid, "noteId": note_id,
                         "createdAt": now_ms()}
                save_shares(shares + [share])
            return self.send(200, share)
        if p == ["api", "settings"]:
            hooks = [str(u).strip() for u in self.json_body().get("webhooks", []) if str(u).strip()][:5]
            accounts.get(user["id"])["webhooks"] = hooks
            accounts.save()
            return self.send(200, {"webhooks": hooks})
        if len(p) >= 3 and p[:2] == ["api", "admin"] and accounts.is_admin(user):
            return self.admin_post(user, p[2:], self.json_body())
        return self.send(404, {"error": "not found"})

    def admin_post(self, user: dict, rest: list, data: dict):
        me = user["id"]
        if rest == ["invites"]:
            sid = steam.parse_steam_id(str(data.get("steamId", "")))
            if not sid:
                return self.send(400, {"error": "Enter a 17-digit Steam ID or a steamcommunity.com/profiles/… link"})
            if sid not in accounts.db.setdefault("invites", []) and not accounts.by_steam(sid):
                accounts.db["invites"].append(sid)
                accounts.save()
                accounts.log("invite.add", f"invited Steam {sid}", actor=me)
            return self.send(200, {"invites": accounts.db["invites"]})
        if rest == ["settings"]:
            if "allowSignups" in data and "signupMode" not in data:  # older pages
                data["signupMode"] = "open" if data["allowSignups"] else "approval"
            changed = []
            if data.get("signupMode") in ("open", "approval", "invite"):
                accounts.db["signupMode"] = data["signupMode"]
                accounts.db["allowSignups"] = data["signupMode"] == "open"
                changed.append(f"sign-ups: {data['signupMode']}")
            settings = accounts.db.setdefault("settings", {})
            for key, kind in SETTING_KEYS.items():
                if key in data:
                    value = kind(data[key] or (0 if kind is int else "" if kind is str else False))
                    if kind is int:
                        value = max(0, min(value, 1_000_000))
                    if kind is str:
                        value = value.strip()[:500]
                    if settings.get(key) != value:
                        settings[key] = value
                        changed.append(f"{key}: {value if kind is not str else (value[:40] or 'cleared')}")
            if "readerCacheDays" in data:
                days = reader_cache.clean_days(data["readerCacheDays"])
                if days != reader_cache_days():
                    settings["readerCacheDays"] = days
                    changed.append(f"reader cache: {f'{days} days' if days else 'keep forever'}")
                    readers.prune(days)
            accounts.save()
            if changed:
                accounts.log("settings", "changed " + ", ".join(changed), actor=me)
            return self.send(200, {**admin_settings(), "allowSignups": accounts.signup_mode() == "open"})
        if rest == ["reader", "clear"]:
            n = readers.clear()
            accounts.log("settings", f"cleared the reader cache ({n} pages)", actor=me)
            return self.send(200, {"removed": n, "readerCache": readers.stats()})
        if rest == ["signout-all"]:
            n = accounts.sign_out_others(me)
            accounts.log("server.signout", f"signed everyone else out of the website ({n} sessions)", actor=me)
            return self.send(200, {"ended": n})
        if rest == ["approve-all"]:
            names = [u.get("name") for u in accounts.pending() if accounts.approve(u["id"])]
            if names:
                accounts.log("user.approve", "approved " + ", ".join(names), actor=me)
            return self.send(200, {"approved": len(names)})
        if len(rest) == 3 and rest[0] == "users":
            target = accounts.get(safe(rest[1]))
            action = rest[2]
            if not can_manage(user, target):
                return self.send(403, {"error": "You can't change this account"})
            name = target.get("name")
            if action == "approve":
                ok = accounts.approve(target["id"])
                if ok:
                    accounts.log("user.approve", f"approved {name}", actor=me, target=target["id"])
                return self.send(200, {"ok": ok})
            if action == "password":
                err = accounts.set_login(target["id"], password=str(data.get("password") or ""))
                if not err:
                    accounts.log("user.password", f"set a new password for {name}", actor=me, target=target["id"])
                return self.send(400, {"error": err}) if err else self.send(200, {"ok": True})
            if action == "email":
                err = accounts.set_login(target["id"], email=str(data.get("email") or ""))
                if not err:
                    accounts.log("user.email", f"changed the email of {name}", actor=me, target=target["id"])
                return self.send(400, {"error": err}) if err else self.send(200, {"ok": True})
            if action == "speech":
                accounts.set_speech(target["id"], bool(data.get("allowed")))
                if data.get("allowed"):
                    threading.Thread(target=transcriber.backfill, args=(target["id"],), daemon=True).start()
                accounts.log("user.speech", f"{'allowed' if data.get('allowed') else 'blocked'} speech to text for {name}", actor=me, target=target["id"])
                return self.send(200, {"ok": True})
            if action == "status":
                status = "suspended" if data.get("suspended") else "active"
                if not accounts.set_status(target["id"], status):
                    return self.send(400, {"error": "no such user"})
                accounts.log("user.status", f"{'suspended' if status == 'suspended' else 'restored'} {name}", actor=me, target=target["id"])
                return self.send(200, {"ok": True})
            if action == "role":
                if user.get("role") != "owner":
                    return self.send(403, {"error": "Only the owner can make admins"})
                role = "admin" if data.get("admin") else "user"
                accounts.set_role(target["id"], role)
                accounts.log("user.role", f"{'made ' + name + ' an admin' if role == 'admin' else 'removed admin from ' + name}", actor=me, target=target["id"])
                return self.send(200, {"ok": True})
            if action == "name":
                if not accounts.rename(target["id"], str(data.get("name") or "")):
                    return self.send(400, {"error": "Enter a name"})
                accounts.log("user.rename", f"renamed {name} to {accounts.get(target['id'])['name']}", actor=me, target=target["id"])
                return self.send(200, {"ok": True})
            if action == "signout":
                accounts.sign_out_everywhere(target["id"])
                accounts.log("user.signout", f"signed {name} out everywhere and unlinked their devices", actor=me, target=target["id"])
                return self.send(200, {"ok": True})
        return self.send(404, {"error": "not found"})

    def transcribe(self, user: dict, store: Store, rest: list):
        """POST /api/transcribe?appId=&lang=  (body: audio)       -> {"text"}  dictation
           POST /api/transcribe/{appId}/{file}                       -> {"text"}  a stored voice note, now"""
        if not speech_on(user):
            return self.send(403, {"error": "Speech to text isn't turned on for your account."})
        if not speech_limit.allow(user["id"]):
            return self.send(429, {"error": "That's a lot of talking! Try again in a while."})
        try:
            if len(rest) == 2:
                appid, file = safe(rest[0]), safe(rest[1])
                if not os.path.exists(store.media_path(appid, file)):
                    return self.send(404, {"error": "no such file"})
                return self.send(200, {"text": store.transcribe_file(appid, file)})
            q = self.query()
            audio = self.body()
            if len(audio) < 512:
                return self.send(400, {"error": "No audio was recorded"})
            name = None
            if q.get("appId"):
                game, _ = store.read(safe(q["appId"]))
                name = (game or {}).get("name") or q.get("game")
            ext = {"audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3",
                   "audio/aac": "aac"}.get((self.headers.get("Content-Type") or "").split(";")[0].strip(), "webm")
            text = speech.transcribe(audio, f"clip.{ext}", prompt=speech_prompt(name or q.get("game")),
                                     language=re.sub(r"[^a-z]", "", q.get("lang", ""))[:3])
            return self.send(200, {"text": text})
        except ValueError as e:
            return self.send(413 if "long" in str(e) else 400, {"error": str(e)})
        except (urllib.error.URLError, OSError, RuntimeError) as e:
            print(f"transcribe failed: {e}", flush=True)
            return self.send(502, {"error": "The speech server didn't answer. Try again in a minute."})

    def add_game(self, store: Store, data: dict):
        """{appId, name?}: start a game from the website. Steam games get their name from Steam; anything else
        (a non-Steam shortcut's ID) needs a name."""
        appid, name = str(data.get("appId") or "").strip(), str(data.get("name") or "").strip()[:120]
        if not appid.isdigit():
            return self.send(400, {"error": "An app ID is a number, e.g. 1245620"})
        existing, _ = store.read(appid)
        if existing:
            return self.send(200, {"game": existing, "existing": True})
        info = steam.apps([appid]).get(appid) or {}
        if not name and not info.get("name"):
            return self.send(404, {"error": f"Steam doesn't know app {appid}. Type a name to add it as a non-Steam game."})
        now = now_ms()
        game = {"appId": appid, "name": info.get("name") or name, "notes": [], "firstSeen": now}
        if name and info.get("name") and name != info["name"]:
            game.update(customName=name, customNameAt=now)
        return self.send(200, {"game": store.sync(appid, game, self.source())["game"], "existing": False})

    def rename_game(self, store: Store, appid: str, name: str):
        """Give a game your own name (empty = go back to the name Steam or the Deck reports)."""
        stored, _ = store.read(appid)
        if not stored:
            return self.send(404, {"error": "no such game"})
        now = now_ms()
        if name:
            change = {"name": stored.get("name"), "customName": name[:120], "customNameAt": now}
        else:
            main = stored["appId"]
            steam_name = next((a["name"] for a in steam.apps([main] + store.aliases_of(main)).values() if a["found"]), None)
            change = {"name": stored.get("baseName") or steam_name or main, "customName": None, "customNameAt": now}
        return self.send(200, {"game": store.sync(appid, change, self.source())["game"]})

    def add_note(self, store: Store, appid: str, data: dict):
        """Quick-add for automations: {title, body?, tags?, checklist?: [text], pinned?, kind?, gameName?}."""
        if not str(data.get("title", "")).strip():
            return self.send(400, {"error": "title is required"})
        now = now_ms()
        note = {"id": str(uuid.uuid4()), "folderId": data.get("folderId"), "title": str(data["title"]).strip(),
                "body": str(data.get("body", "")), "tags": [str(t).lstrip("#") for t in data.get("tags", [])],
                "screenshots": [], "recordings": [], "pinned": bool(data.get("pinned")), "spoiler": bool(data.get("spoiler")),
                "kind": data.get("kind") or "note", "createdAt": now, "updatedAt": now, "launchNumber": None}
        if data.get("checklist"):
            note["checklist"] = [{"id": str(uuid.uuid4()), "text": str(c), "done": False} for c in data["checklist"]]
        stored, _ = store.read(appid)
        if stored is None and not data.get("gameName"):
            return self.send(404, {"error": "no such game (pass gameName to create it)"})
        game = {"appId": appid, "name": (stored or {}).get("name") or data.get("gameName"), "notes": [note]}
        return self.send(200, {"note": note, "rev": store.sync(appid, game, self.source())["rev"]})

    # ---------- PUT / DELETE ----------
    def do_PUT(self):
        try:
            p = self.parts()
            user = self.current_user(mutating=True)
            if not user:
                return self.send(401, {"error": "unauthorized"})
            store = Store(user["id"])
            if len(p) == 3 and p[:2] == ["api", "games"]:  # older plugin builds
                return self.send(200, self.sync_game(store, safe(p[2])))
            if len(p) == 4 and p[:2] == ["api", "media"]:
                d = store.media_path(safe(p[2]))
                if over_quota(user, int(self.headers.get("Content-Length", 0))):
                    return self.send(413, {"error": f"You've used your {accounts.setting('quotaMb')} MB of space on this server."})
                os.makedirs(d, exist_ok=True)
                data = self.body()
                with open(os.path.join(d, safe(p[3])), "wb") as f:
                    f.write(data)
                # The note may have synced before its audio arrived; transcribe now that we have it.
                if speech.is_audio(p[3]) and speech_on(user):
                    game, _ = store.read(safe(p[2]))
                    if game and safe(p[3]) in store.fill_transcripts(safe(p[2]), game):
                        transcriber.add(user["id"], safe(p[2]), safe(p[3]))
                return self.send(200, {"ok": True})
        except ValueError:
            return self.send(400, {"error": "bad request"})
        return self.send(404, {"error": "not found"})

    def do_DELETE(self):
        try:
            p = self.parts()
            user = self.current_user(mutating=True)
            if not user:
                return self.send(401, {"error": "unauthorized"})
            if len(p) == 3 and p[:2] == ["api", "shares"]:
                with shares_lock:
                    shares = load_shares()
                    keep = [s for s in shares if not (s["id"] == p[2] and user["id"] in (s["from"], s["to"]))]
                    save_shares(keep)
                return self.send(200, {"ok": len(keep) < len(shares)})
            if len(p) == 3 and p[:2] == ["api", "devices"]:
                return self.send(200, {"ok": accounts.revoke_token(user["id"], p[2])})
            if len(p) == 5 and p[:2] == ["api", "games"] and p[3] == "aliases":
                store = Store(user["id"])
                main = store.canon(safe(p[2]))
                return self.send(200, {"ok": store.remove_alias(main, safe(p[4])), "aliases": store.aliases_of(main)})
            if len(p) >= 4 and p[:2] == ["api", "admin"] and accounts.is_admin(user):
                if p[2] == "invites":
                    accounts.db["invites"] = [i for i in accounts.db.get("invites", []) if i != p[3]]
                    accounts.save()
                    accounts.log("invite.remove", f"cancelled the invite for Steam {p[3]}", actor=user["id"])
                    return self.send(200, {"invites": accounts.db["invites"]})
                if p[2] == "shares":
                    with shares_lock:
                        shares = load_shares()
                        keep = [s for s in shares if s["id"] != p[3]]
                        save_shares(keep)
                    accounts.log("share.remove", "removed a shared note", actor=user["id"])
                    return self.send(200, {"ok": len(keep) < len(shares)})
                if p[2] == "users" and len(p) == 6 and p[4] == "devices":
                    target = accounts.get(safe(p[3]))
                    if not can_manage(user, target):
                        return self.send(403, {"error": "You can't change this account"})
                    ok = accounts.revoke_token(target["id"], p[5])
                    accounts.log("user.device", f"unlinked a device of {target.get('name')}", actor=user["id"], target=target["id"])
                    return self.send(200, {"ok": ok})
                if p[2] == "users":
                    target = accounts.get(safe(p[3]))
                    if not can_manage(user, target):
                        return self.send(403, {"error": "You can't change this account"})
                    pending = target.get("status") == "pending"
                    ok = accounts.remove_user(target["id"])
                    if ok:
                        with shares_lock:
                            save_shares([s for s in load_shares() if p[3] not in (s["from"], s["to"])])
                        accounts.log("user.remove", f"{'rejected' if pending else 'removed'} {target.get('name')}", actor=user["id"], target=target["id"])
                    return self.send(200, {"ok": ok})
        except ValueError:
            return self.send(400, {"error": "bad request"})
        return self.send(404, {"error": "not found"})


if __name__ == "__main__":
    if WEB_PASSWORD == "AdminPassword" and not (accounts.get(OWNER_ID) or {}).get("password"):
        print("NOTE: the owner password is the default (AdminPassword). Set WEB_PASSWORD to change it.", flush=True)
    readers.start_pruning(reader_cache_days)
    port = int(os.environ.get("PORT", "8430"))
    print(f"Desk of Madness server on :{port}, data in {DATA}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
