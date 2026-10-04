import asyncio
import os
import shutil
import signal
import time
import uuid

import decky
import storage


class Recorder:
    """Records the default microphone to a WAV file using PipeWire (or ALSA as a fallback)."""

    def __init__(self):
        self.proc = None
        self.path = None
        self.item = None
        self.started = 0.0

    def _command(self, path: str) -> list:
        if shutil.which("pw-record"):
            return ["pw-record", "--rate", "16000", "--channels", "1", "--format", "s16", path]
        if shutil.which("arecord"):
            return ["arecord", "-q", "-f", "S16_LE", "-r", "16000", "-c", "1", path]
        raise RuntimeError("No recorder found (need pw-record or arecord)")

    async def start(self, appid: str) -> dict:
        """A voice note, saved with the game's media."""
        rec_id = str(uuid.uuid4())
        item = {"id": rec_id, "file": rec_id + ".wav", "createdAt": int(time.time() * 1000)}
        await self.start_to(os.path.join(storage.media_dir(appid), item["file"]), item)
        return item

    async def start_to(self, path: str, item: dict = None):
        if self.proc:
            await self.stop()
        env = dict(os.environ)
        env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
        self.proc = await asyncio.create_subprocess_exec(
            *self._command(path),
            env=env,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self.path = path
        self.item = item or {}
        self.started = time.time()
        await asyncio.sleep(0.3)
        if self.proc.returncode is not None:
            err = (await self.proc.stderr.read()).decode(errors="replace")
            self.proc = None
            raise RuntimeError(f"Recorder exited: {err.strip()}")

    async def stop(self):
        if not self.proc:
            return None
        proc, item, path = self.proc, self.item, self.path
        self.proc = None
        try:
            proc.send_signal(signal.SIGINT)
            await asyncio.wait_for(proc.wait(), timeout=3)
        except (ProcessLookupError, asyncio.TimeoutError):
            proc.kill()
        item["durationSec"] = round(time.time() - self.started, 1)
        if not os.path.exists(path) or os.path.getsize(path) < 1024:
            decky.logger.warning("Recording produced no audio: %s", path)
            return None
        return item

    def status(self) -> dict:
        if not self.proc:
            return {"recording": False}
        return {"recording": True, "elapsed": time.time() - self.started, "item": self.item}
