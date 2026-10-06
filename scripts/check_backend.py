"""Starts the plugin backend the way Decky Loader would, with only the Python modules Decky's bundled
interpreter carries (scripts/decky-modules.txt), and makes a few calls. Run before tagging a release:

    python3 scripts/check_backend.py

Decky's Python is a PyInstaller build, so a stdlib module Decky itself doesn't use (html.parser, glob, ...)
is simply missing there, and the backend dies on import with every call left unanswered."""
import asyncio
import importlib.abc
import os
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWED = {l.strip() for l in open(os.path.join(ROOT, "scripts", "decky-modules.txt")) if l.strip() and not l.startswith("#")}
# The attributes Decky's own `decky` module has (decky_loader/plugin/imports/decky.py).
DECKY_ATTRS = ["DECKY_VERSION", "DECKY_USER", "DECKY_USER_HOME", "DECKY_HOME", "DECKY_PLUGIN_SETTINGS_DIR",
               "DECKY_PLUGIN_RUNTIME_DIR", "DECKY_PLUGIN_LOG_DIR", "DECKY_PLUGIN_DIR", "DECKY_PLUGIN_NAME",
               "DECKY_PLUGIN_VERSION", "DECKY_PLUGIN_AUTHOR", "DECKY_PLUGIN_LOG"]


class DeckyBundleOnly(importlib.abc.MetaPathFinder):
    """Refuses stdlib modules missing from Decky's bundle, for imports made by the plugin's own files."""

    def find_spec(self, name, path, target=None):
        if name in ALLOWED or name in sys.builtin_module_names or name == "decky":
            return None
        f = sys._getframe(1)
        while f and ("importlib" in f.f_code.co_filename or f.f_code.co_filename == __file__):
            f = f.f_back
        if not (f and f.f_code.co_filename.startswith(ROOT)):
            return None
        for finder in sys.meta_path:
            if finder is self or not hasattr(finder, "find_spec"):
                continue
            spec = finder.find_spec(name, path, target)
            if spec:
                if spec.origin and (spec.origin.startswith(ROOT) or spec.origin in ("built-in", "frozen")):
                    return None
                raise ModuleNotFoundError(f"No module named '{name}' (Decky's bundled Python doesn't have it)", name=name)
        return None


def fake_decky(home: str) -> types.ModuleType:
    import logging
    d = types.ModuleType("decky")
    vals = {
        "DECKY_HOME": home, "DECKY_USER_HOME": home, "DECKY_USER": "deck", "DECKY_VERSION": "v3.2.10",
        "DECKY_PLUGIN_SETTINGS_DIR": os.path.join(home, "settings"), "DECKY_PLUGIN_RUNTIME_DIR": os.path.join(home, "data"),
        "DECKY_PLUGIN_LOG_DIR": os.path.join(home, "logs"), "DECKY_PLUGIN_DIR": ROOT, "DECKY_PLUGIN_NAME": "Desk of Madness",
        "DECKY_PLUGIN_VERSION": "check", "DECKY_PLUGIN_AUTHOR": "check",
    }
    vals["DECKY_PLUGIN_LOG"] = os.path.join(vals["DECKY_PLUGIN_LOG_DIR"], "check.log")
    for k in DECKY_ATTRS:
        setattr(d, k, vals[k])
    for k in ("DECKY_PLUGIN_SETTINGS_DIR", "DECKY_PLUGIN_RUNTIME_DIR", "DECKY_PLUGIN_LOG_DIR"):
        os.makedirs(vals[k], exist_ok=True)
    logging.basicConfig(level=logging.WARNING)
    d.logger = logging.getLogger("decky")

    async def emit(*args):
        pass
    d.emit = emit
    return d


def main():
    home = tempfile.mkdtemp(prefix="dom-check-")
    sys.modules["decky"] = fake_decky(home)
    sys.meta_path.insert(0, DeckyBundleOnly())
    sys.path[:0] = [os.path.join(ROOT, "py_modules"), ROOT]
    import main as plugin_main

    async def calls():
        p = plugin_main.Plugin()
        await p._main()
        for name in ("list_games", "get_settings", "scrolls_installed"):
            if hasattr(p, name):
                await asyncio.wait_for(getattr(p, name)(), 10)
        await p._unload()

    asyncio.run(calls())
    print("Backend starts and answers with Decky's modules.")


if __name__ == "__main__":
    main()
