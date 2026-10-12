# Checkout billing

£299 one-off and £39/month, on the cream checkout (no star field). Domain search lists every priced domain. The £20 cap is an inclusion allowance, not a hide filter.

## Plans

| Plan | First invoice | Domain later |
|------|----------------|--------------|
| £299 one-off | £299 plus any domain price above £20 | Yearly renewal at the checkout price, from the anniversary, on its own subscription (365 day trial) |
| £39/month | £39 plus any domain price above £39 | Renewals are included in the £39 that month. No separate domain charge |

## Reminders (£299 domain renewals)

30, 14 and 7 days before the renewal date: SMS from +44 7378 961404 and email from nathan@taylor-marriott.com. Each message has the date, the price, and a manage or update-card link.

Every SMS is GSM-7 and at most 159 septets, including the link. Stripe invoice and portal URLs are stored in the `billing-short-links` blob and sent as `https://taylor-marriott.com/p/<8 chars>`, which redirects with HTTP 302. `sendBillingSms` refuses anything longer or not GSM-7 before Twilio is called. Pause and resume texts use the same rule. Nathan's alert mail is email only.

## Failed payments

Our job retries once per London day, up to 10 days. After every failed attempt the client gets an email and an SMS with the pay link. After the 10th failure the invoice is marked uncollectible and the subscription is treated as unpaid. The pause text goes out as well on that day. A later payment sends the resume text.

A single `invoice.payment_failed` event does not pause the site and does not count as one of the 10 attempts. The webhook only stores the open invoice. Pause follows the final Stripe status (`unpaid` or `canceled`) or our 10th daily failure. The daily job is what charges the card again, then sends the email and the SMS.

## Pause

| Case | Site | Custom domain |
|------|------|----------------|
| Monthly, unpaid, renewal not due | Paused page, HTTP 503, Retry-After | Kept |
| Monthly, still unpaid when the domain renewal is due | Paused page | Removed. Preview `*.netlify.app` address. No Porkbun renew |
| £299 domain renewal unpaid after 10 days | Stays up on the preview hostname | Removed. No Porkbun renew. Auto-renew stays off |

Pay later: if we still own the domain, add it back. If it lapsed, re-register only when `DOMAIN_PURCHASE_LIVE=1` and the name is free. Otherwise stay on `*.netlify.app` and email nathan@taylor-marriott.com.

Switching the pause flag writes a JSON blob on the client site (`site-pause` / `status`) with that site's id and `NETLIFY_AUTH_TOKEN`. It does not rebuild the site. Copy `templates/client-site-pause/` into each bulk starter site. The edge function reads the blob on the same site, so the read stays local. When the flag is off, `context.next()` serves the real site, so SEO is unchanged. When the flag is on, the edge responds 503 and `noindex`.

## Daily job

`billing-daily` (07:00 UTC) starts `billing-daily-background`. The worker lists `site_checkout` subscriptions from the Stripe search API, 100 at a time, and follows `next_page` until the list is done. A full pass that runs long chains another background call from the saved page cursor. List calls retry three times with backoff on HTTP 429 and 5xx. Each invoice is its own step log: check, pay, persist the attempt, then email and SMS. A crash after the attempt is saved does not charge that invoice again the same London day (Stripe idempotency key `tm-pay-{invoice}-{date}`), and the unpaid notice is sent on the next run if it was not delivered. One site failing does not stop the rest. Each pause, resume, or failure emails nathan@taylor-marriott.com when notify is live.

Default is dry-run. A dry-run does not charge, text, email, detach a domain, or write the pause blob. Set `BILLING_ACTIONS_LIVE=1` to apply site changes and `BILLING_NOTIFY_LIVE=1` to send. Actions live also require `BILLING_CRON_SECRET`. The scheduled tick sends it as `Authorization: Bearer`. With notify live and `BILLING_NOTIFY_CLIENTS` unset, mail goes only to nathan@taylor-marriott.com and SMS is not sent to clients. Domain register and renew still need `DOMAIN_PURCHASE_LIVE=1` as well. Porkbun auto-renew stays off.

## Stripe dashboard (Nathan)

Do this in live mode. This repo does not change the dashboard.

1. Settings, Billing, Subscriptions and emails: leave Stripe's own failed-payment emails on.
2. Settings, Billing, Revenue recovery: turn Smart Retries off. Our 10 daily attempts are the only retries. If a retry schedule stays on, Stripe and this job will both charge the card.
3. If an invoice is still unpaid, set the subscription status to unpaid (or cancel). Do not use a Stripe retry window that overlaps these 10 days.
4. Settings, Billing, Customer portal: turn the portal on so manage and update-card links work.
5. Webhook `/api/stripe-webhook` events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.

## Env vars

See `.env.example`. New names: `BILLING_ACTIONS_LIVE`, `BILLING_NOTIFY_LIVE`, `BILLING_NOTIFY_CLIENTS`, `BILLING_CRON_SECRET`, `GMAIL_SEND_AS`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.

Gmail uses the existing Google OAuth client. The refresh token needs the `https://www.googleapis.com/auth/gmail.send` scope. The calendar token may not include it yet.
