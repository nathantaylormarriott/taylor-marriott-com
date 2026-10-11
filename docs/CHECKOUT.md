# Cold-outreach checkout (`/checkout`)

Client-facing checkout for the £299 website fee and an optional yearly domain add-on. Preview sites link here with `?place_id=<Google Places id>`.

## Routes

| Path | Purpose |
|------|---------|
| `/checkout?place_id=…` | Domain search, cart, pay |
| `/checkout/done?session_id=…` | Stripe success return |
| `GET /api/domain-search` | Normalises pasted URLs; label → `.co.uk`/`.com`/`.uk`; fixed retail price; up to 3 alternatives if taken |
| `GET /api/domain-suggestions` | Auto-suggested domains from business/trade/town (Porkbun check, cached ~5 min) |
| `GET /api/client-preview-site?place_id=…` | Resolve the client’s Netlify preview URL for checkout device mockups (registry → config → team scan) |
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
| `SENDGRID_API_KEY` | Transactional email | SendGrid API key (Mail Send). If unset, checkout and fulfilment still run; emails are skipped and logged. |
| `SENDGRID_FROM_EMAIL` | Optional | Default `nathan@taylor-marriott.com` (must match a SendGrid **single sender** or authenticated domain). |
| `SENDGRID_FROM_NAME` | Optional | Default `Taylor-Marriott` (display name on From). |
| `SENDGRID_REPLY_TO` | Optional | Default `nathan@taylor-marriott.com`. |
| `CHECKOUT_ALERT_EMAIL` | Optional | Nathan alerts (failures, dry-run fulfilment, new sales). Default `nathan@taylor-marriott.com`. |
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

Only domains whose **fixed yearly retail** is **≤ `DOMAIN_INCLUDED_MAX_GBP`** (default **£20**, config + env) are offered. Others show *Not available in this package* in search/suggestions.

Subscription metadata includes `domain_first_year_included=1`, `place_id`, `domain`, `tld`, `domain_amount_pence`, and Netlify site hints when known (`client-sites.js` registry). Stripe Checkout **custom submit text** states the renewal price and date.

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

## Transactional email (SendGrid)

Checkout sends email via **SendGrid** from Netlify Functions (`netlify/functions/_shared/mailer.js`). Email never blocks payment or domain jobs — failures are logged only. Each message is **idempotent** (Netlify Blobs store `checkout-emails`).

| When | To | Notes |
|------|-----|--------|
| `checkout.session.completed` (paid) | Nathan + client | Sale summary; client gets what they bought and next steps |
| Domain fulfilment succeeds (live connect) | Client | Domain is live |
| Domain fulfilment dry-run / test | Nathan only | Subject/body prefixed **`[DRY-RUN]`** — client is not told the domain is live |
| Domain fulfilment error | Nathan | Includes business, domain, error |
| Domain renew error | Nathan | After `domain-renew` background job fails |
| `invoice.payment_failed` | Nathan | Yearly domain charge failed |
| Subscription lapsing | Nathan | Cancelled or unpaid |

### What Nathan must set up (SendGrid + DNS)

1. **SendGrid account** — create an API key with **Mail Send** permission only. In Netlify → Environment variables, set **`SENDGRID_API_KEY`** (never commit it).
2. **Sender** — authenticate the domain **`taylor-marriott.com`** in SendGrid (Settings → Sender Authentication → Authenticate Your Domain). Use the DNS host for the domain (often Porkbun or Netlify DNS). SendGrid will show exact records; typically:
   - **CNAME** `emXXXX.taylor-marriott.com` → `uXXXX.wl.sendgrid.net` (mail subdomain)
   - **CNAME** `s1._domainkey.taylor-marriott.com` → `s1.domainkey.uXXXX.wl.sendgrid.net` (DKIM)
   - **CNAME** `s2._domainkey.taylor-marriott.com` → `s2.domainkey.uXXXX.wl.sendgrid.net` (DKIM)
   - Optional **TXT** on `@` for SPF if SendGrid instructs (often `v=spf1 include:sendgrid.net ~all` merged with any existing SPF — only one SPF TXT per domain).
3. **Env vars** — `SENDGRID_FROM_EMAIL=nathan@taylor-marriott.com`, `SENDGRID_FROM_NAME=Taylor-Marriott`, `SENDGRID_REPLY_TO=nathan@taylor-marriott.com`, `CHECKOUT_ALERT_EMAIL=nathan@taylor-marriott.com`.
4. **Stripe webhook** — in the Stripe Dashboard (test and live endpoints), add events **`invoice.payment_failed`** and **`customer.subscription.updated`** to the existing subscription (do not change the endpoint URL). Existing: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`.

### Checkout device previews

Mockups load the client site via `GET /api/client-preview-site?place_id=…` when `?site=` / referrer / session storage are unavailable. Resolution order matches fulfilment: `client-sites.js` registry, `config/client-preview-sites.json`, then scan of team **`tmbulk-*`** / **`tm-preview-*`** sites. Unknown clients show no iframe (neutral device frames only).
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
