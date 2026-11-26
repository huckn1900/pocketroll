/* test/browser.mjs — one place where the browser is named, so the CDP suites run on any machine.
   Set DSH_CHROME to a Chrome/Chromium executable to use your own build; without it the
   platform default for this OS is used. The scratch profile lives in the system temp dir. */
export function chromeBin(){
  const custom = process.env.DSH_CHROME;
  if (custom) return custom;
  const p = process.platform;
  if (p === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (p === 'linux') return process.env.CHROME_BIN || 'google-chrome';
  return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}
/* An isolated profile per run: IndexedDB of one suite never leaks into the next. */
export function tmpProfile(tag, port){
  const dir = process.env.TEMP || process.env.TMPDIR || (process.env.HOME + '/tmp');
  return `${dir}${process.platform === 'win32' ? '\\' : '/'}chrome-${tag}-${port}-${Date.now().toString(36)}`;
}
