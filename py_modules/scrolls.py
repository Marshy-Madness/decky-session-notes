"""Scrolls installed on this Deck: add-ons from the Madness Workshop, kept in the plugin's data folder.

Every Scroll is checked when it's installed and again each time it's loaded, so a file changed on disk
can't sneak code in: code Scrolls only load with a valid Workshop signature.
"""
import json
import os

import decky
import scrollfmt

# The Workshop keys the Desk trusts to sign code Scrolls: {key id: public key (hex)}.
TRUSTED_KEYS = {
    "6ca2c0363ac66824": "d82cb630e47b7186c37bce585077bcb2ad4548ebddf0f93572fe9a9576f4d193",
}
DIR = os.path.join(decky.DECKY_PLUGIN_DATA_DIR, "scrolls")


def _path(scroll_id: str) -> str:
    if not scrollfmt.ID_RE.match(scroll_id or ""):
        raise RuntimeError("Not a Scroll id")
    return os.path.join(DIR, f"{scroll_id}.json")


def check(raw) -> dict:
    """Validates a Scroll and its signature. Returns it with "signedBy" ("" for unsigned data Scrolls)."""
    try:
        scroll = scrollfmt.validate(raw)
    except ValueError as e:
        raise RuntimeError(str(e))
    desk = getattr(decky, "DECKY_PLUGIN_VERSION", "") or ""
    if scroll.get("minDesk") and desk and scrollfmt.newer(scroll["minDesk"], desk):
        raise RuntimeError(f"“{scroll['name']}” needs Desk of Madness {scroll['minDesk']} or newer (this is {desk}).")
    signer = scrollfmt.signed_by(scroll, TRUSTED_KEYS)
    if scroll["kind"] == "code" and not signer:
        raise RuntimeError("This Scroll has code but no valid Madness Workshop signature, so Desk won't install or run it.")
    return {**scroll, "signedBy": signer}


def meta(scroll: dict, size: int) -> dict:
    """What lists show: everything but the code and the signature."""
    out = {k: v for k, v in scroll.items() if k not in ("code", "signature")}
    out["size"] = size
    out["signed"] = bool(scroll.get("signedBy"))
    return out


def installed() -> list:
    out = []
    if not os.path.isdir(DIR):
        return out
    for name in sorted(os.listdir(DIR)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(DIR, name)
        try:
            with open(path, "rb") as f:
                raw = f.read()
            out.append(meta(check(json.loads(raw)), len(raw)))
        except (OSError, ValueError, RuntimeError) as e:
            out.append({"id": name[:-5], "name": name[:-5], "broken": str(e), "size": os.path.getsize(path)})
    return out


def used_bytes(skip: str = "") -> int:
    if not os.path.isdir(DIR):
        return 0
    return sum(os.path.getsize(os.path.join(DIR, n)) for n in os.listdir(DIR) if n.endswith(".json") and n != f"{skip}.json")


def install(raw: dict, allowed: list, quota_mb: int) -> dict:
    """Saves a Scroll after checking it, the sync server's allowlist and its space limit."""
    scroll = check(raw)
    if allowed and scroll["id"] not in allowed:
        raise RuntimeError(f"Your Desk server's admin hasn't allowed the “{scroll['name']}” Scroll.")
    data = scrollfmt.dump({k: v for k, v in scroll.items() if k != "signedBy"})
    if quota_mb and used_bytes(scroll["id"]) + len(data) > quota_mb * 1024 * 1024:
        raise RuntimeError(f"Scrolls can use {quota_mb} MB on this Deck (set by your Desk server's admin). Remove one first.")
    os.makedirs(DIR, exist_ok=True)
    path = _path(scroll["id"])
    with open(path + ".tmp", "wb") as f:
        f.write(data)
    os.replace(path + ".tmp", path)
    decky.logger.info(f"Installed Scroll {scroll['id']} {scroll['version']} ({scroll['kind']}, signed by {scroll['signedBy'] or 'nobody'})")
    return meta(scroll, len(data))


def load(scroll_id: str) -> dict:
    """The whole Scroll, code included, checked again first."""
    with open(_path(scroll_id), "rb") as f:
        return check(json.loads(f.read()))


def remove(scroll_id: str):
    path = _path(scroll_id)
    if os.path.exists(path):
        os.remove(path)
