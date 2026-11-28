// Push POCKETROLL to the private-owner GitHub line. The app itself carries the owner key
// (SHA-256 checked in app.js), so the GitHub copy needs no licensing edits — only its own
// cache/build name, so it never collides with production caches and reads as a test build.
// usage: node scripts/push-github-test.mjs --token <gh PAT> [--repo pocketroll]
// The GitHub repo is a test line, not a second product: one branch (gh-test) cut from
// master, differing only in the build name, force-pushed to <repo>/main. GitHub Pages
// rebuilds from main automatically. Production (Cloudflare) keeps serving master.
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
app = app.replace(/BUILD = 'pocketroll-v(\d+)'/, `BUILD = 'pocketroll-test-${build}'`);
sw = sw.replace(/CACHE = 'pocketroll-v(\d+)'/, `CACHE = 'pocketroll-test-${build}'`);
if (!app.includes(`BUILD = 'pocketroll-test-${build}'`)) throw new Error('BUILD constant not found');
await writeFile(appPath, app);
await writeFile(swPath, sw);
git(['add', appPath, swPath]);
git(['-c', 'user.name=huckn1900', '-c', 'user.email=huckn1900@gmail.com', 'commit', '--allow-empty',
  '-m', `test build v${build}: everything unlocked (personal GitHub line)`]);
git(['checkout', 'master']); // master's app.js keeps the free gate; the variant lives on gh-test
git(['push', '-f', pushUrl, 'gh-test:main']);

// The real gate is the served file. GitHub's pages API reports last_updated unreliably
// (observed: the content rebuilt while the API still reported the old build), so verify
// the marker directly instead of trusting the build status.
let served = '';
for (let i = 0; i < 12; i++) {
  const res = await fetch(`${site}/app.js?cb=${Date.now()}`);
  const text = await res.text();
  if (text.includes(`BUILD = 'pocketroll-test-${build}'`)) {
    served = `served app.js carries test marker pocketroll-test-${build}`;
    break;
  }
  await new Promise(r => setTimeout(r, 10000));
}
if (!served) throw new Error('Pages did not serve the test build within 2 minutes');
console.log(JSON.stringify({ pushed: 'gh-test:main', test_build: `pocketroll-test-${build}`, site, served }, null, 2));
