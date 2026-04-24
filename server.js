const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── QR code image generator (server-side, no browser library needed) ──────
app.get('/api/qr', async (req, res) => {
  const data = req.query.data;
  if (!data) return res.status(400).json({ error: 'Missing data param' });

  try {
    const dataUrl = await QRCode.toDataURL(data, {
      errorCorrectionLevel: 'M',
      width: 240,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
    res.json({ url: dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Constants (mirrored from the Flutter app) ──────────────────────────────
const IOS_CLIENT_ID = 'q6KqjlQINmjOC86rqt9JdU_i41nhD_Z4DwygpBxGiIs';
const IOS_REDIRECT_URI = 'com.basicfit.bfa:/oauthredirect';
const ANDROID_USER_AGENT = 'Basic Fit App/1.76.0.2634 (Android)';

const AUTH_URL = 'https://auth.basic-fit.com/token';
const API_URL = 'https://bfa.basic-fit.com/api/member/info';

// ── OAuth callback page (loaded inside the popup after login) ─────────────
// BasicFit redirects the popup here. The page sends the code back to the
// parent window via postMessage, then closes itself — no user action needed.
app.get('/callback', (req, res) => {
  const code  = JSON.stringify(req.query.code  || '');
  const error = JSON.stringify(req.query.error || '');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{background:#121212;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}p{color:#9e9e9e;font-size:15px}</style>
</head><body><p>Connexion en cours…</p><script>
const code=${code}, error=${error};
if(code){window.opener&&window.opener.postMessage({type:'oauth_callback',code},window.location.origin);}
else{window.opener&&window.opener.postMessage({type:'oauth_error',error},window.location.origin);}
window.close();
</script></body></html>`);
});

// ── Proxy: exchange auth code for tokens ──────────────────────────────────
app.post('/api/token', async (req, res) => {
  const { code, code_verifier, redirect_uri } = req.body;

  if (!code || !code_verifier) {
    return res.status(400).json({ error: 'Missing code or code_verifier' });
  }

  // Use the redirect_uri the client actually used in the OAuth request
  const usedRedirectUri = redirect_uri || IOS_REDIRECT_URI;

  const payload =
    `code=${encodeURIComponent(code)}` +
    `&code_verifier=${encodeURIComponent(code_verifier)}` +
    `&redirect_uri=${encodeURIComponent(usedRedirectUri)}` +
    `&client_id=${IOS_CLIENT_ID}` +
    `&grant_type=authorization_code`;

  try {
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': ANDROID_USER_AGENT,
      },
      body: payload,
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[token] upstream error:', err.message);
    res.status(502).json({ error: 'Token exchange failed' });
  }
});

// ── Proxy: refresh access token ────────────────────────────────────────────
app.post('/api/refresh', async (req, res) => {
  const { access_token, refresh_token } = req.body;

  if (!access_token || !refresh_token) {
    return res.status(400).json({ error: 'Missing tokens' });
  }

  const payload =
    `access_token=${encodeURIComponent(access_token)}` +
    `&refresh_token=${encodeURIComponent(refresh_token)}` +
    `&redirect_uri=${encodeURIComponent(IOS_REDIRECT_URI)}` +
    `&client_id=${IOS_CLIENT_ID}` +
    `&grant_type=refresh_token`;

  try {
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': ANDROID_USER_AGENT,
      },
      body: payload,
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[refresh] upstream error:', err.message);
    res.status(502).json({ error: 'Token refresh failed' });
  }
});

// ── Proxy: fetch member info ───────────────────────────────────────────────
app.get('/api/member', async (req, res) => {
  const auth = req.headers['authorization'];

  if (!auth) {
    return res.status(401).json({ error: 'No authorization header' });
  }

  try {
    const response = await fetch(API_URL, {
      headers: {
        Authorization: auth,
        'User-Agent': ANDROID_USER_AGENT,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401) {
      return res.status(401).json({ error: 'Unauthorized — token may be expired' });
    }

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[member] upstream error:', err.message);
    res.status(502).json({ error: 'Member info fetch failed' });
  }
});

// ── Fallback: serve index.html for any unmatched route ────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BasicShare Web running → http://localhost:${PORT}`);
});
