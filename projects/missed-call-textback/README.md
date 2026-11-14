# Missed Call Text Back

If nobody picks up a customer's call, this texts them back automatically, so the lead isn't lost to the next shop on the list.

```
Customer calls your Twilio number
        │
        ├─ Closed? ──► "We're closed" greeting ──► after-hours text to the caller
        │
        └─ Open ──► rings the shop phone(s) for RING_SECONDS
                       ├─ Answered ──► normal call, nothing sent
                       └─ No answer / busy / caller hung up ──► "Sorry we missed you" text
Customer replies by text ──► forwarded to the owner's / manager's cell
Owner texts "+15551234567 Your order's ready" to the business number ──► customer gets it from the business number
```

## Features

- Rings one or more real phones first, and texts the caller only if nobody answers.
- Separate business-hours and after-hours messages, in your own timezone.
- Cooldown, so a caller who rings three times in a row gets one text, not three.
- Skips blocked or anonymous caller IDs and your own staff numbers.
- Sends customer replies on to staff cells. Staff can answer from the business number, so their personal cell numbers stay private.
- Dashboard at `/admin`: calls answered and missed, callers texted, replies, and the full log.
- Every webhook checks Twilio's request signature, so nobody else can make it send texts.
- No dependencies. It needs only Node 22 and uses Node's built-in SQLite.

## Setup

1. **Twilio account.** Buy a local number with voice and SMS ($1–2/month, plus about a cent per text or call minute).
2. **US texting:** register the number for **A2P 10DLC** in the Twilio console (Messaging → Regulatory Compliance). Unregistered numbers get filtered by the carriers. After registering, put the Messaging Service SID in `TWILIO_MESSAGING_SERVICE_SID`.
3. **Configure:**
   ```bash
   cp .env.example .env    # fill in your values
   npm test                # 16 tests, should all pass
   npm start
   ```
4. **Expose it over HTTPS.** Use a small VPS, Render or Fly.io, or a Cloudflare Tunnel or ngrok from an office box. Set `PUBLIC_BASE_URL` to that address.
5. **Point Twilio at it.** In Twilio, open Phone Numbers → your number:
   - *A call comes in*: Webhook, `POST`, `https://YOUR-URL/voice/incoming`
   - *A message comes in*: Webhook, `POST`, `https://YOUR-URL/sms/incoming`
6. **Route customers to it.** Either publish the Twilio number, or (usually easier) set your existing line to **forward on no-answer or busy** to the Twilio number. Your phone company or VoIP provider can turn that on.

### Docker

```bash
docker build -t textback .
docker run -d --env-file .env -p 3000:3000 -v textback-data:/data --restart unless-stopped textback
```

## Gotchas

- **Voicemail answers calls.** If the forwarded phone has its own voicemail, Twilio counts the call as answered and sends no text. Set `RING_SECONDS` shorter than that phone's voicemail pickup time, or turn its voicemail off.
- **Opt-outs:** Twilio handles STOP, UNSUBSCRIBE and HELP replies for you, so a customer who opts out is never texted again.
- **Landlines** can't receive texts. Twilio logs those sends as failed, and the dashboard shows "Text failed".

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/voice/incoming` | Twilio voice webhook |
| POST | `/voice/dial-status` | Called by Twilio when the forwarded ring ends |
| POST | `/sms/incoming` | Twilio messaging webhook |
| GET | `/admin` | Dashboard (basic auth, needs `ADMIN_PASSWORD`) |
| GET | `/health` | Uptime check |
