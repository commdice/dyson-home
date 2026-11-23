"""Outbound channels: email (SMTP) and SMS (Twilio REST)."""

from __future__ import annotations

import base64
import smtplib
import urllib.parse
import urllib.request
from email.message import EmailMessage
from typing import Protocol

from .config import Config


class Sender(Protocol):
    def send_email(self, to: str, subject: str, body: str) -> None: ...
    def send_sms(self, to: str, body: str) -> None: ...


class LiveSender:
    def __init__(self, cfg: Config):
        self.cfg = cfg

    @property
    def can_email(self) -> bool:
        return bool(self.cfg.smtp_host and self.cfg.smtp_from)

    @property
    def can_sms(self) -> bool:
        return bool(self.cfg.twilio_sid and self.cfg.twilio_token and self.cfg.twilio_from)

    def send_email(self, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"] = self.cfg.smtp_from
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        with smtplib.SMTP(self.cfg.smtp_host, self.cfg.smtp_port, timeout=30) as s:
            s.starttls()
            if self.cfg.smtp_user:
                s.login(self.cfg.smtp_user, self.cfg.smtp_password)
            s.send_message(msg)

    def send_sms(self, to: str, body: str) -> None:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.cfg.twilio_sid}/Messages.json"
        data = urllib.parse.urlencode({"To": to, "From": self.cfg.twilio_from, "Body": body}).encode()
        auth = base64.b64encode(f"{self.cfg.twilio_sid}:{self.cfg.twilio_token}".encode()).decode()
        req = urllib.request.Request(url, data=data, headers={"Authorization": f"Basic {auth}"})
        urllib.request.urlopen(req, timeout=30).close()


class DryRunSender:
    """Prints instead of sending; also used in tests to capture output."""

    can_email = True
    can_sms = True

    def __init__(self) -> None:
        self.sent: list[tuple] = []

    def send_email(self, to: str, subject: str, body: str) -> None:
        self.sent.append(("email", to, subject, body))
        print(f"[dry-run] email -> {to}: {subject}")

    def send_sms(self, to: str, body: str) -> None:
        self.sent.append(("sms", to, body))
        print(f"[dry-run] sms -> {to}: {body[:60]}...")
