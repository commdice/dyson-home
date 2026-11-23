"""Draft review replies with Claude; a human approves before anything is posted."""

from __future__ import annotations

import sqlite3
from typing import Callable

from .config import Config
from .db import now

SYSTEM = """You write public replies to Google reviews on behalf of {business}.
Tone: {tone}.
Rules:
- 2-4 sentences, plain text, no hashtags or emojis.
- Thank the reviewer by first name if one is given.
- Reference something specific they mentioned, if anything.
- For negative or mixed reviews: acknowledge the issue, apologise sincerely without
  admitting legal liability, and invite them to contact the shop directly to make it right.
  Never argue, never reveal private customer or job details, never offer compensation publicly.
- Never ask them to change or remove their review.
- Output only the reply text."""

Drafter = Callable[[str, str], str]  # (system, user) -> reply text


def claude_drafter(cfg: Config) -> Drafter:
    import anthropic  # optional dependency: `uv sync --extra ai`

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY

    def draft(system: str, user: str) -> str:
        msg = client.messages.create(
            model=cfg.anthropic_model,
            max_tokens=400,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(b.text for b in msg.content if b.type == "text").strip()

    return draft


def draft_replies(conn: sqlite3.Connection, cfg: Config, drafter: Drafter, limit: int = 20) -> int:
    rows = conn.execute(
        """SELECT v.* FROM reviews v
           LEFT JOIN reply_drafts d ON d.review_id = v.review_id
           WHERE v.has_reply = 0 AND d.review_id IS NULL
           ORDER BY v.rating ASC, v.created_at DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    system = SYSTEM.format(business=cfg.business_name, tone=cfg.reply_tone)
    for r in rows:
        user = (
            f"Reviewer: {r['reviewer_name']}\nRating: {r['rating']}/5\n"
            f"Review text: {r['comment'] or '(rating only, no text)'}"
        )
        text = drafter(system, user)
        conn.execute(
            "INSERT INTO reply_drafts (review_id, draft, created_at) VALUES (?, ?, ?)",
            (r["review_id"], text, now()),
        )
        conn.commit()
    return len(rows)


def pending(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        """SELECT d.review_id, d.draft, v.reviewer_name, v.rating, v.comment
           FROM reply_drafts d JOIN reviews v USING (review_id)
           WHERE d.status = 'pending' ORDER BY v.rating ASC""",
    ).fetchall()


def decide(conn: sqlite3.Connection, review_id: str, status: str, edited: str | None = None) -> None:
    assert status in ("approved", "rejected")
    if edited:
        conn.execute("UPDATE reply_drafts SET draft = ? WHERE review_id = ?", (edited, review_id))
    conn.execute(
        "UPDATE reply_drafts SET status = ?, decided_at = ? WHERE review_id = ?",
        (status, now(), review_id),
    )
    conn.commit()


def post_approved(conn: sqlite3.Connection, client, dry_run: bool = False) -> int:
    rows = conn.execute("SELECT * FROM reply_drafts WHERE status = 'approved'").fetchall()
    for d in rows:
        if dry_run:
            print(f"[dry-run] reply to {d['review_id']}: {d['draft'][:70]}...")
            continue
        client.post_reply(d["review_id"], d["draft"])
        conn.execute(
            "UPDATE reply_drafts SET status = 'posted', posted_at = ? WHERE review_id = ?",
            (now(), d["review_id"]),
        )
        conn.execute("UPDATE reviews SET has_reply = 1 WHERE review_id = ?", (d["review_id"],))
        conn.commit()
    return len(rows)
