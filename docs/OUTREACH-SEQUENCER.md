# Outreach sequencer

Day 0, Day 3, and Day 10 use the same steps on SMS, WhatsApp, and email. Day 0 is the preview link and goes out as soon as the lead is enrolled, at any hour. Day 3 is a short nudge. Day 10 is the final note that the preview is coming down soon. After Day 10 the sequence is complete.

The sequence stops only when that Netlify site has been bought (the £299 one-off or the £39/month subscription) or when Nathan stops it by hand. A reply, including STOP or "not interested", does not stop the sequence and is not added to a suppression list. The reply is stored, `optedOut` is set when the text is a stop or not-interested phrase, and Nathan is still notified. Twilio itself may refuse a later SMS to a number that texted STOP. That error is logged and the job continues with the next lead. The step is not recorded as sent.

Copy is placeholder text in `config/outreach-copy.json` with `{business}` and `{link}`. Replace it before anyone turns sending on. The code refuses an em dash, refuses an opt-out line such as "STOP to opt out", and does not append one. SMS must render to 159 GSM-7 septets or fewer, including the business name and the link. A longer or non-GSM-7 SMS is not sent.

`OUTREACH_SEND_LIVE=1` sends. Any other value logs the would-be send and records nothing as sent. While the switch is off, enrolment logs Day 0, and the 10-minute job logs Day 0 again each run because nothing was stored.

## When messages go out

Day 0 is sent inside `POST /api/outreach-enrol`, at whatever hour the site is enrolled. `netlify/functions/outreach-day0.js` also runs every 10 minutes (`*/10 * * * *`) and sends a Day 0 that was not recorded yet (a dry run, a failed send, or the switch turned on later). It does not send Day 3 or Day 10.

Day 3 and Day 10 use `netlify/functions/outreach-evening.js`. Netlify cron is UTC, so the schedule is `0 18,19 * * *`, every day of the week:

- 18:00 UTC is 19:00 British Summer Time.
- 19:00 UTC is 19:00 Greenwich Mean Time.

The function sends only when the Europe/London hour is 19. Due dates are London calendar days from the Day 0 time recorded at enrolment. It does not skip ahead: Day 3 waits until Day 0 has been sent.

Scheduled functions run on published production deploys. They do not fire on deploy previews.

## Enrol

`POST /api/outreach-enrol`

Header `x-outreach-admin-secret` must match `OUTREACH_ADMIN_SECRET`. If that env var is unset, or the header is wrong, the response is 403 and nothing is written.

```bash
curl -sS -X POST https://taylor-marriott.com/api/outreach-enrol \
  -H 'content-type: application/json' \
  -H 'x-outreach-admin-secret: YOUR_SECRET' \
  -d '{
    "phone": "+447911123456",
    "email": "owner@example.co.uk",
    "channel": "sms",
    "businessName": "Example Plumbing",
    "trade": "plumber",
    "town": "Atherstone",
    "previewUrl": "https://taylor-marriott.com/p/abcd1234",
    "place_id": "ChIJexample",
    "site_id": "example-site-id"
  }'
```

`channel` is `sms`, `whatsapp`, or `email`. `email` is optional except when the channel is email. Phone is E.164. The call refuses a missing preview URL and a number that is already enrolled. It records `day0At` and then sends Day 0 when `OUTREACH_SEND_LIVE=1`. If Stripe already has an active £299 or £39 checkout for that `site_id`, the lead is stored as purchased and Day 0 is not sent.

`site_id` must be the same Netlify site id stored on the Stripe Checkout metadata as `netlify_site_id`. That is how a later payment finds this lead.

## Manual stop

`POST /api/outreach-stop` with the same header. Body is `{ "phone": "+447911123456" }` or `{ "site_id": "example-site-id" }`. The lead stays stored and no further step is sent.

## Status

`GET /api/outreach-status` with the same header. Read only. Each row has `step` (last day sent, or null), `nextDueOn`, `replied`, `optedOut`, `purchased`, `stopped`, and `complete`.

## Purchase

A paid `checkout.session.completed` for the website product, or a subscription whose status is `active`, stops every enrolled lead with that `netlify_site_id`. The £299 one-off and the £39/month plan both do this. A reply does not.

## Senders

SMS: Twilio `Messages.json` with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` (default `+447378961404`). If Twilio returns an error, including 21610 (unsubscribed recipient), the error is logged and the run continues. The lead is not marked sent for that step.

WhatsApp: the same endpoint with `ContentSid` and `ContentVariables`. There is no free-form `Body`, because Day 0 uses the approved template `tm_website_preview_v2` and Day 3 and Day 10 are outside the 24 hour window.

Twilio's Content API takes the template SID (`HX...`) plus a JSON object whose keys are the template slots `{{1}}`, `{{2}}`, and so on. This repo does not store the live ContentSid. Set it in the env vars below. The slot map in `config/outreach-copy.json` sends `{{1}}` as the business name and `{{2}}` as the preview URL for `tm_website_preview_v2`. Change that map if the approved template uses different slots. If a step's ContentSid is unset, that step is skipped and logged. The lead is not marked sent, so a later run can send once the SID is set.

WhatsApp sends also stop at 250 in a London day, even if `OUTREACH_DAILY_CAP` is higher. SMS and email continue under the overall cap.

Email: the existing Gmail mailer, from `nathan@taylor-marriott.com`. Gmail OAuth must already be configured (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_GMAIL_REFRESH_TOKEN` or `GOOGLE_OAUTH_REFRESH_TOKEN`). The Gmail message id is stored on the touch.

## What Nathan sets to switch on

Do this in Netlify site settings, then redeploy production. This repo does not change env vars or the Twilio number, sender, or webhooks.

1. Replace the placeholder strings in `config/outreach-copy.json`. Keep `{business}` and `{link}`. Keep each SMS at or under 159 GSM-7 septets for the longest business name and preview link you will enrol. Use a short preview link. No em dash. No "STOP to opt out" or similar.
2. For WhatsApp, confirm `whatsappVariables` match the approved templates. Put the ContentSids in the env vars below. Day 3 and Day 10 need their own approved templates.
3. Set `OUTREACH_ADMIN_SECRET` to a long random value. Enrol, stop, and status stay closed until this is set.
4. Leave `OUTREACH_SEND_LIVE` unset, enrol one test lead, and read the dry-run log. The log shows the rendered Day 0 text. Nothing is stored as sent.
5. Set `OUTREACH_DAILY_CAP` if 20 sends per London day is wrong.
6. Set `OUTREACH_SEND_LIVE` to `1` only after the copy and the ContentSids are final. Any other value stays a dry run. The next 10-minute run sends Day 0 for leads enrolled while the switch was off.

| Name | Purpose |
| --- | --- |
| `OUTREACH_ADMIN_SECRET` | Shared secret header for enrol, stop, and status. Required. Unset fails closed. |
| `OUTREACH_SEND_LIVE` | `1` sends. Anything else, including unset, logs only and records nothing as sent. |
| `OUTREACH_DAILY_CAP` | Max sends per London day. Default 20. |
| `WHATSAPP_CONTENT_SID_DAY0` | ContentSid for `tm_website_preview_v2`. |
| `WHATSAPP_CONTENT_SID_DAY3` | ContentSid for the Day 3 template. Unset skips that WhatsApp step. |
| `WHATSAPP_CONTENT_SID_DAY10` | ContentSid for the Day 10 template. Unset skips that WhatsApp step. |
| `TWILIO_ACCOUNT_SID` | Twilio account for SMS and WhatsApp. |
| `TWILIO_AUTH_TOKEN` | Twilio auth token. |
| `TWILIO_FROM_NUMBER` | Sender. `+447378961404` when unset. |
| Gmail OAuth vars | Existing checkout mailer. From address is `nathan@taylor-marriott.com`. |

Inbound replies still use `/api/twilio-inbound` as described in `docs/INBOUND-REPLIES.md`.
