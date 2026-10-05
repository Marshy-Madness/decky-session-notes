"""Reader view pages, kept on the server so a link opened once loads instantly afterwards on every device.

Each page is one JSON file named after its URL. A file's modified time is when someone last viewed it; pages
nobody has viewed for the admin's chosen number of days are deleted (never, if that's set to 0)."""
import hashlib
import json
import os
import threading
import time

import reader

DAY_CHOICES = (30, 60, 90, 180, 365, 0)  # 0 = never delete
DEFAULT_DAYS = 90
PRUNE_EVERY_SEC = 3600


def clean_days(value) -> int:
    """The closest allowed choice, so a hand-made request can't store something odd."""
    try:
        days = int(value)
    except (TypeError, ValueError):
        return DEFAULT_DAYS
    if days <= 0:
        return 0
    return min((d for d in DAY_CHOICES if d), key=lambda d: abs(d - days))


class ReaderCache:
    def __init__(self, data_dir: str):
        self.dir = os.path.join(data_dir, "reader")
        os.makedirs(self.dir, exist_ok=True)
        self.locks: dict = {}
        self.locks_lock = threading.Lock()

    def _path(self, url: str) -> str:
        return os.path.join(self.dir, hashlib.sha256(url.strip().encode()).hexdigest() + ".json")

    def _lock(self, path: str) -> threading.Lock:
        with self.locks_lock:
            return self.locks.setdefault(path, threading.Lock())

    def get(self, url: str, refresh: bool = False) -> dict:
        """The reader page for `url`, from the cache unless it's missing or `refresh` is set. Raises ValueError
        with a readable reason when the page can't be fetched or has no article."""
        path = self._path(url)
        with self._lock(path):  # two devices opening the same link fetch it once
            if not refresh and os.path.exists(path):
                try:
                    with open(path) as f:
                        page = json.load(f)
                    os.utime(path)  # viewed now
                    return {**page, "cached": True}
                except (OSError, ValueError):
                    pass
            page = reader.extract(url)
            tmp = path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(page, f)
            os.replace(tmp, path)
            # The link someone tapped may redirect; keep it under both addresses.
            if page.get("url") and page["url"] != url:
                try:
                    with open(self._path(page["url"]) + ".tmp", "w") as f:
                        json.dump(page, f)
                    os.replace(self._path(page["url"]) + ".tmp", self._path(page["url"]))
                except OSError:
                    pass
            return {**page, "cached": False}

    def prune(self, days: int) -> int:
        """Deletes pages not viewed in `days` days. Returns how many went."""
        if days <= 0:
            return 0
        cutoff = time.time() - days * 86400
        removed = 0
        for name in os.listdir(self.dir):
            path = os.path.join(self.dir, name)
            try:
                if os.path.getmtime(path) < cutoff:
                    os.remove(path)
                    removed += 1
            except OSError:
                pass
        return removed

    def clear(self) -> int:
        removed = 0
        for name in os.listdir(self.dir):
            try:
                os.remove(os.path.join(self.dir, name))
                removed += 1
            except OSError:
                pass
        return removed

    def stats(self) -> dict:
        pages = size = 0
        for name in os.listdir(self.dir):
            if name.endswith(".json"):
                pages += 1
                try:
                    size += os.path.getsize(os.path.join(self.dir, name))
                except OSError:
                    pass
        return {"pages": pages, "bytes": size}

    def start_pruning(self, days_fn):
        """Prunes now and then every hour, using whatever `days_fn()` says at the time."""
        def loop():
            while True:
                try:
                    n = self.prune(days_fn())
                    if n:
                        print(f"Reader cache: removed {n} page(s) nobody viewed lately", flush=True)
                except Exception as e:  # keep going; a bad file shouldn't stop pruning for good
                    print(f"Reader cache prune failed: {e}", flush=True)
                time.sleep(PRUNE_EVERY_SEC)
        threading.Thread(target=loop, daemon=True).start()
