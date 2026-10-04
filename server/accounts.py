"""Users, web sessions, device tokens and pairing codes for the sync server."""
import hashlib
import hmac
import json
import os
import secrets
import shutil
import threading
import time

DATA = os.environ.get("DATA_DIR", "/data")
ACCOUNTS_PATH = os.path.join(DATA, "accounts.json")
SESSIONS_PATH = os.path.join(DATA, "sessions.json")
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
OWNER_ID = "owner"
lock = threading.RLock()


def _h(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _now() -> float:
    return time.time()


def _load(path: str, default):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default


def _save(path: str, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w") as f:
        json.dump(data, f, indent=2)
    os.replace(path + ".tmp", path)


class Accounts:
    def __init__(self):
        self.db = _load(ACCOUNTS_PATH, {"users": {}, "invites": [], "allowSignups": False})
        sessions = _load(SESSIONS_PATH, {})
        # Older builds stored {hash: expiry}; those sessions belonged to the owner.
        self.sessions = {k: (v if isinstance(v, dict) else {"uid": OWNER_ID, "exp": v}) for k, v in sessions.items()}
        self.pairing = {}  # code -> {uid, exp}
        self._migrate_single_user()

    # ---- storage ----
    def save(self):
        with lock:
            _save(ACCOUNTS_PATH, self.db)

    def _save_sessions(self):
        _save(SESSIONS_PATH, self.sessions)

    def user_dir(self, uid: str) -> str:
        return os.path.join(DATA, "users", uid)

    def _migrate_single_user(self):
        """First multi-user start: the existing notes become the owner's."""
        with lock:
            if OWNER_ID not in self.db["users"]:
                self.db["users"][OWNER_ID] = {"id": OWNER_ID, "name": "Owner", "avatar": "", "role": "owner",
                                              "steamId": os.environ.get("OWNER_STEAM_ID") or None,
                                              "createdAt": int(_now() * 1000), "tokens": [], "webhooks": []}
                self.save()
            dest = self.user_dir(OWNER_ID)
            for name in ("games", "media", "note_history", "history"):
                src = os.path.join(DATA, name)
                if os.path.isdir(src) and not os.path.exists(os.path.join(dest, name)):
                    os.makedirs(dest, exist_ok=True)
                    shutil.move(src, os.path.join(dest, name))

    # ---- users ----
    def get(self, uid: str):
        return self.db["users"].get(uid)

    def by_steam(self, steam_id: str):
        return next((u for u in self.db["users"].values() if u.get("steamId") == steam_id), None)

    def public(self, u: dict) -> dict:
        return {"id": u["id"], "name": u.get("name"), "avatar": u.get("avatar", ""), "steamId": u.get("steamId"),
                "role": u.get("role", "user")}

    def list_public(self) -> list:
        return [self.public(u) for u in self.db["users"].values()]

    # ---- speech to text (runs on the server's GPU, so the owner hands it out per user) ----
    def speech_allowed(self, u: dict) -> bool:
        return bool(u) and (u.get("role") == "owner" or bool(u.get("speech")))

    def set_speech(self, uid: str, allowed: bool) -> bool:
        with lock:
            u = self.db["users"].get(uid)
            if not u or u.get("role") == "owner":
                return False
            u["speech"] = bool(allowed)
            self.save()
            return True

    def login_steam(self, steam_id: str, prof: dict, link_uid: str = None):
        """Returns (user, error). Links Steam to link_uid if given, else finds or creates the user."""
        with lock:
            existing = self.by_steam(steam_id)
            if link_uid:
                if existing and existing["id"] != link_uid:
                    return None, "That Steam account already belongs to another user."
                user = self.db["users"][link_uid]
                user["steamId"] = steam_id
            elif existing:
                user = existing
            elif self.db.get("allowSignups") or steam_id in self.db.get("invites", []):
                uid = steam_id
                user = {"id": uid, "steamId": steam_id, "role": "user", "createdAt": int(_now() * 1000),
                        "tokens": [], "webhooks": []}
                self.db["users"][uid] = user
                if steam_id in self.db.get("invites", []):
                    self.db["invites"].remove(steam_id)
            else:
                return None, "This server is invite-only. Ask the owner to invite your Steam account."
            user["name"] = prof.get("name") or user.get("name") or steam_id
            user["avatar"] = prof.get("avatar") or user.get("avatar", "")
            self.save()
            return user, None

    def remove_user(self, uid: str):
        with lock:
            if uid == OWNER_ID or uid not in self.db["users"]:
                return False
            del self.db["users"][uid]
            self.sessions = {k: v for k, v in self.sessions.items() if v["uid"] != uid}
            self._save_sessions()
            self.save()
            d = self.user_dir(uid)
            if os.path.isdir(d):
                shutil.move(d, os.path.join(DATA, "removed-users", f"{uid}-{int(_now())}"))
            return True

    # ---- web sessions ----
    def new_session(self, uid: str) -> str:
        sid = secrets.token_urlsafe(32)
        with lock:
            now = _now()
            self.sessions = {k: v for k, v in self.sessions.items() if v["exp"] > now}
            self.sessions[_h(sid)] = {"uid": uid, "exp": now + SESSION_DAYS * 86400}
            self._save_sessions()
        return sid

    def session_user(self, sid: str):
        if not sid:
            return None
        s = self.sessions.get(_h(sid))
        if not s or s["exp"] < _now():
            return None
        return self.get(s["uid"])

    def end_session(self, sid: str):
        with lock:
            self.sessions.pop(_h(sid or ""), None)
            self._save_sessions()

    # ---- device tokens ----
    def token_user(self, token: str):
        legacy = os.environ.get("API_TOKEN", "")
        if legacy and hmac.compare_digest(token, legacy):
            return self.get(OWNER_ID)
        h = _h(token)
        for u in self.db["users"].values():
            for t in u.get("tokens", []):
                if hmac.compare_digest(t["hash"], h):
                    if _now() * 1000 - t.get("lastUsed", 0) > 3600_000:
                        t["lastUsed"] = int(_now() * 1000)
                        self.save()
                    return u
        return None

    def new_pairing_code(self, uid: str) -> dict:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I
        code = "".join(secrets.choice(alphabet) for _ in range(3)) + "-" + "".join(secrets.choice(alphabet) for _ in range(3))
        exp = _now() + 600
        with lock:
            self.pairing = {k: v for k, v in self.pairing.items() if v["exp"] > _now()}
            self.pairing[code] = {"uid": uid, "exp": exp}
        return {"code": code, "expiresAt": int(exp * 1000)}

    def redeem_pairing_code(self, code: str, label: str):
        code = (code or "").strip().upper()
        if len(code) == 6:
            code = code[:3] + "-" + code[3:]
        with lock:
            p = self.pairing.pop(code, None)
            if not p or p["exp"] < _now():
                return None, None
            user = self.db["users"][p["uid"]]
            token = secrets.token_urlsafe(32)
            user.setdefault("tokens", []).append({"id": secrets.token_hex(6), "hash": _h(token),
                                                  "label": (label or "Device")[:60], "createdAt": int(_now() * 1000),
                                                  "lastUsed": int(_now() * 1000)})
            self.save()
            return user, token

    def revoke_token(self, uid: str, token_id: str) -> bool:
        with lock:
            user = self.db["users"][uid]
            before = len(user.get("tokens", []))
            user["tokens"] = [t for t in user.get("tokens", []) if t["id"] != token_id]
            self.save()
            return len(user["tokens"]) < before
