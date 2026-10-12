export async function fetchDomainSuggestions({ placeId, business, trade, town, signal }) {
  const params = new URLSearchParams({ place_id: placeId });
  if (business) params.set('business', business);
  if (trade) params.set('trade', trade);
  if (town) params.set('town', town);
  const res = await fetch(`/api/domain-suggestions?${params}`, { signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Suggestions failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function searchDomains({ placeId, q, signal }) {
  const params = new URLSearchParams({ place_id: placeId, q });
  const res = await fetch(`/api/domain-search?${params}`, { signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Search failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function fetchClientPreviewSite(placeId, { siteId, signal } = {}) {
  const params = new URLSearchParams({ place_id: placeId });
  if (siteId) params.set('site_id', siteId);
  const res = await fetch(`/api/client-preview-site?${params}`, { signal });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) return { url: null, ...data };
  if (!res.ok) {
    const err = new Error(data.error || 'Preview site lookup failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function createCheckoutSession({ placeId, siteId, domain, email, plan, phone, termsAccepted }) {
  const res = await fetch('/api/create-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      place_id: placeId,
      site_id: siteId || undefined,
      domain: domain || null,
      email: email || undefined,
      plan: plan || 'one_off',
      phone: phone || undefined,
      terms_accepted: termsAccepted === true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || 'Could not start checkout');
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}
