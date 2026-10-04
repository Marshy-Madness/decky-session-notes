"""Two-way merge for one game's record. Shared by the Deck plugin and the server.

Rules:
- Notes, folders and counters merge by id; the copy with the newer updatedAt wins.
- Deletions are kept as tombstones in game["deleted"] = {id: deletedAtMs}; an item is
  dropped if it was deleted at or after its last edit.
- Sessions are only ever added, so they're a plain union.
- Totals (launches, playtime) take the max; the left-off pin takes the newer one.
"""

TOMBSTONE_TTL_MS = 180 * 24 * 3600 * 1000


def _stamp(item: dict) -> int:
    return item.get("updatedAt") or item.get("createdAt") or 0


def _merge_items(a: list, b: list, deleted: dict) -> list:
    out = {}
    for item in (a or []) + (b or []):
        if "id" not in item:
            continue
        cur = out.get(item["id"])
        if cur is None or _stamp(item) > _stamp(cur):
            out[item["id"]] = item
    return [i for i in out.values() if deleted.get(i["id"], -1) < _stamp(i)]


def merge_games(a: dict, b: dict, now_ms: int = 0) -> dict:
    deleted = dict(a.get("deleted") or {})
    for k, v in (b.get("deleted") or {}).items():
        deleted[k] = max(v, deleted.get(k, 0))
    if now_ms:
        deleted = {k: v for k, v in deleted.items() if now_ms - v < TOMBSTONE_TTL_MS}

    result = {**b, **a}  # scalar fields: start from either, fixed up below
    result["deleted"] = deleted
    for key in ("notes", "folders", "counters"):
        result[key] = _merge_items(a.get(key), b.get(key), deleted)
    sessions = {s["id"]: s for s in (b.get("sessions") or []) + (a.get("sessions") or []) if s.get("id")}
    for s in (a.get("sessions") or []) + (b.get("sessions") or []):
        if s.get("id") and s.get("end") and not sessions[s["id"]].get("end"):
            sessions[s["id"]] = s
    result["sessions"] = sorted(sessions.values(), key=lambda s: s.get("start") or 0)

    for key in ("launchCount", "playtimeSeconds"):
        result[key] = max(a.get(key) or 0, b.get(key) or 0)
    result["lastLaunched"] = max(a.get("lastLaunched") or 0, b.get("lastLaunched") or 0) or None
    firsts = [x for x in (a.get("firstSeen"), b.get("firstSeen")) if x]
    result["firstSeen"] = min(firsts) if firsts else None

    appid = str(result.get("appId"))
    names = [n for n in (a.get("name"), b.get("name")) if n and n != appid]
    result["name"] = names[0] if names else appid

    la, lb = a.get("leftOff"), b.get("leftOff")
    result["leftOff"] = max((x for x in (la, lb) if x), key=lambda x: x.get("updatedAt", 0), default=None)
    result.pop("summary", None)
    return result


# ---------- per-note version history (also shared by plugin and server) ----------

import json as _json
import os as _os

NOTE_HISTORY_KEEP = 50


def changed_notes(old_notes: list, new_notes: list):
    """Yield (old_version, reason) for every note that was edited or removed between two states."""
    new_by_id = {n["id"]: n for n in new_notes or [] if "id" in n}
    for old in old_notes or []:
        new = new_by_id.get(old.get("id"))
        if new is None:
            yield old, "deleted"
        elif _stamp(new) != _stamp(old) or new != old:
            yield old, "edited"


class NoteHistory:
    """Previous versions of notes, one JSON file per note: <base>/<appid>/<noteid>.json (newest last)."""

    def __init__(self, base_dir: str):
        self.base = base_dir

    def _path(self, appid: str, note_id: str) -> str:
        safe_id = "".join(c for c in str(note_id) if c.isalnum() or c in "-_")
        return _os.path.join(self.base, str(appid), f"{safe_id}.json")

    def get(self, appid: str, note_id: str) -> list:
        path = self._path(appid, note_id)
        if not _os.path.exists(path):
            return []
        with open(path) as f:
            return _json.load(f)

    def record(self, appid: str, old_notes: list, new_notes: list, now_ms: int):
        for old, reason in changed_notes(old_notes, new_notes):
            versions = self.get(appid, old["id"])
            if versions and versions[-1]["note"] == old:
                if reason == "deleted" and versions[-1]["reason"] != "deleted":
                    versions[-1]["reason"] = "deleted"
                    versions[-1]["savedAt"] = now_ms
                else:
                    continue
            else:
                versions.append({"savedAt": now_ms, "reason": reason, "note": old})
            path = self._path(appid, old["id"])
            _os.makedirs(_os.path.dirname(path), exist_ok=True)
            with open(path + ".tmp", "w") as f:
                _json.dump(versions[-NOTE_HISTORY_KEEP:], f)
            _os.replace(path + ".tmp", path)

    def deleted(self, appid: str, current_notes: list) -> list:
        """Notes whose last recorded event was a deletion and that aren't back in the game."""
        live = {n["id"] for n in current_notes or []}
        d = _os.path.join(self.base, str(appid))
        out = []
        for name in _os.listdir(d) if _os.path.isdir(d) else []:
            if not name.endswith(".json"):
                continue
            with open(_os.path.join(d, name)) as f:
                versions = _json.load(f)
            last = versions[-1] if versions else None
            if last and last["reason"] == "deleted" and last["note"]["id"] not in live:
                out.append({"deletedAt": last["savedAt"], "note": last["note"]})
        return sorted(out, key=lambda x: x["deletedAt"], reverse=True)
