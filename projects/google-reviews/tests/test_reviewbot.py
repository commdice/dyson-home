from datetime import datetime, timedelta, timezone

import pytest

from reviewbot import monitor, outreach, replies
from reviewbot.config import Config
from reviewbot.db import connect
from reviewbot.google_api import normalise
from reviewbot.notify import DryRunSender

NOW = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)


@pytest.fixture
def cfg():
    return Config(business_name="Acme Paints", google_place_id="PLACE123", alert_email="staff@example.com")


@pytest.fixture
def conn(tmp_path):
    return connect(str(tmp_path / "t.db"))


@pytest.fixture
def jobs_csv(tmp_path):
    p = tmp_path / "jobs.csv"
    p.write_text(
        "job_id,name,email,phone,job_summary,completed_at,sms_consent\n"
        "J1,Jane Doe,jane@example.com,,your exterior repaint,2026-11-10,no\n"
        "J2,Bob Ray,,+15550001,your colour consultation,2026-11-12,yes\n"
        "J3,Sam Lee,,+15550002,your deck stain,2026-11-12,no\n"
        "J4,Too New,new@example.com,,a job,2026-11-14T11:00:00,no\n"
    )
    return p


def test_import_is_idempotent_and_respects_sms_consent(conn, jobs_csv):
    assert outreach.import_jobs_csv(conn, jobs_csv) == 4
    assert outreach.import_jobs_csv(conn, jobs_csv) == 0
    phones = dict(conn.execute("SELECT job_id, phone FROM customers").fetchall())
    assert phones["J2"] == "+15550001"
    assert phones["J3"] is None  # no consent -> phone not stored


def test_everyone_gets_the_same_request_no_gating(conn, cfg, jobs_csv):
    outreach.import_jobs_csv(conn, jobs_csv)
    s = DryRunSender()
    assert outreach.send_due_requests(conn, cfg, s, at=NOW) == 2  # J1 email, J2 sms; J3 no contact; J4 too new
    email = next(m for m in s.sent if m[0] == "email")
    assert cfg.review_link in email[3] and "STOP" in email[3]
    sms = next(m for m in s.sent if m[0] == "sms")
    assert cfg.review_link in sms[2]
    # Running again immediately sends nothing new.
    assert outreach.send_due_requests(conn, cfg, s, at=NOW) == 0


def test_single_reminder_skipped_after_review_or_opt_out(conn, cfg, jobs_csv):
    outreach.import_jobs_csv(conn, jobs_csv)
    s = DryRunSender()
    outreach.send_due_requests(conn, cfg, s, at=NOW)
    later = NOW + timedelta(days=6)
    due = outreach.due_requests(conn, cfg, at=later)
    kinds = {(c["job_id"], k) for c, k in due}
    assert ("J1", "reminder") in kinds
    # Jane leaves a review -> no reminder
    monitor.store_reviews(conn, [{"review_id": "r1", "reviewer_name": "Jane Doe", "rating": 5,
                                  "comment": "", "created_at": "x", "updated_at": "x", "has_reply": 0}])
    assert ("J1", "reminder") not in {(c["job_id"], k) for c, k in outreach.due_requests(conn, cfg, at=later)}
    # Opt-out also stops it
    outreach.opt_out(conn, "+15550001")
    assert all(c["job_id"] != "J2" for c, _ in outreach.due_requests(conn, cfg, at=later))
    # SMS-only customers never get a reminder (one text max)
    outreach.import_jobs_csv(conn, jobs_csv)
    assert all(c["email"] for c, k in outreach.due_requests(conn, cfg, at=later) if k == "reminder")
    # Never more than one reminder per customer
    outreach.send_due_requests(conn, cfg, s, at=later)
    much_later = later + timedelta(days=30)
    outreach.send_due_requests(conn, cfg, s, at=much_later)
    counts = conn.execute(
        "SELECT customer_id, COUNT(*) FROM review_requests WHERE kind='reminder' GROUP BY customer_id"
    ).fetchall()
    assert counts and all(n == 1 for _, n in counts)
    assert outreach.due_requests(conn, cfg, at=much_later + timedelta(days=30)) == []


def test_normalise_google_payload():
    r = normalise({"reviewId": "abc", "reviewer": {"displayName": "Kim"}, "starRating": "TWO",
                   "comment": "Paint peeled", "createTime": "t", "updateTime": "t",
                   "reviewReply": {"comment": "sorry"}})
    assert r == {"review_id": "abc", "reviewer_name": "Kim", "rating": 2, "comment": "Paint peeled",
                 "created_at": "t", "updated_at": "t", "has_reply": 1}


def _reviews():
    base = {"created_at": "2026-11-13", "updated_at": "2026-11-13", "has_reply": 0}
    return [
        {**base, "review_id": "good", "reviewer_name": "Ann", "rating": 5, "comment": "Great job!"},
        {**base, "review_id": "bad", "reviewer_name": "Kim", "rating": 2, "comment": "Paint peeled"},
        {**base, "review_id": "done", "reviewer_name": "Lou", "rating": 4, "comment": "ok", "has_reply": 1},
    ]


def test_low_rating_alert_sent_once(conn, cfg):
    monitor.store_reviews(conn, _reviews())
    s = DryRunSender()
    assert monitor.alert_low_ratings(conn, cfg, s) == 1
    assert "2-star" in s.sent[0][2]
    assert monitor.alert_low_ratings(conn, cfg, s) == 0


def test_draft_approve_post_flow(conn, cfg):
    monitor.store_reviews(conn, _reviews())
    calls = []

    def fake_drafter(system, user):
        calls.append(user)
        return f"Thanks! ({user.splitlines()[0]})"

    assert replies.draft_replies(conn, cfg, fake_drafter) == 2  # 'done' already has a reply
    assert "Rating: 2/5" in calls[0]  # worst reviews drafted first
    assert replies.draft_replies(conn, cfg, fake_drafter) == 0  # no duplicate drafts

    queue = replies.pending(conn)
    replies.decide(conn, queue[0]["review_id"], "approved", "We're sorry, Kim — please call us.")
    replies.decide(conn, queue[1]["review_id"], "rejected")

    class FakeClient:
        posted = []

        def post_reply(self, rid, text):
            self.posted.append((rid, text))

    client = FakeClient()
    assert replies.post_approved(conn, client) == 1
    assert client.posted == [("bad", "We're sorry, Kim — please call us.")]
    assert replies.post_approved(conn, client) == 0
    st = monitor.stats(conn)
    assert st["reviews"] == 3 and st["unanswered"] == 1 and st["distribution"][2] == 1
