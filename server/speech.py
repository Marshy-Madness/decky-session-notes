"""Speech to text through a Whisper container (openai-whisper-asr-webservice), plus a per-user transcript cache."""
import json
import os
import secrets
import threading
import time
import urllib.parse
import urllib.request

WHISPER_URL = os.environ.get("WHISPER_URL", "").rstrip("/")
WHISPER_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "").strip()  # empty = detect per clip
MAX_AUDIO = 25 * 1024 * 1024
AUDIO_EXTS = {".wav", ".webm", ".ogg", ".m4a", ".mp3", ".mp4", ".aac", ".flac", ".opus", ".amr", ".3gp"}

gpu = threading.Semaphore(1)  # one clip at a time; the card is shared with everything else on the PC


def enabled() -> bool:
    return bool(WHISPER_URL)


def is_audio(name: str) -> bool:
    return os.path.splitext(name)[1].lower() in AUDIO_EXTS


def transcribe(audio: bytes, filename: str = "audio.webm", prompt: str = "", language: str = "") -> str:
    """Send a clip to Whisper and return the text. Any format ffmpeg reads works."""
    if not WHISPER_URL:
        raise RuntimeError("Speech to text isn't set up on this server (WHISPER_URL)")
    if len(audio) > MAX_AUDIO:
        raise ValueError("Recording is too long")
    params = {"task": "transcribe", "output": "json", "encode": "true", "vad_filter": "true"}
    lang = language or WHISPER_LANGUAGE
    if lang:
        params["language"] = lang
    if prompt:
        params["initial_prompt"] = prompt[:200]
    boundary = "----sn" + secrets.token_hex(12)
    safe_name = "".join(c for c in os.path.basename(filename) if c.isalnum() or c in "._-") or "audio.webm"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"audio_file\"; filename=\"{safe_name}\"\r\n"
            f"Content-Type: application/octet-stream\r\n\r\n").encode() + audio + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{WHISPER_URL}/asr?{urllib.parse.urlencode(params)}", data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with gpu:
        # The first clip after an idle unload also loads the model, so allow plenty of time.
        with urllib.request.urlopen(req, timeout=300) as r:
            raw = r.read()
    try:
        data = json.loads(raw)
        text = data.get("text", "") if isinstance(data, dict) else str(data)
    except ValueError:
        text = raw.decode(errors="replace")
    return " ".join(text.split())


class Transcripts:
    """users/<uid>/transcripts.json: {"<appid>/<file>": {"text": ..., "at": ms} or {"error": ..., "at": ms}}."""

    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()

    def load(self) -> dict:
        if os.path.exists(self.path):
            with open(self.path) as f:
                return json.load(f)
        return {}

    def get(self, appid: str, file: str):
        return self.load().get(f"{appid}/{file}")

    def put(self, appid: str, file: str, entry: dict):
        with self.lock:
            data = self.load()
            data[f"{appid}/{file}"] = {**entry, "at": int(time.time() * 1000)}
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            with open(self.path + ".tmp", "w") as f:
                json.dump(data, f)
            os.replace(self.path + ".tmp", self.path)


class RateLimit:
    """At most `per_hour` transcriptions per user per rolling hour."""

    def __init__(self, per_hour: int):
        self.per_hour = per_hour
        self.hits: dict = {}
        self.lock = threading.Lock()

    def allow(self, uid: str) -> bool:
        if self.per_hour <= 0:
            return True
        now = time.time()
        with self.lock:
            recent = [t for t in self.hits.get(uid, []) if t > now - 3600]
            if len(recent) >= self.per_hour:
                self.hits[uid] = recent
                return False
            self.hits[uid] = recent + [now]
            return True
