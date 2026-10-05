"""One-time import of Session Notes data into Desk of Madness.

Desk of Madness is the renamed Session Notes plugin. Decky sees it as a new plugin with its own
settings and data folders, so on the first start we copy the old plugin's folders over (copy, never
move, so Session Notes keeps working until it's uninstalled). Runs before storage is imported.
"""
import json
import os
import shutil
import time

import decky

OLD_NAME = "Session Notes"
# Folder names the old plugin has had (repo name, store name); the installed ones are found by scanning too.
OLD_FOLDERS = ["decky-session-notes", "Session Notes", "Session-Notes", "session-notes"]
MARKER = "imported_from_session_notes.json"


def _homebrew() -> str:
    return os.path.dirname(os.path.dirname(decky.DECKY_PLUGIN_SETTINGS_DIR))


def _old_folders() -> list:
    found = []
    plugins = os.path.join(_homebrew(), "plugins")
    try:
        for d in os.listdir(plugins):
            try:
                with open(os.path.join(plugins, d, "plugin.json")) as f:
                    if json.load(f).get("name") == OLD_NAME:
                        found.append(d)
            except (OSError, ValueError):
                pass
    except OSError:
        pass
    return found + [d for d in OLD_FOLDERS if d not in found]


def _has_data(settings_dir: str) -> bool:
    return os.path.exists(os.path.join(settings_dir, "settings.json")) or os.path.isdir(os.path.join(settings_dir, "games"))


def run() -> None:
    new_settings = decky.DECKY_PLUGIN_SETTINGS_DIR
    new_data = decky.DECKY_PLUGIN_RUNTIME_DIR
    if os.path.exists(os.path.join(new_settings, MARKER)) or _has_data(new_settings):
        return
    settings_root = os.path.dirname(new_settings)
    data_root = os.path.dirname(new_data)
    for name in _old_folders():
        old_settings = os.path.join(settings_root, name)
        if os.path.abspath(old_settings) == os.path.abspath(new_settings) or not _has_data(old_settings):
            continue
        try:
            shutil.copytree(old_settings, new_settings, dirs_exist_ok=True)
            old_data = os.path.join(data_root, name)
            if os.path.isdir(old_data):
                shutil.copytree(old_data, new_data, dirs_exist_ok=True)
            with open(os.path.join(new_settings, MARKER), "w") as f:
                json.dump({"from": name, "at": int(time.time() * 1000), "shown": False}, f)
            decky.logger.info(f"Imported Session Notes data from {name}")
        except OSError as e:
            decky.logger.error(f"Couldn't import Session Notes data from {name}: {e}")
        return


def take_notice():
    """The import, the first time it's asked about (for a one-time toast); None after that."""
    path = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, MARKER)
    try:
        with open(path) as f:
            info = json.load(f)
    except (OSError, ValueError):
        return None
    if info.get("shown"):
        return None
    info["shown"] = True
    with open(path, "w") as f:
        json.dump(info, f)
    return info
