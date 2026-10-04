"""Session Notes Bookstore: a public library of game notes, guides and tips.

Anyone can browse. Signing in with Steam lets you post, edit (if allowed), comment and like.
The Deck plugin links to an account with a device code that you approve on the website.
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


def public_user(steam_id: str) -> dict:
    row = db.conn().execute("SELECT steam_id, name, avatar FROM users WHERE steam_id=?", (steam_id,)).fetchone()
    return {"steamId": steam_id, "name": row["name"] if row else steam_id, "avatar": row["avatar"] if row else ""}


def summary(e: dict) -> dict:
    thumb = (e["screenshots"][0].get("thumb") or e["screenshots"][0].get("file")) if e["screenshots"] else None
    return {"id": e["id"], "appId": e["app_id"], "gameName": e["game_name"], "title": e["title"], "firstLine": first_line(e["body"]),
            "kind": e["kind"], "tags": e["tags"], "spoiler": e["spoiler"], "spoilerLabel": e["spoiler_label"] or "",
            "author": public_user(e["author"]), "likes": e["likes"], "comments": e["comments"], "allowCopy": e["allow_copy"],
            "hasScreenshots": bool(e["screenshots"]), "hasVoice": bool(e["recordings"]), "hasChecklist": bool(e["checklist"]),
            "thumb": thumb, "createdAt": e["created_at"], "updatedAt": e["updated_at"]}


def full(e: dict, viewer) -> dict:
    out = summary(e)
    out.update({"body": e["body"], "checklist": e["checklist"], "screenshots": e["screenshots"], "recordings": e["recordings"],
                "editPolicy": e["edit_policy"], "editors": [public_user(s) for s in e["editors"]],
                "updatedBy": public_user(e["updated_by"]) if e["updated_by"] else None})
    out["canEdit"] = can_edit(e, viewer)
    out["isAuthor"] = bool(viewer and viewer == e["author"])
    out["canDelete"] = bool(viewer and (viewer == e["author"] or viewer in ADMINS))
    out["liked"] = bool(viewer and db.conn().execute("SELECT 1 FROM likes WHERE entry_id=? AND steam_id=?", (e["id"], viewer)).fetchone())
    rows = db.conn().execute("SELECT * FROM comments WHERE entry_id=? ORDER BY created_at", (e["id"],)).fetchall()
    out["commentList"] = [{"id": r["id"], "text": r["text"], "createdAt": r["created_at"], "author": public_user(r["author"]),
                           "canDelete": bool(viewer and viewer in (r["author"], e["author"]) or viewer in ADMINS)} for r in rows]
    return out


def can_edit(e: dict, viewer) -> bool:
    if not viewer:
        return False
    if viewer == e["author"] or viewer in ADMINS:
        return True
    if e["edit_policy"] == "anyone":
        return True
    return e["edit_policy"] == "select" and viewer in e["editors"]


def get_entry(entry_id: str):
    row = db.conn().execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
    return db.row_to_entry(row) if row else None


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
            return self.send(200, {"user": public_user(viewer) if viewer else None, "admin": viewer in ADMINS})
        if p[1:] == ["games"]:
            q = self.query().get("q", "").strip().lower()
            rows = c.execute("SELECT app_id, MAX(game_name) AS name, COUNT(*) AS n, MAX(updated_at) AS u FROM entries "
                             "GROUP BY app_id ORDER BY n DESC, u DESC LIMIT 200").fetchall()
            games = [{"appId": r["app_id"], "gameName": r["name"], "count": r["n"], "updatedAt": r["u"]} for r in rows]
            return self.send(200, [g for g in games if not q or q in (g["gameName"] or "").lower() or q == g["appId"]])
        if p[1:] == ["entries"]:
            q = self.query()
            where, args = [], []
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
            sql = "SELECT * FROM entries" + (" WHERE " + " AND ".join(where) if where else "") + f" ORDER BY {order} LIMIT 50 OFFSET ?"
            rows = c.execute(sql, args + [max(0, int(q.get("offset", 0) or 0))]).fetchall()
            return self.send(200, [summary(db.row_to_entry(r)) for r in rows])
        if len(p) == 3 and p[1] == "entries":
            e = get_entry(p[2])
            return self.send(200, full(e, viewer)) if e else self.err(404, "No such entry")
        if len(p) == 4 and p[1] == "entries" and p[3] == "history":
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
        if self.rate_limited(viewer):
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
        if p == ["api", "entries"]:
            data = self.json_body()
            app_id = re.sub(r"\D", "", str(data.get("appId", "")))[:20]
            if not app_id:
                return self.err(400, "A Steam app ID is required")
            fields = clean_fields(data)
            policy = data.get("editPolicy") if data.get("editPolicy") in POLICIES else "owner"
            editors = [s for s in (data.get("editors") or []) if re.fullmatch(r"\d{17}", str(s))][:50]
            eid = uuid.uuid4().hex[:12]
            now = now_ms()
            c.execute("INSERT INTO entries (id, app_id, game_name, title, body, kind, tags, checklist, screenshots, recordings, spoiler, "
                      "spoiler_label, author, edit_policy, editors, allow_copy, created_at, updated_at, updated_by) "
                      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (eid, app_id, str(data.get("gameName") or app_id)[:120], fields["title"], fields["body"], fields["kind"],
                       json.dumps(fields["tags"]), json.dumps(fields["checklist"]), json.dumps(fields["screenshots"]),
                       json.dumps(fields["recordings"]), fields["spoiler"], fields["spoiler_label"], viewer, policy,
                       json.dumps(editors), 1 if data.get("allowCopy", True) else 0, now, now, viewer))
            c.commit()
            return self.send(200, full(get_entry(eid), viewer))
        if len(p) == 4 and p[:2] == ["api", "entries"] and p[3] == "comments":
            e = get_entry(p[2])
            text = str(self.json_body().get("text", "")).strip()[:2000]
            if not e or not text:
                return self.err(400, "Write something first")
            c.execute("INSERT INTO comments VALUES (?,?,?,?,?)", (uuid.uuid4().hex[:12], e["id"], viewer, text, now_ms()))
            c.execute("UPDATE entries SET comments=comments+1 WHERE id=?", (e["id"],))
            c.commit()
            return self.send(200, full(get_entry(e["id"]), viewer))
        if len(p) == 4 and p[:2] == ["api", "entries"] and p[3] == "like":
            e = get_entry(p[2])
            if not e:
                return self.err(404, "No such entry")
            if c.execute("SELECT 1 FROM likes WHERE entry_id=? AND steam_id=?", (e["id"], viewer)).fetchone():
                c.execute("DELETE FROM likes WHERE entry_id=? AND steam_id=?", (e["id"], viewer))
            else:
                c.execute("INSERT INTO likes VALUES (?,?)", (e["id"], viewer))
            c.execute("UPDATE entries SET likes=(SELECT COUNT(*) FROM likes WHERE entry_id=?) WHERE id=?", (e["id"], e["id"]))
            c.commit()
            return self.send(200, full(get_entry(e["id"]), viewer))
        if len(p) == 4 and p[:2] == ["api", "admin"] and p[2] == "ban" and viewer in ADMINS:
            c.execute("UPDATE users SET banned=1 WHERE steam_id=?", (p[3],)); c.commit()
            return self.send(200, {"ok": True})
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
                c = db.conn()
                c.execute("INSERT INTO entry_versions VALUES (?,?,?,?)", (e["id"], now_ms(), e["updated_by"] or e["author"],
                          json.dumps({k: e[k] for k in ("title", "body", "kind", "tags", "checklist", "screenshots", "recordings",
                                                         "spoiler", "spoiler_label", "updated_at")})))
                sets = dict(fields)
                if viewer == e["author"] or viewer in ADMINS:  # only the poster changes who can edit/copy
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
            if not e or not (viewer == e["author"] or viewer in ADMINS):
                return self.err(403, "Only the poster can delete this")
            for t in ("entries WHERE id", "comments WHERE entry_id", "likes WHERE entry_id", "entry_versions WHERE entry_id"):
                c.execute(f"DELETE FROM {t}=?", (e["id"],))
            c.commit()
            return self.send(200, {"ok": True})
        if len(p) == 3 and p[:2] == ["api", "comments"]:
            row = c.execute("SELECT * FROM comments WHERE id=?", (p[2],)).fetchone()
            e = get_entry(row["entry_id"]) if row else None
            if not row or not (viewer in (row["author"], e["author"]) or viewer in ADMINS):
                return self.err(403, "Not yours to delete")
            c.execute("DELETE FROM comments WHERE id=?", (p[2],))
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
