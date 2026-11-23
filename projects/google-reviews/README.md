# reviewbot — Google review automation

A small, self-hosted tool for a local business (built with a paint shop in mind) that:

1. **Asks every real customer for a review** after a job is finished (email, or SMS if they agreed to texts), with one follow-up at most.
2. **Watches your Google Business Profile** for new reviews and emails staff when a review is low-rated.
3. **Drafts replies with Claude.** A person approves, edits or rejects each one before it is posted. Nothing posts automatically.

Python 3.10+, SQLite, standard library only (the `anthropic` SDK is optional).

## Staying within Google's rules

These are built in on purpose. Breaking them can get reviews removed or the listing suspended.

| Rule | How reviewbot handles it |
|---|---|
| No **review gating** (asking only happy customers) | Every customer gets the same message and the same public link. There is no "how did we do?" pre-screen. |
| No incentives for reviews | The templates offer nothing in return. Don't add discounts. |
| No fake or self-written reviews | The tool only contacts real customers from your job records. |
| Consent and unsubscribe (CAN-SPAM, TCPA) | Every message says how to opt out (`reviewbot opt-out`). Phone numbers are stored only when `sms_consent=yes`. |
| Don't pester people | One request and at most one email reminder. No reminder once a review with a matching name appears. |

## Setup

```bash
cd projects/google-reviews
uv sync --extra ai --extra dev        # or: pip install -e '.[ai,dev]'
cp .env.example .env                  # fill in values
```

**Place ID** (needed for the review link): look it up with Google's Place ID Finder. The link becomes
`https://search.google.com/local/writereview?placeid=<ID>`.

**Google Business Profile API** (needed for `sync` and `post`):
1. In Google Cloud, create a project and request access to the Business Profile APIs (Google approves this manually and it can take a few days).
2. Create an OAuth client (Desktop app). Get a refresh token for the scope `https://www.googleapis.com/auth/business.manage`, for example with the OAuth 2.0 Playground.
3. Find your account and location IDs (Account Management API `accounts.list` and Business Information API `locations.list`).

You can use the review-request side without any of this. Only `GOOGLE_PLACE_ID` and SMTP are required.

## Usage

```bash
reviewbot import examples/jobs.csv    # export finished jobs from your POS / job system
reviewbot --dry-run send              # preview who would be contacted
reviewbot send                        # send due requests and reminders
reviewbot sync                        # pull reviews and send low-star alerts
reviewbot draft                       # Claude drafts replies (worst-rated first)
reviewbot approve                     # approve, edit or reject each draft
reviewbot post                        # publish approved replies to Google
reviewbot opt-out jane@example.com
reviewbot stats
```

CSV columns: `job_id,name,email,phone,job_summary,completed_at,sms_consent`. Re-importing is safe because existing `job_id`s are skipped.

## Scheduling

`reviewbot run` does send + sync + draft. It never posts replies. Run it once a day:

```cron
# crontab -e   (09:15 daily)
15 9 * * *  cd /opt/reviewbot && .venv/bin/reviewbot run >> reviewbot.log 2>&1
```

On Windows, use Task Scheduler to run `reviewbot.exe run` with "Start in" set to the project folder.
Then have someone run `reviewbot approve && reviewbot post` a few times a week.

## Tests

```bash
uv run pytest -q
```
