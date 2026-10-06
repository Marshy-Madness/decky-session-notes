"""Steam news for a game (the keyless ISteamNews/GetNewsForApp), cleaned up for showing as plain text."""
import html
import json
import re
import time
import urllib.parse
import urllib.request

from sync import _SSL

URL = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/"
CACHE_SECONDS = 30 * 60
_cache: dict = {}


def _plain(text: str) -> str:
    text = re.sub(r"\[/?[a-zA-Z0-9*]+(?:=[^\]]*)?\]", " ", text or "")  # BBCode
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\{STEAM_CLAN_IMAGE\}\S*", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def _image(text: str) -> str:
    m = re.search(r"\{STEAM_CLAN_IMAGE\}(\S+?\.(?:png|jpe?g|gif|webp))", text or "")
    if m:
        return "https://clan.akamai.steamstatic.com/images" + m.group(1)
    m = re.search(r"(https://[^\s\"'\]\[]+\.(?:png|jpe?g|webp))", text or "")
    return m.group(1) if m else ""


def for_app(appid: str, count: int = 5) -> list:
    appid = re.sub(r"\D", "", str(appid))
    if not appid:
        return []
    count = max(1, min(int(count or 5), 20))
    hit = _cache.get(appid)
    if hit and hit[0] > time.time() - CACHE_SECONDS and len(hit[1]) >= count:
        return hit[1][:count]
    q = urllib.parse.urlencode({"appid": appid, "count": count, "maxlength": 0, "format": "json"})
    req = urllib.request.Request(f"{URL}?{q}", headers={"User-Agent": "DeskOfMadness/1"})
    try:
        with urllib.request.urlopen(req, timeout=15, context=_SSL) as resp:
            items = (json.loads(resp.read()).get("appnews") or {}).get("newsitems") or []
    except Exception as e:  # noqa: BLE001 — an offline Deck just shows no news
        if hit:
            return hit[1][:count]
        raise RuntimeError(f"Couldn't get Steam news: {e}")
    out = []
    for n in items:
        body = _plain(n.get("contents", ""))
        out.append({"id": str(n.get("gid")), "title": html.unescape(n.get("title") or "").strip(), "url": n.get("url") or "",
                    "author": n.get("author") or "", "feed": n.get("feedlabel") or "", "date": int(n.get("date") or 0) * 1000,
                    "summary": body[:280] + ("…" if len(body) > 280 else ""), "image": _image(n.get("contents", "")),
                    "official": "patchnotes" in (n.get("tags") or []) or n.get("feed_type") == 1})
    _cache[appid] = (time.time(), out)
    return out
