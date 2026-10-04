"""Takes a screenshot of the game by asking gamescope for one, the same way Steam's own screenshot key does.

gamescope watches the GAMESCOPECTRL_REQUEST_SCREENSHOT property on the root window of its X server: set it
to a screenshot type and it writes /tmp/gamescope.png, then deletes the property again. Steam doesn't add
these to its screenshot library, so we copy the file into the note's media ourselves.
"""

import asyncio
import ctypes
import ctypes.util
import glob
import os
import shutil
import time
import uuid

import storage

GAMESCOPE_SHOT = "/tmp/gamescope.png"
SHOT_BASE_PLANE = 1  # just the game, without Steam's overlays and our own toasts on top
WAIT_SECONDS = 4.0


def _x_env() -> dict:
    """DISPLAY and XAUTHORITY of the running Steam, since the plugin backend runs outside the session."""
    for path in glob.glob("/proc/[0-9]*/environ"):
        try:
            with open(path.replace("environ", "comm")) as f:
                if f.read().strip() not in ("steam", "steamwebhelper", "gamescope-wl", "gamescope"):
                    continue
            with open(path, "rb") as f:
                env = dict(
                    kv.split(b"=", 1) for kv in f.read().split(b"\0") if b"=" in kv
                )
        except OSError:
            continue
        if b"DISPLAY" in env:
            return {k.decode(): env[k].decode() for k in (b"DISPLAY", b"XAUTHORITY") if k in env}
    return {"DISPLAY": ":0"}


def _request(env: dict):
    lib = ctypes.util.find_library("X11")
    if not lib:
        raise RuntimeError("libX11 isn't installed")
    x = ctypes.cdll.LoadLibrary(lib)
    x.XOpenDisplay.restype = ctypes.c_void_p
    x.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x.XDefaultRootWindow.restype = ctypes.c_ulong
    x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x.XInternAtom.restype = ctypes.c_ulong
    x.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    x.XChangeProperty.argtypes = [
        ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_int, ctypes.c_int,
        ctypes.c_void_p, ctypes.c_int,
    ]
    x.XFlush.argtypes = [ctypes.c_void_p]
    x.XCloseDisplay.argtypes = [ctypes.c_void_p]

    if env.get("XAUTHORITY"):
        os.environ["XAUTHORITY"] = env["XAUTHORITY"]
    dpy = x.XOpenDisplay(env.get("DISPLAY", ":0").encode())
    if not dpy:
        raise RuntimeError(f"can't reach the display {env.get('DISPLAY', ':0')}")
    try:
        atom = x.XInternAtom(dpy, b"GAMESCOPECTRL_REQUEST_SCREENSHOT", 0)
        value = (ctypes.c_long * 1)(SHOT_BASE_PLANE)  # format 32 data is passed as C longs
        XA_CARDINAL, PROP_MODE_REPLACE = 6, 0
        x.XChangeProperty(dpy, x.XDefaultRootWindow(dpy), atom, XA_CARDINAL, 32, PROP_MODE_REPLACE, value, 1)
        x.XFlush(dpy)
    finally:
        x.XCloseDisplay(dpy)


def _mtime(path: str) -> float:
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


async def capture(dest: str):
    """Takes a screenshot and saves it as `dest` (a .png). Raises if gamescope didn't write one."""
    before = _mtime(GAMESCOPE_SHOT)
    await asyncio.to_thread(_request, _x_env())
    deadline = time.monotonic() + WAIT_SECONDS
    size = -1
    while time.monotonic() < deadline:
        await asyncio.sleep(0.15)
        if _mtime(GAMESCOPE_SHOT) <= before:
            continue
        # gamescope writes from its own thread; wait until the file stops growing.
        now = os.path.getsize(GAMESCOPE_SHOT)
        if now > 0 and now == size:
            shutil.copyfile(GAMESCOPE_SHOT, dest)
            return
        size = now
    raise RuntimeError("gamescope didn't take a screenshot (only works in Game Mode)")


def attach(appid: str, path: str) -> dict:
    """Moves a captured screenshot into the game's media. Returns the Screenshot item for a note."""
    shot_id = str(uuid.uuid4())
    name = shot_id + ".png"
    taken = int(_mtime(path) * 1000) or int(time.time() * 1000)
    shutil.move(path, os.path.join(storage.media_dir(appid), name))
    return {"id": shot_id, "file": name, "takenAt": taken}
