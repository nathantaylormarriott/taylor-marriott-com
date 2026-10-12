# Cold-outreach checkout (`/checkout`)

Client-facing checkout for the £299 website fee and an optional yearly domain add-on.

**Preview / generator checkout link** (bulk-websites should emit this on each site):

```
/checkout?place_id=<Google Places id>&site_id=<Netlify site UUID>&business=<name>&trade=<trade>&town=<town>
```

- `place_id` — required (Google Places id or bulk `cid-…` id).
- `site_id` — optional but recommended for new builds (plain Netlify site name, no `tmbulk-` prefix). Server verifies the site is on the Taylor-Marriott Netlify team and that its homepage checkout link uses the same `place_id`.
- `business`, `trade`, `town` — optional; improve domain suggestions (registry overrides when present).

## Routes

| Path | Purpose |
|------|---------|
| `/checkout?place_id=…&site_id=…` | Domain search, cart, pay (see link format above) |
| `/checkout/done?session_id=…` | Stripe success return |
| `GET /api/domain-search` | Normalises pasted URLs; label → `.co.uk`/`.com`/`.uk`; fixed retail price; up to 3 alternatives if taken |
| `GET /api/domain-suggestions` | Auto-suggested domains from business/trade/town (Porkbun check, cached ~5 min) |
| `GET /api/client-preview-site?place_id=…&site_id=…` | Verified preview URL for device mockups (optional `site_id` → registry → config → cached team scan) |
| `POST /api/create-session` | Stripe Checkout Session (server recomputes amounts) |
| `POST /api/stripe-webhook` | Signature verify, queue orders/renewals, start background jobs |
| `POST /api/domain-fulfil` | Background: Porkbun register → DNS → Netlify custom domain |
| `POST /api/domain-renew` | Background: Porkbun renew (1 year) after a paid renewal invoice |

## Environment (Netlify UI — do not commit)

| Variable | Required | Notes |
|----------|----------|--------|
| `PORKBUN_API_KEY` | For domain search / session with domain | |
| `PORKBUN_SECRET_API_KEY` | Same | |
| `STRIPE_SECRET_KEY` | For pay button | Use `sk_test_…` first |
| `STRIPE_WEBHOOK_SECRET` | Post-payment + renewals | Subscribe the endpoint to **`checkout.session.completed`**, **`invoice.paid`**, **`invoice.payment_failed`**, **`customer.subscription.deleted`**, **`customer.subscription.updated`** |
| `GOOGLE_GMAIL_REFRESH_TOKEN` | Checkout email | OAuth refresh token with scope **`gmail.send`**. Same `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` as Calendar. Run `node scripts/google-oauth-gmail-refresh-token.mjs` locally, then copy to Netlify. Sign in as **nathan@taylor-marriott.com**. |
| `CHECKOUT_FROM_EMAIL` | Optional | Default `nathan@taylor-marriott.com` (must match the Google account used for the refresh token). |
| `CHECKOUT_FROM_NAME` | Optional | Default `Taylor-Marriott`. |
| `CHECKOUT_REPLY_TO` | Optional | Default `nathan@taylor-marriott.com`. |
| `CHECKOUT_ALERT_EMAIL` | Optional | Nathan alerts (failures, dry-run fulfilment, new sales). Default `nathan@taylor-marriott.com`. |
| `SENDGRID_API_KEY` | Legacy only | Optional fallback if Gmail OAuth is not set. Not recommended. |
| `NETLIFY_AUTH_TOKEN` | Fulfilment | Finds the client site and sets its custom domain |
| `DOMAIN_PURCHASE_LIVE` | Kill switch | `1` = really register/renew at Porkbun (live-mode Stripe only). Anything else = dry run |
| `DOMAIN_CONNECT_LIVE` | Kill switch | `1` = really change DNS + Netlify custom domain (first purchase only) |
| `CHECKOUT_USD_TO_GBP` | Emergency fallback | Only if live FX APIs + blob cache unavailable (see pricing section) |
| `CHECKOUT_BASE_URL` | Optional | e.g. `https://taylor-marriott.com/checkout` |

## Domain retail pricing (fixed per TLD)

Yearly client prices are **fixed GBP** in `config/domain-pricing.json` (placeholders until Nathan confirms), e.g. `.co.uk` / `.uk` £15, `.com` £20.

- Search and checkout show these retail prices, not pass-through Porkbun quotes.
- `create-session` still checks Porkbun and **refuses** premium names or when live Porkbun cost (USD × live USD→GBP rate, +10% margin) exceeds the retail price charged. FX: Frankfurter (ECB daily) → open.er-api.com → 1h blob cache → `CHECKOUT_USD_TO_GBP` env.

Suggested checkout copy: *“The domain renews yearly at £X until cancelled; if payment fails it lapses.”* (Use the TLD price from `domain-pricing.json`.)

## Stripe Checkout modes

| Cart | Stripe `mode` | Billing |
|------|---------------|---------|
| Website only | `payment` | One-off £299 |
| Website + domain | `subscription` | **Pay today: £299 only** (website + domain year 1). Yearly domain line is on the subscription with **`trial_period_days: 365`** so the first domain charge is at the 1-year anniversary. Card saved. |

Domain search lists every priced domain. The £20 figure is the year-1 inclusion allowance on the £299 plan. Anything above that is added to today's total. The £39/month plan includes domain price up to £39. See `docs/BILLING.md`.

Subscription metadata includes `plan`, `domain_first_year_included` (`1` on the one-off plan, `0` on monthly), `domain_excess_pence` when a domain is in the cart, `place_id`, `domain`, `tld`, `domain_amount_pence`, optional `phone`, and Netlify site hints when known (`netlify_site_id` / `netlify_site_name` from verified `site_id` or registry, including website-only checkout). Stripe Checkout **custom submit text** states the renewal price and date.

## Stripe metadata

Checkout / subscription metadata: `product_type=site_checkout`, `place_id`, `domain`, `tld`, `domain_amount_pence`, `renewal_lead_days`, optional `netlify_site_id` / `netlify_site_name`.

## End-to-end flow

```
First purchase (domain included)
  checkout.session.completed (paid)
    → store order (Blobs: domain-orders/<session id>)
    → /api/domain-fulfil  register @ Porkbun, auto-renew OFF, DNS, Netlify domain

Yearly renewal (client card via Stripe)
  invoice.paid (billing_reason=subscription_cycle)
    → store job (Blobs: domain-renewals/<invoice id>)
    → /api/domain-renew  Porkbun /domain/renew 1y (DOMAIN_PURCHASE_LIVE, idempotent per invoice)

Failed / cancelled subscription
  invoice.payment_failed
    → email Nathan (idempotent per invoice)
  customer.subscription.updated (status unpaid or canceled)
    → mark lapsing + email Nathan
  customer.subscription.deleted
    → mark subscription lapsing in Blobs; email Nathan; no Porkbun renew, no spend on our side
```

## Transactional email (Google Workspace / Gmail)

Checkout sends email via the **Gmail API** from Netlify Functions (`netlify/functions/_shared/mailer.js`), using your **nathan@taylor-marriott.com** mailbox (same Google OAuth client as discovery booking). Email never blocks payment or domain jobs — failures are logged only. Each message is **idempotent** (Netlify Blobs store `checkout-emails`).

| When | To | Notes |
|------|-----|--------|
| `checkout.session.completed` (paid) | Nathan + client | Sale summary; client gets what they bought and next steps |
| Domain fulfilment succeeds (live connect) | Client | Domain is live |
| Domain fulfilment dry-run / test | Nathan only | Subject/body prefixed **`[DRY-RUN]`** — client is not told the domain is live |
| Domain fulfilment error | Nathan | Includes business, domain, error |
| Domain renew error | Nathan | After `domain-renew` background job fails |
| `invoice.payment_failed` | Nathan | Yearly domain charge failed |
| Subscription lapsing | Nathan | Cancelled or unpaid |

### What Nathan must set up (Gmail)

1. **Google Cloud** — on the same project as Calendar OAuth, enable **Gmail API**.
2. **OAuth Web client** — add redirect URI `http://localhost:3334/oauth/callback` (in addition to the Calendar callback on port 3333 if you use both scripts).
3. **Refresh token** — from the project root, run `node scripts/google-oauth-gmail-refresh-token.mjs`, sign in as **nathan@taylor-marriott.com**, consent to **Send email on your behalf**. Copy **`GOOGLE_GMAIL_REFRESH_TOKEN`** to Netlify production (functions + runtime, secret).
4. **Env vars** (optional overrides) — `CHECKOUT_FROM_EMAIL`, `CHECKOUT_FROM_NAME`, `CHECKOUT_REPLY_TO`, `CHECKOUT_ALERT_EMAIL`.
5. **Stripe webhook** — in the Stripe Dashboard (test and live endpoints), add events **`invoice.payment_failed`** and **`customer.subscription.updated`** to the existing subscription (do not change the endpoint URL). Existing: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`.

Mail is sent **from your Gmail/Workspace Sent folder** — no SendGrid or extra DNS for checkout email.

### Checkout device previews

Mockups load the client site via `GET /api/client-preview-site?place_id=…&site_id=…` when `?site=` / referrer / session storage are unavailable. Resolution order: verified **`site_id`** (if present) → `client-sites.js` registry → `config/client-preview-sites.json` → **cached scan of all team sites** (~60): homepage must link to checkout with the same `place_id` (works for plain repo-name sites, not only legacy `tmbulk-*` prefixes). Verified URLs may be `*.netlify.app` or the site’s own HTTPS domain. Unknown or unverifiable clients show no iframe (never another client’s site).

Domain fulfilment resolves the Netlify site with **`netlify_site_id` from Stripe metadata first**, then the same scan fallback.
```

- **Smart Retries / dunning**: handled by Stripe; we do not charge Porkbun until `invoice.paid` for a cycle.
- **Test mode**: never registers or renews a real domain, even with `DOMAIN_PURCHASE_LIVE=1`.
- Porkbun **auto-renew stays OFF** at registration so Porkbun never bills unless the client has paid us.

## Manual test (sk_test_, no real charges)

1. Set env vars above in Netlify (or local `.env` for `netlify dev`).
2. Open `/checkout?place_id=ChIJ_test_place_id_example123`.
3. Toggle **Add a domain** — suggested domains load in the background (chips); or search manually. Optional query params: `business`, `trade`, `town` (also read from `client-sites.js`).
4. Pay opens Stripe test Checkout (subscription when a domain is selected).
5. Card `4242 4242 4242 4242` — test mode, no real money.
6. Webhook dry-run: orders queued; fulfil/renew jobs log planned Porkbun requests unless switches are on **and** live mode.

## Generator integration

Set `checkoutBaseUrl` in the bulk-websites `config/checkout.json` (or `CHECKOUT_BASE_URL` on rebuild) to `https://taylor-marriott.com/checkout` so preview CTAs appear.

Local tests:

```
npm run test:domain
node scripts/domain-fulfil-dryrun.mjs …
```
