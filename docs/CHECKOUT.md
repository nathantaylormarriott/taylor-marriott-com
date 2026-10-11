# Cold-outreach checkout (`/checkout`)

Client-facing checkout for the £299 website fee and an optional yearly domain add-on. Preview sites link here with `?place_id=<Google Places id>`.

## Routes

| Path | Purpose |
|------|---------|
| `/checkout?place_id=…` | Domain search, cart, pay |
| `/checkout/done?session_id=…` | Stripe success return |
| `GET /api/domain-search` | Normalises pasted URLs; label → `.co.uk`/`.com`/`.uk`; fixed retail price; up to 3 alternatives if taken |
| `GET /api/domain-suggestions` | Auto-suggested domains from business/trade/town (Porkbun check, cached ~5 min) |
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
| `STRIPE_WEBHOOK_SECRET` | Post-payment + renewals | Subscribe the endpoint to **`checkout.session.completed`**, **`invoice.paid`**, **`customer.subscription.deleted`** |
| `NETLIFY_AUTH_TOKEN` | Fulfilment | Finds the client site and sets its custom domain |
| `DOMAIN_PURCHASE_LIVE` | Kill switch | `1` = really register/renew at Porkbun (live-mode Stripe only). Anything else = dry run |
| `DOMAIN_CONNECT_LIVE` | Kill switch | `1` = really change DNS + Netlify custom domain (first purchase only) |
| `CHECKOUT_USD_TO_GBP` | Recommended | FX guard vs Porkbun cost (not used to set retail prices) |
| `CHECKOUT_BASE_URL` | Optional | e.g. `https://taylor-marriott.com/checkout` |

## Domain retail pricing (fixed per TLD)

Yearly client prices are **fixed GBP** in `config/domain-pricing.json` (placeholders until Nathan confirms), e.g. `.co.uk` / `.uk` £15, `.com` £20.

- Search and checkout show these retail prices, not pass-through Porkbun quotes.
- `create-session` still checks Porkbun and **refuses** premium names or when live Porkbun cost (USD × `CHECKOUT_USD_TO_GBP`, +10% margin) exceeds the retail price charged.

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
  customer.subscription.deleted (or unpaid after Stripe dunning)
    → mark subscription lapsing in Blobs; no Porkbun renew, no spend on our side
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
