# Inbound SMS and WhatsApp replies

Outreach texts a tradesperson from +447378961404. The same number sends the approved WhatsApp template `tm_website_preview_v2`. The sequence is Day 0 (preview, as soon as the lead is enrolled), Day 3 (nudge at 19:00 London), Day 10 (final, same hour). A reply does not stop that sequence. STOP and "not interested" are stored as `optedOut` and emailed to Nathan. They do not join a suppression list and they do not block the next send. The sequence stops when the website is bought, or when Nathan stops it. See `docs/OUTREACH-SEQUENCER.md`.

`POST /api/twilio-inbound` takes Twilio's inbound webhook for both channels. It checks `X-Twilio-Signature` with `TWILIO_AUTH_TOKEN` against the public URL (`x-forwarded-proto` and `x-forwarded-host`). A missing token or a bad signature returns 403 and stores nothing. The response is an empty TwiML `<Response/>`. This function does not message the sender. Twilio still handles SMS STOP on its side.

Messages are stored in the `outreach` Netlify Blobs store, one row per `MessageSid`. Posting the same sid again does not write a second row and does not send a second email.

## What Nathan sets by hand

Do this in the Twilio console. This repo does not change the number, the WhatsApp sender, or the webhook.

1. Phone number `+447378961404`. Messaging configuration. **A message comes in**: Webhook, `https://taylor-marriott.com/api/twilio-inbound`, HTTP POST.
2. WhatsApp sender for that same number. Incoming messages webhook: `https://taylor-marriott.com/api/twilio-inbound`, HTTP POST.

Netlify environment (site settings, not this repo):

| Name | Purpose |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio account. Not used to sign the webhook. Kept with the other Twilio vars. |
| `TWILIO_AUTH_TOKEN` | Validates `X-Twilio-Signature`. Required. If it is unset the webhook rejects every request. |
| `TWILIO_FROM_NUMBER` | `+447378961404`. The sequencer will send from this number. |
| `INBOUND_NOTIFY_LIVE` | `1` emails nathan@taylor-marriott.com for each new reply. Any other value, including unset, logs the reply and does not send. |

Live email uses the existing Gmail mailer (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_GMAIL_REFRESH_TOKEN` or `GOOGLE_OAUTH_REFRESH_TOKEN`). The same token billing notices use.

## Store the sequencer will read

Helpers in `netlify/functions/_shared/inbound-store.js`:

- `hasReplied(phone)` is true after any inbound message. The sequencer still sends.
- `markReplied(phone, details)` sets `replied: true` and `repliedAt` (first reply time is kept). An opt-out also sets `optedOut`. It does not write a suppression row and it does not change `sequence.status`.
- `isSuppressed(phone)` reads any old suppression row. New opt-outs do not add one, and the sequencer does not consult it.
- `getLead(phone)` / `saveLead(phone, patch)` / `listLeads()`.
- `markSitePurchased(siteId, details)` stops every lead with that Netlify site id.

`saveLead` is where Day 0 should write `businessName`, `previewUrl`, and `placeId` before the first text. The notify email includes those when they are on the lead. If they are missing, a billing account with the same phone is used (`businessName`, `placeId`, `netlifySiteName`).

Lead fields:

- `replied`, `repliedAt` record that someone wrote back. They do not halt the sequence.
- `optedOut`, `optedOutAt` record STOP or "not interested" for Nathan. They do not halt the sequence.
- `sequence.status` is `idle`, then `active` after enrolment. Purchase or a manual stop sets `stopped`. Day 10 sets `complete`.
- `sequence.haltReason` is `purchased` or `manual`.
- `sequence.touches` is for `{ day: 0 | 3 | 10, channel, at, messageSid }`.
- `sequence.nextTouchOn` is the next London date the sequencer should send, or null when stopped or complete.
- `purchased` is set from a paid website checkout or an active subscription for this `siteId`.

Opt-out phrases (whole message, case insensitive, light filler allowed): STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, "stop texting", "not interested", "remove me", and close variants such as "please stop texting me". A longer note that only contains the word stop, such as "stop by tomorrow?", is a normal reply: `optedOut` stays false, and the sequence keeps going either way. Twilio may still block SMS to a number that texted STOP. The sequencer logs that send error and continues.
