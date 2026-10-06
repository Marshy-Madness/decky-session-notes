"""Client for the public Madness Workshop (browse, link account, publish, copy, like, comment)."""
import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid

import decky
import storage
from sync import _SSL, clean_url

DEFAULT_URL = "https://workshop.marshymadness.com"
OLD_URL = "https://bookstore.marshymadness.com"
SYNC_STATE = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "sync_state.json")
CACHE_DIR = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "bookstore_cache")
MIME = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif",
        "wav": "audio/wav", "webm": "audio/webm", "ogg": "audio/ogg", "m4a": "audio/mp4", "mp3": "audio/mpeg"}


class Workshop:
    def base(self) -> str:
        # Your own setting, else the address your sync server's admin set, else the public Workshop.
        url = clean_url(storage.get_settings().get("bookstoreUrl") or self.server_default() or DEFAULT_URL)
        return DEFAULT_URL if url == OLD_URL else url  # the Bookstore's old address

    @staticmethod
    def server_default() -> str:
        try:
            with open(SYNC_STATE) as f:
                return (json.load(f).get("account") or {}).get("workshopUrl") or ""
        except (OSError, ValueError):
            return ""

    def _request(self, method: str, path: str, body=None, raw: bytes = None, auth: bool = True):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base() + path, data=data, method=method)
        req.add_header("Content-Type", "application/octet-stream" if raw is not None else "application/json")
        token = storage.get_settings().get("bookstoreToken")
        if auth and token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=30, context=_SSL) as resp:
                payload = resp.read()
                ctype = resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read()).get("error")
            except Exception:
                msg = None
            raise RuntimeError(msg or f"Workshop error {e.code}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"Can't reach the Workshop: {e.reason}")
        return json.loads(payload or b"null") if ctype.startswith("application/json") else payload

    # ---- browsing ----
    def games(self, q: str = "") -> list:
        return self._request("GET", f"/api/games?q={urllib.parse.quote(q)}")

    def entries(self, params: dict) -> list:
        clean = {k: v for k, v in params.items() if v not in (None, "", [])}
        return self._request("GET", "/api/entries?" + urllib.parse.urlencode(clean))

    def entry(self, entry_id: str) -> dict:
        return self._request("GET", f"/api/entries/{urllib.parse.quote(entry_id)}")

    def media(self, file: str):
        """A Workshop image or recording as a data URL, cached on disk (files never change)."""
        name = os.path.basename(file)
        os.makedirs(CACHE_DIR, exist_ok=True)
        path = os.path.join(CACHE_DIR, name)
        if not os.path.exists(path):
            data = self._request("GET", f"/api/media/{urllib.parse.quote(name)}", auth=False)
            with open(path, "wb") as f:
                f.write(data)
        with open(path, "rb") as f:
            mime = MIME.get(name.rsplit(".", 1)[-1].lower(), "application/octet-stream")
            return f"data:{mime};base64,{base64.b64encode(f.read()).decode()}"

    # ---- account linking (device code you approve on the website) ----
    def me(self):
        return self._request("GET", "/api/me")

    def start_link(self) -> dict:
        return self._request("POST", "/api/device/start", {"label": "Steam Deck"}, auth=False)

    def poll_link(self, device_code: str) -> dict:
        resp = self._request("POST", "/api/device/poll", {"deviceCode": device_code}, auth=False)
        if resp.get("status") == "linked":
            settings = storage.get_settings()
            settings["bookstoreToken"] = resp["token"]
            settings["bookstoreUser"] = resp["user"]
            storage.save_settings(settings)
            return {"status": "linked", "user": resp["user"]}
        return {"status": resp.get("status", "pending")}

    def unlink(self):
        try:
            self._request("DELETE", "/api/tokens/current")
        except RuntimeError:
            pass
        settings = storage.get_settings()
        settings.pop("bookstoreToken", None)
        settings.pop("bookstoreUser", None)
        storage.save_settings(settings)

    # ---- interacting ----
    def like(self, entry_id: str) -> dict:
        return self._request("POST", f"/api/entries/{urllib.parse.quote(entry_id)}/like")

    def comment(self, entry_id: str, text: str) -> dict:
        return self._request("POST", f"/api/entries/{urllib.parse.quote(entry_id)}/comments", {"text": text})

    def users(self, q: str) -> list:
        return self._request("GET", f"/api/users?q={urllib.parse.quote(q)}")

    def update(self, entry_id: str, fields: dict) -> dict:
        return self._request("PUT", f"/api/entries/{urllib.parse.quote(entry_id)}", fields)

    def _upload(self, appid: str, file: str, thumb: bool = False) -> str:
        path = os.path.join(storage.media_dir(appid), os.path.basename(file))
        ext = file.rsplit(".", 1)[-1].lower()
        with open(path, "rb") as f:
            q = f"?ext={ext}" + ("&thumb=1" if thumb else "")
            return self._request("POST", "/api/uploads" + q, raw=f.read())["file"]

    def publish(self, appid: str, note_id: str, options: dict) -> dict:
        """Upload a local note (with its media) as a new Workshop entry, or update the one it was published as."""
        game = storage.load_game(appid)
        note = next((n for n in game.get("notes", []) if n["id"] == note_id), None)
        if not note:
            raise RuntimeError("Note not found")
        shots = []
        for s in note.get("screenshots", []):
            item = {"id": s["id"], "file": self._upload(appid, s["file"])}
            if s.get("thumb"):
                item["thumb"] = self._upload(appid, s["thumb"], thumb=True)
            shots.append(item)
        recs = [{"id": r["id"], "file": self._upload(appid, r["file"]), **({"durationSec": r["durationSec"]} if r.get("durationSec") else {})}
                for r in note.get("recordings", [])]
        payload = {"appId": appid, "gameName": game.get("name") or appid, "title": note["title"], "body": note.get("body", ""),
                   "kind": options.get("kind") or note.get("kind") or "note", "tags": note.get("tags", []),
                   "checklist": [{"id": c["id"], "text": c["text"]} for c in note.get("checklist") or []],
                   "screenshots": shots, "recordings": recs, "spoiler": bool(options.get("spoiler")),
                   "spoilerLabel": options.get("spoilerLabel", ""), "editPolicy": options.get("editPolicy", "owner"),
                   "editors": options.get("editors", []), "allowCopy": bool(options.get("allowCopy", True))}
        entry = None
        if note.get("bookstoreId"):
            try:
                entry = self.update(note["bookstoreId"], payload)
            except RuntimeError as e:
                if "No such entry" not in str(e):
                    raise
        if entry is None:
            entry = self._request("POST", "/api/entries", payload)
            note["bookstoreId"] = entry["id"]
            storage.save_note(appid, note)
        return entry

    def copy(self, entry_id: str, appid: str) -> dict:
        """Copy an entry into your own notes for that game (your copy is private to you)."""
        e = self.entry(entry_id)
        if not e.get("allowCopy"):
            raise RuntimeError("The poster turned off copying for this one")
        local = storage.media_dir(appid)

        def fetch(name: str, thumb: bool = False) -> str:
            ext = name.rsplit(".", 1)[-1]
            new = f"{uuid.uuid4()}{'.thumb' if thumb else ''}.{ext}"
            data = self._request("GET", f"/api/media/{urllib.parse.quote(name)}", auth=False)
            with open(os.path.join(local, new), "wb") as f:
                f.write(data)
            return new

        shots = []
        for s in e.get("screenshots", []):
            item = {"id": str(uuid.uuid4()), "file": fetch(s["file"]), "takenAt": e["createdAt"]}
            if s.get("thumb"):
                item["thumb"] = fetch(s["thumb"], True)
            shots.append(item)
        recs = [{"id": str(uuid.uuid4()), "file": fetch(r["file"]), "createdAt": e["createdAt"],
                 **({"durationSec": r["durationSec"]} if r.get("durationSec") else {})} for r in e.get("recordings", [])]
        game = storage.load_game(appid)
        if game.get("name") in (None, appid):
            storage.ensure_game(appid, e.get("gameName") or appid)
        note = {"id": str(uuid.uuid4()), "folderId": None, "title": e["title"], "body": e.get("body", ""), "tags": e.get("tags", []),
                "screenshots": shots, "recordings": recs, "pinned": False, "createdAt": 0, "updatedAt": 0, "launchNumber": None,
                "kind": e.get("kind", "note"), "spoiler": bool(e.get("spoiler")),
                "checklist": [{"id": str(uuid.uuid4()), "text": c["text"], "done": False} for c in e.get("checklist", [])] or None,
                "source": {"type": "bookstore", "id": e["id"], "author": e["author"]["name"]}}
        if not note["checklist"]:
            note.pop("checklist")
        saved = storage.save_note(appid, note)
        self.copied("entries", e["id"])
        return saved

    def copied(self, kind: str, item_id: str):
        """Counts the save for 🔥 Trending. Best effort: no network, no count."""
        try:
            self._request("POST", f"/api/{kind}/{urllib.parse.quote(item_id)}/copied", {})
        except RuntimeError:
            pass

    # ⭐ Featured, 🔥 Trending, 📦 Note Packs, 🧰 My Workshop
    def featured(self, app_id: str = "") -> dict:
        return self._request("GET", "/api/featured" + (f"?appId={urllib.parse.quote(app_id)}" if app_id else ""))

    def trending(self, app_id: str = "") -> list:
        return self._request("GET", "/api/trending" + (f"?appId={urllib.parse.quote(app_id)}" if app_id else ""))

    def packs(self, params: dict) -> list:
        return self._request("GET", "/api/packs?" + urllib.parse.urlencode({k: v for k, v in params.items() if v}))

    def pack(self, pack_id: str) -> dict:
        return self._request("GET", f"/api/packs/{urllib.parse.quote(pack_id)}")

    def mine(self) -> dict:
        return self._request("GET", "/api/mine")

    def copy_pack(self, pack_id: str) -> dict:
        """Copies every post in a Note Pack into its own game's notes; posts you already copied are skipped."""
        pk = self.pack(pack_id)
        done = skipped = 0
        for e in pk.get("entries", []):
            game = storage.load_game(e["appId"])
            if any((n.get("source") or {}).get("id") == e["id"] for n in game.get("notes", [])):
                skipped += 1
                continue
            try:
                self.copy(e["id"], e["appId"])
                done += 1
            except RuntimeError:
                skipped += 1
        self.copied("packs", pack_id)
        return {"copied": done, "skipped": skipped, "title": pk.get("title")}

    # 📜 Scrolls
    def scrolls(self, params: dict) -> list:
        return self._request("GET", "/api/scrolls?" + urllib.parse.urlencode({k: v for k, v in params.items() if v}))

    def scroll(self, scroll_id: str) -> dict:
        return self._request("GET", f"/api/scrolls/{urllib.parse.quote(scroll_id)}")

    def download_scroll(self, scroll_id: str) -> dict:
        """The whole Scroll (code included), as the Workshop published it. Checked by scrolls.install."""
        return self._request("GET", f"/api/scrolls/{urllib.parse.quote(scroll_id)}/download?install=1", auth=False)
