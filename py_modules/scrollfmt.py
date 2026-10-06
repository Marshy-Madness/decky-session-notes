"""The Scroll format, shared by the Madness Workshop and the Deck plugin.

A Scroll is one JSON document:

    {
      "format": 1,
      "id": "game-news",                  lowercase letters, digits and dashes
      "name": "Game News", "icon": "📰", "version": "1.0.0",
      "summary": "One line for lists", "description": "Longer text for its page",
      "author": "MarshyMadness", "minDesk": "0.3.0",
      "kind": "code" | "data",
      "permissions": ["library-page", ...],   what a code Scroll touches (shown before installing)
      "code": "...",                          code Scrolls only: JavaScript (see scrolls/README.md)
      "data": {...},                          data Scrolls only: text, links, Note Packs, a Desk layout
      "signature": {"key": "...", "sig": "..."}   added by the Workshop
    }

Code runs inside Steam with the same power as the plugin, so the Desk only runs code Scrolls signed with
the Workshop's key, and the Workshop signs a code Scroll only when its owner approves it. Data Scrolls
can't run anything, so they don't need a signature.
"""
import base64
import hashlib
import json
import re

import ed25519

FORMAT = 1
MAX_BYTES = 512 * 1024
SIGN_PREFIX = b"desk-of-madness-scroll\n"
ID_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$")
KINDS = ("code", "data")
# What a code Scroll may say it touches. Shown to people before they install it.
PERMISSIONS = {
    "tomes": "Adds Tomes to your Desk",
    "library-page": "Adds a section to games' library pages",
    "main-menu": "Adds entries to Steam's main menu",
    "quick-access": "Adds tabs to the Quick Access menu",
    "decky-ui": "Changes Decky's own plugin list",
    "network": "Fetches from the internet (Steam news, the Workshop)",
}
MAX_LINKS = 50
MAX_PACKS = 20


def _text(scroll: dict, key: str, limit: int, required: bool = False) -> str:
    value = scroll.get(key, "")
    if not isinstance(value, str):
        raise ValueError(f"“{key}” has to be text")
    value = value.strip()
    if required and not value:
        raise ValueError(f"The Scroll needs a “{key}”")
    if len(value) > limit:
        raise ValueError(f"“{key}” is longer than {limit} characters")
    return value


def _strings(value, limit: int, what: str) -> list:
    if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
        raise ValueError(f"{what} has to be a list of text")
    return [x.strip()[:80] for x in value[:limit] if x.strip()]


def _data(data) -> dict:
    """A data Scroll's contents: nothing in here can run."""
    if not isinstance(data, dict):
        raise ValueError("A data Scroll needs a “data” object")
    out = {}
    if data.get("text"):
        if not isinstance(data["text"], str):
            raise ValueError("data.text has to be text")
        out["text"] = data["text"].strip()[:4000]
    if data.get("links"):
        if not isinstance(data["links"], list):
            raise ValueError("data.links has to be a list")
        links = []
        for link in data["links"][:MAX_LINKS]:
            if not isinstance(link, dict) or not isinstance(link.get("url"), str):
                raise ValueError("Each link needs a “url”")
            url = link["url"].strip()
            if not re.match(r"^https?://[^\s]+$", url):
                raise ValueError(f"Not a web address: {url[:80]}")
            title = str(link.get("title") or url).strip()[:120]
            links.append({"title": title, "url": url[:1000], **({"note": str(link["note"]).strip()[:200]} if link.get("note") else {})})
        out["links"] = links
    if data.get("packs"):
        out["packs"] = [p for p in _strings(data["packs"], MAX_PACKS, "data.packs") if re.fullmatch(r"[A-Za-z0-9_-]{1,40}", p)]
    if data.get("layout"):
        layout = data["layout"]
        if not isinstance(layout, dict):
            raise ValueError("data.layout has to be an object")
        out["layout"] = {k: _strings(layout.get(k) or [], 100, f"data.layout.{k}") for k in ("order", "hidden", "collapsed")}
    if not out:
        raise ValueError("This data Scroll is empty: add text, links, packs or a layout")
    return out


def validate(scroll) -> dict:
    """Checks a Scroll and returns a clean copy (the signature, if any, is kept as it was). Raises ValueError."""
    if not isinstance(scroll, dict):
        raise ValueError("A Scroll is a JSON object")
    if scroll.get("format", FORMAT) != FORMAT:
        raise ValueError(f"This Desk understands Scroll format {FORMAT}; this one is format {scroll.get('format')}")
    sid = scroll.get("id")
    if not isinstance(sid, str) or not ID_RE.match(sid):
        raise ValueError("The Scroll's “id” must be 1–40 lowercase letters, digits or dashes")
    version = scroll.get("version")
    if not isinstance(version, str) or not VERSION_RE.match(version):
        raise ValueError("The Scroll's “version” must look like 1.0.0")
    kind = scroll.get("kind")
    if kind not in KINDS:
        raise ValueError("The Scroll's “kind” must be “code” or “data”")
    out = {
        "format": FORMAT,
        "id": sid,
        "name": _text(scroll, "name", 60, required=True),
        "icon": _text(scroll, "icon", 8) or "📜",
        "version": version,
        "summary": _text(scroll, "summary", 200),
        "description": _text(scroll, "description", 4000),
        "author": _text(scroll, "author", 60),
        "minDesk": _text(scroll, "minDesk", 20),
        "kind": kind,
    }
    if kind == "code":
        code = scroll.get("code")
        if not isinstance(code, str) or not code.strip():
            raise ValueError("A code Scroll needs its “code”")
        out["code"] = code
        perms = _strings(scroll.get("permissions") or [], 20, "permissions")
        unknown = [p for p in perms if p not in PERMISSIONS]
        if unknown:
            raise ValueError(f"Unknown permission: {', '.join(unknown)}")
        out["permissions"] = perms
        if scroll.get("data"):
            raise ValueError("A code Scroll can't have “data”")
    else:
        if scroll.get("code"):
            raise ValueError("A data Scroll can't have “code”; make it a code Scroll so it can be reviewed")
        out["data"] = _data(scroll.get("data"))
        out["permissions"] = []
    if isinstance(scroll.get("signature"), dict):
        out["signature"] = {"key": str(scroll["signature"].get("key", "")), "sig": str(scroll["signature"].get("sig", ""))}
    if len(dump(out)) > MAX_BYTES:
        raise ValueError(f"The Scroll is bigger than {MAX_BYTES // 1024} KB")
    return out


def dump(scroll: dict) -> bytes:
    return json.dumps(scroll, ensure_ascii=False, separators=(",", ":")).encode()


def canonical(scroll: dict) -> bytes:
    """The exact bytes a signature covers: everything but the signature, keys sorted, no spaces."""
    body = {k: v for k, v in scroll.items() if k != "signature"}
    return SIGN_PREFIX + json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def key_id(public: bytes) -> str:
    return hashlib.sha256(public).hexdigest()[:16]


def sign(scroll: dict, secret: bytes) -> dict:
    public = ed25519.public_key(secret)
    sig = ed25519.sign(secret, canonical(scroll))
    return {**{k: v for k, v in scroll.items() if k != "signature"}, "signature": {"key": key_id(public), "sig": base64.b64encode(sig).decode()}}


def signed_by(scroll: dict, keys: dict) -> str:
    """The id of the trusted key that signed this Scroll ("" if none did). `keys` is {key id: public key hex}."""
    sig = scroll.get("signature") or {}
    public = keys.get(sig.get("key", ""))
    if not public:
        return ""
    try:
        raw = base64.b64decode(sig.get("sig", ""), validate=True)
    except ValueError:
        return ""
    return sig["key"] if ed25519.verify(bytes.fromhex(public), canonical(scroll), raw) else ""


def version_key(version: str):
    """Sorts versions: 1.2.0-beta.1 < 1.2.0 < 1.10.0."""
    main, _, pre = (version or "0.0.0").partition("-")
    nums = tuple(int(x) if x.isdigit() else 0 for x in main.split("."))
    return nums + ((1,) if not pre else (0, *((0, int(x)) if x.isdigit() else (1, x) for x in pre.split("."))))


def newer(a: str, b: str) -> bool:
    return version_key(a) > version_key(b)
