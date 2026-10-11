# Cold-outreach checkout (`/checkout`)

Client-facing checkout for the £299 website fee and an optional yearly domain add-on. Preview sites link here with `?place_id=<Google Places id>`.

## Routes

| Path | Purpose |
|------|---------|
| `/checkout?place_id=…` | Domain search, cart, pay |
| `/checkout/done?session_id=…` | Stripe success return |
| `GET /api/domain-search` | Porkbun availability + live GBP yearly price |
| `POST /api/create-session` | Stripe Checkout Session (server recomputes amounts) |
| `POST /api/stripe-webhook` | Signature verify, queue paid domain order (Netlify Blobs `domain-orders`), start background job |
| `POST /api/domain-fulfil` | Background function: Porkbun register → DNS → Netlify custom domain (behind kill switches) |

## Environment (Netlify UI — do not commit)

| Variable | Required | Notes |
|----------|----------|--------|
| `PORKBUN_API_KEY` | For domain search / session with domain | |
| `PORKBUN_SECRET_API_KEY` | Same | |
| `STRIPE_SECRET_KEY` | For pay button | Use `sk_test_…` first |
| `STRIPE_WEBHOOK_SECRET` | For post-payment domain step | `whsec_…` of the endpoint `https://taylor-marriott.com/api/stripe-webhook` (event `checkout.session.completed`) |
| `NETLIFY_AUTH_TOKEN` | For post-payment domain step | Finds the client site and sets its custom domain |
| `DOMAIN_PURCHASE_LIVE` | Kill switch | `1` = really register at Porkbun (live-mode Stripe payments only). Anything else = dry run |
| `DOMAIN_CONNECT_LIVE` | Kill switch | `1` = really change DNS + Netlify custom domain for a registered domain |
| `CHECKOUT_USD_TO_GBP` | Recommended | Overrides `config/checkout.json` FX rate |
| `CHECKOUT_BASE_URL` | Optional | e.g. `https://taylor-marriott.com/checkout` |

## Live domain pricing (FX)

Yearly client price in **GBP pence**:

```
ceil( max(Porkbun registration USD, renewal USD) in cents × usdToGbp )
```

- Per-domain check prices from Porkbun `checkDomain`; TLD list prices from public `/pricing/get` fill gaps.
- **No markup** in code — only FX. Set `CHECKOUT_USD_TO_GBP` (or `domainPricing.usdToGbp` in `config/checkout.json`) to the rate Nathan wants (e.g. Bank of England daily, manual desk rate). Document the chosen source in Netlify env notes.
- Premium domains are never sold. Amounts are **never** taken from the browser; `create-session` re-checks Porkbun and recomputes.

## Stripe metadata

Checkout sessions set `client_reference_id=place_id` and metadata: `place_id`, `product_type=site_checkout`, `domain` (empty when none), `renewal_lead_days` when a domain is included.

## Manual test (sk_test_, no real charges)

1. Set env vars above in Netlify (or local `.env` for `netlify dev`).
2. Open `/checkout?place_id=ChIJ_test_place_id_example123`.
3. Toggle **Add a domain**, search e.g. `atherstoneplumbing` — rows should show live £/year for available TLDs.
4. Select a domain; summary shows website + domain lines. Pay opens Stripe test Checkout.
5. Use card `4242 4242 4242 4242`, any future expiry, any CVC — completes in test mode without moving real money if the Stripe account is in test mode.
6. Confirm redirect to `/checkout/done?session_id=cs_test_…` and copy in Stripe Dashboard → session metadata includes `place_id` and `domain`.
7. Cancel flow: start checkout, back out — land on `/checkout?place_id=…&cancelled=1` with selection restored from `sessionStorage`.
8. `POST /api/create-session` with a taken or premium domain should return 409.

## Generator integration

Set `checkoutBaseUrl` in the bulk-websites `config/checkout.json` (or `CHECKOUT_BASE_URL` on rebuild) to `https://taylor-marriott.com/checkout` so preview CTAs appear.

## Post-payment domain fulfilment

```
Stripe checkout.session.completed (paid, metadata.product_type=site_checkout, metadata.domain set)
  → /api/stripe-webhook   verify signature, store order (Blobs: domain-orders/<session id>), 200 to Stripe
  → /api/domain-fulfil    background (up to 15 min):
      1. Porkbun checkDomain: available, not premium, ≤ $100 API cap, and cost ≤ what the client
         paid (metadata.domain_amount_pence ÷ usdToGbp, +10% FX tolerance)           read only
      2. Find the Netlify site: _shared/client-sites.js registry, else scan tmbulk-* / tm-preview-*
         sites for a checkout link with this exact place_id (exactly one match)     read only
      3. Porkbun /domain/create (dryRun preflight first, Idempotency-Key tm-domain-<session id>),
         then auto-renew OFF                                       DOMAIN_PURCHASE_LIVE=1 + live-mode payment
      4. Porkbun DNS: delete parking A/AAAA/ALIAS/CNAME on @, www, *; create
         ALIAS @ → apex-loadbalancer.netlify.com and CNAME www → <site>.netlify.app   DOMAIN_CONNECT_LIVE=1
      5. Netlify PATCH /sites/<id> {custom_domain, domain_aliases:[www]} then POST /ssl  DOMAIN_CONNECT_LIVE=1
```

- Switch off → the exact request is built and stored on the order (secrets as env names), not sent.
- A **test-mode** Stripe payment never registers a real domain, even with `DOMAIN_PURCHASE_LIVE=1`.
- Replays: an order that is `registered`/`connected`/`processing` is not queued again. After
  `error_after_register`, replaying the event retries only DNS + Netlify (never buys twice).
- Website-only payments (no domain) are acknowledged and ignored here.
- Yearly domain renewals (`invoice.paid`, `subscription_cycle`) are **not** handled here yet; Porkbun
  auto-renew is turned off at registration, so a renewal step must be added before the first anniversary.
- Add each new client site to `netlify/functions/_shared/client-sites.js` (faster, no scan).

Local end-to-end dry run (real Porkbun + Netlify reads, nothing sent):

```
PORKBUN_API_KEY=… PORKBUN_SECRET_API_KEY=… NETLIFY_AUTH_TOKEN=… \
  node scripts/domain-fulfil-dryrun.mjs cid-5705786826933327223 srconstructionatherstone.co.uk 448
npm run test:domain   # unit tests, no network
```
