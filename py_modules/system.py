"""Readings for the Desk's Deck Tomes: temperatures, memory, battery, storage and network."""

import glob
import os
import shutil
import subprocess


def _read(path: str):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return None


def _temps() -> dict:
    """CPU and GPU temperatures in °C from hwmon (the Deck's APU reports as k10temp and amdgpu)."""
    out = {}
    for hw in glob.glob("/sys/class/hwmon/hwmon*"):
        name = _read(os.path.join(hw, "name"))
        raw = _read(os.path.join(hw, "temp1_input"))
        if not raw or not raw.isdigit():
            continue
        if name == "k10temp" or (name == "acpitz" and "cpu" not in out):
            out["cpu"] = int(raw) / 1000
        elif name == "amdgpu":
            out["gpu"] = int(raw) / 1000
    return out


def _memory() -> dict:
    info = {}
    for line in (_read("/proc/meminfo") or "").splitlines():
        key, _, rest = line.partition(":")
        if key in ("MemTotal", "MemAvailable"):
            info[key] = int(rest.split()[0]) * 1024
    if "MemTotal" not in info:
        return {}
    return {"total": info["MemTotal"], "used": info["MemTotal"] - info.get("MemAvailable", 0)}


def _battery():
    for bat in glob.glob("/sys/class/power_supply/BAT*"):
        cap = _read(os.path.join(bat, "capacity"))
        if cap and cap.isdigit():
            return {"percent": int(cap), "status": _read(os.path.join(bat, "status")) or ""}
    return None


def _cpu_load():
    load = _read("/proc/loadavg")
    try:
        return float(load.split()[0]) / (os.cpu_count() or 1) if load else None
    except ValueError:
        return None


def stats() -> dict:
    return {"temps": _temps(), "memory": _memory(), "battery": _battery(), "load": _cpu_load()}


def storage() -> list:
    """Free space on the internal drive and any SD card or USB drive."""
    seen, out = set(), []
    places = [("Internal", os.path.expanduser("~"))] + [
        (os.path.basename(p), p) for p in sorted(glob.glob("/run/media/*/*") + glob.glob("/run/media/*"))
    ]
    for label, path in places:
        try:
            st = os.statvfs(path)
            usage = shutil.disk_usage(path)
        except OSError:
            continue
        key = st.f_fsid
        if key in seen or usage.total < 1 << 30:  # same drive twice, or a tiny/virtual mount
            continue
        seen.add(key)
        out.append({"label": label, "path": path, "total": usage.total, "free": usage.free})
    return out


def network() -> dict:
    """Wi-Fi name and signal, from NetworkManager (nmcli) with /proc/net/wireless as a fallback."""
    out = {"ssid": None, "signal": None, "connected": False}
    try:
        res = subprocess.run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"], capture_output=True, text=True, timeout=3)
        for line in res.stdout.splitlines():
            parts = line.split(":")
            if parts and parts[0] == "yes":
                out.update(ssid=":".join(parts[1:-1]) or None, signal=int(parts[-1]) if parts[-1].isdigit() else None, connected=True)
                break
    except (OSError, subprocess.SubprocessError):
        pass
    if out["signal"] is None:
        for line in (_read("/proc/net/wireless") or "").splitlines()[2:]:
            parts = line.split()
            if len(parts) > 2:
                try:
                    out["signal"] = min(100, max(0, round(float(parts[2].rstrip(".")) / 70 * 100)))
                    out["connected"] = True
                except ValueError:
                    pass
    if not out["connected"]:
        out["connected"] = any(_read(f"{d}/operstate") == "up" for d in glob.glob("/sys/class/net/*") if not d.endswith("/lo"))
    return out
