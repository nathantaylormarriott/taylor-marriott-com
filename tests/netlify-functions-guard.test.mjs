import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { rm } from 'node:fs/promises';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FORBIDDEN_DECL = /\b(?:const|let|var)\s+(__dirname|__filename)\s*=/;

const netlifyBundlePlugins = [
  {
    name: 'stub-netlify-packages',
    setup(build) {
      build.onResolve({ filter: /^@netlify\/blobs$/ }, () => ({
        path: path.join(ROOT, 'tests/stubs/netlify-blobs.js'),
      }));
      build.onResolve({ filter: /^@netlify\/database$/ }, () => ({
        path: path.join(ROOT, 'tests/stubs/netlify-database.js'),
      }));
    },
  },
];

function walkJs(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules') continue;
      walkJs(full, out);
    } else if (/\.(js|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

test('netlify/functions and shared must not declare __dirname or __filename', () => {
  const dirs = ['netlify/functions', 'shared'].map((d) => path.join(ROOT, d));
  const offenders = [];
  for (const dir of dirs) {
    for (const file of walkJs(dir)) {
      const text = fs.readFileSync(file, 'utf8');
      if (FORBIDDEN_DECL.test(text)) offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], `Forbidden __dirname/__filename in: ${offenders.join(', ')}`);
});

test('Netlify-style esbuild bundle imports each function handler', async () => {
  const fnDir = path.join(ROOT, 'netlify/functions');
  const entries = fs
    .readdirSync(fnDir)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .map((f) => path.join(fnDir, f));

  const outDir = path.join(ROOT, 'tests/.bundled-handlers');
  fs.mkdirSync(outDir, { recursive: true });
  try {
    for (const entry of entries) {
      const base = path.basename(entry, '.js');
      const outFile = path.join(outDir, `${base}.mjs`);
      await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: outFile,
        logLevel: 'silent',
        packages: 'external',
        plugins: netlifyBundlePlugins,
      });
      await import(pathToFileURL(outFile).href);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('bundled client-preview-site handler returns 400 without place_id', async () => {
  const entry = path.join(ROOT, 'netlify/functions/client-preview-site.js');
  const outDir = path.join(ROOT, 'tests/.bundled-handlers');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'client-preview-site.mjs');
  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: outFile,
      logLevel: 'silent',
      packages: 'external',
      plugins: netlifyBundlePlugins,
    });
    const mod = await import(pathToFileURL(outFile).href);
    const res = await mod.default(new Request('https://example.com/api/client-preview-site'));
    assert.equal(res.status, 400);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
