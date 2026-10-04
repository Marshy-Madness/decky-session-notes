"""Steam sign-in (OpenID 2.0), public profile lookup and game names/icons. No Steam Web API key needed."""
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

OPENID = "https://steamcommunity.com/openid/login"
CLAIMED = re.compile(r"^https://steamcommunity\.com/openid/id/(\d{17})$")


def login_url(return_to: str, realm: str) -> str:
    params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": return_to,
        "openid.realm": realm,
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    return OPENID + "?" + urllib.parse.urlencode(params)


def verify(query: dict, expected_return_to: str):
    """Check an OpenID response with Steam. Returns the 64-bit Steam ID, or None."""
    if query.get("openid.mode") != "id_res" or query.get("openid.op_endpoint") != OPENID:
        return None
    if not query.get("openid.return_to", "").startswith(expected_return_to):
        return None
    m = CLAIMED.match(query.get("openid.claimed_id", ""))
    if not m:
        return None
    check = dict(query)
    check["openid.mode"] = "check_authentication"
    req = urllib.request.Request(OPENID, data=urllib.parse.urlencode(check).encode(), method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode(errors="replace")
    return m.group(1) if "is_valid:true" in body else None


def profile(steam_id: str) -> dict:
    """Public persona name + avatar from the community profile XML."""
    try:
        with urllib.request.urlopen(f"https://steamcommunity.com/profiles/{steam_id}/?xml=1", timeout=10) as resp:
            root = ET.fromstring(resp.read())
        return {"name": (root.findtext("steamID") or "").strip() or steam_id,
                "avatar": (root.findtext("avatarMedium") or "").strip()}
    except Exception:
        return {"name": steam_id, "avatar": ""}


def parse_steam_id(text: str):
    """Accept a 17-digit ID or a steamcommunity.com/profiles/<id> URL."""
    m = re.search(r"(7656\d{13})", text or "")
    return m.group(1) if m else None


# ---------- game names and icons ----------

APPS_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "steam_apps.json")
CDN = "https://cdn.cloudflare.steamstatic.com"
_apps_lock = threading.Lock()
_apps = None


def is_steam_app(appid) -> bool:
    """Steam store games have small numeric IDs; non-Steam shortcuts on the Deck get IDs of 2^31 and up."""
    s = str(appid)
    return s.isdigit() and 0 < int(s) < 2 ** 31


def _cache() -> dict:
    global _apps
    if _apps is None:
        try:
            with open(APPS_PATH) as f:
                _apps = json.load(f)
        except (OSError, ValueError):
            _apps = {}
    return _apps


def _art(appid: str, info: dict) -> dict:
    icon = info.get("icon")
    return {"appId": appid, "name": info.get("name"), "found": bool(info.get("name")),
            "icon": f"{CDN}/steamcommunity/public/images/apps/{appid}/{icon}.jpg" if icon else None,
            "image": f"{CDN}/steam/apps/{appid}/header.jpg" if info.get("name") else None}


def apps(appids, fetch: bool = True) -> dict:
    """{appid: {appId, name, found, icon, image}} for Steam games. Looked up once, then cached
    (misses are retried after a day). With fetch=False only the cache is used."""
    want = [str(a) for a in appids if is_steam_app(a)]
    with _apps_lock:
        cache = _cache()
        stale = [a for a in want if a not in cache or (not cache[a].get("name") and time.time() - cache[a].get("at", 0) > 86400)]
    if fetch and stale:
        found = {}
        for i in range(0, len(stale), 100):
            batch = stale[i:i + 100]
            q = "&".join(f"appids%5B{n}%5D={a}" for n, a in enumerate(batch))
            try:
                with urllib.request.urlopen(f"https://api.steampowered.com/ICommunityService/GetApps/v1/?{q}", timeout=10) as r:
                    for app in json.loads(r.read()).get("response", {}).get("apps", []):
                        found[str(app.get("appid"))] = app
            except Exception as e:  # offline: try again next time
                print(f"steam app lookup failed: {e}", flush=True)
                batch = []
            for a in batch:
                app = found.get(a, {})
                found[a] = {"name": app.get("name"), "icon": app.get("icon"), "at": int(time.time())}
        with _apps_lock:
            cache.update({a: found[a] for a in stale if a in found})
            os.makedirs(os.path.dirname(APPS_PATH), exist_ok=True)
            with open(APPS_PATH + ".tmp", "w") as f:
                json.dump(cache, f)
            os.replace(APPS_PATH + ".tmp", APPS_PATH)
    with _apps_lock:
        return {a: _art(a, cache[a]) for a in want if a in cache}
