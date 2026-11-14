"""Command-line entry point: `reviewbot <command>`."""

from __future__ import annotations

import argparse
import json
import sys

from . import monitor, outreach, replies
from .config import Config
from .db import connect
from .notify import DryRunSender, LiveSender


def _sender(cfg: Config):
    return DryRunSender() if cfg.dry_run else LiveSender(cfg)


def cmd_import(cfg, conn, args):
    print(f"Imported {outreach.import_jobs_csv(conn, args.csv)} new job(s).")


def cmd_optout(cfg, conn, args):
    print(f"Opted out {outreach.opt_out(conn, args.contact)} customer(s).")


def cmd_send(cfg, conn, args):
    if not cfg.google_place_id:
        sys.exit("GOOGLE_PLACE_ID is required to build the review link.")
    print(f"Sent {outreach.send_due_requests(conn, cfg, _sender(cfg))} review request(s).")


def cmd_sync(cfg, conn, args):
    from .google_api import GoogleBusinessClient

    new = monitor.store_reviews(conn, GoogleBusinessClient(cfg).list_reviews())
    alerts = monitor.alert_low_ratings(conn, cfg, _sender(cfg))
    print(f"Synced reviews: {new} new, {alerts} low-rating alert(s) sent.")


def cmd_draft(cfg, conn, args):
    n = replies.draft_replies(conn, cfg, replies.claude_drafter(cfg), limit=args.limit)
    print(f"Drafted {n} reply/replies. Run `reviewbot approve` to review them.")


def cmd_approve(cfg, conn, args):
    queue = replies.pending(conn)
    if not queue:
        print("No drafts waiting.")
        return
    for row in queue:
        print("\n" + "=" * 70)
        print(f"{row['rating']}★  {row['reviewer_name']}\n> {row['comment'] or '(no text)'}")
        print(f"\nDraft reply:\n{row['draft']}\n")
        choice = input("[a]pprove / [e]dit / [r]eject / [s]kip / [q]uit: ").strip().lower()
        if choice == "a":
            replies.decide(conn, row["review_id"], "approved")
        elif choice == "e":
            replies.decide(conn, row["review_id"], "approved", input("New reply: ").strip())
        elif choice == "r":
            replies.decide(conn, row["review_id"], "rejected")
        elif choice == "q":
            break


def cmd_post(cfg, conn, args):
    from .google_api import GoogleBusinessClient

    client = None if cfg.dry_run else GoogleBusinessClient(cfg)
    print(f"Posted {replies.post_approved(conn, client, dry_run=cfg.dry_run)} approved reply/replies.")


def cmd_run(cfg, conn, args):
    """Scheduled job: send requests, sync reviews, draft replies. Never auto-posts."""
    cmd_send(cfg, conn, args)
    if cfg.google_refresh_token:
        cmd_sync(cfg, conn, args)
        try:
            cmd_draft(cfg, conn, args)
        except ImportError:
            print("anthropic not installed; skipping reply drafting (uv sync --extra ai).")
    else:
        print("Google API not configured; skipping review sync.")


def cmd_stats(cfg, conn, args):
    print(json.dumps(monitor.stats(conn), indent=2))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="reviewbot", description=__doc__)
    p.add_argument("--env", default=".env", help="path to .env file")
    p.add_argument("--dry-run", action="store_true", help="print instead of sending/posting")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("import", help="import completed jobs from CSV")
    s.add_argument("csv")
    s.set_defaults(fn=cmd_import)
    s = sub.add_parser("opt-out", help="stop contacting an email/phone")
    s.add_argument("contact")
    s.set_defaults(fn=cmd_optout)
    sub.add_parser("send", help="send due review requests").set_defaults(fn=cmd_send)
    sub.add_parser("sync", help="pull reviews from Google, alert on low stars").set_defaults(fn=cmd_sync)
    s = sub.add_parser("draft", help="draft replies with Claude")
    s.add_argument("--limit", type=int, default=20)
    s.set_defaults(fn=cmd_draft)
    sub.add_parser("approve", help="interactively approve/edit/reject drafts").set_defaults(fn=cmd_approve)
    sub.add_parser("post", help="post approved replies to Google").set_defaults(fn=cmd_post)
    s = sub.add_parser("run", help="scheduled: send + sync + draft (never posts)")
    s.add_argument("--limit", type=int, default=20)
    s.set_defaults(fn=cmd_run)
    sub.add_parser("stats", help="show review metrics").set_defaults(fn=cmd_stats)

    args = p.parse_args(argv)
    cfg = Config.from_env(args.env)
    cfg.dry_run = cfg.dry_run or args.dry_run
    with connect(cfg.db_path) as conn:
        args.fn(cfg, conn, args)


if __name__ == "__main__":
    main()
