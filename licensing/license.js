/* POCKETROLL licensing — the Pro unlock is a Payhip license key, verified online.
   Payhip's current license API (v2) needs no account API key: each product carries its own
   product secret key, which Payhip documents as meant for public applications. Verification:
   GET https://payhip.com/api/v2/license/verify?license_key=... with the secret in a
   product-secret-key header. An EMPTY response means "no such key"; a refunded order makes
   the key come back enabled:false, so a code that stops verifying locks the app again.
   The store link and secret key are filled in once the Payhip product exists.
   This module returns data only — every UI line lives in app.js / index.html. */
const PAYHIP_VERIFY_URL = 'https://payhip.com/api/v2/license/verify';
const PAYHIP_STORE_URL = '';   // Payhip product page (US$4.99 one-time Pro unlock) — fill when it exists
const PAYHIP_PRODUCT_SECRET = ''; // Settings ▸ license keys on the Payhip product — fill when it exists
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
    const data = JSON.parse(text).data;
    if (!data) return { status: 'unknown' };
    return data.enabled ? { status: 'ok', data } : { status: 'disabled' };
  } catch { return { status: 'offline' }; }
}
