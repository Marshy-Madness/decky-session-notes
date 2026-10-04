"""Session Notes sync server: multi-user two-way sync for the Decky plugin, web editor, sharing, API, webhooks.

Sign-in:
- Website: "Sign in with Steam", or the owner password (WEB_PASSWORD).
- Deck / Android / API: a device token, obtained with a pairing code from the website.
  The legacy API_TOKEN still works and belongs to the owner.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import merge
import steam
from accounts import OWNER_ID, Accounts

DATA = os.environ.get("DATA_DIR", "/data")
WEB_PASSWORD = os.environ.get("WEB_PASSWORD") or "AdminPassword"
HISTORY_KEEP = int(os.environ.get("HISTORY_KEEP", "30"))
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
OWNER_WEBHOOKS = [u.strip() for u in os.environ.get("WEBHOOK_URLS", "").split(",") if u.strip()]
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")
BOOKSTORE_URL = (os.environ.get("BOOKSTORE_URL") or "https://bookstore.marshymadness.com").rstrip("/")
MAX_BODY = 60 * 1024 * 1024
SAFE = re.compile(r"^[A-Za-z0-9._-]+$")
HERE = os.path.dirname(os.path.abspath(__file__))
COOKIE = "sn_session"
STATIC = {"manifest.webmanifest": "application/manifest+json", "icon.svg": "image/svg+xml", "sw.js": "text/javascript"}
APK_PATH = os.path.join(DATA, "app", "SessionNotes.apk")
SHARES_PATH = os.path.join(DATA, "shares.json")
MEDIA_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
               ".wav": "audio/wav", ".webm": "audio/webm", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp3": "audio/mpeg"}

accounts = Accounts()
write_lock = threading.Lock()
shares_lock = threading.Lock()
failed_logins: dict = {}


def now_ms() -> int:
    return int(time.time() * 1000)


def safe(name: str) -> str:
    name = urllib.parse.unquote(name)
    if not SAFE.match(name) or name in (".", ".."):
        raise ValueError("bad name")
    return name


# ---------- per-user game storage ----------

class Store:
    def __init__(self, uid: str):
        self.uid = uid
        self.root = accounts.user_dir(uid)
        self.history = merge.NoteHistory(os.path.join(self.root, "note_history"))

    def game_path(self, appid: str) -> str:
        return os.path.join(self.root, "games", f"{appid}.json")

    def media_path(self, appid: str, file: str = "") -> str:
        return os.path.join(self.root, "media", appid, file)

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
        incoming["appId"] = appid
        with write_lock:
            stored, rev = self.read(appid)
            merged = merge.merge_games(incoming, stored or {}, now_ms())
            if stored is None or json.dumps(merged, sort_keys=True) != json.dumps(stored, sort_keys=True):
                self.history.record(appid, (stored or {}).get("notes", []), merged.get("notes", []), now_ms())
                rev = self.write(appid, merged)
                hooks = user_webhooks(self.uid)
                if hooks:
                    events = describe_changes(stored or {}, merged)
                    if events:
                        threading.Thread(target=send_webhooks, args=(hooks, merged, events, source), daemon=True).start()
        return {"game": merged, "rev": rev}


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


# ---------- Bookstore import ----------

def bookstore_get(path: str) -> bytes:
    req = urllib.request.Request(BOOKSTORE_URL + path, headers={"User-Agent": "SessionNotes-Server"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def import_from_bookstore(store: "Store", entry_id: str, source: str) -> dict:
    """Copy a public Bookstore entry into this user's notes (same shape as the Deck plugin's copy)."""
    if not SAFE.match(entry_id):
        raise ValueError("bad id")
    try:
        e = json.loads(bookstore_get(f"/api/entries/{urllib.parse.quote(entry_id)}"))
    except urllib.error.HTTPError as err:
        raise LookupError("That Bookstore post doesn't exist anymore" if err.code == 404 else f"Bookstore error {err.code}")
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
                req.add_header("Title", f"Session Notes · {game.get('name')}")
                req.add_header("Tags", "memo")
                if PUBLIC_URL:
                    req.add_header("Click", PUBLIC_URL)
            else:
                req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST")
                req.add_header("Content-Type", "application/json")
            urllib.request.urlopen(req, timeout=10).read()
        except Exception as e:  # never let a webhook break a save
            print(f"webhook to {url.split('?')[0]} failed: {e}", flush=True)


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "SessionNotes/3"

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
        """The signed-in user (device token or web session), or None."""
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            return accounts.token_user(auth[7:])
        user = accounts.session_user(self.session_id())
        # Browser changes need a custom header, which other sites can't send (CSRF protection).
        if user and mutating and self.headers.get("X-Requested-With") != "session-notes":
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
                return self.send(200, f.read(), "text/html; charset=utf-8")
        if len(p) == 1 and p[0] in STATIC:
            with open(os.path.join(HERE, p[0]), "rb") as f:
                return self.send(200, f.read(), STATIC[p[0]], {"Cache-Control": "no-cache"})
        if p == ["download", "android"]:
            if not os.path.exists(APK_PATH):
                return self.send(404, b"The Android app hasn't been uploaded to this server yet.", "text/plain")
            with open(APK_PATH, "rb") as f:
                return self.send(200, f.read(), "application/vnd.android.package-archive",
                                 {"Content-Disposition": 'attachment; filename="SessionNotes.apk"'})
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
            return self.send(200, {"loggedIn": bool(u), "user": accounts.public(u) if u else None,
                                   "androidApp": os.path.exists(APK_PATH), "bookstoreUrl": BOOKSTORE_URL})

        user = self.current_user()
        if not user:
            return self.send(401, {"error": "unauthorized"})
        store = Store(user["id"])

        if p[1:] == ["games"]:
            out = []
            for appid in store.appids():
                g, rev = store.read(appid)
                out.append({"appId": g.get("appId"), "name": g.get("name"), "rev": rev, "noteCount": len(g.get("notes", [])),
                            "lastLaunched": g.get("lastLaunched"),
                            "updatedAt": int(os.path.getmtime(store.game_path(appid)) * 1000)})
            return self.send(200, out)
        if len(p) == 3 and p[1] == "games":
            g, rev = store.read(safe(p[2]))
            return self.send(200, {"game": g, "rev": rev}) if g else self.send(404, {"error": "no such game"})
        if p[1:] == ["search"]:
            q = self.query().get("q", "").lower().strip()
            hits = []
            for appid in store.appids() if q else []:
                g, _ = store.read(appid)
                for n in g.get("notes", []):
                    if q in (n.get("title", "") + "\n" + n.get("body", "") + "\n" + " ".join(n.get("tags", []))).lower():
                        hits.append({"appId": g.get("appId"), "game": g.get("name"), "note": n})
            return self.send(200, hits)
        if len(p) == 4 and p[1] == "history":
            return self.send(200, list(reversed(store.history.get(safe(p[2]), safe(p[3])))))
        if len(p) == 3 and p[1] == "deleted":
            g, _ = store.read(safe(p[2]))
            return self.send(200, store.history.deleted(p[2], (g or {}).get("notes", [])))
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
        if p[1:] == ["admin"] and user["role"] == "owner":
            return self.send(200, {"users": accounts.list_public(), "invites": accounts.db.get("invites", []),
                                   "allowSignups": accounts.db.get("allowSignups", False)})
        return self.send(404, {"error": "not found"})

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
        user, err = accounts.login_steam(steam_id, steam.profile(steam_id), current["id"] if (link and current) else None)
        if err:
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
        if p == ["api", "login"]:  # owner password
            if self.throttled():
                return self.send(429, {"error": "Too many attempts. Try again in 15 minutes."})
            password = (self.json_body().get("password") or "")
            if not hmac.compare_digest(password.encode(), WEB_PASSWORD.encode()):
                self.failed()
                return self.send(401, {"error": "Wrong password"})
            return self.send(200, {"ok": True}, headers={"Set-Cookie": self.cookie_for(accounts.new_session(OWNER_ID))})
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
            return self.send(200, store.sync(safe(p[2]), self.json_body(), self.source()))
        if len(p) == 4 and p[:2] == ["api", "games"] and p[3] == "notes":
            return self.add_note(store, safe(p[2]), self.json_body())
        if p == ["api", "import", "bookstore"]:
            try:
                return self.send(200, import_from_bookstore(store, str(self.json_body().get("id", "")), self.source()))
            except (LookupError, PermissionError) as err:
                return self.send(404 if isinstance(err, LookupError) else 403, {"error": str(err)})
            except (urllib.error.URLError, OSError) as err:
                return self.send(502, {"error": f"Couldn't reach the Bookstore: {err}"})
        if p == ["api", "devices", "code"]:
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
        if len(p) >= 3 and p[:2] == ["api", "admin"] and user["role"] == "owner":
            data = self.json_body()
            if p[2] == "invites":
                sid = steam.parse_steam_id(str(data.get("steamId", "")))
                if not sid:
                    return self.send(400, {"error": "Enter a 17-digit Steam ID or a steamcommunity.com/profiles/… link"})
                if sid not in accounts.db.setdefault("invites", []) and not accounts.by_steam(sid):
                    accounts.db["invites"].append(sid)
                    accounts.save()
                return self.send(200, {"invites": accounts.db["invites"]})
            if p[2] == "settings":
                accounts.db["allowSignups"] = bool(data.get("allowSignups"))
                accounts.save()
                return self.send(200, {"allowSignups": accounts.db["allowSignups"]})
        return self.send(404, {"error": "not found"})

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
                return self.send(200, store.sync(safe(p[2]), self.json_body(), self.source()))
            if len(p) == 4 and p[:2] == ["api", "media"]:
                d = store.media_path(safe(p[2]))
                os.makedirs(d, exist_ok=True)
                data = self.body()
                with open(os.path.join(d, safe(p[3])), "wb") as f:
                    f.write(data)
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
            if len(p) >= 4 and p[:2] == ["api", "admin"] and user["role"] == "owner":
                if p[2] == "invites":
                    accounts.db["invites"] = [i for i in accounts.db.get("invites", []) if i != p[3]]
                    accounts.save()
                    return self.send(200, {"invites": accounts.db["invites"]})
                if p[2] == "users":
                    ok = accounts.remove_user(safe(p[3]))
                    if ok:
                        with shares_lock:
                            save_shares([s for s in load_shares() if p[3] not in (s["from"], s["to"])])
                    return self.send(200, {"ok": ok})
        except ValueError:
            return self.send(400, {"error": "bad request"})
        return self.send(404, {"error": "not found"})


if __name__ == "__main__":
    if WEB_PASSWORD == "AdminPassword":
        print("NOTE: the owner password is the default (AdminPassword). Set WEB_PASSWORD to change it.", flush=True)
    port = int(os.environ.get("PORT", "8430"))
    print(f"Session Notes server on :{port}, data in {DATA}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
