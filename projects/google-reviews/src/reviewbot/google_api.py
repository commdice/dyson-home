"""Google Business Profile API client (reviews list + reply) using only stdlib."""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request

from .config import Config

TOKEN_URL = "https://oauth2.googleapis.com/token"
API_BASE = "https://mybusiness.googleapis.com/v4"
STARS = {"ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5}


class GoogleBusinessClient:
    def __init__(self, cfg: Config):
        missing = [
            k
            for k in ("google_client_id", "google_client_secret", "google_refresh_token",
                      "google_account_id", "google_location_id")
            if not getattr(cfg, k)
        ]
        if missing:
            raise RuntimeError(f"Google API not configured; missing: {', '.join(missing)}")
        self.cfg = cfg
        self._token: str | None = None
        self._token_exp = 0.0

    @property
    def _location(self) -> str:
        return f"accounts/{self.cfg.google_account_id}/locations/{self.cfg.google_location_id}"

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        data = urllib.parse.urlencode({
            "client_id": self.cfg.google_client_id,
            "client_secret": self.cfg.google_client_secret,
            "refresh_token": self.cfg.google_refresh_token,
            "grant_type": "refresh_token",
        }).encode()
        with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=data), timeout=30) as r:
            payload = json.load(r)
        self._token = payload["access_token"]
        self._token_exp = time.time() + int(payload.get("expires_in", 3600))
        return self._token

    def _call(self, method: str, path: str, body: dict | None = None, query: dict | None = None) -> dict:
        url = f"{API_BASE}/{path}"
        if query:
            url += "?" + urllib.parse.urlencode(query)
        req = urllib.request.Request(
            url,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": f"Bearer {self._access_token()}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
        return json.loads(raw) if raw else {}

    def list_reviews(self) -> list[dict]:
        """Return all reviews, normalised to plain dicts."""
        reviews, token = [], None
        while True:
            q = {"pageSize": 50, "orderBy": "updateTime desc"}
            if token:
                q["pageToken"] = token
            page = self._call("GET", f"{self._location}/reviews", query=q)
            reviews.extend(normalise(r) for r in page.get("reviews", []))
            token = page.get("nextPageToken")
            if not token:
                return reviews

    def post_reply(self, review_id: str, comment: str) -> None:
        self._call("PUT", f"{self._location}/reviews/{review_id}/reply", body={"comment": comment})


def normalise(r: dict) -> dict:
    return {
        "review_id": r["reviewId"],
        "reviewer_name": (r.get("reviewer") or {}).get("displayName", "A customer"),
        "rating": STARS.get(r.get("starRating", ""), 0),
        "comment": r.get("comment", ""),
        "created_at": r.get("createTime"),
        "updated_at": r.get("updateTime"),
        "has_reply": 1 if r.get("reviewReply") else 0,
    }
