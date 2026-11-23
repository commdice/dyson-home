"""Sync reviews from Google and alert staff about low ratings."""

from __future__ import annotations

import sqlite3

from .config import Config
from .db import now


def store_reviews(conn: sqlite3.Connection, reviews: list[dict]) -> int:
    """Upsert reviews; returns how many were new."""
    new = 0
    for r in reviews:
        exists = conn.execute("SELECT 1 FROM reviews WHERE review_id = ?", (r["review_id"],)).fetchone()
        if exists:
            conn.execute(
                """UPDATE reviews SET rating=?, comment=?, updated_at=?, has_reply=?, fetched_at=?
                   WHERE review_id=?""",
                (r["rating"], r["comment"], r["updated_at"], r["has_reply"], now(), r["review_id"]),
            )
        else:
            conn.execute(
                """INSERT INTO reviews (review_id, reviewer_name, rating, comment, created_at,
                                        updated_at, has_reply, fetched_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (r["review_id"], r["reviewer_name"], r["rating"], r["comment"], r["created_at"],
                 r["updated_at"], r["has_reply"], now()),
            )
            new += 1
    conn.commit()
    return new


def alert_low_ratings(conn: sqlite3.Connection, cfg: Config, sender) -> int:
    """Email staff once per low-rated review so someone can follow up personally."""
    if not cfg.alert_email:
        return 0
    rows = conn.execute(
        "SELECT * FROM reviews WHERE alerted = 0 AND rating > 0 AND rating <= ?",
        (cfg.low_star_threshold,),
    ).fetchall()
    for r in rows:
        sender.send_email(
            cfg.alert_email,
            f"[{cfg.business_name}] {r['rating']}-star Google review from {r['reviewer_name']}",
            f"Rating: {r['rating']}/5\nReviewer: {r['reviewer_name']}\nDate: {r['created_at']}\n\n"
            f"{r['comment'] or '(no text)'}\n\n"
            "A reply draft is queued for approval. Consider reaching out to the customer directly.",
        )
        conn.execute("UPDATE reviews SET alerted = 1 WHERE review_id = ?", (r["review_id"],))
    conn.commit()
    return len(rows)


def stats(conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        "SELECT COUNT(*) n, AVG(rating) avg, SUM(has_reply = 0) unanswered FROM reviews WHERE rating > 0"
    ).fetchone()
    dist = dict(conn.execute("SELECT rating, COUNT(*) FROM reviews GROUP BY rating").fetchall())
    req = conn.execute(
        "SELECT COUNT(DISTINCT customer_id) contacted, COUNT(*) messages FROM review_requests"
    ).fetchone()
    customers = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
    return {
        "reviews": row["n"],
        "average": round(row["avg"], 2) if row["avg"] else None,
        "unanswered": row["unanswered"] or 0,
        "distribution": {s: dist.get(s, 0) for s in range(5, 0, -1)},
        "customers": customers,
        "customers_contacted": req["contacted"],
        "messages_sent": req["messages"],
        "pending_drafts": conn.execute(
            "SELECT COUNT(*) FROM reply_drafts WHERE status = 'pending'").fetchone()[0],
    }
