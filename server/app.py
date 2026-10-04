"""Session Notes server: two-way sync for the Decky plugin plus a web editor.

Auth:
- The Deck uses a bearer token (API_TOKEN).
- The website uses a password login (WEB_PASSWORD) that sets a session cookie.
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
import urllib.request
import uuid
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

import merge

DATA = os.environ.get("DATA_DIR", "/data")
TOKEN = os.environ.get("API_TOKEN", "")
WEB_PASSWORD = os.environ.get("WEB_PASSWORD") or "AdminPassword"
HISTORY_KEEP = int(os.environ.get("HISTORY_KEEP", "30"))
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
MAX_BODY = 60 * 1024 * 1024
SAFE = re.compile(r"^[A-Za-z0-9._-]+$")
HERE = os.path.dirname(os.path.abspath(__file__))
SESSIONS_PATH = os.path.join(DATA, "sessions.json")
COOKIE = "sn_session"
WEBHOOK_URLS = [u.strip() for u in os.environ.get("WEBHOOK_URLS", "").split(",") if u.strip()]
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")
STATIC = {  # file -> content type, served without login
    "manifest.webmanifest": "application/manifest+json",
    "icon.svg": "image/svg+xml",
    "sw.js": "text/javascript",
}
APK_PATH = os.path.join(DATA, "app", "SessionNotes.apk")

history = merge.NoteHistory(os.path.join(DATA, "note_history"))
write_lock = threading.Lock()
auth_lock = threading.Lock()
failed_logins: dict = {}  # ip -> [timestamps]


def now_ms() -> int:
    return int(time.time() * 1000)


def safe(name: str) -> str:
    name = unquote(name)
    if not SAFE.match(name) or name in (".", ".."):
        raise ValueError("bad name")
    return name


def game_path(appid: str) -> str:
    return os.path.join(DATA, "games", f"{appid}.json")


def read_game(appid: str):
    path = game_path(appid)
    if not os.path.exists(path):
        return None, None
    with open(path, "rb") as f:
        raw = f.read()
    return json.loads(raw), hashlib.sha1(raw).hexdigest()[:16]


def write_game(appid: str, game: dict) -> str:
    path = game_path(appid)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        hist = os.path.join(DATA, "history", appid)
        os.makedirs(hist, exist_ok=True)
        shutil.copy2(path, os.path.join(hist, f"{now_ms()}.json"))
        for old in sorted(os.listdir(hist))[:-HISTORY_KEEP]:
            os.remove(os.path.join(hist, old))
    raw = json.dumps(game, indent=2).encode()
    with open(path + ".tmp", "wb") as f:
        f.write(raw)
    os.replace(path + ".tmp", path)
    return hashlib.sha1(raw).hexdigest()[:16]


def sync_game(appid: str, incoming: dict, source: str = "api") -> dict:
    incoming["appId"] = appid
    with write_lock:
        stored, rev = read_game(appid)
        merged = merge.merge_games(incoming, stored or {}, now_ms())
        if stored is None or json.dumps(merged, sort_keys=True) != json.dumps(stored, sort_keys=True):
            history.record(appid, (stored or {}).get("notes", []), merged.get("notes", []), now_ms())
            rev = write_game(appid, merged)
            if WEBHOOK_URLS:
                events = describe_changes(stored or {}, merged)
                if events:
                    threading.Thread(target=send_webhooks, args=(merged, events, source), daemon=True).start()
    return {"game": merged, "rev": rev}


# ---- webhooks ----

def describe_changes(old: dict, new: dict) -> list:
    """Human-meaningful events between two versions of a game."""
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


def send_webhooks(game: dict, events: list, source: str):
    """POST JSON to each URL. Prefix a URL with ntfy+ (e.g. ntfy+https://ntfy.sh/topic) for ntfy-style plain text."""
    payload = {"source": source, "appId": game.get("appId"), "game": game.get("name"), "at": now_ms(),
               "events": events, "summary": [_summary_line(game, e) for e in events],
               "url": PUBLIC_URL or None}
    for url in WEBHOOK_URLS:
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


# ---- web sessions ----

def load_sessions() -> dict:
    if os.path.exists(SESSIONS_PATH):
        with open(SESSIONS_PATH) as f:
            return json.load(f)
    return {}


def save_sessions(sessions: dict):
    os.makedirs(DATA, exist_ok=True)
    with open(SESSIONS_PATH, "w") as f:
        json.dump(sessions, f)


sessions = load_sessions()


class Handler(BaseHTTPRequestHandler):
    server_version = "SessionNotes/2"

    def log_message(self, fmt, *args):
        print(f"{self.client_ip()} {fmt % args}", flush=True)

    def client_ip(self) -> str:
        return self.headers.get("X-Real-IP") or self.headers.get("X-Forwarded-For", "").split(",")[0].strip() or self.client_address[0]

    # ---- helpers ----
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

    def session_id(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        return cookie[COOKIE].value if COOKIE in cookie else None

    def web_session_valid(self) -> bool:
        sid = self.session_id()
        if not sid:
            return False
        with auth_lock:
            exp = sessions.get(hashlib.sha256(sid.encode()).hexdigest())
        return bool(exp and exp > time.time())

    def authed(self, mutating: bool = False) -> bool:
        auth = self.headers.get("Authorization", "")
        if TOKEN and auth.startswith("Bearer ") and hmac.compare_digest(auth[7:], TOKEN):
            return True
        if self.web_session_valid():
            # Custom header can't be sent cross-site without CORS, which blocks CSRF.
            return not mutating or self.headers.get("X-Requested-With") == "session-notes"
        return False

    def source(self) -> str:
        return "web" if not self.headers.get("Authorization", "").startswith("Bearer ") else (self.headers.get("X-Client") or "deck")

    def body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_BODY:
            raise ValueError("too large")
        return self.rfile.read(length)

    def parts(self):
        return [p for p in self.path.split("?")[0].split("/") if p]

    def is_https(self) -> bool:
        return self.headers.get("X-Forwarded-Proto", "") == "https"

    # ---- login ----
    def login(self):
        ip = self.client_ip()
        recent = [t for t in failed_logins.get(ip, []) if t > time.time() - 900]
        if len(recent) >= 8:
            return self.send(429, {"error": "Too many attempts. Try again in 15 minutes."})
        try:
            password = json.loads(self.body() or b"{}").get("password", "")
        except ValueError:
            password = ""
        if not WEB_PASSWORD or not hmac.compare_digest(password.encode(), WEB_PASSWORD.encode()):
            failed_logins[ip] = recent + [time.time()]
            time.sleep(1)
            return self.send(401, {"error": "Wrong password" if WEB_PASSWORD else "WEB_PASSWORD is not set on the server"})
        failed_logins.pop(ip, None)
        sid = secrets.token_urlsafe(32)
        with auth_lock:
            now = time.time()
            for k in [k for k, exp in sessions.items() if exp < now]:
                del sessions[k]
            sessions[hashlib.sha256(sid.encode()).hexdigest()] = now + SESSION_DAYS * 86400
            save_sessions(sessions)
        cookie = f"{COOKIE}={sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_DAYS * 86400}"
        if self.is_https():
            cookie += "; Secure"
        return self.send(200, {"ok": True}, headers={"Set-Cookie": cookie})

    def logout(self):
        sid = self.session_id()
        if sid:
            with auth_lock:
                sessions.pop(hashlib.sha256(sid.encode()).hexdigest(), None)
                save_sessions(sessions)
        return self.send(200, {"ok": True}, headers={"Set-Cookie": f"{COOKIE}=; Path=/; Max-Age=0"})

    def add_note(self, appid: str, data: dict):
        """Simple endpoint for automations: create a note from {title, body?, tags?, checklist?: [text], pinned?}."""
        if not str(data.get("title", "")).strip():
            return self.send(400, {"error": "title is required"})
        now = now_ms()
        note = {
            "id": str(uuid.uuid4()), "folderId": data.get("folderId"), "title": str(data["title"]).strip(),
            "body": str(data.get("body", "")), "tags": [str(t).lstrip("#") for t in data.get("tags", [])],
            "screenshots": [], "recordings": [], "pinned": bool(data.get("pinned")), "spoiler": bool(data.get("spoiler")),
            "createdAt": now, "updatedAt": now, "launchNumber": None,
        }
        if data.get("checklist"):
            note["checklist"] = [{"id": str(uuid.uuid4()), "text": str(c), "done": False} for c in data["checklist"]]
        stored, _ = read_game(appid)
        if stored is None and not data.get("gameName"):
            return self.send(404, {"error": "no such game (pass gameName to create it)"})
        game = {"appId": appid, "name": (stored or {}).get("name") or data.get("gameName"), "notes": [note]}
        self.send(200, {"note": note, "rev": sync_game(appid, game, self.source())["rev"]})

    # ---- verbs ----
    def do_GET(self):
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
        if p[0] != "api":
            return self.send(404, {"error": "not found"})
        if p[1:] == ["health"]:
            return self.send(200, {"ok": True})
        if p[1:] == ["me"]:
            return self.send(200, {"loggedIn": self.web_session_valid(), "androidApp": os.path.exists(APK_PATH)})
        if not self.authed():
            return self.send(401, {"error": "unauthorized"})
        try:
            if p[1:] == ["games"]:
                games = []
                gdir = os.path.join(DATA, "games")
                for name in sorted(os.listdir(gdir)) if os.path.isdir(gdir) else []:
                    if name.endswith(".json"):
                        g, rev = read_game(name[:-5])
                        games.append({"appId": g.get("appId"), "name": g.get("name"), "rev": rev,
                                      "noteCount": len(g.get("notes", [])), "lastLaunched": g.get("lastLaunched"),
                                      "updatedAt": int(os.path.getmtime(os.path.join(gdir, name)) * 1000)})
                return self.send(200, games)
            if len(p) == 3 and p[1] == "games":
                g, rev = read_game(safe(p[2]))
                return self.send(200, {"game": g, "rev": rev}) if g else self.send(404, {"error": "no such game"})
            if p[1:] == ["search"]:
                q = (self.path.split("q=", 1)[1].split("&")[0] if "q=" in self.path else "")
                q = unquote(q.replace("+", " ")).lower().strip()
                hits = []
                gdir = os.path.join(DATA, "games")
                for name in sorted(os.listdir(gdir)) if q and os.path.isdir(gdir) else []:
                    if name.endswith(".json"):
                        g, _ = read_game(name[:-5])
                        for n in g.get("notes", []):
                            if q in (n.get("title", "") + "\n" + n.get("body", "") + "\n" + " ".join(n.get("tags", []))).lower():
                                hits.append({"appId": g.get("appId"), "game": g.get("name"), "note": n})
                return self.send(200, hits)
            if len(p) == 4 and p[1] == "history":
                return self.send(200, list(reversed(history.get(safe(p[2]), safe(p[3])))))
            if len(p) == 3 and p[1] == "deleted":
                g, _ = read_game(safe(p[2]))
                return self.send(200, history.deleted(p[2], (g or {}).get("notes", [])))
            if len(p) == 3 and p[1] == "media":
                d = os.path.join(DATA, "media", safe(p[2]))
                return self.send(200, sorted(os.listdir(d)) if os.path.isdir(d) else [])
            if len(p) == 4 and p[1] == "media":
                path = os.path.join(DATA, "media", safe(p[2]), safe(p[3]))
                if not os.path.exists(path):
                    return self.send(404, {"error": "no such file"})
                ext = os.path.splitext(path)[1].lower()
                ctype = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
                         ".wav": "audio/wav", ".webm": "audio/webm", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
                         ".mp3": "audio/mpeg"}.get(ext, "application/octet-stream")
                with open(path, "rb") as f:
                    return self.send(200, f.read(), ctype, {"Cache-Control": "private, max-age=86400"})
        except ValueError:
            return self.send(400, {"error": "bad name"})
        return self.send(404, {"error": "not found"})

    def do_POST(self):
        p = self.parts()
        if p == ["api", "login"]:
            return self.login()
        if p == ["api", "logout"]:
            return self.logout()
        if not self.authed(mutating=True):
            return self.send(401, {"error": "unauthorized"})
        try:
            if len(p) == 3 and p[:2] == ["api", "sync"]:
                return self.send(200, sync_game(safe(p[2]), json.loads(self.body()), self.source()))
            if len(p) == 4 and p[:2] == ["api", "games"] and p[3] == "notes":
                return self.add_note(safe(p[2]), json.loads(self.body() or b"{}"))
        except ValueError:
            return self.send(400, {"error": "bad request"})
        return self.send(404, {"error": "not found"})

    def do_PUT(self):
        p = self.parts()
        if not self.authed(mutating=True):
            return self.send(401, {"error": "unauthorized"})
        try:
            if len(p) == 3 and p[:2] == ["api", "games"]:  # older plugin builds
                return self.send(200, sync_game(safe(p[2]), json.loads(self.body()), self.source()))
            if len(p) == 4 and p[:2] == ["api", "media"]:
                d = os.path.join(DATA, "media", safe(p[2]))
                os.makedirs(d, exist_ok=True)
                data = self.body()
                with open(os.path.join(d, safe(p[3])), "wb") as f:
                    f.write(data)
                return self.send(200, {"ok": True})
        except ValueError:
            return self.send(400, {"error": "bad request"})
        return self.send(404, {"error": "not found"})


if __name__ == "__main__":
    if not TOKEN:
        print("WARNING: API_TOKEN is not set; the Deck can't sync.", flush=True)
    if WEB_PASSWORD == "AdminPassword":
        print("NOTE: the website password is the default (AdminPassword). Set WEB_PASSWORD to change it.", flush=True)
    port = int(os.environ.get("PORT", "8430"))
    print(f"Session Notes server on :{port}, data in {DATA}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
