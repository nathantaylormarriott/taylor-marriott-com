# Cold-outreach checkout (`/checkout`)

Client-facing checkout for the £299 website fee and an optional yearly domain add-on. Preview sites link here with `?place_id=<Google Places id>`.

## Routes

| Path | Purpose |
|------|---------|
| `/checkout?place_id=…` | Domain search, cart, pay |
| `/checkout/done?session_id=…` | Stripe success return |
| `GET /api/domain-search` | Porkbun availability + live GBP yearly price |
| `POST /api/create-session` | Stripe Checkout Session (server recomputes amounts) |
| `POST /api/stripe-webhook` | Signature verify + log metadata (register/connect TODO on bulk box) |

## Environment (Netlify UI — do not commit)

| Variable | Required | Notes |
|----------|----------|--------|
| `PORKBUN_API_KEY` | For domain search / session with domain | |
| `PORKBUN_SECRET_API_KEY` | Same | |
| `STRIPE_SECRET_KEY` | For pay button | Use `sk_test_…` first |
| `STRIPE_WEBHOOK_SECRET` | Optional | For `/api/stripe-webhook` |
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
