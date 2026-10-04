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
        self.appid = None
        self.item = None
        self.started = 0.0

    def _command(self, path: str) -> list:
        if shutil.which("pw-record"):
            return ["pw-record", "--rate", "16000", "--channels", "1", "--format", "s16", path]
        if shutil.which("arecord"):
            return ["arecord", "-q", "-f", "S16_LE", "-r", "16000", "-c", "1", path]
        raise RuntimeError("No recorder found (need pw-record or arecord)")

    async def start(self, appid: str) -> dict:
        if self.proc:
            await self.stop()
        rec_id = str(uuid.uuid4())
        filename = rec_id + ".wav"
        path = os.path.join(storage.media_dir(appid), filename)
        env = dict(os.environ)
        env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
        self.proc = await asyncio.create_subprocess_exec(
            *self._command(path),
            env=env,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self.appid = appid
        self.item = {"id": rec_id, "file": filename, "createdAt": int(time.time() * 1000)}
        self.started = time.time()
        await asyncio.sleep(0.3)
        if self.proc.returncode is not None:
            err = (await self.proc.stderr.read()).decode(errors="replace")
            self.proc = None
            raise RuntimeError(f"Recorder exited: {err.strip()}")
        return self.item

    async def stop(self):
        if not self.proc:
            return None
        proc, item = self.proc, self.item
        self.proc = None
        try:
            proc.send_signal(signal.SIGINT)
            await asyncio.wait_for(proc.wait(), timeout=3)
        except (ProcessLookupError, asyncio.TimeoutError):
            proc.kill()
        item["durationSec"] = round(time.time() - self.started, 1)
        path = os.path.join(storage.media_dir(self.appid), item["file"])
        if not os.path.exists(path) or os.path.getsize(path) < 1024:
            decky.logger.warning("Recording produced no audio: %s", path)
            return None
        return item

    def status(self) -> dict:
        if not self.proc:
            return {"recording": False}
        return {"recording": True, "elapsed": time.time() - self.started, "item": self.item}
