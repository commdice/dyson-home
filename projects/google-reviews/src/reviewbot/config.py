"""Configuration loaded from environment variables (optionally via a .env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def load_dotenv(path: str | Path = ".env") -> None:
    """Minimal .env loader: KEY=VALUE lines, existing env vars win."""
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


@dataclass
class Config:
    business_name: str = "Our Shop"
    google_place_id: str = ""
    db_path: str = "reviewbot.db"

    # Review-request cadence
    request_delay_days: int = 1  # wait after job completion before first ask
    reminder_after_days: int = 5  # single follow-up if they haven't reviewed
    max_requests_per_run: int = 50

    # SMTP (email requests + staff alerts)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    alert_email: str = ""  # staff inbox for low-star alerts
    low_star_threshold: int = 3  # alert when rating <= this

    # Twilio (optional SMS requests)
    twilio_sid: str = ""
    twilio_token: str = ""
    twilio_from: str = ""

    # Google Business Profile API (OAuth refresh-token flow)
    google_client_id: str = ""
    google_client_secret: str = ""
    google_refresh_token: str = ""
    google_account_id: str = ""
    google_location_id: str = ""

    # Claude reply drafting
    anthropic_model: str = "claude-sonnet-5-5"
    reply_tone: str = "warm, professional, concise; sign off as the team"
    dry_run: bool = False
    extra: dict = field(default_factory=dict)

    @property
    def review_link(self) -> str:
        return f"https://search.google.com/local/writereview?placeid={self.google_place_id}"

    @classmethod
    def from_env(cls, dotenv: str | Path = ".env") -> "Config":
        load_dotenv(dotenv)
        e = os.environ.get
        return cls(
            business_name=e("BUSINESS_NAME", "Our Shop"),
            google_place_id=e("GOOGLE_PLACE_ID", ""),
            db_path=e("REVIEWBOT_DB", "reviewbot.db"),
            request_delay_days=_int("REQUEST_DELAY_DAYS", 1),
            reminder_after_days=_int("REMINDER_AFTER_DAYS", 5),
            max_requests_per_run=_int("MAX_REQUESTS_PER_RUN", 50),
            smtp_host=e("SMTP_HOST", ""),
            smtp_port=_int("SMTP_PORT", 587),
            smtp_user=e("SMTP_USER", ""),
            smtp_password=e("SMTP_PASSWORD", ""),
            smtp_from=e("SMTP_FROM", ""),
            alert_email=e("ALERT_EMAIL", ""),
            low_star_threshold=_int("LOW_STAR_THRESHOLD", 3),
            twilio_sid=e("TWILIO_ACCOUNT_SID", ""),
            twilio_token=e("TWILIO_AUTH_TOKEN", ""),
            twilio_from=e("TWILIO_FROM", ""),
            google_client_id=e("GOOGLE_CLIENT_ID", ""),
            google_client_secret=e("GOOGLE_CLIENT_SECRET", ""),
            google_refresh_token=e("GOOGLE_REFRESH_TOKEN", ""),
            google_account_id=e("GOOGLE_ACCOUNT_ID", ""),
            google_location_id=e("GOOGLE_LOCATION_ID", ""),
            anthropic_model=e("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
            reply_tone=e("REPLY_TONE", "warm, professional, concise; sign off as the team"),
            dry_run=e("DRY_RUN", "").lower() in ("1", "true", "yes"),
        )
