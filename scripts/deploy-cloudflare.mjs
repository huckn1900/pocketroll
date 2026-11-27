// Deploy the POCKETROLL web shell to Cloudflare Pages via the API.
// usage: node scripts/deploy-cloudflare.mjs --token <cf_token> [--project pocketroll35]
// Protocol = wrangler's direct-upload flow (same as tokyo-wars-web/deploy-cloudflare.ts):
//   1. GET .../pages/projects/<project>/upload-token -> JWT (300s)
//   2. POST /pages/assets/upload   (JWT, JSON batches {key,value,metadata,base64})
//   3. POST /pages/assets/upsert-hashes (JWT, {hashes})
//   4. POST .../pages/projects/<project>/deployments (multipart, manifest only)
// Key = wrangler's asset hash: blake3(base64(content) + extension), first 32 hex chars.
// Only the shell files go up — exactly sw.js SHELL plus index.html; test/docs/dev
// artifacts stay local. Verification is real HTTP on a probe branch, then production.
import { readFile } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { blake3 } from 'hash-wasm';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : def;
};
const token = opt('token') || process.env.CF_API_TOKEN;
if (!token) throw new Error('missing --token');
const project = opt('project', 'pocketroll35');
const root = opt('dir', '.');

// The deployable surface mirrors sw.js SHELL — anything not listed here must not
// ship, or the deployed app would offer files the service worker never knows.
const FILES = [
  'index.html', 'app.js', 'sw.js',
  'storage/database.js', 'storage/current-roll.js', 'storage/archive.js', 'storage/backup.js',
  'film/roll-manager.js', 'film/development.js',
  'camera/viewfinder.js', 'camera/camera-manager.js', 'camera/capture.js',
  'licensing/license.js',
  'manifest.webmanifest', 'icon.png', 'icon-192.png',
  'assets/cameras.json', 'assets/films.json', 'assets/samples/street.jpg',
  'assets/fonts/roboto-condensed-700.woff2', 'assets/fonts/ibm-plex-mono-400.woff2',
];
const MIME = {
  html: 'text/html', js: 'text/javascript', json: 'application/json',
  woff2: 'font/woff2', jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml',
};

const accounts = await (await fetch('https://api.cloudflare.com/client/v4/accounts', {
  headers: { Authorization: 'Bearer ' + token },
})).json();
if (!accounts.success) throw new Error('accounts: ' + JSON.stringify(accounts.errors));
const accountId = accounts.result[0].id;
console.log('account', accountId, accounts.result[0].name);

const proj = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}`, {
  headers: { Authorization: 'Bearer ' + token },
})).json();
if (!proj.success) {
  const created = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: project, production: { branch: 'main' } }),
  })).json();
  if (!created.success) throw new Error('create project: ' + JSON.stringify(created.errors));
  console.log('created project', project);
}

const files = [];
for (const rel of FILES) {
  const bytes = await readFile(`${root}/${rel}`);
  files.push({ path: rel, bytes });
}

const keyOf = async (path, bytes) => {
  const base64 = Buffer.from(bytes).toString('base64');
  const ext = (path.match(/\.[^.]*$/)?.[0] ?? '').slice(1);
  const digest = await blake3(base64 + ext);
  return Buffer.from(digest).toString('hex').slice(0, 32);
};
const manifest = {};
const byKey = new Map();
for (const f of files) {
  const key = await keyOf(f.path, f.bytes);
  if (!byKey.has(key)) byKey.set(key, f);
  manifest['/' + f.path] = key;
}
const blobs = [...byKey.entries()];
const total = blobs.reduce((s, [, f]) => s + f.bytes.length, 0);
console.log('registering', files.length, 'files,', blobs.length, 'unique blobs', Math.round(total / 1024) + 'KB');

let jwt = '';
let jwtAt = 0;
const ensureJwt = async () => {
  if (jwt && Date.now() - jwtAt < 250_000) return jwt;
  const t = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}/upload-token`, {
    headers: { Authorization: 'Bearer ' + token },
  })).json();
  if (!t.success) throw new Error('upload-token: ' + JSON.stringify(t.errors));
  jwt = t.result.jwt; jwtAt = Date.now();
  return jwt;
};

const BATCH = 14 * 1024 * 1024;
let batch = [], batchBytes = 0, batches = 0;
const flush = async () => {
  if (!batch.length) return;
  batches++;
  const res = await fetch('https://api.cloudflare.com/client/v4/pages/assets/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + await ensureJwt(), 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
  });
  const text = await res.text();
  let ok;
  try { ok = JSON.parse(text); } catch { throw new Error(`asset batch ${batches}: HTTP ${res.status} — ${text.slice(0, 200)}`); }
  if (!ok.success) throw new Error(`asset batch ${batches}: ` + JSON.stringify(ok.errors));
  console.log(`asset batch ${batches} ok (${batch.length} blobs)`);
  batch = []; batchBytes = 0;
};
for (const [key, f] of blobs) {
  if (batchBytes + f.bytes.length > BATCH && batch.length) await flush();
  batch.push({ key, value: Buffer.from(f.bytes).toString('base64'), metadata: { contentType: MIME[f.path.split('.').pop()] ?? 'application/octet-stream' }, base64: true });
  batchBytes += f.bytes.length;
}
await flush();

const ups = await (await fetch('https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + await ensureJwt(), 'Content-Type': 'application/json' },
  body: JSON.stringify({ hashes: blobs.map(([k]) => k) }),
})).json();
if (!ups.success) throw new Error('upsert-hashes: ' + JSON.stringify(ups.errors));
console.log('upsert-hashes ok');
mkdirSync(`${root}/scripts/.gh-cf`, { recursive: true });
writeFileSync(`${root}/scripts/.gh-cf/manifest.json`, JSON.stringify(manifest));

const makeDeployment = async (branch) => {
  const fd = new FormData();
  fd.append('manifest', JSON.stringify(manifest));
  if (branch) fd.append('branch', branch);
  const dep = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}/deployments`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd,
  })).json();
  if (!dep.success) throw new Error('deployments: ' + JSON.stringify(dep.errors));
  return dep.result.id;
};
const waitDeploy = async (id) => {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 4000));
    const st = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}/deployments/${id}`, {
      headers: { Authorization: 'Bearer ' + token },
    })).json();
    const s = st.result?.latest_stage?.status ?? st.result?.status;
    if (s === 'success' || s === 'ready' || s === 'error' || s === 'failed') return s;
  }
  return 'timeout';
};
const probeHttp = async (base, path) => {
  // A brand-new *.pages.dev subdomain can fail the TLS handshake for a few
  // seconds after deployment (ssl alert 40) — retry until it serves.
  let last = '';
  for (let i = 0; i < 8; i++) {
    try {
      const res = await fetch(base + path, { headers: { 'Cache-Control': 'no-cache' } });
      const text = res.ok ? await res.text() : '';
      return `${path} -> ${res.status} ${text.length}B`;
    } catch (e) {
      last = e?.cause?.message ?? String(e);
    }
    await new Promise(r => setTimeout(r, 10000));
  }
  return `${path} -> FAILED after retries (${last})`;
};

const probeBranch = 'probe-' + Date.now().toString(36);
const probeId = await makeDeployment(probeBranch);
console.log('probe deployment', probeId, 'status:', await waitDeploy(probeId));
const probeBase = `https://${probeBranch}.${project}.pages.dev`;
console.log(await probeHttp(probeBase, '/'));
console.log(await probeHttp(probeBase, '/app.js'));
await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}/deployments/${probeId}?force=true`, {
  method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
});

const prodId = await makeDeployment();
console.log('production deployment', prodId, 'status:', await waitDeploy(prodId));
const prodBase = `https://${project}.pages.dev`;
const home = await probeHttp(prodBase, '/');
let appjs = '';
for (let i = 0; i < 8 && !appjs; i++) {
  try { appjs = await (await fetch(prodBase + '/app.js', { headers: { 'Cache-Control': 'no-cache' } })).text(); }
  catch { await new Promise(r => setTimeout(r, 10000)); }
}
console.log(home);
// verify the live app carries THIS build (marker read from the local file, never hardcoded)
const localBuild = (String(await readFile(root + '/app.js')).match(/BUILD = '([^']+)'/) || [])[1] || 'none';
console.log('/app.js contains live build marker:', localBuild, '/', appjs.includes(localBuild));
console.log(await probeHttp(prodBase, '/manifest.webmanifest'));
console.log(await probeHttp(prodBase, '/assets/films.json'));

const deps = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}/deployments`, {
  headers: { Authorization: 'Bearer ' + token },
})).json();
let dropped = 0;
for (const d of (deps.result ?? [])) {
  if (d.id === prodId) continue;
  const del = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}/deployments/${d.id}?force=true`, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
  });
  if (del.ok) dropped++;
}
console.log('dropped', dropped, 'stale deployments');
console.log('FINAL production: https://' + project + '.pages.dev');
