import base64
import glob
import json
import os
import shutil
import time
import uuid

import decky
import merge

DATA_DIR = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "games")
MEDIA_DIR = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "media")
SETTINGS_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
SCHEMA_VERSION = 2
history = merge.NoteHistory(os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "note_history"))


def _now_ms() -> int:
    return int(time.time() * 1000)


def _game_path(appid: str) -> str:
    os.makedirs(DATA_DIR, exist_ok=True)
    return os.path.join(DATA_DIR, f"{appid}.json")


def media_dir(appid: str) -> str:
    path = os.path.join(MEDIA_DIR, str(appid))
    os.makedirs(path, exist_ok=True)
    return path


def _empty_game(appid: str) -> dict:
    return {
        "version": SCHEMA_VERSION,
        "appId": str(appid),
        "name": str(appid),
        "launchCount": 0,
        "firstSeen": _now_ms(),
        "lastLaunched": None,
        "playtimeSeconds": 0,
        "folders": [],
        "notes": [],
        "sessions": [],
    }


def _migrate_v1(appid: str):
    """Fold the old games/<appid>/<profile>.json layout into one v2 record."""
    old_dir = os.path.join(DATA_DIR, str(appid))
    if not os.path.isdir(old_dir):
        return None
    game = _empty_game(appid)
    for filename in os.listdir(old_dir):
        if filename == "profiles.json" or not filename.endswith(".json"):
            continue
        with open(os.path.join(old_dir, filename), "r") as f:
            data = json.load(f)
        for old in data.get("notes", []):
            body = old.get("body", "")
            first, _, rest = body.partition("\n")
            ts = old.get("timestamp", _now_ms())
            game["notes"].append({
                "id": old.get("id", str(uuid.uuid4())),
                "folderId": None,
                "title": first[:80] or "Untitled",
                "body": rest if len(first) <= 80 else body,
                "tags": old.get("tags", []),
                "screenshots": [],
                "recordings": [],
                "pinned": old.get("pinned", False),
                "createdAt": ts,
                "updatedAt": ts,
                "launchNumber": None,
            })
        for s in data.get("sessions", []):
            game["sessions"].append({"id": s.get("id"), "start": s.get("start"), "end": s.get("end")})
    shutil.move(old_dir, old_dir + ".v1-backup")
    _save_game(game)
    return game


def load_game(appid: str) -> dict:
    path = _game_path(appid)
    if os.path.exists(path):
        with open(path, "r") as f:
            return json.load(f)
    return _migrate_v1(appid) or _empty_game(appid)


_dirty_listeners = []


def on_change(fn):
    _dirty_listeners.append(fn)


def _save_game(game: dict, notify: bool = True):
    if notify:
        for fn in _dirty_listeners:
            fn()
    path = _game_path(game["appId"])
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(game, f, indent=2)
    os.replace(tmp, path)


def _summary(game: dict) -> dict:
    notes = game.get("notes", [])
    return {
        "appId": game["appId"],
        "name": game.get("name", game["appId"]),
        "launchCount": game.get("launchCount", 0),
        "lastLaunched": game.get("lastLaunched"),
        "firstSeen": game.get("firstSeen"),
        "playtimeSeconds": game.get("playtimeSeconds", 0),
        "noteCount": len(notes),
        "folderCount": len(game.get("folders", [])),
        "lastEdited": max((n.get("updatedAt", 0) for n in notes), default=None),
        "firstNoteCreated": min((n.get("createdAt", 0) for n in notes), default=None),
        "leftOff": game.get("leftOff") if (game.get("leftOff") or {}).get("text") else None,
    }


# ---------- games / launches ----------

def list_games() -> list:
    if not os.path.isdir(DATA_DIR):
        return []
    appids = set()
    for entry in os.listdir(DATA_DIR):
        if entry.endswith(".json"):
            appids.add(entry[:-5])
        elif os.path.isdir(os.path.join(DATA_DIR, entry)) and not entry.endswith(".v1-backup"):
            appids.add(entry)
    return [_summary(load_game(a)) for a in appids]


def get_game(appid: str) -> dict:
    game = load_game(appid)
    game["summary"] = _summary(game)
    return game


def record_launch(appid: str, name: str) -> dict:
    game = load_game(appid)
    now = _now_ms()
    if name:
        game["name"] = name
    # Close any session left open by a crash so it doesn't count forever.
    for s in game["sessions"]:
        if not s.get("end"):
            s["end"] = s["start"]
    for c in game.get("counters", []):
        if c.get("sessionCount"):
            c["sessionCount"] = 0
            c["updatedAt"] = now
    game["launchCount"] = game.get("launchCount", 0) + 1
    game["lastLaunched"] = now
    game["sessions"].append({"id": str(uuid.uuid4()), "start": now, "end": None})
    _save_game(game)
    return _summary(game)


def record_exit(appid: str) -> dict:
    game = load_game(appid)
    now = _now_ms()
    for s in game["sessions"]:
        if not s.get("end"):
            s["end"] = now
            game["playtimeSeconds"] = game.get("playtimeSeconds", 0) + max(0, (now - s["start"]) // 1000)
    _save_game(game)
    return _summary(game)


def ensure_game(appid: str, name: str) -> dict:
    """Make sure a record exists (e.g. game already running when the plugin loaded)."""
    game = load_game(appid)
    if name and game.get("name") in (None, str(appid)):
        game["name"] = name
    _save_game(game)
    return _summary(game)


# ---------- notes / folders ----------

def save_note(appid: str, note: dict) -> dict:
    game = load_game(appid)
    now = _now_ms()
    if not note.get("createdAt"):
        note["createdAt"] = now
    note["updatedAt"] = now
    if note.get("launchNumber") is None:
        note["launchNumber"] = game.get("launchCount") or None
    idx = next((i for i, n in enumerate(game["notes"]) if n["id"] == note["id"]), None)
    if idx is None:
        game["notes"].append(note)
    else:
        history.record(appid, [game["notes"][idx]], [note], now)
        game["notes"][idx] = note
    _save_game(game)
    return note


def delete_note(appid: str, note_id: str):
    game = load_game(appid)
    note = next((n for n in game["notes"] if n["id"] == note_id), None)
    if not note:
        return
    # Media is kept so the note (or an older version) can be restored with its attachments.
    history.record(appid, [note], [], _now_ms())
    game["notes"] = [n for n in game["notes"] if n["id"] != note_id]
    _tombstone(game, note_id)
    _save_game(game)


def _tombstone(game: dict, item_id: str):
    game.setdefault("deleted", {})[item_id] = _now_ms()


def save_folder(appid: str, folder: dict) -> dict:
    game = load_game(appid)
    if not folder.get("createdAt"):
        folder["createdAt"] = _now_ms()
    folder["updatedAt"] = _now_ms()
    idx = next((i for i, f in enumerate(game["folders"]) if f["id"] == folder["id"]), None)
    if idx is None:
        game["folders"].append(folder)
    else:
        game["folders"][idx] = folder
    _save_game(game)
    return folder


def delete_folder(appid: str, folder_id: str):
    """Delete a folder; its notes and subfolders move up to the parent."""
    game = load_game(appid)
    folder = next((f for f in game["folders"] if f["id"] == folder_id), None)
    if not folder:
        return
    parent = folder.get("parentId")
    now = _now_ms()
    for f in game["folders"]:
        if f.get("parentId") == folder_id:
            f["parentId"] = parent
            f["updatedAt"] = now
    for n in game["notes"]:
        if n.get("folderId") == folder_id:
            n["folderId"] = parent
            n["updatedAt"] = now
    game["folders"] = [f for f in game["folders"] if f["id"] != folder_id]
    _tombstone(game, folder_id)
    _save_game(game)


def set_left_off(appid: str, text: str) -> dict:
    game = load_game(appid)
    # Cleared pins keep a timestamp so the clear wins over an older pin when syncing.
    game["leftOff"] = {"text": text.strip(), "updatedAt": _now_ms(), "launchNumber": game.get("launchCount") or None}
    _save_game(game)
    return game["leftOff"] if text.strip() else None


# ---------- counters ----------

def save_counter(appid: str, counter: dict) -> dict:
    game = load_game(appid)
    counters = game.setdefault("counters", [])
    counter.setdefault("count", 0)
    counter.setdefault("sessionCount", 0)
    if not counter.get("createdAt"):
        counter["createdAt"] = _now_ms()
    counter["updatedAt"] = _now_ms()
    idx = next((i for i, c in enumerate(counters) if c["id"] == counter["id"]), None)
    if idx is None:
        counters.append(counter)
    else:
        counters[idx] = counter
    _save_game(game)
    return counter


def bump_counter(appid: str, counter_id: str, delta: int):
    game = load_game(appid)
    counter = next((c for c in game.get("counters", []) if c["id"] == counter_id), None)
    if not counter:
        return None
    counter["count"] = max(0, counter.get("count", 0) + delta)
    counter["sessionCount"] = max(0, counter.get("sessionCount", 0) + delta)
    counter["updatedAt"] = _now_ms()
    _save_game(game)
    return counter


def delete_counter(appid: str, counter_id: str):
    game = load_game(appid)
    game["counters"] = [c for c in game.get("counters", []) if c["id"] != counter_id]
    _tombstone(game, counter_id)
    _save_game(game)


# ---------- media ----------

def _remove_media(appid: str, item: dict):
    for key in ("file", "thumb"):
        name = item.get(key)
        if name:
            path = os.path.join(media_dir(appid), os.path.basename(name))
            if os.path.exists(path):
                os.remove(path)


def _screenshot_dirs(appid: str) -> list:
    home = decky.DECKY_USER_HOME
    ids = {str(appid)}
    try:
        # Non-Steam shortcuts store screenshots under their 64-bit game id.
        ids.add(str((int(appid) << 32) | 0x02000000))
    except ValueError:
        pass
    dirs = []
    for root in (os.path.join(home, ".local/share/Steam"), os.path.join(home, ".steam/steam")):
        for gid in ids:
            dirs.extend(glob.glob(os.path.join(root, "userdata", "*", "760", "remote", gid, "screenshots")))
    return list({os.path.realpath(d) for d in dirs})


def _data_url(path: str) -> str:
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif", "wav": "audio/wav",
            "webm": "audio/webm", "ogg": "audio/ogg", "m4a": "audio/mp4", "mp3": "audio/mpeg"}.get(ext, "application/octet-stream")
    with open(path, "rb") as f:
        return f"data:{mime};base64,{base64.b64encode(f.read()).decode()}"


def list_steam_screenshots(appid: str, limit: int = 30) -> list:
    shots = []
    for d in _screenshot_dirs(appid):
        for path in glob.glob(os.path.join(d, "*.jpg")) + glob.glob(os.path.join(d, "*.png")):
            shots.append((os.path.getmtime(path), path))
    shots.sort(reverse=True)
    result = []
    for mtime, path in shots[:limit]:
        thumb = os.path.join(os.path.dirname(path), "thumbnails", os.path.basename(path))
        result.append({
            "path": path,
            "takenAt": int(mtime * 1000),
            "preview": _data_url(thumb if os.path.exists(thumb) else path),
        })
    return result


def find_new_screenshot(appid: str, after_ms: int):
    """Newest screenshot for the game taken at/after `after_ms` (a few seconds of slack)."""
    newest = None
    for d in _screenshot_dirs(appid):
        for path in glob.glob(os.path.join(d, "*.jpg")) + glob.glob(os.path.join(d, "*.png")):
            mtime = os.path.getmtime(path) * 1000
            if mtime >= after_ms - 5000 and (newest is None or mtime > newest[0]):
                newest = (mtime, path)
    return newest[1] if newest else None


def attach_screenshot(appid: str, path: str) -> dict:
    allowed = [os.path.realpath(d) for d in _screenshot_dirs(appid)]
    real = os.path.realpath(path)
    if not any(real.startswith(d + os.sep) for d in allowed):
        raise ValueError("Not a screenshot for this game")
    shot_id = str(uuid.uuid4())
    ext = os.path.splitext(real)[1]
    dest_dir = media_dir(appid)
    shutil.copy2(real, os.path.join(dest_dir, shot_id + ext))
    item = {"id": shot_id, "file": shot_id + ext, "takenAt": int(os.path.getmtime(real) * 1000)}
    thumb = os.path.join(os.path.dirname(real), "thumbnails", os.path.basename(real))
    if os.path.exists(thumb):
        shutil.copy2(thumb, os.path.join(dest_dir, shot_id + ".thumb" + ext))
        item["thumb"] = shot_id + ".thumb" + ext
    return item


def get_media(appid: str, filename: str):
    path = os.path.join(media_dir(appid), os.path.basename(filename))
    return _data_url(path) if os.path.exists(path) else None


def delete_media(appid: str, item: dict):
    _remove_media(appid, item)


# ---------- settings ----------

def get_settings() -> dict:
    if not os.path.exists(SETTINGS_PATH):
        return {}
    with open(SETTINGS_PATH, "r") as f:
        return json.load(f)


def save_settings(settings: dict):
    os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
    with open(SETTINGS_PATH, "w") as f:
        json.dump(settings, f, indent=2)


# ---------- sync ----------

def apply_synced(remote: dict) -> bool:
    """Merge the server's copy into the local one. Returns True if anything local changed."""
    appid = str(remote["appId"])
    local = load_game(appid)
    merged = merge.merge_games(local, remote, _now_ms())
    merged.setdefault("version", SCHEMA_VERSION)
    if json.dumps(merged, sort_keys=True) == json.dumps(local, sort_keys=True):
        return False
    history.record(appid, local.get("notes", []), merged.get("notes", []), _now_ms())
    _save_game(merged, notify=False)
    return True


def get_note_history(appid: str, note_id: str) -> list:
    return list(reversed(history.get(appid, note_id)))


def list_deleted_notes(appid: str) -> list:
    return history.deleted(appid, load_game(appid).get("notes", []))


def restore_note(appid: str, note: dict) -> dict:
    """Bring back an older or deleted version; it becomes the newest edit so it syncs everywhere."""
    note = dict(note)
    note["updatedAt"] = 0
    return save_note(appid, note)


def referenced_media(game: dict) -> set:
    files = set()
    for n in game.get("notes", []):
        for item in n.get("screenshots", []) + n.get("recordings", []):
            files.update(x for x in (item.get("file"), item.get("thumb")) if x)
    return files
