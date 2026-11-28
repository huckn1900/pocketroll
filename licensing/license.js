/* POCKETROLL licensing — the Pro unlock is a Payhip license key, verified online.
   Payhip's current license API (v2) needs no account API key: each product carries its own
   product secret key, which Payhip documents as meant for public applications. Verification:
   GET https://payhip.com/api/v2/license/verify?license_key=... with the secret in a
   product-secret-key header. An EMPTY response means "no such key"; a refunded order makes
   the key come back enabled:false, so a code that stops verifying locks the app again.
   The store link and secret key are filled in once the Payhip product exists.
   This module returns data only — every UI line lives in app.js / index.html. */
const PAYHIP_VERIFY_URL = 'https://payhip.com/api/v2/license/verify';
const PAYHIP_STORE_URL = 'https://payhip.com/b/ajTMF';   // the Pro unlock product, US$4.99 one-time
const PAYHIP_PRODUCT_SECRET = 'prod_sk_ajTMF_4d92b4f89c817d7503028dbe3e8d2db7df95a149'; // product secret key (Advanced Options ▸ license keys)
const LICENSE_STORE_KEY = 'pocketroll-license';

function storedLicense(){ try { return JSON.parse(localStorage.getItem(LICENSE_STORE_KEY)) || null; } catch { return null; } }
function storeLicense(key){ try { localStorage.setItem(LICENSE_STORE_KEY, JSON.stringify({ key, at: Date.now() })); } catch {} }
function clearStoredLicense(){ try { localStorage.removeItem(LICENSE_STORE_KEY); } catch {} }

/* Returns {status:'ok'|'unknown'|'disabled'|'offline'|'unconfigured', data?}.
   'unknown' = Payhip answered with an empty body (not a key); 'offline' = the network
   refused, which must NOT revoke a cached grant — offline keeps working. */
async function payhipVerify(rawKey){
  if (!PAYHIP_PRODUCT_SECRET) return { status: 'unconfigured' };
  const key = String(rawKey || '').trim().toUpperCase();
  if (!key) return { status: 'unknown' };
  try {
    const res = await fetch(PAYHIP_VERIFY_URL + '?license_key=' + encodeURIComponent(key),
      { headers: { 'product-secret-key': PAYHIP_PRODUCT_SECRET } });
    const text = await res.text();
    if (!text) return { status: 'unknown' };
    let body;
    try { body = JSON.parse(text); } catch { return { status: 'unknown' }; }
    /* Docs promise an empty body for a failed check; live behaviour answers
       {"data":[],"error":true} for a key that does not exist — and [] is truthy in JS, so the
       not-found test must look at error/array, not !data. {"code":...} is an authentication or
       parameter problem: two different answers to the user. */
    const data = body.data;
    if (!data || Array.isArray(data) || body.error) return body.code ? { status: 'unconfigured' } : { status: 'unknown' };
    return data.enabled ? { status: 'ok', data } : { status: 'disabled' };
  } catch { return { status: 'offline' }; }
}
