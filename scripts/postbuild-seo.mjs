#!/usr/bin/env node
/**
 * Post-build SEO maintenance: stamp sitemap lastmod to build date.
 * Runs after vite build — does not touch public-facing React pages.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distSitemap = join(root, 'dist', 'sitemap.xml');
const publicSitemap = join(root, 'public', 'sitemap.xml');
const today = new Date().toISOString().slice(0, 10);

for (const file of [distSitemap, publicSitemap]) {
  try {
    const xml = readFileSync(file, 'utf8');
    const updated = xml.replace(/<lastmod>[^<]+<\/lastmod>/g, `<lastmod>${today}</lastmod>`);
    if (updated !== xml) writeFileSync(file, updated);
  } catch {
    // dist/sitemap may not exist if build failed
  }
}

console.log(`[seo] sitemap lastmod → ${today}`);
