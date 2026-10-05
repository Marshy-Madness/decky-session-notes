import asyncio
import hashlib
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

import decky
import storage

STATE_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "sync_state.json")
CHANGE_DELAY_SEC = 20  # after a local edit, wait this long for more edits before syncing

# Decky's bundled Python may not find the system CA store on its own.
_CA_FILES = ["/etc/ssl/certs/ca-certificates.crt", "/etc/ca-certificates/extracted/tls-ca-bundle.pem"]
_SSL = ssl.create_default_context(cafile=next((f for f in _CA_FILES if os.path.exists(f)), None))


def clean_url(raw) -> str:
    """Tidy a typed server address: add https:// if missing, fix 'https:/x' or 'https:///x', drop spaces."""
    url = re.sub(r"\s+", "", str(raw or "")).replace("\\", "/").rstrip("/")
    if not url:
        return ""
    m = re.match(r"^(https?)(?::/*|//+)(.*)$", url, re.I)
    if m:
        scheme, rest = m.group(1).lower(), m.group(2)
    else:  # no scheme: plain http for a LAN IP/localhost, https for a domain
        rest = url.lstrip("/")
        local = re.match(r"^(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?(/|$)", rest)
        scheme = "http" if local else "https"
    if not rest or rest.startswith(("/", "?", "#")):
        raise RuntimeError(f"Server address '{raw}' has no host name, e.g. https://steamnotes.example.com")
    return f"{scheme}://{rest}"


def _q(s: str) -> str:
    return urllib.parse.quote(str(s), safe="")


class Sync:
    """Two-way sync of notes + media with the Desk of Madness server."""

    def __init__(self):
        self.dirty_at = time.time()  # sync once soon after boot
        self.last_poll = 0.0
        self.running = False
        self.task = None
        storage.on_change(self.mark_dirty)

    def mark_dirty(self):
        self.dirty_at = time.time()

    # ---- state ----

    def _state(self) -> dict:
        if os.path.exists(STATE_PATH):
            with open(STATE_PATH) as f:
                return json.load(f)
        return {"games": {}, "media": {}, "lastSync": None, "lastError": None}

    def _save_state(self, state: dict):
        with open(STATE_PATH, "w") as f:
            json.dump(state, f, indent=2)

    def status(self) -> dict:
        s = self._state()
        return {"lastBackup": s.get("lastSync"), "lastError": s.get("lastError"), "running": self.running,
                "pending": self.dirty_at > 0}

    # ---- http ----

    def _request(self, method: str, path: str, body=None, content_type="application/json", timeout=30):
        settings = storage.get_settings()
        base = clean_url(settings.get("syncUrl"))
        if not base:
            raise RuntimeError("No server address set")
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        req = urllib.request.Request(base + path, data=body, method=method)
        req.add_header("Authorization", f"Bearer {settings.get('syncToken', '').strip()}")
        if body is not None:
            req.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=_SSL) as resp:
                data = resp.read()
                ctype = resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise RuntimeError("Server rejected the token")
            try:
                message = json.loads(e.read()).get("error")
            except Exception:
                message = None
            raise RuntimeError(message if message and e.code in (403, 413, 422, 429, 502) else f"Server error {e.code}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"Can't reach server: {e.reason}")
        return json.loads(data or b"null") if ctype.startswith("application/json") else data

    # ---- sync (blocking; runs in a thread) ----

    @staticmethod
    def _file_hash(appid: str):
        path = os.path.join(storage.DATA_DIR, f"{appid}.json")
        if not os.path.exists(path):
            return None
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()

    def _sync(self) -> dict:
        state = self._state()
        if any(not isinstance(v, dict) for v in state.get("games", {}).values()):
            state["games"] = {}  # old backup-only format
        known = state["games"]
        remote = {str(g["appId"]): g.get("rev") for g in self._request("GET", "/api/games") or []}
        local = {n[:-5] for n in os.listdir(storage.DATA_DIR) if n.endswith(".json")} if os.path.isdir(storage.DATA_DIR) else set()

        pushed = pulled = 0
        for appid in sorted(local | set(remote)):
            k = known.get(appid, {})
            local_changed = appid in local and self._file_hash(appid) != k.get("hash")
            remote_changed = appid in remote and remote[appid] != k.get("rev")
            if not (local_changed or remote_changed):
                continue
            mine = storage.load_game(appid)
            mine.pop("summary", None)
            resp = self._request("POST", f"/api/sync/{_q(appid)}", mine)
            if storage.apply_synced(resp["game"]):
                pulled += 1
            if local_changed:
                pushed += 1
            known[appid] = {"hash": self._file_hash(appid), "rev": resp["rev"]}
            self._sync_media(appid, resp["game"], state)

        if self._sync_shared():
            pulled += 1
        self._refresh_account(state)
        state["lastSync"] = int(time.time() * 1000)
        state["lastError"] = None
        self._save_state(state)
        return {"pushed": pushed, "pulled": pulled}

    def _sync_shared(self) -> bool:
        """Cache notes shared with you (and their media) so they can be read offline."""
        try:
            incoming = self._request("GET", "/api/shared") or []
        except RuntimeError as e:
            if "404" in str(e):  # older server without sharing
                return False
            raise
        cache = {}
        for item in incoming:
            appid = str(item["appId"])
            note = item["note"]
            local_dir = storage.media_dir(appid)
            for media in note.get("screenshots", []) + note.get("recordings", []):
                for key in ("file", "thumb"):
                    name = media.get(key)
                    if not name:
                        continue
                    local = f"sh-{item['shareId']}-{os.path.basename(name)}"
                    dest = os.path.join(local_dir, local)
                    if not os.path.exists(dest):
                        data = self._request("GET", f"/api/shared/media/{_q(item['shareId'])}/{_q(name)}")
                        with open(dest, "wb") as f:
                            f.write(data)
                    media[key] = local
            cache.setdefault(appid, []).append({k: item[k] for k in ("shareId", "fromId", "fromName", "gameName", "note")})
        if cache == storage.load_shared():
            return False
        storage.save_shared(cache)
        return True

    # ---- speech to text (the server owner turns it on per account) ----

    def _refresh_account(self, state: dict) -> bool:
        try:
            account = self._request("GET", "/api/account") or {}
            state["speech"] = bool(account.get("speech"))
            # What the server's admins set for everyone: the starting Desk, the Workshop address, allowed Scrolls.
            state["account"] = {k: account.get(k) for k in ("deskDefaults", "workshopUrl", "allowedScrolls")}
        except RuntimeError as e:
            if "404" not in str(e):  # older server: no speech
                raise
            state["speech"] = False
        return state["speech"]

    def speech_allowed(self, refresh: bool = False) -> bool:
        """Cached from the last sync; refresh asks the server now (blocking)."""
        state = self._state()
        if refresh and (storage.get_settings().get("syncUrl") or "").strip():
            try:
                self._refresh_account(state)
                self._save_state(state)
            except RuntimeError:
                pass
        return bool(state.get("speech"))

    def account_info(self) -> dict:
        """The server's settings for this account, as of the last sync ({} without a server)."""
        return self._state().get("account") or {}

    def transcribe(self, path: str, appid: str = "", game: str = "") -> str:
        """Send a WAV clip to the server and get the words back (blocking)."""
        with open(path, "rb") as f:
            audio = f.read()
        lang = storage.get_settings().get("speechLanguage") or ""
        q = urllib.parse.urlencode({"appId": appid, "game": game, "lang": lang})
        return (self._request("POST", f"/api/transcribe?{q}", audio, "audio/wav", timeout=180) or {}).get("text", "")

    def transcribe_media(self, appid: str, file: str) -> str:
        """Transcribe a stored voice note on the server (uploading it first if needed)."""
        path = os.path.join(storage.media_dir(appid), os.path.basename(file))
        with open(path, "rb") as f:
            self._request("PUT", f"/api/media/{_q(appid)}/{_q(file)}", f.read(), "application/octet-stream")
        return (self._request("POST", f"/api/transcribe/{_q(appid)}/{_q(file)}", {}, timeout=180) or {}).get("text", "")

    # ---- pairing & sharing (blocking helpers) ----

    # ---- reader view (the server makes the page and keeps it, so it opens instantly next time) ----

    def reader_page(self, url: str, refresh: bool = False) -> dict:
        return self._request("GET", f"/api/reader?url={_q(url)}" + ("&refresh=1" if refresh else ""), timeout=45)

    def reader_settings(self):
        """The server's reader cache settings, or None if this account isn't an admin there."""
        try:
            return self._request("GET", "/api/admin/reader")
        except RuntimeError as e:
            if "404" in str(e) or "403" in str(e):
                return None
            raise

    def set_reader_cache_days(self, days: int) -> dict:
        st = self._request("POST", "/api/admin/settings", {"readerCacheDays": int(days)})
        return {k: st.get(k) for k in ("readerCacheDays", "readerCacheChoices", "readerCache")}

    def clear_reader_cache(self) -> dict:
        return self._request("POST", "/api/admin/reader/clear", {})

    def pair(self, code: str) -> dict:
        resp = self._request("POST", "/api/pair", {"code": code, "label": "Steam Deck"})
        settings = storage.get_settings()
        settings["syncToken"] = resp["token"]
        storage.save_settings(settings)
        return resp["user"]

    def users(self) -> list:
        return self._request("GET", "/api/users") or []

    def note_shares(self, appid: str, note_id: str) -> list:
        return [s for s in self._request("GET", f"/api/shares?appId={_q(appid)}") or [] if s["noteId"] == note_id]

    def share(self, appid: str, note_id: str, to: str) -> dict:
        self._sync()  # the server needs the latest copy of the note first
        return self._request("POST", "/api/shares", {"appId": appid, "noteId": note_id, "to": to})

    def unshare(self, share_id: str):
        return self._request("DELETE", f"/api/shares/{_q(share_id)}")

    def _sync_media(self, appid: str, game: dict, state: dict):
        local_dir = storage.media_dir(appid)
        uploaded = set(state["media"].get(appid, []))
        on_server = set(self._request("GET", f"/api/media/{_q(appid)}") or [])
        for fname in os.listdir(local_dir):
            if fname not in on_server and fname not in uploaded:
                with open(os.path.join(local_dir, fname), "rb") as f:
                    self._request("PUT", f"/api/media/{_q(appid)}/{_q(fname)}", f.read(), "application/octet-stream")
            uploaded.add(fname)
        for fname in storage.referenced_media(game) & on_server:
            dest = os.path.join(local_dir, os.path.basename(fname))
            if not os.path.exists(dest):
                data = self._request("GET", f"/api/media/{_q(appid)}/{_q(fname)}")
                with open(dest, "wb") as f:
                    f.write(data)
                uploaded.add(fname)
        state["media"][appid] = sorted(uploaded)

    # ---- async api ----

    async def sync(self):
        if self.running:
            raise RuntimeError("A sync is already running")
        self.running = True
        self.dirty_at = 0.0
        self.last_poll = time.time()
        try:
            result = await asyncio.to_thread(self._sync)
        except Exception as e:
            state = self._state()
            state["lastError"] = str(e)
            self._save_state(state)
            raise
        finally:
            self.running = False
        if result["pulled"]:
            await decky.emit("data_changed")
        return result

    async def test(self):
        def check():
            self._request("GET", "/api/health")
            games = self._request("GET", "/api/games")  # needs a valid token
            return {"ok": True, "games": len(games or [])}
        return await asyncio.to_thread(check)

    @staticmethod
    def interval_minutes(settings: dict) -> int:
        """How often to check the website. 0 = manual only (older builds used an on/off toggle)."""
        if "syncInterval" in settings:
            return int(settings.get("syncInterval") or 0)
        return 1 if settings.get("autoBackup") else 0

    async def auto_loop(self):
        while True:
            await asyncio.sleep(10)
            settings = storage.get_settings()
            minutes = self.interval_minutes(settings)
            if not minutes or not settings.get("syncUrl") or self.running:
                continue
            now = time.time()
            changed = self.dirty_at and now - self.dirty_at > CHANGE_DELAY_SEC
            if changed or now - self.last_poll > minutes * 60:
                try:
                    await self.sync()
                except Exception as e:
                    self.last_poll = now
                    decky.logger.info("Sync skipped: %s", e)
