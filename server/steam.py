"""Steam sign-in (OpenID 2.0) and public profile lookup. No Steam Web API key needed."""
import re
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
