# Outreach sequencer

Day 0, Day 3, and Day 10 use the same steps on SMS, WhatsApp, and email. Day 0 is the preview link. Day 3 is a short nudge. Day 10 is the final note that the preview is coming down soon. The sequence then stops.

Any inbound reply (`hasReplied`) or suppression row (`isSuppressed`) stops the lead before the next send. The job records each live send once (step, time, Twilio SID or Gmail id, status). A second run the same day does not send that step again.

Copy is placeholder text in `config/outreach-copy.json` with `{business}` and `{link}`. Replace it before anyone turns sending on. The code refuses an em dash, refuses an opt-out line such as "STOP to opt out", and does not append one. SMS must render to 159 GSM-7 septets or fewer, including the business name and the link. A longer or non-GSM-7 SMS is not sent.

The daily job is `netlify/functions/outreach-daily.js`. Netlify cron is UTC, so the schedule is `0 9,10 * * *`:

- 09:00 UTC is 10:00 British Summer Time.
- 10:00 UTC is 10:00 Greenwich Mean Time.

The function sends only when the Europe/London hour is 10, so there is one send window per calendar day in both GMT and BST. Due dates are London calendar days from the Day 0 time recorded at enrolment, not raw 24 hour gaps. A lead enrolled after 10:00 London time gets Day 0 on the next morning. The job does not skip ahead: if Day 0 was missed, that is the step it sends.

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

`channel` is `sms`, `whatsapp`, or `email`. `email` is optional except when the channel is email. Phone is E.164. The call refuses a missing preview URL, a suppressed number, a number that has already replied, and a number that is already enrolled. It stores `day0At` and does not send.

## Status

`GET /api/outreach-status` with the same header. Read only. Each row has `step` (last day sent, or null), `nextDueOn`, `replied`, `suppressed`, and `complete`.

## Senders

SMS: Twilio `Messages.json` with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` (default `+447378961404`).

WhatsApp: the same endpoint with `ContentSid` and `ContentVariables`. There is no free-form `Body`, because Day 0 uses the approved template `tm_website_preview_v2` and Day 3 and Day 10 are outside the 24 hour window.

Twilio's Content API takes the template SID (`HX...`) plus a JSON object whose keys are the template slots `{{1}}`, `{{2}}`, and so on. This repo does not store the live ContentSid. Set it in the env vars below. The slot map in `config/outreach-copy.json` sends `{{1}}` as the business name and `{{2}}` as the preview URL for `tm_website_preview_v2`. Change that map if the approved template uses different slots. If `WHATSAPP_CONTENT_SID_DAY3` or `WHATSAPP_CONTENT_SID_DAY10` is unset, that step is skipped and logged. The lead is not marked sent, so a later run can send once the SID is set. Day 0 is skipped the same way when its SID is unset.

WhatsApp sends also stop at 250 in a London day, even if `OUTREACH_DAILY_CAP` is higher. SMS and email continue under the overall cap.

Email: the existing Gmail mailer, from `nathan@taylor-marriott.com`. Gmail OAuth must already be configured (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_GMAIL_REFRESH_TOKEN` or `GOOGLE_OAUTH_REFRESH_TOKEN`). The Gmail message id is stored on the touch.

## What Nathan sets to switch on

Do this in Netlify site settings, then redeploy production. This repo does not change env vars or the Twilio number, sender, or webhooks.

1. Replace the placeholder strings in `config/outreach-copy.json`. Keep `{business}` and `{link}`. Keep each SMS at or under 159 GSM-7 septets for the longest business name and preview link you will enrol. Use a short preview link. No em dash. No "STOP to opt out" or similar.
2. For WhatsApp, confirm `whatsappVariables` match the approved templates. Put the ContentSids in the env vars below. Day 3 and Day 10 need their own approved templates.
3. Set `OUTREACH_ADMIN_SECRET` to a long random value. Enrol and status stay closed until this is set.
4. Leave `OUTREACH_SEND_LIVE` unset, enrol one test lead, and read the dry-run log. The log shows the rendered text. Nothing is stored as sent.
5. Set `OUTREACH_DAILY_CAP` if 20 sends per London day is wrong.
6. Set `OUTREACH_SEND_LIVE` to `1` only after the copy and the ContentSids are final. Any other value stays a dry run.

| Name | Purpose |
| --- | --- |
| `OUTREACH_ADMIN_SECRET` | Shared secret header for enrol and status. Required. Unset fails closed. |
| `OUTREACH_SEND_LIVE` | `1` sends. Anything else, including unset, logs only and records nothing as sent. |
| `OUTREACH_DAILY_CAP` | Max sends per London day. Default 20. |
| `WHATSAPP_CONTENT_SID_DAY0` | ContentSid for `tm_website_preview_v2`. |
| `WHATSAPP_CONTENT_SID_DAY3` | ContentSid for the Day 3 template. Unset skips that WhatsApp step. |
| `WHATSAPP_CONTENT_SID_DAY10` | ContentSid for the Day 10 template. Unset skips that WhatsApp step. |
| `TWILIO_ACCOUNT_SID` | Twilio account for SMS and WhatsApp. |
| `TWILIO_AUTH_TOKEN` | Twilio auth token. |
| `TWILIO_FROM_NUMBER` | Sender. `+447378961404` when unset. |
| Gmail OAuth vars | Existing checkout mailer. From address is `nathan@taylor-marriott.com`. |

Inbound replies still use `/api/twilio-inbound` as described in `docs/INBOUND-REPLIES.md`. A reply or an opt-out stops this sequence without any extra switch.
