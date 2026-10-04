"""SQLite storage for the Bookstore."""
import json
import os
import sqlite3
import threading

DATA = os.environ.get("DATA_DIR", "/data")
DB_PATH = os.path.join(DATA, "bookstore.db")
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
"""

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
    conn().executescript(SCHEMA)
    conn().commit()


def row_to_entry(row) -> dict:
    e = dict(row)
    for k in JSON_COLS:
        e[k] = json.loads(e.get(k) or "[]")
    e["spoiler"] = bool(e["spoiler"])
    e["allow_copy"] = bool(e["allow_copy"])
    return e
