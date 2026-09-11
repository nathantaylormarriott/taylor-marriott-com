import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GlassField from '../components/GlassField';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatValue(tender) {
  const currency = tender.currency === 'USD' || tender.currency === 'CAD' ? tender.currency : 'GBP';
  const money = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
  const low = tender.value && tender.value > 0 ? tender.value : null;
  const high = tender.valueHigh && tender.valueHigh > 0 ? tender.valueHigh : null;
  if (low == null && high == null) return 'Value not stated';
  if (low != null && high != null && high !== low) {
    return `${money.format(low)} – ${money.format(high)}`;
  }
  return money.format(low ?? high);
}

function sourceLabel(source) {
  const labels = {
    'find-a-tender': 'Find a Tender',
    'sell2wales': 'Sell2Wales',
    'public-contracts-scotland': 'Public Contracts Scotland',
    'sam-gov': 'SAM.gov',
    'canada-buys': 'CanadaBuys',
    'contracts-finder': 'Contracts Finder',
  };
  return labels[source] || source;
}

function sourceCountry(source) {
  const countries = {
    'find-a-tender': 'United Kingdom',
    'contracts-finder': 'United Kingdom',
    'sell2wales': 'Wales',
    'public-contracts-scotland': 'Scotland',
    'sam-gov': 'United States',
    'canada-buys': 'Canada',
  };
  return countries[source] || '';
}

function sourceCaption(source) {
  const country = sourceCountry(source);
  const name = sourceLabel(source);
  return country ? `${name} · ${country}` : name;
}

function noticeLabel(source) {
  if (source === 'sam-gov') return 'Open on SAM.gov';
  if (source === 'canada-buys') return 'Open on CanadaBuys';
  return 'Open on GOV.UK';
}

function codeLabel(source) {
  if (source === 'sam-gov') return 'NAICS';
  if (source === 'canada-buys') return 'UNSPSC';
  return 'CPV';
}

function SamKeyNotice({ message, url }) {
  if (!message && !url) return null;
  return (
    <p className="contact-error mono ops-page__sam-alert">
      {message || 'SAM.gov is not working. Create a new public API key.'}
      {' '}
      <a href={url || 'https://sam.gov/workspace/profile/account-details'} target="_blank" rel="noopener noreferrer">
        https://sam.gov/workspace/profile/account-details
      </a>
    </p>
  );
}

export default function Ops() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [sending, setSending] = useState(false);
  const [tenders, setTenders] = useState([]);
  const [meta, setMeta] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const autoPulled = useRef(false);

  const selected = tenders.find((row) => row.id === selectedId) || null;

  const sources = useMemo(() => {
    const seen = new Set();
    for (const row of tenders) {
      if (row.source) seen.add(row.source);
    }
    return [...seen].sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b)));
  }, [tenders]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tenders.filter((row) => {
      if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
      if (!needle) return true;
      const hay = [
        row.title,
        row.buyer,
        row.description,
        row.region,
        row.status,
        row.cpvId,
        row.setAside,
        sourceCaption(row.source),
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [tenders, query, sourceFilter]);

  const loadTenders = useCallback(async () => {
    const response = await fetch('/api/ops/tenders', { credentials: 'include' });
    if (response.status === 401) {
      setSession(null);
      return;
    }
    if (!response.ok) {
      setLoadError('Could not load tenders.');
      return;
    }
    const data = await response.json();
    setTenders(data.tenders || []);
    setMeta(data.meta || null);
    setLoadError('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch('/api/ops/session', { credentials: 'include' });
      if (cancelled) return;
      if (!response.ok) {
        setSession(null);
        setChecking(false);
        return;
      }
      const data = await response.json();
      setSession(data);
      setChecking(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setLoadError('');
    try {
      const response = await fetch('/api/ops/sync', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoadError(data.error || 'Sync failed.');
        if (data.samKeyInvalid) {
          setMeta((current) => ({
            ...(current || {}),
            lastError: data.error,
            samKeyInvalid: true,
            samKeyHelpUrl: data.samKeyHelpUrl || 'https://sam.gov/workspace/profile/account-details',
          }));
        }
        return;
      }
      if (data.samKeyInvalid) {
        setLoadError('');
      }
      await loadTenders();
    } catch {
      setLoadError('Pull timed out. Try again.');
    } finally {
      setSyncing(false);
    }
  }, [loadTenders]);

  useEffect(() => {
    if (!session) {
      autoPulled.current = false;
      return;
    }
    loadTenders();
    if (autoPulled.current) return;
    autoPulled.current = true;
    handleSync();
  }, [session, loadTenders, handleSync]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setSending(true);
    setLoginError('');
    const form = e.target;
    try {
      const response = await fetch('/api/ops/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: form.username.value.trim(),
          password: form.password.value,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoginError(data.error || 'Sign-in failed.');
        return;
      }
      setSession({ username: data.username });
    } catch {
      setLoginError('Could not reach the ops API. Start the site with npm run dev.');
    } finally {
      setSending(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/ops/logout', { method: 'POST', credentials: 'include' });
    setSession(null);
    setTenders([]);
    setSelectedId(null);
    setQuery('');
    setSourceFilter('all');
  };

  return (
    <main className="ops-page">
      <div className="ops-page__inner">
        <header className="ops-page__header">
          <p className="ops-page__kicker mono">Admin</p>
        </header>

        {checking ? (
          <p className="ops-page__status">Checking session…</p>
        ) : !session ? (
          <form className="contact-form ops-page__form" noValidate onSubmit={handleLogin}>
            <GlassField id="ops-username" label="Username" name="username" autoComplete="username" />
            <GlassField id="ops-password" label="Password" name="password" type="password" autoComplete="current-password" />
            <button className="contact-submit ops-page__submit" type="submit" disabled={sending}>
              {sending ? 'Signing in…' : 'Sign in'}
            </button>
            {loginError && <p className="contact-error mono">{loginError}</p>}
          </form>
        ) : (
          <>
            <div className="ops-page__toolbar">
              <p className="ops-page__meta mono">
                {selected
                  ? sourceCaption(selected.source)
                  : meta?.lastSyncAt ? `Synced ${formatDate(meta.lastSyncAt)}` : 'Not synced yet'}
                {!selected && tenders.length ? ` · ${visible.length}${sourceFilter !== 'all' || query.trim() ? ` of ${tenders.length}` : ' open'}` : ''}
                {!selected && typeof meta?.lastNewCount === 'number' ? ` · ${meta.lastNewCount} new` : ''}
              </p>
              <div className="ops-page__actions">
                {selected && (
                  <button type="button" className="head-contact ops-page__btn" onClick={() => setSelectedId(null)}>
                    Overview
                  </button>
                )}
                {!selected && (
                  <button type="button" className="head-portal ops-page__btn" onClick={handleSync} disabled={syncing}>
                    {syncing ? 'Pulling…' : 'Pull latest'}
                  </button>
                )}
                <button type="button" className="head-contact ops-page__btn" onClick={handleLogout}>
                  Sign out
                </button>
              </div>
            </div>

            {meta?.samKeyInvalid && !selected && (
              <SamKeyNotice message={meta.lastError} url={meta.samKeyHelpUrl} />
            )}
            {meta?.lastError && !meta?.samKeyInvalid && !selected && (
              <p className="contact-error mono">{meta.lastError}</p>
            )}
            {loadError && !meta?.samKeyInvalid && !selected && <p className="contact-error mono">{loadError}</p>}

            {!selected && tenders.length > 0 && (
              <div className="ops-page__filters">
                <label className="ops-page__search-wrap">
                  <span className="visually-hidden">Search tenders</span>
                  <input
                    className="ops-page__search"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search title, buyer, source…"
                    autoComplete="off"
                  />
                </label>
                <div className="ops-page__chips" role="group" aria-label="Filter by source">
                  <button
                    type="button"
                    className={`ops-page__chip${sourceFilter === 'all' ? ' is-active' : ''}`}
                    onClick={() => setSourceFilter('all')}
                  >
                    All
                  </button>
                  {sources.map((source) => (
                    <button
                      key={source}
                      type="button"
                      className={`ops-page__chip${sourceFilter === source ? ' is-active' : ''}`}
                      onClick={() => setSourceFilter(source)}
                    >
                      {sourceCaption(source)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selected ? (
          <article className="ops-page__detail">
            <p className="ops-page__source-line">{sourceCaption(selected.source)}</p>
            <h1 className="ops-page__detail-title">{selected.title}</h1>
            <p className="ops-page__detail-buyer">{selected.buyer}</p>
            <dl className="ops-page__dl">
              <div>
                <dt>Deadline</dt>
                <dd>{formatDate(selected.deadline)}</dd>
              </div>
              <div>
                <dt>Value</dt>
                <dd>{formatValue(selected)}</dd>
              </div>
              <div>
                <dt>Published</dt>
                <dd>{formatDate(selected.publishedAt)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selected.status || '—'}</dd>
              </div>
              {selected.region && (
                <div>
                  <dt>Region</dt>
                  <dd>{selected.region}</dd>
                </div>
              )}
              {selected.setAside && (
                <div>
                  <dt>Set-aside</dt>
                  <dd>{selected.setAside}</dd>
                </div>
              )}
              {selected.cpvId && (
                <div>
                  <dt>{codeLabel(selected.source)}</dt>
                  <dd>{selected.cpvId}{selected.cpvDescription ? ` — ${selected.cpvDescription}` : ''}</dd>
                </div>
              )}
            </dl>
            {selected.description && (
              <p className="ops-page__detail-copy">{selected.description}</p>
            )}
            {selected.classification.reasons?.length > 0 && (
              <p className="ops-page__detail-reasons">{selected.classification.reasons.join(' · ')}</p>
            )}
            <a className="contact-submit ops-page__notice-btn" href={selected.url} target="_blank" rel="noopener noreferrer">
              {noticeLabel(selected.source)}
            </a>
          </article>
            ) : !tenders.length ? (
              <p className="ops-page__status">
                No matching tenders yet. Pull latest to load software, digital product, design and marketing work under £1m with an open deadline.
              </p>
            ) : !visible.length ? (
              <p className="ops-page__status">No tenders match that search or filter.</p>
            ) : (
              <ul className="ops-page__list">
                {visible.map((tender) => (
                  <li key={tender.id}>
                    <button
                      type="button"
                      className="ops-page__card"
                      onClick={() => setSelectedId(tender.id)}
                    >
                      <div className="ops-page__card-top">
                        <span className="ops-page__source">{sourceCaption(tender.source)}</span>
                        <span className="ops-page__deadline">{formatDate(tender.deadline)}</span>
                      </div>
                      <h2 className="ops-page__card-title">{tender.title}</h2>
                      <p className="ops-page__buyer">{tender.buyer}</p>
                      {tender.description && <p className="ops-page__copy">{tender.description}</p>}
                      <p className="ops-page__facts">
                        {formatValue(tender)}
                        {' · '}
                        Published {formatDate(tender.publishedAt)}
                        {tender.deadline ? ` · Deadline ${formatDate(tender.deadline)}` : ''}
                        {tender.cpvId ? ` · ${codeLabel(tender.source)} ${tender.cpvId}` : ''}
                        {tender.setAside ? ` · ${tender.setAside}` : ''}
                      </p>
                      {tender.classification.reasons?.length > 0 && (
                        <p className="ops-page__reasons">{tender.classification.reasons.join(' · ')}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </main>
  );
}
