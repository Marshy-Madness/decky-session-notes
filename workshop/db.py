"""SQLite storage for the Madness Workshop."""
import json
import os
import sqlite3
import threading

DATA = os.environ.get("DATA_DIR", "/data")
DB_PATH = os.path.join(DATA, "bookstore.db")  # name kept from when the Workshop was the Bookstore
_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  steam_id TEXT PRIMARY KEY, name TEXT, avatar TEXT, created_at INTEGER, banned INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, game_name TEXT, title TEXT, body TEXT, kind TEXT,
  tags TEXT, checklist TEXT, screenshots TEXT, recordings TEXT,
  spoiler INTEGER DEFAULT 0, spoiler_label TEXT,
  author TEXT NOT NULL, edit_policy TEXT DEFAULT 'owner', editors TEXT DEFAULT '[]', allow_copy INTEGER DEFAULT 1,
  created_at INTEGER, updated_at INTEGER, updated_by TEXT, likes INTEGER DEFAULT 0, comments INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS entries_app ON entries(app_id);
CREATE TABLE IF NOT EXISTS entry_versions (entry_id TEXT, saved_at INTEGER, saved_by TEXT, data TEXT);
CREATE INDEX IF NOT EXISTS versions_entry ON entry_versions(entry_id);
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, entry_id TEXT, author TEXT, text TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS comments_entry ON comments(entry_id);
CREATE TABLE IF NOT EXISTS likes (entry_id TEXT, steam_id TEXT, PRIMARY KEY (entry_id, steam_id));
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, steam_id TEXT, exp INTEGER);
CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, steam_id TEXT, label TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS device_codes (device_code TEXT PRIMARY KEY, user_code TEXT UNIQUE, steam_id TEXT, label TEXT, exp INTEGER);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS modlog (at INTEGER, actor TEXT, action TEXT, target TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, kind TEXT, target_id TEXT, entry_id TEXT, reporter TEXT, reason TEXT,
  created_at INTEGER, status TEXT DEFAULT 'open', resolved_by TEXT, resolved_at INTEGER);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status);
"""

# Columns added after the first release: (table, column, definition)
MIGRATIONS = [
    ("entries", "pinned", "INTEGER DEFAULT 0"),      # shown first on the game's page
    ("entries", "locked", "INTEGER DEFAULT 0"),      # only admins can edit or comment
    ("entries", "status", "TEXT DEFAULT 'published'"),  # published | pending (waiting for an admin) | hidden
    ("users", "role", "TEXT DEFAULT ''"),            # 'admin' = moderator (ADMIN_STEAM_IDS are always admins)
    ("users", "ban_reason", "TEXT"),
    ("users", "last_login", "INTEGER"),
]

JSON_COLS = ("tags", "checklist", "screenshots", "recordings", "editors")


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        os.makedirs(DATA, exist_ok=True)
        c = sqlite3.connect(DB_PATH, timeout=15)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        _local.conn = c
    return c


def init():
    c = conn()
    c.executescript(SCHEMA)
    for table, col, definition in MIGRATIONS:
        if col not in {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}:
            c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {definition}")
    c.execute("CREATE INDEX IF NOT EXISTS entries_status ON entries(status)")
    c.commit()


def row_to_entry(row) -> dict:
    e = dict(row)
    for k in JSON_COLS:
        e[k] = json.loads(e.get(k) or "[]")
    e["spoiler"] = bool(e["spoiler"])
    e["allow_copy"] = bool(e["allow_copy"])
    e["pinned"] = bool(e.get("pinned"))
    e["locked"] = bool(e.get("locked"))
    e["status"] = e.get("status") or "published"
    return e
