// One release = BOTH surfaces updated together: the production site on Cloudflare and the
// personal test line on GitHub. They must never drift — same working tree, same BUILD/CACHE;
// the GitHub copy only renames its cache so the two never collide in a browser.
// usage: node scripts/release.mjs --cf-token <cfat token> --gh-token <gh PAT> [--repo pocketroll]
// Order matters: production first (it serves master as-is), then the test line, each step
// verifying its own served build marker before the next runs.
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };
const cf = opt('cf-token'), gh = opt('gh-token');
if (!cf || !gh) {
  console.error('usage: node scripts/release.mjs --cf-token <cfat token> --gh-token <gh PAT> [--repo pocketroll]');
  process.exit(2);
}
const steps = [
  ['scripts/deploy-cloudflare.mjs', ['--token', cf]],
  ['scripts/push-github-test.mjs', ['--token', gh, ...(opt('repo') ? ['--repo', opt('repo')] : [])]],
];
for (const [script, args] of steps) {
  console.log(`--- release step: ${script}`);
  const r = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`release stopped at ${script} — the other surface was NOT updated`); process.exit(r.status ?? 1); }
}
console.log('release done: production https://pocketroll35.pages.dev and the personal test line https://huckn1900.github.io/pocketroll/ now serve the same version');
