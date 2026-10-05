import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MissingDatabaseConnectionError, getDatabase } from '@netlify/database';
import { LOCK_MS, MAX_FAILURES } from './pipelineAuth.js';

const DEV_FILE = fileURLToPath(new URL('../../../.netlify/pipeline-dev.json', import.meta.url));

export function defaultBoard() {
  return { cards: [] };
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function orderedCardsFromLegacy(input) {
  const columnsIn = Array.isArray(input?.columns) ? input.columns : [];
  const cardsIn = Array.isArray(input?.cards) ? input.cards : [];
  if (!columnsIn.length) return cardsIn;

  const ordered = [];
  const placed = new Set();
  columnsIn.slice(0, 24).forEach((col) => {
    const columnId = cleanText(col?.id, 48);
    if (!columnId) return;
    cardsIn.forEach((card) => {
      if (cleanText(card?.columnId, 48) !== columnId) return;
      const id = cleanText(card?.id, 48);
      if (!id || placed.has(id)) return;
      placed.add(id);
      ordered.push(card);
    });
  });
  cardsIn.forEach((card) => {
    const id = cleanText(card?.id, 48);
    if (!id || placed.has(id)) return;
    placed.add(id);
    ordered.push(card);
  });
  return ordered;
}

export function sanitizeBoard(input) {
  const cardsIn = orderedCardsFromLegacy(input);
  const cards = [];
  const seenCards = new Set();

  cardsIn.slice(0, 400).forEach((card) => {
    const id = cleanText(card?.id, 48);
    if (!id || seenCards.has(id)) return;
    seenCards.add(id);
    cards.push({
      id,
      name: cleanText(card?.name, 120),
      notes: cleanText(card?.notes, 4000),
    });
  });

  return { cards };
}

function sqlClient() {
  try {
    return getDatabase().sql;
  } catch (error) {
    if (error instanceof MissingDatabaseConnectionError) return null;
    throw error;
  }
}

async function readDev() {
  try {
    return JSON.parse(await readFile(DEV_FILE, 'utf8'));
  } catch {
    return { board: defaultBoard(), attempts: {} };
  }
}

async function writeDev(data) {
  await mkdir(dirname(DEV_FILE), { recursive: true });
  await writeFile(DEV_FILE, JSON.stringify(data));
}

export async function ensureDevTables() {
  const sql = sqlClient();
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_board (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_login_attempts (
      ip_hash text PRIMARY KEY,
      failures integer NOT NULL DEFAULT 0,
      locked_until timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

function firstRow(result) {
  if (Array.isArray(result)) return result[0] || null;
  if (Array.isArray(result?.rows)) return result.rows[0] || null;
  return null;
}

export async function readBoard() {
  const sql = sqlClient();
  if (!sql) {
    const dev = await readDev();
    return sanitizeBoard(dev.board);
  }
  const result = await sql`SELECT data FROM pipeline_board WHERE id = 'main'`;
  const row = firstRow(result);
  if (!row?.data) return defaultBoard();
  const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  return sanitizeBoard(data);
}

export async function writeBoard(board) {
  const sql = sqlClient();
  const clean = sanitizeBoard(board);
  if (!sql) {
    const dev = await readDev();
    await writeDev({ ...dev, board: clean });
    return clean;
  }
  const payload = JSON.stringify(clean);
  await sql`
    INSERT INTO pipeline_board (id, data, updated_at)
    VALUES ('main', ${payload}::jsonb, now())
    ON CONFLICT (id) DO UPDATE
    SET data = EXCLUDED.data, updated_at = now()
  `;
  return clean;
}

export async function loginState(ipHash) {
  const sql = sqlClient();
  if (!sql) {
    const dev = await readDev();
    const row = dev.attempts?.[ipHash];
    if (!row) return { locked: false, failures: 0 };
    const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : 0;
    return { locked: lockedUntil > Date.now(), failures: Number(row.failures) || 0 };
  }
  const result = await sql`
    SELECT failures, locked_until FROM pipeline_login_attempts WHERE ip_hash = ${ipHash}
  `;
  const row = firstRow(result);
  if (!row) return { locked: false, failures: 0 };
  const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : 0;
  return {
    locked: lockedUntil > Date.now(),
    failures: Number(row.failures) || 0,
  };
}

export async function recordFailure(ipHash) {
  const sql = sqlClient();
  const state = await loginState(ipHash);
  const failures = state.failures + 1;
  const lockedUntil = failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MS).toISOString() : null;
  if (!sql) {
    const dev = await readDev();
    dev.attempts = dev.attempts || {};
    dev.attempts[ipHash] = { failures, locked_until: lockedUntil };
    await writeDev(dev);
    return failures >= MAX_FAILURES;
  }
  await sql`
    INSERT INTO pipeline_login_attempts (ip_hash, failures, locked_until, updated_at)
    VALUES (${ipHash}, ${failures}, ${lockedUntil}, now())
    ON CONFLICT (ip_hash) DO UPDATE
    SET failures = EXCLUDED.failures,
        locked_until = EXCLUDED.locked_until,
        updated_at = now()
  `;
  return failures >= MAX_FAILURES;
}

export async function clearFailures(ipHash) {
  const sql = sqlClient();
  if (!sql) {
    const dev = await readDev();
    if (dev.attempts) delete dev.attempts[ipHash];
    await writeDev(dev);
    return;
  }
  await sql`DELETE FROM pipeline_login_attempts WHERE ip_hash = ${ipHash}`;
}
