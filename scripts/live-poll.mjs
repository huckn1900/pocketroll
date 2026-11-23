/* Poll a deployed URL until a string appears in the served file (GitHub Pages can lag a minute
   after a push). Usage: node scripts/live-poll.mjs <url> <needle> [tries] */
const [url, needle, triesArg] = process.argv.slice(2);
const tries = Number(triesArg || 6);
for (let n = 1; n <= tries; n++){
  const res = await fetch(url, { cache: 'no-store' });
  const body = await res.text();
  if (body.includes(needle)){ console.log(`live at attempt ${n}`); break; }
  console.log(`attempt ${n}: not live yet`);
  if (n < tries) await new Promise(r => setTimeout(r, 20000));
  else console.log('NOT LIVE after ' + tries + ' attempts');
}
