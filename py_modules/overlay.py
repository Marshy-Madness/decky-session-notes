"""Pin a to-do list on screen while playing, using Steam's performance overlay (MangoHud).

Steam's gamescope session runs `mangoapp` with MANGOHUD_CONFIGFILE pointing at a config file Steam rewrites
whenever you change the overlay level. We append `custom_text=` lines to that file (and re-append them if
Steam rewrites it); MangoHud reloads the file on change. The overlay must be on (Level 1 or higher).
"""
import asyncio
import glob
import os
import re

import decky

BEGIN = "# session-notes-begin"
END = "# session-notes-end"

POSITIONS = {"top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center",
             "bottom-right"}

# Everything Steam's levels can switch on. Later lines win in MangoHud's config, so `name=0` turns them off
# and only our custom_text lines are left.
STATS = ["fps", "fps_only", "frametime", "frame_timing", "histogram", "cpu_stats", "cpu_temp", "cpu_power",
         "cpu_mhz", "core_load", "gpu_stats", "gpu_temp", "gpu_junction_temp", "gpu_mem_temp", "gpu_power",
         "gpu_core_clock", "gpu_mem_clock", "gpu_voltage", "gpu_fan", "gpu_name", "vulkan_driver", "ram", "vram",
         "swap", "procmem", "io_read", "io_write", "battery", "battery_time", "battery_watt", "throttling_status",
         "fan", "engine_version", "wine", "arch", "resolution", "refresh_rate", "show_fps_limit", "present_mode",
         "fsr", "hdr", "gamemode", "vkbasalt", "time", "version", "frame_count", "display_server", "horizontal"]


def _config_path():
    for comm in glob.glob("/proc/[0-9]*/comm"):
        try:
            with open(comm) as f:
                if f.read().strip() != "mangoapp":
                    continue
            with open(comm.replace("comm", "environ"), "rb") as f:
                for var in f.read().split(b"\0"):
                    if var.startswith(b"MANGOHUD_CONFIGFILE="):
                        return var.split(b"=", 1)[1].decode()
        except OSError:
            continue
    return None


def _ascii(text: str) -> str:
    """The overlay font has no emoji; keep it to plain characters."""
    return re.sub(r"[^\x20-\x7E -ɏ]", "", text).strip()


class Overlay:
    def __init__(self):
        self.lines = []
        self.task = None
        self.hide_stats = False
        self.position = None

    def set_style(self, hide_stats: bool, position):
        self.hide_stats = bool(hide_stats)
        self.position = position if position in POSITIONS else None
        self._apply()

    def render(self, note: dict) -> list:
        items = note.get("checklist") or []
        todo = [i for i in items if not i.get("done")]
        lines = [f"[ {_ascii(note.get('title', 'To do'))} ]  {len(items) - len(todo)}/{len(items)} done"]
        lines += [f"  - {_ascii(i.get('text', ''))[:48]}" for i in todo[:6]]
        if len(todo) > 6:
            lines.append(f"  ...and {len(todo) - 6} more")
        if not todo and items:
            lines.append("  All done!")
        return lines

    def set_note(self, note):
        self.lines = self.render(note) if note else []
        self._apply()

    def clear(self):
        self.lines = []
        self._apply()

    def status(self) -> dict:
        return {"overlayRunning": _config_path() is not None, "pinned": bool(self.lines)}

    def _apply(self):
        path = _config_path()
        if not path or not os.path.exists(path):
            return
        try:
            with open(path) as f:
                text = f.read()
            base = re.sub(rf"\n?{BEGIN}.*?{END}\n?", "\n", text, flags=re.S).rstrip("\n")
            new = base + "\n"
            if self.lines:
                block = [f"{name}=0" for name in STATS] if self.hide_stats else []
                if self.position:
                    block.append(f"position={self.position}")
                block += [f"custom_text={line}" for line in self.lines]
                new += "\n".join([BEGIN] + block + [END]) + "\n"
            if new != text:
                with open(path, "w") as f:
                    f.write(new)
        except OSError as e:
            decky.logger.warning("Overlay update failed: %s", e)

    async def loop(self):
        # Steam rewrites the config when the overlay level changes; put our lines back.
        while True:
            await asyncio.sleep(3)
            if self.lines:
                self._apply()
