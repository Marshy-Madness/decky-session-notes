"""Users, web sessions, device tokens and pairing codes for the sync server."""
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import threading
import time

DATA = os.environ.get("DATA_DIR", "/data")
ACCOUNTS_PATH = os.path.join(DATA, "accounts.json")
SESSIONS_PATH = os.path.join(DATA, "sessions.json")
LOG_PATH = os.path.join(DATA, "admin_log.json")
LOG_KEEP = 500
SIGNUP_MODES = ("open", "approval", "invite")
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
OWNER_ID = "owner"
lock = threading.RLock()


def _h(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        _, salt, want = (stored or "").split("$")
        dk = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1, dklen=32)
    except ValueError:
        return False
    return hmac.compare_digest(dk.hex(), want)


EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8


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
        self.activity = _load(LOG_PATH, [])
        self._migrate_single_user()

    # ---- storage ----
    def save(self):
        with lock:
            _save(ACCOUNTS_PATH, self.db)

    def _save_sessions(self):
        _save(SESSIONS_PATH, self.sessions)

    # ---- activity log (shown to admins) ----
    def log(self, event: str, text: str, actor: str = None, target: str = None):
        with lock:
            self.activity.append({"at": int(_now() * 1000), "event": event, "text": text, "actor": actor, "target": target})
            del self.activity[:-LOG_KEEP]
            _save(LOG_PATH, self.activity)

    # ---- server-wide settings ----
    def signup_mode(self) -> str:
        """open: anyone gets in. approval: new accounts wait for an admin. invite: only invited Steam accounts."""
        mode = self.db.get("signupMode")
        return mode if mode in SIGNUP_MODES else ("open" if self.db.get("allowSignups") else "approval")

    def setting(self, key: str, default=None):
        return self.db.get("settings", {}).get(key, default)

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

    def by_email(self, email: str):
        email = (email or "").strip().lower()
        return next((u for u in self.db["users"].values() if email and u.get("email") == email), None)

    def public(self, u: dict) -> dict:
        return {"id": u["id"], "name": u.get("name"), "avatar": u.get("avatar", ""), "steamId": u.get("steamId"),
                "role": u.get("role", "user")}

    @staticmethod
    def is_admin(u: dict) -> bool:
        return bool(u) and u.get("role") in ("owner", "admin")

    def list_public(self) -> list:
        return [self.public(u) for u in self.db["users"].values() if self.active(u)]

    @staticmethod
    def active(u: dict) -> bool:
        """New sign-ups wait for the owner's approval (status "pending") before they can do anything."""
        return bool(u) and u.get("status", "active") == "active"

    def pending(self) -> list:
        return [u for u in self.db["users"].values() if u.get("status") == "pending"]

    def approve(self, uid: str) -> bool:
        with lock:
            u = self.db["users"].get(uid)
            if not u or u.get("status") != "pending":
                return False
            u["status"] = "active"
            u["approvedAt"] = int(_now() * 1000)
            self.save()
            return True

    def set_status(self, uid: str, status: str) -> bool:
        """Suspend (or bring back) an account. Suspended people are signed out and can't sign in or sync."""
        with lock:
            u = self.db["users"].get(uid)
            if not u or u.get("role") == "owner" or status not in ("active", "suspended"):
                return False
            u["status"] = status
            self.save()
        if status == "suspended":
            self.sign_out_everywhere(uid)
        return True

    def set_role(self, uid: str, role: str) -> bool:
        with lock:
            u = self.db["users"].get(uid)
            if not u or u.get("role") == "owner" or role not in ("user", "admin"):
                return False
            u["role"] = role
            self.save()
            return True

    def rename(self, uid: str, name: str) -> bool:
        name = (name or "").strip()[:60]
        with lock:
            u = self.db["users"].get(uid)
            if not u or not name:
                return False
            u["name"] = name
            u["customName"] = True  # Steam sign-ins keep this name instead of the Steam one
            self.save()
            return True

    def sign_out_everywhere(self, uid: str, keep_session: str = None):
        """End every website session and unlink every device of one user (except the given session)."""
        with lock:
            keep = _h(keep_session) if keep_session else None
            self.sessions = {k: v for k, v in self.sessions.items() if v["uid"] != uid or k == keep}
            self._save_sessions()
            u = self.db["users"].get(uid)
            if u:
                u["tokens"] = []
                self.save()

    def sign_out_others(self, keep_uid: str) -> int:
        """End everyone's website sessions except one user's. Devices stay linked."""
        with lock:
            before = len(self.sessions)
            self.sessions = {k: v for k, v in self.sessions.items() if v["uid"] == keep_uid}
            self._save_sessions()
            return before - len(self.sessions)

    def session_counts(self) -> dict:
        now = _now()
        out = {}
        for v in self.sessions.values():
            if v["exp"] > now:
                out[v["uid"]] = out.get(v["uid"], 0) + 1
        return out

    # ---- email + password ----
    def signup_email(self, email: str, password: str, name: str):
        """Returns (user, error). The account waits for approval unless the owner opened sign-ups."""
        email = (email or "").strip().lower()
        if self.signup_mode() == "invite" or not self.setting("emailSignups", True):
            return None, "This server isn't taking new email accounts. Ask the owner for an invite."
        if not EMAIL.match(email) or len(email) > 200:
            return None, "Enter a valid email address."
        if len(password or "") < MIN_PASSWORD:
            return None, f"Use a password of at least {MIN_PASSWORD} characters."
        with lock:
            if self.by_email(email):
                return None, "There's already an account with that email. Log in instead."
            uid = "u-" + secrets.token_hex(6)
            user = {"id": uid, "email": email, "password": hash_password(password),
                    "name": (name or "").strip()[:60] or email.split("@")[0], "avatar": "", "steamId": None, "role": "user",
                    "status": "active" if self.signup_mode() == "open" else "pending",
                    "speech": bool(self.setting("speechDefault", False)),
                    "createdAt": int(_now() * 1000), "tokens": [], "webhooks": []}
            self.db["users"][uid] = user
            self.save()
            return user, None

    def login_email(self, email: str, password: str):
        """Returns (user, error)."""
        user = self.by_email(email)
        if not user or not user.get("password") or not check_password(password or "", user["password"]):
            return None, "Wrong email or password"
        if not self.active(user):
            return None, self.inactive_reason(user)
        return user, None

    @staticmethod
    def inactive_reason(user: dict) -> str:
        if user.get("status") == "suspended":
            return "Your account is suspended. Ask the server owner about it."
        return "Thanks! The server owner needs to approve your account before you can sign in."

    def set_login(self, uid: str, email: str = None, password: str = None):
        """Set (or change) the email and/or password someone signs in with. Returns an error or None."""
        with lock:
            user = self.db["users"][uid]
            if email is not None:
                email = email.strip().lower()
                if email and (not EMAIL.match(email) or len(email) > 200):
                    return "Enter a valid email address."
                other = self.by_email(email)
                if other and other["id"] != uid:
                    return "Another account already uses that email."
                if not email and user.get("password") and user.get("role") != "owner" and not user.get("steamId"):
                    return "You need an email to sign in with."
                user["email"] = email or None
            if password is not None:
                if len(password) < MIN_PASSWORD:
                    return f"Use a password of at least {MIN_PASSWORD} characters."
                user["password"] = hash_password(password)
            self.save()
            return None

    def check_owner_password(self, password: str) -> bool:
        """The owner signs in with the password set on the website, or WEB_PASSWORD until one is set."""
        owner = self.get(OWNER_ID)
        if owner and owner.get("password"):
            return check_password(password, owner["password"])
        return hmac.compare_digest(password.encode(), (os.environ.get("WEB_PASSWORD") or "AdminPassword").encode())

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
            else:
                # Invited people and open sign-ups get straight in; everyone else waits for the owner's approval.
                invited = steam_id in self.db.get("invites", [])
                mode = self.signup_mode()
                if mode == "invite" and not invited:
                    return None, "This server is invite-only. Ask the owner to invite your Steam account."
                user = {"id": steam_id, "steamId": steam_id, "role": "user", "createdAt": int(_now() * 1000),
                        "status": "active" if invited or mode == "open" else "pending",
                        "speech": bool(self.setting("speechDefault", False)),
                        "tokens": [], "webhooks": []}
                self.db["users"][steam_id] = user
                if invited:
                    self.db["invites"].remove(steam_id)
            if not user.get("customName"):
                user["name"] = prof.get("name") or user.get("name") or steam_id
            user["avatar"] = prof.get("avatar") or user.get("avatar", "")
            user["lastLogin"] = int(_now() * 1000)
            self.save()
            if not self.active(user):
                return None, self.inactive_reason(user)
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
            if uid in self.db["users"]:
                self.db["users"][uid]["lastLogin"] = int(now * 1000)
                self.save()
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
        u = self.get(s["uid"])
        return u if self.active(u) else None

    def end_session(self, sid: str):
        with lock:
            self.sessions.pop(_h(sid or ""), None)
            self._save_sessions()

    # ---- device tokens ----
    def token_user(self, token: str):
        return self.token_lookup(token)[0]

    def token_lookup(self, token: str):
        """(user, token id) for a device token, or (None, None)."""
        legacy = os.environ.get("API_TOKEN", "")
        if legacy and hmac.compare_digest(token, legacy):
            return self.get(OWNER_ID), "legacy"
        h = _h(token)
        for u in self.db["users"].values():
            for t in u.get("tokens", []):
                if hmac.compare_digest(t["hash"], h):
                    if not self.active(u):
                        return None, None
                    if _now() * 1000 - t.get("lastUsed", 0) > 3600_000:
                        t["lastUsed"] = int(_now() * 1000)
                        self.save()
                    return u, t["id"]
        return None, None

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
