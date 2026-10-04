import asyncio
import hashlib
import json
import os
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


def _q(s: str) -> str:
    return urllib.parse.quote(str(s), safe="")


class Sync:
    """Two-way sync of notes + media with the Session Notes server."""

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

    def _request(self, method: str, path: str, body=None, content_type="application/json"):
        settings = storage.get_settings()
        base = (settings.get("syncUrl") or "").strip().rstrip("/")
        if not base:
            raise RuntimeError("No server address set")
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        req = urllib.request.Request(base + path, data=body, method=method)
        req.add_header("Authorization", f"Bearer {settings.get('syncToken', '').strip()}")
        if body is not None:
            req.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(req, timeout=30, context=_SSL) as resp:
                data = resp.read()
                ctype = resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise RuntimeError("Server rejected the token")
            raise RuntimeError(f"Server error {e.code}")
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

        state["lastSync"] = int(time.time() * 1000)
        state["lastError"] = None
        self._save_state(state)
        return {"pushed": pushed, "pulled": pulled}

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
