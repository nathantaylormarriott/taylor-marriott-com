# Inbound SMS and WhatsApp replies

Outreach texts a tradesperson from +447378961404. The same number sends the approved WhatsApp template `tm_website_preview_v2`. The sequence is Day 0 (preview), Day 3 (nudge), Day 10 (final). Any reply stops that sequence. An opt-out also blocks every future send on SMS and WhatsApp.

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

- `isSuppressed(phone)` is true when the number is on the suppression list. Do not send on any channel.
- `hasReplied(phone)` is true after any inbound message. Do not send the next touch.
- `markReplied(phone, details)` sets `replied: true` and `repliedAt` (first reply time is kept).
- `getLead(phone)` / `saveLead(phone, patch)` / `listLeads()`.

`saveLead` is where Day 0 should write `businessName`, `previewUrl`, and `placeId` before the first text. The notify email includes those when they are on the lead. If they are missing, a billing account with the same phone is used (`businessName`, `placeId`, `netlifySiteName`).

Lead fields:

- `replied`, `repliedAt` halt the sequence.
- `sequence.status` is `idle`, then the sequencer may set `active`. A reply forces `halted`.
- `sequence.haltReason` is `replied`, `opt-out`, or `suppressed`.
- `sequence.touches` is for `{ day: 0 | 3 | 10, channel, at, messageSid }`.
- `sequence.nextTouchOn` is the next London date the sequencer should send, or null when halted.
- `suppressed` mirrors the suppression list.

Opt-out phrases (whole message, case insensitive, light filler allowed): STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, "stop texting", "not interested", "remove me", and close variants such as "please stop texting me". A longer note that only contains the word stop, such as "stop by tomorrow?", is a normal reply: the sequence halts, and the number is not suppressed.
