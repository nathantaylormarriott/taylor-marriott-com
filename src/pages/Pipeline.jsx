import React, { useEffect, useRef, useState } from 'react';
import { useShell } from '../layout/Shell';
import { revealPageChromeInstant } from '../lib/pageTransition';

const EMPTY = { cards: [] };

async function pipelineFetch(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Pipeline': '1',
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function uploadLogo(cardId, file) {
  const response = await fetch(`/api/pipeline/logo/${encodeURIComponent(cardId)}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': file.type,
      'X-Pipeline': '1',
    },
    body: file,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Logo upload failed');
  return data;
}

async function deleteLogo(cardId) {
  await fetch(`/api/pipeline/logo/${encodeURIComponent(cardId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-Pipeline': '1' },
  }).catch(() => {});
}

function reorderCard(board, cardId, beforeId) {
  const card = board.cards.find((item) => item.id === cardId);
  if (!card) return board;
  const without = board.cards.filter((item) => item.id !== cardId);
  if (!beforeId || beforeId === cardId) {
    return { cards: [...without, card] };
  }
  const index = without.findIndex((item) => item.id === beforeId);
  if (index < 0) return { cards: [...without, card] };
  const next = [...without];
  next.splice(index, 0, card);
  return { cards: next };
}

export default function Pipeline() {
  const { finishRouteTransition } = useShell();
  const [phase, setPhase] = useState('checking');
  const [password, setPassword] = useState('');
  const [board, setBoard] = useState(EMPTY);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  const cardRefs = useRef({});
  const dragRef = useRef(null);
  const [draggingId, setDraggingId] = useState('');
  const [insertBeforeId, setInsertBeforeId] = useState(null);
  const [logoVersion, setLogoVersion] = useState({});

  useEffect(() => {
    document.title = 'Pipeline';
    const robots = document.querySelector('meta[name="robots"]');
    if (robots) robots.setAttribute('content', 'noindex, nofollow, noarchive');
    revealPageChromeInstant();
    finishRouteTransition();
  }, [finishRouteTransition]);

  useEffect(() => {
    let cancelled = false;
    pipelineFetch('/api/pipeline', { method: 'GET' })
      .then((data) => {
        if (cancelled) return;
        loaded.current = false;
        setBoard(data.board?.cards ? data.board : { cards: [] });
        setPhase('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 401) setPhase('locked');
        else {
          setError(err.message);
          setPhase('locked');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'ready') return undefined;
    if (!loaded.current) {
      loaded.current = true;
      return undefined;
    }
    const handle = window.setTimeout(async () => {
      setNotice('Saving…');
      try {
        await pipelineFetch('/api/pipeline', {
          method: 'PUT',
          body: JSON.stringify({ board }),
        });
        setNotice('Saved');
        setError('');
      } catch (err) {
        setNotice('');
        setError(err.message);
      }
    }, 450);
    return () => window.clearTimeout(handle);
  }, [board, phase]);

  const signIn = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await pipelineFetch('/api/pipeline/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setPassword('');
      const data = await pipelineFetch('/api/pipeline', { method: 'GET' });
      loaded.current = false;
      setBoard(data.board?.cards ? data.board : { cards: [] });
      setPhase('ready');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addCard = () => {
    const id = crypto.randomUUID();
    setBoard((current) => ({
      cards: [...current.cards, { id, name: '', notes: '', hasLogo: false }],
    }));
  };

  const updateCard = (id, patch) => {
    setBoard((current) => ({
      cards: current.cards.map((card) => (card.id === id ? { ...card, ...patch } : card)),
    }));
  };

  const removeCard = (id) => {
    deleteLogo(id);
    setBoard((current) => ({
      cards: current.cards.filter((card) => card.id !== id),
    }));
  };

  const onLogoPick = (cardId) => async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setNotice('Uploading logo…');
    setError('');
    try {
      await uploadLogo(cardId, file);
      updateCard(cardId, { hasLogo: true });
      setLogoVersion((current) => ({ ...current, [cardId]: Date.now() }));
      setNotice('Saved');
    } catch (err) {
      setNotice('');
      setError(err.message);
    }
  };

  const clearLogo = (cardId) => async () => {
    await deleteLogo(cardId);
    updateCard(cardId, { hasLogo: false });
    setLogoVersion((current) => ({ ...current, [cardId]: Date.now() }));
  };

  const findInsertBefore = (clientY, draggedId, cards) => {
    for (const card of cards) {
      if (card.id === draggedId) continue;
      const node = cardRefs.current[card.id];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return card.id;
    }
    return null;
  };

  const finishDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const { cardId } = drag;
    setBoard((current) => {
      const beforeId = findInsertBefore(event.clientY, cardId, current.cards);
      return reorderCard(current, cardId, beforeId);
    });
    dragRef.current = null;
    setDraggingId('');
    setInsertBeforeId(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const startDrag = (cardId) => (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { cardId, pointerId: event.pointerId };
    setDraggingId(cardId);
    setInsertBeforeId(findInsertBefore(event.clientY, cardId, board.cards));
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setInsertBeforeId(findInsertBefore(event.clientY, drag.cardId, board.cards));
  };

  return (
    <main className="pipeline-page">
      {phase !== 'ready' ? (
        <form className="pipeline-lock" onSubmit={signIn}>
          <label htmlFor="pipeline-password">Password</label>
          <input
            id="pipeline-password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={phase === 'checking' || busy}
            required
          />
          <button type="submit" disabled={phase === 'checking' || busy}>
            {busy ? 'Checking…' : 'Enter'}
          </button>
          {error ? <p className="pipeline-error">{error}</p> : null}
        </form>
      ) : (
        <div className="pipeline-app">
          <div className="pipeline-toolbar">
            <p className="pipeline-status">{error || notice}</p>
            <button type="button" onClick={addCard}>Add client</button>
          </div>
          <div className="pipeline-board">
            {board.cards.map((card) => (
              <article
                key={card.id}
                ref={(node) => {
                  if (node) cardRefs.current[card.id] = node;
                  else delete cardRefs.current[card.id];
                }}
                className={[
                  'pipeline-card',
                  draggingId === card.id ? 'is-dragging' : '',
                  insertBeforeId === card.id ? 'is-drop-before' : '',
                ].filter(Boolean).join(' ')}
              >
                <span
                  role="button"
                  tabIndex={0}
                  className="pipeline-card__handle"
                  aria-label="Drag to reorder"
                  onPointerDown={startDrag(card.id)}
                  onPointerMove={moveDrag}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                >
                  Move
                </span>
                <div className="pipeline-card__logo-row">
                  <div className="pipeline-card__logo-slot">
                    {card.hasLogo ? (
                      <img
                        className="pipeline-card__logo"
                        src={`/api/pipeline/logo/${encodeURIComponent(card.id)}?v=${logoVersion[card.id] || 0}`}
                        alt=""
                      />
                    ) : (
                      <span className="pipeline-card__logo-placeholder" aria-hidden="true">Logo</span>
                    )}
                  </div>
                  <div className="pipeline-card__logo-actions">
                    <label className="pipeline-card__logo-upload">
                      {card.hasLogo ? 'Change logo' : 'Add logo'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={onLogoPick(card.id)}
                      />
                    </label>
                    {card.hasLogo ? (
                      <button type="button" className="pipeline-card__remove" onClick={clearLogo(card.id)}>
                        Remove logo
                      </button>
                    ) : null}
                  </div>
                </div>
                <input
                  className="pipeline-card__name"
                  value={card.name}
                  placeholder="Client name"
                  aria-label="Client name"
                  onChange={(event) => updateCard(card.id, { name: event.target.value })}
                />
                <textarea
                  className="pipeline-card__notes"
                  value={card.notes}
                  placeholder="Notes"
                  aria-label="Notes"
                  rows={6}
                  onChange={(event) => updateCard(card.id, { notes: event.target.value })}
                />
                <button type="button" className="pipeline-card__remove" onClick={() => removeCard(card.id)}>
                  Remove
                </button>
              </article>
            ))}
            <div
              className={[
                'pipeline-board__tail',
                draggingId && insertBeforeId === null ? 'is-drop-before' : '',
              ].filter(Boolean).join(' ')}
              aria-hidden="true"
            />
          </div>
          <button type="button" className="pipeline-pdf" onClick={() => window.print()}>
            Download PDF
          </button>
        </div>
      )}

      <section className="pipeline-print" aria-hidden="true">
        <h1>Taylor-Marriott pipeline</h1>
        <div className="pipeline-print__row">
          {board.cards.map((card) => (
            <article key={card.id}>
              {card.hasLogo ? (
                <img
                  className="pipeline-print__logo"
                  src={`/api/pipeline/logo/${encodeURIComponent(card.id)}?v=${logoVersion[card.id] || 0}`}
                  alt=""
                />
              ) : null}
              <h2>{card.name || 'Untitled client'}</h2>
              <p>{card.notes}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
