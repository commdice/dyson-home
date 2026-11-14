"""Review requests: import completed jobs and ask every customer for a review.

Compliance notes (Google review policy + CAN-SPAM/TCPA):
  * Every eligible customer gets the SAME message and the SAME public review
    link. There is deliberately no "were you happy?" pre-screen — routing only
    happy customers to Google ("review gating") violates Google policy.
  * No incentives (discounts, gifts) are offered in exchange for reviews.
  * At most one initial ask + one reminder per job, and opt-outs are honoured.
  * SMS is only sent to customers you have consent to text.
"""

from __future__ import annotations

import csv
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import Config
from .db import now

EMAIL_SUBJECT = "Thanks for choosing {business}!"

EMAIL_BODY = """Hi {first_name},

Thank you for trusting {business} with {job}. We'd really value your honest
feedback — good or bad, it helps us improve and helps neighbours choose.

Leave a Google review (takes about a minute):
{link}

Thanks again,
The {business} team

Don't want these emails? Reply STOP and we'll remove you.
"""

REMINDER_BODY = """Hi {first_name},

Just a quick follow-up from {business}. If you have a minute, we'd appreciate
an honest Google review of your recent job:
{link}

This is the last reminder we'll send. Reply STOP to opt out.

The {business} team
"""

SMS_BODY = "Hi {first_name}, thanks for choosing {business}! We'd value your honest review: {link} Reply STOP to opt out."


def import_jobs_csv(conn: sqlite3.Connection, path: str | Path) -> int:
    """Import completed jobs. CSV columns: job_id,name,email,phone,job_summary,completed_at,sms_consent

    completed_at is ISO-8601 (date or datetime). Existing job_ids are skipped.
    Phone numbers are only stored when sms_consent is yes/true/1.
    """
    added = 0
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            job_id = (row.get("job_id") or "").strip()
            name = (row.get("name") or "").strip()
            completed = (row.get("completed_at") or "").strip()
            if not (job_id and name and completed):
                continue
            consent = (row.get("sms_consent") or "").strip().lower() in ("1", "y", "yes", "true")
            cur = conn.execute(
                """INSERT OR IGNORE INTO customers
                   (job_id, name, email, phone, job_summary, completed_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    job_id,
                    name,
                    (row.get("email") or "").strip() or None,
                    ((row.get("phone") or "").strip() or None) if consent else None,
                    (row.get("job_summary") or "").strip() or "your recent project",
                    _parse_dt(completed).isoformat(timespec="seconds"),
                    now(),
                ),
            )
            added += cur.rowcount
    conn.commit()
    return added


def opt_out(conn: sqlite3.Connection, contact: str) -> int:
    cur = conn.execute(
        "UPDATE customers SET opted_out = 1 WHERE lower(email) = lower(?) OR phone = ?",
        (contact, contact),
    )
    conn.commit()
    return cur.rowcount


def due_requests(conn: sqlite3.Connection, cfg: Config, at: datetime | None = None) -> list[tuple[sqlite3.Row, str]]:
    """Return (customer, kind) pairs that should be contacted now."""
    at = at or datetime.now(timezone.utc)
    initial_cutoff = (at - timedelta(days=cfg.request_delay_days)).isoformat(timespec="seconds")
    reminder_cutoff = (at - timedelta(days=cfg.reminder_after_days)).isoformat(timespec="seconds")

    initial = conn.execute(
        """SELECT c.* FROM customers c
           WHERE c.opted_out = 0 AND c.completed_at <= ?
             AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM review_requests r WHERE r.customer_id = c.id)
           ORDER BY c.completed_at""",
        (initial_cutoff,),
    ).fetchall()
    reminders = conn.execute(
        """SELECT c.* FROM customers c
           JOIN review_requests r ON r.customer_id = c.id AND r.kind = 'initial'
           WHERE c.opted_out = 0 AND r.sent_at <= ?
             AND c.email IS NOT NULL  -- reminders are email-only; SMS gets one ask
             AND NOT EXISTS (SELECT 1 FROM review_requests r2
                             WHERE r2.customer_id = c.id AND r2.kind = 'reminder')
             AND NOT EXISTS (SELECT 1 FROM reviews v
                             WHERE lower(v.reviewer_name) = lower(c.name))
           ORDER BY r.sent_at""",
        (reminder_cutoff,),
    ).fetchall()
    out = [(c, "initial") for c in initial] + [(c, "reminder") for c in reminders]
    return out[: cfg.max_requests_per_run]


def send_due_requests(conn: sqlite3.Connection, cfg: Config, sender, at: datetime | None = None) -> int:
    sent = 0
    for customer, kind in due_requests(conn, cfg, at):
        ctx = {
            "first_name": customer["name"].split()[0],
            "business": cfg.business_name,
            "job": customer["job_summary"],
            "link": cfg.review_link,
        }
        channel = None
        try:
            if customer["email"] and sender.can_email:
                body = (EMAIL_BODY if kind == "initial" else REMINDER_BODY).format(**ctx)
                sender.send_email(customer["email"], EMAIL_SUBJECT.format(**ctx), body)
                channel = "email"
            elif customer["phone"] and sender.can_sms and kind == "initial":
                sender.send_sms(customer["phone"], SMS_BODY.format(**ctx))
                channel = "sms"
        except Exception as exc:  # keep going; one bad address shouldn't stop the batch
            print(f"! failed to contact job {customer['job_id']}: {exc}")
            continue
        if channel:
            conn.execute(
                "INSERT INTO review_requests (customer_id, kind, channel, sent_at) VALUES (?, ?, ?, ?)",
                (customer["id"], kind, channel, (at or datetime.now(timezone.utc)).isoformat(timespec="seconds")),
            )
            conn.commit()
            sent += 1
    return sent


def _parse_dt(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
