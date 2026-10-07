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

export async function createCheckoutSession({ placeId, domain, email }) {
  const res = await fetch('/api/create-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      place_id: placeId,
      domain: domain || null,
      email: email || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Could not start checkout');
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}
