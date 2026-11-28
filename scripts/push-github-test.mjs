// Push POCKETROLL's personal test build — everything unlocked — to the private GitHub line.
// usage: node scripts/push-github-test.mjs --token <gh PAT> [--repo pocketroll]
// The GitHub repo is a test build, not a second product: one branch (gh-test) cut from
// master, differing ONLY in the licensing constants and its own cache name, force-pushed
// to <repo>/main. GitHub Pages rebuilds from main automatically. Production (Cloudflare)
// keeps serving master's app.js with the free gate; this file never touches master.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const token = opt('token');
if (!token) throw new Error('missing --token');
const repo = opt('repo', 'pocketroll');
const owner = opt('owner', 'huckn1900');
const site = `https://${owner}.github.io/${repo}`;
const api = `https://api.github.com/repos/${owner}/${repo}`;
const pushUrl = `https://${token}@github.com/${owner}/${repo}.git`;
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// A branch cut from a clean master: dirty tracked files would commit unrelated edits.
// Untracked scratch (probe files, temp bodies) does not enter the branch.
if (git(['status', '--porcelain', '--untracked-files=no'])) throw new Error('working tree is not clean');

git(['checkout', '-B', 'gh-test']);
const appPath = 'app.js', swPath = 'sw.js';
let app = await readFile(appPath, 'utf8');
let sw = await readFile(swPath, 'utf8');
const build = (app.match(/BUILD = 'pocketroll-v(\d+)'/) || [])[1];
if (!build) throw new Error('no BUILD version in app.js');
app = app.replace("const WEB_LICENSE = 'free'", "const WEB_LICENSE = 'all'")
  .replace(/BUILD = 'pocketroll-v(\d+)'/, `BUILD = 'pocketroll-test-${build}'`);
sw = sw.replace(/CACHE = 'pocketroll-v(\d+)'/, `CACHE = 'pocketroll-test-${build}'`);
if (!app.includes("const WEB_LICENSE = 'all'")) throw new Error('WEB_LICENSE constant not found');
await writeFile(appPath, app);
await writeFile(swPath, sw);
git(['add', appPath, swPath]);
git(['-c', 'user.name=huckn1900', '-c', 'user.email=huckn1900@gmail.com', 'commit', '--allow-empty',
  '-m', `test build v${build}: everything unlocked (personal GitHub line)`]);
git(['checkout', 'master']); // master's app.js keeps the free gate; the variant lives on gh-test
git(['push', '-f', pushUrl, 'gh-test:main']);

// Wait for the Pages rebuild, then verify the served file really carries the test marker.
const pages = async () => JSON.parse(await (await fetch(`${api}/pages`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } })).text());
const before = (await pages()).last_updated;
let built = false;
for (let i = 0; i < 8; i++) {
  await new Promise(r => setTimeout(r, 15000));
  const p = await pages();
  if (p.status === 'built' && p.last_updated > before) { built = true; break; }
}
if (!built) throw new Error('Pages did not rebuild within 2 minutes');

let served = '';
for (let i = 0; i < 8; i++) {
  const res = await fetch(`${site}/app.js?cb=${Date.now()}`);
  const text = await res.text();
  if (text.includes(`BUILD = 'pocketroll-test-${build}'`) && text.includes("const WEB_LICENSE = 'all'")) {
    served = `served app.js carries test marker pocketroll-test-${build}`;
    break;
  }
  await new Promise(r => setTimeout(r, 10000));
}
if (!served) throw new Error('served app.js still carries the production marker');
console.log(JSON.stringify({ pushed: 'gh-test:main', test_build: `pocketroll-test-${build}`, site, built: true, served }, null, 2));
