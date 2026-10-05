import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'pipeline-logos';
const DEV_DIR = fileURLToPath(new URL('../../../.netlify/pipeline-logos', import.meta.url));
const MAX_BYTES = 512 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function isLogoContentType(type) {
  return ALLOWED_TYPES.has(String(type || '').toLowerCase());
}

export function cleanCardId(cardId) {
  const id = String(cardId || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,48}$/.test(id)) return '';
  return id;
}

function blobKey(cardId) {
  return `card/${cardId}`;
}

function devMetaPath(cardId) {
  return join(DEV_DIR, `${cardId}.meta.json`);
}

function devDataPath(cardId, ext) {
  return join(DEV_DIR, `${cardId}${ext}`);
}

async function readDevLogo(cardId) {
  try {
    const metaRaw = await readFile(devMetaPath(cardId), 'utf8');
    const meta = JSON.parse(metaRaw);
    const data = await readFile(devDataPath(cardId, meta.ext || '.bin'));
    return { data, contentType: meta.contentType || 'application/octet-stream' };
  } catch {
    return null;
  }
}

async function writeDevLogo(cardId, buffer, contentType) {
  const ext = contentType === 'image/png' ? '.png'
    : contentType === 'image/webp' ? '.webp'
      : contentType === 'image/gif' ? '.gif'
        : '.jpg';
  await mkdir(DEV_DIR, { recursive: true });
  await writeFile(devDataPath(cardId, ext), buffer);
  await writeFile(devMetaPath(cardId), JSON.stringify({ contentType, ext }));
}

async function deleteDevLogo(cardId) {
  try {
    const metaRaw = await readFile(devMetaPath(cardId), 'utf8');
    const meta = JSON.parse(metaRaw);
    await unlink(devDataPath(cardId, meta.ext || '.bin')).catch(() => {});
    await unlink(devMetaPath(cardId)).catch(() => {});
  } catch {
    /* no logo */
  }
}

function blobStore() {
  try {
    return getStore({ name: STORE_NAME, consistency: 'strong' });
  } catch {
    return null;
  }
}

export async function readLogo(cardId) {
  const id = cleanCardId(cardId);
  if (!id) return null;

  const store = blobStore();
  if (store) {
    const result = await store.getWithMetadata(blobKey(id), { type: 'arrayBuffer' });
    if (!result?.data) return null;
    const contentType = result.metadata?.contentType || 'application/octet-stream';
    return { data: Buffer.from(result.data), contentType };
  }

  const dev = await readDevLogo(id);
  if (!dev) return null;
  return { data: Buffer.from(dev.data), contentType: dev.contentType };
}

export async function writeLogo(cardId, buffer, contentType) {
  const id = cleanCardId(cardId);
  if (!id) throw new Error('Invalid card id');
  if (!isLogoContentType(contentType)) throw new Error('Unsupported image type');
  if (buffer.byteLength > MAX_BYTES) throw new Error('Logo must be 512 KB or smaller');

  const store = blobStore();
  if (store) {
    await store.set(blobKey(id), buffer, {
      metadata: { contentType, updatedAt: new Date().toISOString() },
    });
    return;
  }

  await writeDevLogo(id, buffer, contentType);
}

export async function deleteLogo(cardId) {
  const id = cleanCardId(cardId);
  if (!id) return;

  const store = blobStore();
  if (store) {
    await store.delete(blobKey(id));
    return;
  }

  await deleteDevLogo(id);
}
