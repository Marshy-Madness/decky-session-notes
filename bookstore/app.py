"""Session Notes Bookstore: a public library of game notes, guides and tips.

Anyone can browse. Signing in with Steam lets you post, edit (if allowed), comment and like.
The Deck plugin links to an account with a device code that you approve on the website.

Admins (ADMIN_STEAM_IDS, plus anyone they make an admin on the website) get 🛡 Admin on the website:
an approval queue, reports, posts (publish/hide/pin/lock/delete, in bulk), comments, games (rename, move to
another app ID), users (ban, sign out, delete their posts or comments), site settings (announcement, read-only,
comments on/off, check new posts first, posts per day, account age, blocked words) and a mod log.
"""
import hashlib
import json
import os
import re
import secrets
import threading
import time
import urllib.parse
import uuid
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import db
import steam

DATA = db.DATA
MEDIA = os.path.join(DATA, "media")
HERE = os.path.dirname(os.path.abspath(__file__))
ADMINS = {s.strip() for s in os.environ.get("ADMIN_STEAM_IDS", "").split(",") if s.strip()}
SESSION_DAYS = 30
MAX_UPLOAD = 15 * 1024 * 1024
MAX_JSON = 2 * 1024 * 1024
COOKIE = "bs_session"
KINDS = {"note", "guide", "tip", "walkthrough", "boss", "build", "collectibles", "secret", "settings", "achievement"}
POLICIES = {"owner", "select", "anyone"}
MEDIA_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif",
             "wav": "audio/wav", "webm": "audio/webm", "ogg": "audio/ogg", "m4a": "audio/mp4", "mp3": "audio/mpeg"}
SAFE_FILE = re.compile(r"^[a-f0-9-]{36}(\.thumb)?\.[a-z0-9]{2,4}$")
write_times: dict = {}
lock = threading.Lock()
STARTED = time.time()
# Site settings admins can change on the website (key: (type, default)).
SETTINGS = {"announcement": (str, ""), "readOnly": (bool, False), "approvePosts": (bool, False), "commentsEnabled": (bool, True),
            "blockedWords": (str, ""), "maxPostsPerDay": (int, 0), "minAccountDays": (int, 0)}


def now_ms() -> int:
    return int(time.time() * 1000)


def h(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def first_line(body: str) -> str:
    for line in (body or "").split("\n"):
        line = re.sub(r"\[img:\d+\]", "", line).strip()
        if line:
            return line[:200]
    return ""


def setting(key: str):
    kind, default = SETTINGS[key]
    row = db.conn().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def all_settings() -> dict:
    return {k: setting(k) for k in SETTINGS}


def is_admin(sid) -> bool:
    """ADMIN_STEAM_IDS are always admins; they can make other people admins (moderators) on the website."""
    if not sid:
        return False
    if sid in ADMINS:
        return True
    row = db.conn().execute("SELECT role FROM users WHERE steam_id=?", (sid,)).fetchone()
    return bool(row and row["role"] == "admin")


def modlog(actor: str, action: str, target: str = "", detail: str = ""):
    db.conn().execute("INSERT INTO modlog VALUES (?,?,?,?,?)", (now_ms(), actor, action, target, detail[:300]))
    db.conn().execute("DELETE FROM modlog WHERE at < ?", (now_ms() - 365 * 86400_000,))


def blocked_word(*texts) -> str:
    words = [w.strip().lower() for w in re.split(r"[,\n]", setting("blockedWords") or "") if w.strip()]
    blob = " ".join(t or "" for t in texts).lower()
    return next((w for w in words if re.search(r"(?<!\w)" + re.escape(w) + r"(?!\w)", blob)), "")


def delete_entry(entry_id: str):
    c = db.conn()
    for t in ("entries WHERE id", "comments WHERE entry_id", "likes WHERE entry_id", "entry_versions WHERE entry_id", "reports WHERE entry_id"):
        c.execute(f"DELETE FROM {t}=?", (entry_id,))


def public_user(steam_id: str) -> dict:
    row = db.conn().execute("SELECT steam_id, name, avatar FROM users WHERE steam_id=?", (steam_id,)).fetchone()
    return {"steamId": steam_id, "name": row["name"] if row else steam_id, "avatar": row["avatar"] if row else ""}


def summary(e: dict) -> dict:
    thumb = (e["screenshots"][0].get("thumb") or e["screenshots"][0].get("file")) if e["screenshots"] else None
    return {"id": e["id"], "appId": e["app_id"], "gameName": e["game_name"], "title": e["title"], "firstLine": first_line(e["body"]),
            "kind": e["kind"], "tags": e["tags"], "spoiler": e["spoiler"], "spoilerLabel": e["spoiler_label"] or "",
            "author": public_user(e["author"]), "likes": e["likes"], "comments": e["comments"], "allowCopy": e["allow_copy"],
            "hasScreenshots": bool(e["screenshots"]), "hasVoice": bool(e["recordings"]), "hasChecklist": bool(e["checklist"]),
            "thumb": thumb, "createdAt": e["created_at"], "updatedAt": e["updated_at"],
            "pinned": e["pinned"], "locked": e["locked"], "status": e["status"]}


def full(e: dict, viewer) -> dict:
    out = summary(e)
    out.update({"body": e["body"], "checklist": e["checklist"], "screenshots": e["screenshots"], "recordings": e["recordings"],
                "editPolicy": e["edit_policy"], "editors": [public_user(s) for s in e["editors"]],
                "updatedBy": public_user(e["updated_by"]) if e["updated_by"] else None})
    out["canEdit"] = can_edit(e, viewer)
    out["isAuthor"] = bool(viewer and viewer == e["author"])
    admin = is_admin(viewer)
    out["canDelete"] = bool(viewer and (viewer == e["author"] or admin))
    out["canModerate"] = admin
    out["canComment"] = bool(viewer) and (admin or (not e["locked"] and setting("commentsEnabled") and not setting("readOnly")))
    out["liked"] = bool(viewer and db.conn().execute("SELECT 1 FROM likes WHERE entry_id=? AND steam_id=?", (e["id"], viewer)).fetchone())
    rows = db.conn().execute("SELECT * FROM comments WHERE entry_id=? ORDER BY created_at", (e["id"],)).fetchall()
    out["commentList"] = [{"id": r["id"], "text": r["text"], "createdAt": r["created_at"], "author": public_user(r["author"]),
                           "canDelete": bool(viewer and viewer in (r["author"], e["author"]) or admin)} for r in rows]
    return out


def can_edit(e: dict, viewer) -> bool:
    if not viewer:
        return False
    if viewer == e["author"] or is_admin(viewer):
        return True
    if e["locked"] or setting("readOnly"):
        return False
    if e["edit_policy"] == "anyone":
        return True
    return e["edit_policy"] == "select" and viewer in e["editors"]


def get_entry(entry_id: str, viewer=False):
    """The entry, or None. Pass the viewer to hide posts that aren't published unless they're theirs (or they're an admin)."""
    row = db.conn().execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
    e = db.row_to_entry(row) if row else None
    if e and viewer is not False and e["status"] != "published" and viewer != e["author"] and not is_admin(viewer):
        return None
    return e


def clean_media(items, kind: str) -> list:
    """Keep only well-formed references to files that were really uploaded."""
    out = []
    for item in (items or [])[:20]:
        f = str(item.get("file", ""))
        if not SAFE_FILE.match(f) or not os.path.exists(os.path.join(MEDIA, f)):
            continue
        clean = {"id": str(item.get("id") or uuid.uuid4())[:40], "file": f}
        t = str(item.get("thumb") or "")
        if t and SAFE_FILE.match(t) and os.path.exists(os.path.join(MEDIA, t)):
            clean["thumb"] = t
        if kind == "recordings" and isinstance(item.get("durationSec"), (int, float)):
            clean["durationSec"] = float(item["durationSec"])
        out.append(clean)
    return out


def clean_fields(data: dict) -> dict:
    """Validate the editable parts of an entry."""
    title = str(data.get("title", "")).strip()[:120]
    if not title:
        raise ValueError("A title is required")
    kind = data.get("kind") if data.get("kind") in KINDS else "note"
    tags = [re.sub(r"[^\w\- ]", "", str(t)).strip()[:30] for t in (data.get("tags") or [])][:10]
    checklist = [{"id": str(c.get("id") or uuid.uuid4())[:40], "text": str(c.get("text", ""))[:300], "done": False}
                 for c in (data.get("checklist") or [])[:200] if str(c.get("text", "")).strip()]
    return {"title": title, "body": str(data.get("body", ""))[:50000], "kind": kind, "tags": [t for t in tags if t],
            "checklist": checklist, "screenshots": clean_media(data.get("screenshots"), "screenshots"),
            "recordings": clean_media(data.get("recordings"), "recordings"),
            "spoiler": 1 if data.get("spoiler") else 0, "spoiler_label": str(data.get("spoilerLabel") or "")[:80]}


class Handler(BaseHTTPRequestHandler):
    server_version = "Bookstore/1"

    def log_message(self, fmt, *args):
        print(f"{self.client_ip()} {fmt % args}", flush=True)

    def client_ip(self) -> str:
        return self.headers.get("X-Real-IP") or self.headers.get("X-Forwarded-For", "").split(",")[0].strip() or self.client_address[0]

    def base_url(self) -> str:
        return f"{self.headers.get('X-Forwarded-Proto') or 'http'}://{self.headers.get('Host', 'localhost')}"

    def send(self, code: int, body=b"", ctype="application/json", headers=None):
        if not isinstance(body, (bytes, bytearray)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        if ctype.startswith("text/html"):
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def err(self, code: int, msg: str):
        return self.send(code, {"error": msg})

    def query(self) -> dict:
        return {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).items()}

    def parts(self):
        return [urllib.parse.unquote(p) for p in urllib.parse.urlsplit(self.path).path.split("/") if p]

    def body(self, limit=MAX_JSON) -> bytes:
        n = int(self.headers.get("Content-Length", 0))
        if n > limit:
            raise ValueError("Too large")
        return self.rfile.read(n)

    def json_body(self) -> dict:
        return json.loads(self.body() or b"{}")

    def session_id(self):
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return c[COOKIE].value if COOKIE in c else None

    def viewer(self, mutating=False):
        """Steam ID of the signed-in user (bearer token from the Deck, or website session)."""
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            row = db.conn().execute("SELECT steam_id FROM tokens WHERE hash=?", (h(auth[7:]),)).fetchone()
            sid = row["steam_id"] if row else None
        else:
            sid_cookie = self.session_id()
            row = db.conn().execute("SELECT steam_id, exp FROM sessions WHERE hash=?", (h(sid_cookie or ""),)).fetchone()
            sid = row["steam_id"] if row and row["exp"] > time.time() else None
            if sid and mutating and self.headers.get("X-Requested-With") != "bookstore":
                return None
        if sid:
            banned = db.conn().execute("SELECT banned FROM users WHERE steam_id=?", (sid,)).fetchone()
            if banned and banned["banned"]:
                return None
        return sid

    def rate_limited(self, sid: str) -> bool:
        with lock:
            recent = [t for t in write_times.get(sid, []) if t > time.time() - 60]
            recent.append(time.time())
            write_times[sid] = recent
            return len(recent) > 40

    # ---------- GET ----------
    def do_GET(self):
        try:
            return self._get()
        except ValueError as e:
            return self.err(400, str(e))

    def _get(self):
        p = self.parts()
        if not p or p in (["index.html"], ["link"]):
            with open(os.path.join(HERE, "index.html"), "rb") as f:
                return self.send(200, f.read(), "text/html; charset=utf-8")
        if p == ["auth", "steam"]:
            return self.send(302, b"", "text/plain", {"Location": steam.login_url(self.base_url() + "/auth/steam/callback" + (
                "?next=" + urllib.parse.quote(self.query().get("next", "/")) if self.query().get("next") else ""), self.base_url() + "/")})
        if p == ["auth", "steam", "callback"]:
            return self.steam_callback()
        if not p or p[0] != "api":
            return self.err(404, "not found")
        viewer = self.viewer()
        c = db.conn()

        if p[1:] == ["me"]:
            site = {k: setting(k) for k in ("announcement", "readOnly", "approvePosts", "commentsEnabled")}
            out = {"user": public_user(viewer) if viewer else None, "admin": is_admin(viewer), "ownerAdmin": viewer in ADMINS, "site": site}
            if out["admin"]:
                out["openReports"] = c.execute("SELECT COUNT(*) FROM reports WHERE status='open'").fetchone()[0]
                out["pendingPosts"] = c.execute("SELECT COUNT(*) FROM entries WHERE status='pending'").fetchone()[0]
            return self.send(200, out)
        if len(p) >= 3 and p[1] == "admin":
            return self.admin_get(viewer, p[2:]) if is_admin(viewer) else self.err(403, "Admins only")
        if p[1:] == ["games"]:
            q = self.query().get("q", "").strip().lower()
            rows = c.execute("SELECT app_id, MAX(game_name) AS name, COUNT(*) AS n, MAX(updated_at) AS u FROM entries "
                             "WHERE status='published' GROUP BY app_id ORDER BY n DESC, u DESC LIMIT 200").fetchall()
            games = [{"appId": r["app_id"], "gameName": r["name"], "count": r["n"], "updatedAt": r["u"]} for r in rows]
            return self.send(200, [g for g in games if not q or q in (g["gameName"] or "").lower() or q == g["appId"]])
        if p[1:] == ["entries"]:
            q = self.query()
            where, args = ["(status='published' OR author=?)"], [viewer or ""]
            if q.get("appId"):
                where.append("app_id=?"); args.append(q["appId"])
            if q.get("kind"):
                kinds = [k for k in q["kind"].split(",") if k in KINDS]
                if kinds:
                    where.append(f"kind IN ({','.join('?' * len(kinds))})"); args += kinds
            has = set(q.get("has", "").split(","))
            if "screenshots" in has:
                where.append("screenshots != '[]'")
            if "voice" in has:
                where.append("recordings != '[]'")
            if "checklist" in has:
                where.append("checklist != '[]'")
            if q.get("author"):
                where.append("author=?"); args.append(q["author"])
            if q.get("q"):
                where.append("(title LIKE ? OR body LIKE ? OR tags LIKE ? OR game_name LIKE ?)"); args += [f"%{q['q']}%"] * 4
            order = {"top": "likes DESC, updated_at DESC", "updated": "updated_at DESC"}.get(q.get("sort"), "created_at DESC")
            if q.get("appId"):
                order = "pinned DESC, " + order
            sql = "SELECT * FROM entries" + (" WHERE " + " AND ".join(where) if where else "") + f" ORDER BY {order} LIMIT 50 OFFSET ?"
            rows = c.execute(sql, args + [max(0, int(q.get("offset", 0) or 0))]).fetchall()
            return self.send(200, [summary(db.row_to_entry(r)) for r in rows])
        if len(p) == 3 and p[1] == "entries":
            e = get_entry(p[2], viewer)
            return self.send(200, full(e, viewer)) if e else self.err(404, "No such entry")
        if len(p) == 4 and p[1] == "entries" and p[3] == "history":
            if not get_entry(p[2], viewer):
                return self.err(404, "No such entry")
            rows = c.execute("SELECT saved_at, saved_by, data FROM entry_versions WHERE entry_id=? ORDER BY saved_at DESC LIMIT 50",
                             (p[2],)).fetchall()
            return self.send(200, [{"savedAt": r["saved_at"], "savedBy": public_user(r["saved_by"]), "entry": json.loads(r["data"])} for r in rows])
        if len(p) == 3 and p[1] == "media":
            f = p[2]
            path = os.path.join(MEDIA, f)
            if not SAFE_FILE.match(f) or not os.path.exists(path):
                return self.err(404, "No such file")
            with open(path, "rb") as fh:
                return self.send(200, fh.read(), MEDIA_EXT.get(f.rsplit(".", 1)[-1], "application/octet-stream"),
                                 {"Cache-Control": "public, max-age=31536000, immutable"})
        if p[1:] == ["users"]:
            if not viewer:
                return self.err(401, "Sign in first")
            q = f"%{self.query().get('q', '')}%"
            rows = c.execute("SELECT steam_id FROM users WHERE (name LIKE ? OR steam_id LIKE ?) AND banned=0 LIMIT 20", (q, q)).fetchall()
            return self.send(200, [public_user(r["steam_id"]) for r in rows])
        return self.err(404, "not found")

    def steam_callback(self):
        q = self.query()
        expected = self.base_url() + "/auth/steam/callback"
        try:
            sid = steam.verify(q, expected)
        except Exception as e:
            print(f"steam verify failed: {e}", flush=True)
            sid = None
        if not sid:
            return self.send(302, b"", "text/plain", {"Location": "/?error=" + urllib.parse.quote("Steam sign-in failed")})
        prof = steam.profile(sid)
        c = db.conn()
        c.execute("INSERT INTO users (steam_id, name, avatar, created_at) VALUES (?,?,?,?) "
                  "ON CONFLICT(steam_id) DO UPDATE SET name=excluded.name, avatar=excluded.avatar", (sid, prof["name"], prof["avatar"], now_ms()))
        c.execute("UPDATE users SET last_login=? WHERE steam_id=?", (now_ms(), sid))
        token = secrets.token_urlsafe(32)
        c.execute("INSERT INTO sessions VALUES (?,?,?)", (h(token), sid, int(time.time()) + SESSION_DAYS * 86400))
        c.commit()
        cookie = f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}"
        if self.headers.get("X-Forwarded-Proto") == "https":
            cookie += "; Secure"
        nxt = q.get("next", "/")
        return self.send(302, b"", "text/plain", {"Location": nxt if nxt.startswith("/") and not nxt.startswith("//") else "/",
                                                  "Set-Cookie": cookie})

    # ---------- POST ----------
    def do_POST(self):
        try:
            return self._post()
        except (ValueError, KeyError) as e:
            return self.err(400, str(e))

    def _post(self):
        p = self.parts()
        c = db.conn()
        if p == ["api", "logout"]:
            c.execute("DELETE FROM sessions WHERE hash=?", (h(self.session_id() or ""),)); c.commit()
            return self.send(200, {"ok": True}, headers={"Set-Cookie": f"{COOKIE}=; Path=/; Max-Age=0"})
        # --- device linking (the Deck shows a code; you approve it here) ---
        if p == ["api", "device", "start"]:
            alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
            user_code = "".join(secrets.choice(alphabet) for _ in range(4)) + "-" + "".join(secrets.choice(alphabet) for _ in range(4))
            device_code = secrets.token_urlsafe(24)
            c.execute("DELETE FROM device_codes WHERE exp < ?", (int(time.time()),))
            c.execute("INSERT INTO device_codes VALUES (?,?,?,?,?)", (device_code, user_code, None,
                      str(self.json_body().get("label", "Steam Deck"))[:60], int(time.time()) + 900))
            c.commit()
            return self.send(200, {"deviceCode": device_code, "userCode": user_code, "verifyUrl": self.base_url() + "/link",
                                   "expiresIn": 900, "interval": 4})
        if p == ["api", "device", "poll"]:
            row = c.execute("SELECT * FROM device_codes WHERE device_code=?", (str(self.json_body().get("deviceCode", "")),)).fetchone()
            if not row or row["exp"] < time.time():
                return self.err(410, "Code expired. Start again.")
            if not row["steam_id"]:
                return self.send(200, {"status": "pending"})
            token = secrets.token_urlsafe(32)
            c.execute("INSERT INTO tokens VALUES (?,?,?,?)", (h(token), row["steam_id"], row["label"], now_ms()))
            c.execute("DELETE FROM device_codes WHERE device_code=?", (row["device_code"],))
            c.commit()
            return self.send(200, {"status": "linked", "token": token, "user": public_user(row["steam_id"])})

        viewer = self.viewer(mutating=True)
        if not viewer:
            return self.err(401, "Sign in with Steam first")
        if not is_admin(viewer) and self.rate_limited(viewer):
            return self.err(429, "Slow down a little")

        if p == ["api", "device", "approve"]:
            code = str(self.json_body().get("userCode", "")).strip().upper().replace(" ", "")
            if len(code) == 8:
                code = code[:4] + "-" + code[4:]
            cur = c.execute("UPDATE device_codes SET steam_id=? WHERE user_code=? AND exp>? AND steam_id IS NULL",
                            (viewer, code, int(time.time())))
            c.commit()
            return self.send(200, {"ok": True}) if cur.rowcount else self.err(404, "That code is wrong or expired")
        if p == ["api", "uploads"]:
            ext = re.sub(r"[^a-z0-9]", "", self.query().get("ext", "jpg").lower())
            if ext not in MEDIA_EXT:
                return self.err(400, "Unsupported file type")
            data = self.body(MAX_UPLOAD)
            name = f"{uuid.uuid4()}{'.thumb' if self.query().get('thumb') else ''}.{ext}"
            os.makedirs(MEDIA, exist_ok=True)
            with open(os.path.join(MEDIA, name), "wb") as f:
                f.write(data)
            return self.send(200, {"file": name})
        admin = is_admin(viewer)
        if p == ["api", "report"]:
            data = self.json_body()
            kind, target = data.get("kind"), str(data.get("id", ""))
            reason = str(data.get("reason", "")).strip()[:500]
            if kind == "entry":
                e = get_entry(target, viewer)
                entry_id = e["id"] if e else None
            elif kind == "comment":
                row = c.execute("SELECT entry_id FROM comments WHERE id=?", (target,)).fetchone()
                entry_id = row["entry_id"] if row else None
            else:
                entry_id = None
            if not entry_id:
                return self.err(404, "Nothing to report")
            if not c.execute("SELECT 1 FROM reports WHERE target_id=? AND reporter=? AND status='open'", (target, viewer)).fetchone():
                c.execute("INSERT INTO reports (id, kind, target_id, entry_id, reporter, reason, created_at) VALUES (?,?,?,?,?,?,?)",
                          (uuid.uuid4().hex[:12], kind, target, entry_id, viewer, reason, now_ms()))
                c.commit()
            return self.send(200, {"ok": True})
        if len(p) >= 3 and p[:2] == ["api", "admin"]:
            if not admin:
                return self.err(403, "Admins only")
            return self.admin_post(viewer, p[2:], self.json_body())
        writing = p == ["api", "entries"] or (len(p) == 4 and p[:2] == ["api", "entries"] and p[3] == "comments")
        if writing and not admin:
            if setting("readOnly"):
                return self.err(403, "The Bookstore is read-only for now. Try again later.")
            days = setting("minAccountDays")
            joined = c.execute("SELECT created_at FROM users WHERE steam_id=?", (viewer,)).fetchone()
            if days and joined and joined["created_at"] and now_ms() - joined["created_at"] < days * 86400_000:
                return self.err(403, f"New accounts can post and comment after {days} days.")
        if p == ["api", "entries"]:
            data = self.json_body()
            app_id = re.sub(r"\D", "", str(data.get("appId", "")))[:20]
            if not app_id:
                return self.err(400, "A Steam app ID is required")
            fields = clean_fields(data)
            if not admin:
                bad = blocked_word(fields["title"], fields["body"], " ".join(fields["tags"]))
                if bad:
                    return self.err(400, f"Your post has a blocked word in it (“{bad}”).")
                limit = setting("maxPostsPerDay")
                if limit and c.execute("SELECT COUNT(*) FROM entries WHERE author=? AND created_at>?",
                                       (viewer, now_ms() - 86400_000)).fetchone()[0] >= limit:
                    return self.err(429, f"You can post {limit} times a day. Try again tomorrow.")
            status = "pending" if setting("approvePosts") and not admin else "published"
            policy = data.get("editPolicy") if data.get("editPolicy") in POLICIES else "owner"
            editors = [s for s in (data.get("editors") or []) if re.fullmatch(r"\d{17}", str(s))][:50]
            eid = uuid.uuid4().hex[:12]
            now = now_ms()
            c.execute("INSERT INTO entries (id, app_id, game_name, title, body, kind, tags, checklist, screenshots, recordings, spoiler, "
                      "spoiler_label, author, edit_policy, editors, allow_copy, created_at, updated_at, updated_by, status) "
                      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (eid, app_id, str(data.get("gameName") or app_id)[:120], fields["title"], fields["body"], fields["kind"],
                       json.dumps(fields["tags"]), json.dumps(fields["checklist"]), json.dumps(fields["screenshots"]),
                       json.dumps(fields["recordings"]), fields["spoiler"], fields["spoiler_label"], viewer, policy,
                       json.dumps(editors), 1 if data.get("allowCopy", True) else 0, now, now, viewer, status))
            c.commit()
            return self.send(200, full(get_entry(eid), viewer))
        if len(p) == 4 and p[:2] == ["api", "entries"] and p[3] == "comments":
            e = get_entry(p[2], viewer)
            text = str(self.json_body().get("text", "")).strip()[:2000]
            if not e or not text:
                return self.err(400, "Write something first")
            if not admin and (e["locked"] or not setting("commentsEnabled")):
                return self.err(403, "Comments are closed on this post")
            if not admin and blocked_word(text):
                return self.err(400, f"Your comment has a blocked word in it (“{blocked_word(text)}”).")
            c.execute("INSERT INTO comments VALUES (?,?,?,?,?)", (uuid.uuid4().hex[:12], e["id"], viewer, text, now_ms()))
            c.execute("UPDATE entries SET comments=comments+1 WHERE id=?", (e["id"],))
            c.commit()
            return self.send(200, full(get_entry(e["id"]), viewer))
        if len(p) == 4 and p[:2] == ["api", "entries"] and p[3] == "like":
            e = get_entry(p[2], viewer)
            if not e:
                return self.err(404, "No such entry")
            if c.execute("SELECT 1 FROM likes WHERE entry_id=? AND steam_id=?", (e["id"], viewer)).fetchone():
                c.execute("DELETE FROM likes WHERE entry_id=? AND steam_id=?", (e["id"], viewer))
            else:
                c.execute("INSERT INTO likes VALUES (?,?)", (e["id"], viewer))
            c.execute("UPDATE entries SET likes=(SELECT COUNT(*) FROM likes WHERE entry_id=?) WHERE id=?", (e["id"], e["id"]))
            c.commit()
            return self.send(200, full(get_entry(e["id"]), viewer))
        return self.err(404, "not found")

    # ---------- admin ----------
    def admin_get(self, viewer: str, rest: list):
        c, q = db.conn(), self.query()
        count = lambda sql, *a: c.execute(sql, a).fetchone()[0]
        week = now_ms() - 7 * 86400_000
        if rest == ["overview"]:
            media = sum(os.path.getsize(os.path.join(MEDIA, f)) for f in os.listdir(MEDIA)) if os.path.isdir(MEDIA) else 0
            top_games = c.execute("SELECT app_id, MAX(game_name) AS name, COUNT(*) AS n FROM entries GROUP BY app_id ORDER BY n DESC LIMIT 5").fetchall()
            top_authors = c.execute("SELECT author, COUNT(*) AS n, SUM(likes) AS l FROM entries GROUP BY author ORDER BY n DESC LIMIT 5").fetchall()
            return self.send(200, {
                "posts": count("SELECT COUNT(*) FROM entries"), "published": count("SELECT COUNT(*) FROM entries WHERE status='published'"),
                "pending": count("SELECT COUNT(*) FROM entries WHERE status='pending'"), "hidden": count("SELECT COUNT(*) FROM entries WHERE status='hidden'"),
                "pinned": count("SELECT COUNT(*) FROM entries WHERE pinned=1"), "locked": count("SELECT COUNT(*) FROM entries WHERE locked=1"),
                "games": count("SELECT COUNT(DISTINCT app_id) FROM entries"), "comments": count("SELECT COUNT(*) FROM comments"),
                "likes": count("SELECT COUNT(*) FROM likes"), "users": count("SELECT COUNT(*) FROM users"),
                "banned": count("SELECT COUNT(*) FROM users WHERE banned=1"),
                "admins": len(ADMINS | {r["steam_id"] for r in c.execute("SELECT steam_id FROM users WHERE role='admin'")}),
                "devices": count("SELECT COUNT(*) FROM tokens"), "openReports": count("SELECT COUNT(*) FROM reports WHERE status='open'"),
                "postsWeek": count("SELECT COUNT(*) FROM entries WHERE created_at>?", week),
                "commentsWeek": count("SELECT COUNT(*) FROM comments WHERE created_at>?", week),
                "usersWeek": count("SELECT COUNT(*) FROM users WHERE created_at>?", week),
                "mediaBytes": media, "dbBytes": os.path.getsize(db.DB_PATH) if os.path.exists(db.DB_PATH) else 0,
                "uptime": int(time.time() - STARTED), "readOnly": setting("readOnly"), "approvePosts": setting("approvePosts"),
                "envAdmins": len(ADMINS),
                "topGames": [{"appId": r["app_id"], "name": r["name"], "count": r["n"]} for r in top_games],
                "topAuthors": [{**public_user(r["author"]), "count": r["n"], "likes": r["l"] or 0} for r in top_authors]})
        if rest == ["entries"]:
            where, args = [], []
            if q.get("status") in ("published", "pending", "hidden"):
                where.append("status=?"); args.append(q["status"])
            if q.get("flag") == "pinned":
                where.append("pinned=1")
            if q.get("flag") == "locked":
                where.append("locked=1")
            if q.get("flag") == "reported":
                where.append("id IN (SELECT entry_id FROM reports WHERE status='open' AND kind='entry')")
            if q.get("appId"):
                where.append("app_id=?"); args.append(q["appId"])
            if q.get("author"):
                where.append("author=?"); args.append(q["author"])
            if q.get("q"):
                where.append("(title LIKE ? OR body LIKE ? OR game_name LIKE ? OR id=?)"); args += [f"%{q['q']}%"] * 3 + [q["q"]]
            order = {"top": "likes DESC", "comments": "comments DESC", "updated": "updated_at DESC", "old": "created_at ASC"}.get(q.get("sort"), "created_at DESC")
            rows = c.execute("SELECT * FROM entries" + (" WHERE " + " AND ".join(where) if where else "") + f" ORDER BY {order} LIMIT 100 OFFSET ?",
                             args + [max(0, int(q.get("offset", 0) or 0))]).fetchall()
            out = []
            for r in rows:
                e = summary(db.row_to_entry(r))
                e["reports"] = count("SELECT COUNT(*) FROM reports WHERE entry_id=? AND kind='entry' AND status='open'", r["id"])
                out.append(e)
            return self.send(200, out)
        if rest == ["comments"]:
            where, args = [], []
            if q.get("q"):
                where.append("c.text LIKE ?"); args.append(f"%{q['q']}%")
            if q.get("author"):
                where.append("c.author=?"); args.append(q["author"])
            rows = c.execute("SELECT c.*, e.title AS entry_title, e.game_name FROM comments c LEFT JOIN entries e ON e.id=c.entry_id"
                             + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY c.created_at DESC LIMIT 100 OFFSET ?",
                             args + [max(0, int(q.get("offset", 0) or 0))]).fetchall()
            return self.send(200, [{"id": r["id"], "entryId": r["entry_id"], "entryTitle": r["entry_title"], "gameName": r["game_name"],
                                    "text": r["text"], "createdAt": r["created_at"], "author": public_user(r["author"]),
                                    "reports": count("SELECT COUNT(*) FROM reports WHERE target_id=? AND status='open'", r["id"])} for r in rows])
        if rest == ["reports"]:
            status = q.get("status", "open")
            rows = c.execute("SELECT * FROM reports" + ("" if status == "all" else " WHERE status=?") + " ORDER BY created_at DESC LIMIT 200",
                             () if status == "all" else (status,)).fetchall()
            out = []
            for r in rows:
                e = get_entry(r["entry_id"])
                item = {"id": r["id"], "kind": r["kind"], "targetId": r["target_id"], "entryId": r["entry_id"], "reason": r["reason"],
                        "createdAt": r["created_at"], "status": r["status"], "reporter": public_user(r["reporter"]),
                        "resolvedBy": public_user(r["resolved_by"]) if r["resolved_by"] else None, "resolvedAt": r["resolved_at"],
                        "entryTitle": e["title"] if e else None, "gameName": e["game_name"] if e else None, "exists": bool(e)}
                if r["kind"] == "comment":
                    cm = c.execute("SELECT * FROM comments WHERE id=?", (r["target_id"],)).fetchone()
                    item.update({"exists": bool(cm), "text": cm["text"] if cm else None, "author": public_user(cm["author"]) if cm else None})
                elif e:
                    item.update({"text": first_line(e["body"]), "author": public_user(e["author"])})
                out.append(item)
            return self.send(200, out)
        if rest == ["users"]:
            where, args = [], []
            if q.get("q"):
                where.append("(name LIKE ? OR steam_id LIKE ?)"); args += [f"%{q['q']}%"] * 2
            if q.get("filter") == "banned":
                where.append("banned=1")
            if q.get("filter") == "admins":
                where.append(f"(role='admin' OR steam_id IN ({','.join('?' * len(ADMINS)) or 'NULL'}))"); args += list(ADMINS)
            order = {"posts": "posts DESC", "name": "name COLLATE NOCASE", "login": "last_login DESC"}.get(q.get("sort"), "created_at DESC")
            rows = c.execute("SELECT u.*, (SELECT COUNT(*) FROM entries WHERE author=u.steam_id) AS posts, "
                             "(SELECT COUNT(*) FROM comments WHERE author=u.steam_id) AS ncomments, "
                             "(SELECT COUNT(*) FROM tokens WHERE steam_id=u.steam_id) AS devices FROM users u"
                             + (" WHERE " + " AND ".join(where) if where else "") + f" ORDER BY {order} LIMIT 200", args).fetchall()
            return self.send(200, [{"steamId": r["steam_id"], "name": r["name"], "avatar": r["avatar"], "createdAt": r["created_at"],
                                    "lastLogin": r["last_login"], "banned": bool(r["banned"]), "banReason": r["ban_reason"] or "",
                                    "role": "admin" if r["steam_id"] in ADMINS or r["role"] == "admin" else "", "envAdmin": r["steam_id"] in ADMINS,
                                    "posts": r["posts"], "comments": r["ncomments"], "devices": r["devices"]} for r in rows])
        if rest == ["games"]:
            rows = c.execute("SELECT app_id, GROUP_CONCAT(DISTINCT game_name) AS names, COUNT(*) AS n, SUM(likes) AS l, MAX(updated_at) AS u "
                             "FROM entries GROUP BY app_id ORDER BY n DESC").fetchall()
            return self.send(200, [{"appId": r["app_id"], "names": (r["names"] or "").split(","), "count": r["n"], "likes": r["l"] or 0,
                                    "updatedAt": r["u"]} for r in rows])
        if rest == ["settings"]:
            return self.send(200, all_settings())
        if rest == ["log"]:
            rows = c.execute("SELECT * FROM modlog ORDER BY at DESC LIMIT 300").fetchall()
            return self.send(200, [{"at": r["at"], "actor": public_user(r["actor"]), "action": r["action"], "target": r["target"],
                                    "detail": r["detail"]} for r in rows])
        return self.err(404, "not found")

    def admin_post(self, viewer: str, rest: list, data: dict):
        c = db.conn()
        if len(rest) == 2 and rest[0] == "entries" and rest[1] != "bulk":
            rest, data = ["entries", "bulk"], {**data, "ids": [rest[1]]}
        if rest == ["entries", "bulk"]:
            ids = [str(i) for i in (data.get("ids") or [])][:200]
            actions = {"publish": "status='published'", "hide": "status='hidden'", "pending": "status='pending'", "pin": "pinned=1",
                       "unpin": "pinned=0", "lock": "locked=1", "unlock": "locked=0"}
            # single-entry form: {pinned, locked, status}
            todo = [data["action"]] if data.get("action") else []
            if "pinned" in data:
                todo.append("pin" if data["pinned"] else "unpin")
            if "locked" in data:
                todo.append("lock" if data["locked"] else "unlock")
            if data.get("status") in ("published", "hidden", "pending"):
                todo.append({"published": "publish", "hidden": "hide", "pending": "pending"}[data["status"]])
            for eid in ids:
                e = get_entry(eid)
                if not e:
                    continue
                for action in todo:
                    if action == "delete":
                        delete_entry(eid)
                    elif action in actions:
                        c.execute(f"UPDATE entries SET {actions[action]} WHERE id=?", (eid,))
                    else:
                        continue
                    modlog(viewer, f"entry.{action}", eid, e["title"])
            c.commit()
            return self.send(200, {"ok": True})
        if len(rest) >= 2 and rest[0] == "users":
            sid = rest[1]
            target = c.execute("SELECT * FROM users WHERE steam_id=?", (sid,)).fetchone()
            if not target:
                return self.err(404, "No such user")
            target_admin = is_admin(sid)
            if sid == viewer:
                return self.err(400, "You can't change your own account here")
            if target_admin and viewer not in ADMINS:
                return self.err(403, "Only the site owners (ADMIN_STEAM_IDS) can change another admin")
            if len(rest) == 2:
                if "role" in data:
                    if viewer not in ADMINS:
                        return self.err(403, "Only the site owners (ADMIN_STEAM_IDS) can make admins")
                    if sid in ADMINS:
                        return self.err(400, "This person is an admin through ADMIN_STEAM_IDS")
                    role = "admin" if data["role"] == "admin" else ""
                    c.execute("UPDATE users SET role=? WHERE steam_id=?", (role, sid))
                    modlog(viewer, "user.admin" if role else "user.unadmin", sid, target["name"])
                if "banned" in data:
                    if sid in ADMINS:
                        return self.err(400, "Site owners can't be banned")
                    reason = str(data.get("reason") or "")[:200]
                    c.execute("UPDATE users SET banned=?, ban_reason=? WHERE steam_id=?", (1 if data["banned"] else 0, reason if data["banned"] else None, sid))
                    if data["banned"]:
                        c.execute("DELETE FROM sessions WHERE steam_id=?", (sid,))
                        c.execute("DELETE FROM tokens WHERE steam_id=?", (sid,))
                    modlog(viewer, "user.ban" if data["banned"] else "user.unban", sid, f"{target['name']}{': ' + reason if reason and data['banned'] else ''}")
                c.commit()
                return self.send(200, {"ok": True})
            if rest[2] == "purge":
                what = data.get("what", "all")
                n_posts = n_comments = 0
                if what in ("all", "posts"):
                    ids = [r["id"] for r in c.execute("SELECT id FROM entries WHERE author=?", (sid,))]
                    for eid in ids:
                        delete_entry(eid)
                    n_posts = len(ids)
                if what in ("all", "comments"):
                    for r in c.execute("SELECT entry_id FROM comments WHERE author=?", (sid,)).fetchall():
                        c.execute("UPDATE entries SET comments=MAX(0, comments-1) WHERE id=?", (r["entry_id"],))
                    n_comments = c.execute("DELETE FROM comments WHERE author=?", (sid,)).rowcount
                modlog(viewer, "user.purge", sid, f"{target['name']}: {n_posts} posts, {n_comments} comments")
                c.commit()
                return self.send(200, {"posts": n_posts, "comments": n_comments})
            if rest[2] == "signout":
                c.execute("DELETE FROM sessions WHERE steam_id=?", (sid,))
                n = c.execute("DELETE FROM tokens WHERE steam_id=?", (sid,)).rowcount
                modlog(viewer, "user.signout", sid, f"{target['name']} ({n} devices)")
                c.commit()
                return self.send(200, {"ok": True})
        if len(rest) >= 2 and rest[0] == "reports":
            r = c.execute("SELECT * FROM reports WHERE id=?", (rest[1],)).fetchone()
            if not r:
                return self.err(404, "No such report")
            if len(rest) == 3 and rest[2] == "remove":  # take the reported thing down
                if r["kind"] == "entry":
                    e = get_entry(r["target_id"])
                    if e:
                        modlog(viewer, "entry.delete", e["id"], f"{e['title']} (reported)")
                    delete_entry(r["target_id"])
                else:
                    cm = c.execute("SELECT * FROM comments WHERE id=?", (r["target_id"],)).fetchone()
                    if cm:
                        c.execute("DELETE FROM comments WHERE id=?", (cm["id"],))
                        c.execute("UPDATE entries SET comments=MAX(0, comments-1) WHERE id=?", (cm["entry_id"],))
                        modlog(viewer, "comment.delete", cm["entry_id"], f"{cm['text'][:120]} (reported)")
                c.execute("UPDATE reports SET status='resolved', resolved_by=?, resolved_at=? WHERE target_id=? AND status='open'",
                          (viewer, now_ms(), r["target_id"]))
            else:
                status = "dismissed" if data.get("status") == "dismissed" else "resolved"
                c.execute("UPDATE reports SET status=?, resolved_by=?, resolved_at=? WHERE target_id=? AND status='open'",
                          (status, viewer, now_ms(), r["target_id"]))
                modlog(viewer, f"report.{status}", r["target_id"], r["reason"] or "")
            c.commit()
            return self.send(200, {"ok": True})
        if len(rest) >= 2 and rest[0] == "games":
            app_id = rest[1]
            if len(rest) == 2:
                name = str(data.get("name", "")).strip()[:120]
                if not name:
                    return self.err(400, "Enter a name")
                c.execute("UPDATE entries SET game_name=? WHERE app_id=?", (name, app_id))
                modlog(viewer, "game.rename", app_id, name)
            elif rest[2] == "move":
                to = re.sub(r"\D", "", str(data.get("to", "")))[:20]
                if not to:
                    return self.err(400, "Enter the right Steam app ID")
                name = c.execute("SELECT MAX(game_name) FROM entries WHERE app_id=?", (to,)).fetchone()[0]
                c.execute("UPDATE entries SET app_id=?" + (", game_name=?" if name else "") + " WHERE app_id=?",
                          (to, name, app_id) if name else (to, app_id))
                modlog(viewer, "game.move", app_id, f"posts moved to {to}")
            c.commit()
            return self.send(200, {"ok": True})
        if rest == ["settings"]:
            changed = []
            for key, (kind, default) in SETTINGS.items():
                if key not in data:
                    continue
                value = data[key]
                value = (str(value or "").strip()[:2000] if kind is str else bool(value) if kind is bool else max(0, min(int(value or 0), 100000)))
                if value != setting(key):
                    c.execute("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))
                    changed.append(f"{key} {'set' if value else 'cleared'}" if kind is str else f"{key}={value}")
            if changed:
                modlog(viewer, "settings", "", ", ".join(changed))
            c.commit()
            return self.send(200, all_settings())
        if len(rest) == 2 and rest[0] == "ban":  # older builds
            return self.admin_post(viewer, ["users", rest[1]], {"banned": True})
        return self.err(404, "not found")

    # ---------- PUT / DELETE ----------
    def do_PUT(self):
        try:
            p = self.parts()
            viewer = self.viewer(mutating=True)
            if not viewer:
                return self.err(401, "Sign in with Steam first")
            if len(p) == 3 and p[:2] == ["api", "entries"]:
                e = get_entry(p[2])
                if not e:
                    return self.err(404, "No such entry")
                if not can_edit(e, viewer):
                    return self.err(403, "You can't edit this one")
                data = self.json_body()
                current = {"title": e["title"], "body": e["body"], "kind": e["kind"], "tags": e["tags"], "checklist": e["checklist"],
                           "screenshots": e["screenshots"], "recordings": e["recordings"], "spoiler": e["spoiler"],
                           "spoilerLabel": e["spoiler_label"]}
                fields = clean_fields({**current, **data})  # partial updates keep everything else
                if not is_admin(viewer) and blocked_word(fields["title"], fields["body"]):
                    return self.err(400, f"Your post has a blocked word in it (“{blocked_word(fields['title'], fields['body'])}”).")
                c = db.conn()
                c.execute("INSERT INTO entry_versions VALUES (?,?,?,?)", (e["id"], now_ms(), e["updated_by"] or e["author"],
                          json.dumps({k: e[k] for k in ("title", "body", "kind", "tags", "checklist", "screenshots", "recordings",
                                                         "spoiler", "spoiler_label", "updated_at")})))
                sets = dict(fields)
                if viewer == e["author"] or is_admin(viewer):  # only the poster changes who can edit/copy
                    if data.get("editPolicy") in POLICIES:
                        sets["edit_policy"] = data["editPolicy"]
                    if "editors" in data:
                        sets["editors"] = json.dumps([s for s in data["editors"] if re.fullmatch(r"\d{17}", str(s))][:50])
                    if "allowCopy" in data:
                        sets["allow_copy"] = 1 if data["allowCopy"] else 0
                for k in ("tags", "checklist", "screenshots", "recordings"):
                    sets[k] = json.dumps(sets[k])
                sets.update({"updated_at": now_ms(), "updated_by": viewer})
                c.execute(f"UPDATE entries SET {', '.join(f'{k}=?' for k in sets)} WHERE id=?", list(sets.values()) + [e["id"]])
                c.commit()
                return self.send(200, full(get_entry(e["id"]), viewer))
        except (ValueError, KeyError) as e:
            return self.err(400, str(e))
        return self.err(404, "not found")

    def do_DELETE(self):
        p = self.parts()
        viewer = self.viewer(mutating=True)
        if not viewer:
            return self.err(401, "Sign in with Steam first")
        c = db.conn()
        if len(p) == 3 and p[:2] == ["api", "entries"]:
            e = get_entry(p[2])
            if not e or not (viewer == e["author"] or is_admin(viewer)):
                return self.err(403, "Only the poster can delete this")
            delete_entry(e["id"])
            if viewer != e["author"]:
                modlog(viewer, "entry.delete", e["id"], e["title"])
            c.commit()
            return self.send(200, {"ok": True})
        if len(p) == 3 and p[:2] == ["api", "comments"]:
            row = c.execute("SELECT * FROM comments WHERE id=?", (p[2],)).fetchone()
            e = get_entry(row["entry_id"]) if row else None
            if not row or not (viewer in (row["author"], e["author"]) or is_admin(viewer)):
                return self.err(403, "Not yours to delete")
            c.execute("DELETE FROM comments WHERE id=?", (p[2],))
            c.execute("UPDATE reports SET status='resolved', resolved_by=?, resolved_at=? WHERE target_id=? AND status='open'",
                      (viewer, now_ms(), p[2]))
            if viewer not in (row["author"], e["author"]):
                modlog(viewer, "comment.delete", row["entry_id"], row["text"][:120])
            c.execute("UPDATE entries SET comments=MAX(0, comments-1) WHERE id=?", (row["entry_id"],))
            c.commit()
            return self.send(200, {"ok": True})
        if len(p) == 3 and p[:2] == ["api", "tokens"] and p[2] == "current":
            c.execute("DELETE FROM tokens WHERE hash=?", (h(self.headers.get("Authorization", "")[7:]),)); c.commit()
            return self.send(200, {"ok": True})
        return self.err(404, "not found")


if __name__ == "__main__":
    db.init()
    port = int(os.environ.get("PORT", "8431"))
    print(f"Bookstore on :{port}, data in {DATA}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
