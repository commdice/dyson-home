"""SQLite storage for customers, review requests, reviews and reply drafts."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS customers (
    id           INTEGER PRIMARY KEY,
    job_id       TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    email        TEXT,
    phone        TEXT,
    job_summary  TEXT,
    completed_at TEXT NOT NULL,
    opted_out    INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_requests (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    kind        TEXT NOT NULL CHECK (kind IN ('initial', 'reminder')),
    channel     TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
    sent_at     TEXT NOT NULL,
    UNIQUE (customer_id, kind)
);

CREATE TABLE IF NOT EXISTS reviews (
    review_id     TEXT PRIMARY KEY,
    reviewer_name TEXT,
    rating        INTEGER,
    comment       TEXT,
    created_at    TEXT,
    updated_at    TEXT,
    has_reply     INTEGER NOT NULL DEFAULT 0,
    alerted       INTEGER NOT NULL DEFAULT 0,
    fetched_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reply_drafts (
    review_id   TEXT PRIMARY KEY REFERENCES reviews(review_id),
    draft       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'posted')),
    created_at  TEXT NOT NULL,
    decided_at  TEXT,
    posted_at   TEXT
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn
