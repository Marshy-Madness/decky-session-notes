import json
import os
import decky

DATA_DIR = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "games")


def _profile_path(appid: str, run_profile_id: str) -> str:
    game_dir = os.path.join(DATA_DIR, str(appid))
    os.makedirs(game_dir, exist_ok=True)
    return os.path.join(game_dir, f"{run_profile_id}.json")


def _load(path: str) -> dict:
    if not os.path.exists(path):
        return {"notes": [], "sessions": []}
    with open(path, "r") as f:
        return json.load(f)


def _save(path: str, data: dict):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def get_notes(appid: str, run_profile_id: str):
    return _load(_profile_path(appid, run_profile_id))["notes"]


def save_note(appid: str, run_profile_id: str, note: dict):
    path = _profile_path(appid, run_profile_id)
    data = _load(path)
    existing = next((n for n in data["notes"] if n["id"] == note["id"]), None)
    if existing:
        data["notes"][data["notes"].index(existing)] = note
    else:
        data["notes"].append(note)
    _save(path, data)
    return note


def delete_note(appid: str, run_profile_id: str, note_id: str):
    path = _profile_path(appid, run_profile_id)
    data = _load(path)
    data["notes"] = [n for n in data["notes"] if n["id"] != note_id]
    _save(path, data)


def get_sessions(appid: str, run_profile_id: str):
    return _load(_profile_path(appid, run_profile_id))["sessions"]


def save_session(appid: str, run_profile_id: str, session: dict):
    path = _profile_path(appid, run_profile_id)
    data = _load(path)
    existing = next((s for s in data["sessions"] if s["id"] == session["id"]), None)
    if existing:
        data["sessions"][data["sessions"].index(existing)] = session
    else:
        data["sessions"].append(session)
    _save(path, data)
    return session


def get_run_profiles(appid: str):
    index_path = os.path.join(DATA_DIR, str(appid), "profiles.json")
    if not os.path.exists(index_path):
        return []
    with open(index_path, "r") as f:
        return json.load(f)


def save_run_profile(appid: str, profile: dict):
    game_dir = os.path.join(DATA_DIR, str(appid))
    os.makedirs(game_dir, exist_ok=True)
    index_path = os.path.join(game_dir, "profiles.json")
    profiles = get_run_profiles(appid)
    existing = next((p for p in profiles if p["id"] == profile["id"]), None)
    if existing:
        profiles[profiles.index(existing)] = profile
    else:
        profiles.append(profile)
    with open(index_path, "w") as f:
        json.dump(profiles, f, indent=2)
    return profile


def list_games_with_notes():
    if not os.path.exists(DATA_DIR):
        return []
    result = []
    for appid in os.listdir(DATA_DIR):
        game_dir = os.path.join(DATA_DIR, appid)
        note_count = 0
        for filename in os.listdir(game_dir):
            if filename == "profiles.json":
                continue
            with open(os.path.join(game_dir, filename), "r") as f:
                note_count += len(json.load(f).get("notes", []))
        if note_count > 0:
            result.append({"appId": appid, "noteCount": note_count})
    return result


def get_settings():
    path = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        return json.load(f)


def save_settings(settings: dict):
    path = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
    with open(path, "w") as f:
        json.dump(settings, f, indent=2)
