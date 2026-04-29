const express = require('express');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
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

// ── Constants ──────────────────────────────
const CLIENT_ID = 'q6KqjlQINmjOC86rqt9JdU_i41nhD_Z4DwygpBxGiIs';
const REDIRECT_URI = 'com.basicfit.bfa:/oauthredirect';
const APP_USER_AGENT = 'Basic Fit App/1.76.0.2634 (Android)';

const AUTH_URL = 'https://auth.basic-fit.com/token';
const BFA_BASE = 'https://bfa.basic-fit.com';
const MEMBER_API_URL = `${BFA_BASE}/api/member/info`;

// ── Proxy: exchange auth code for tokens ──────────────────────────────────
app.post('/api/token', async (req, res) => {
  const { code, code_verifier, redirect_uri } = req.body;

  if (!code || !code_verifier) {
    return res.status(400).json({ error: 'Missing code or code_verifier' });
  }

  const usedRedirectUri = redirect_uri || REDIRECT_URI;

  const payload =
    `code=${encodeURIComponent(code)}` +
    `&code_verifier=${encodeURIComponent(code_verifier)}` +
    `&redirect_uri=${encodeURIComponent(usedRedirectUri)}` +
    `&client_id=${CLIENT_ID}` +
    `&grant_type=authorization_code`;

  try {
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': APP_USER_AGENT,
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
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&client_id=${CLIENT_ID}` +
    `&grant_type=refresh_token`;

  try {
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': APP_USER_AGENT,
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
    const response = await fetch(MEMBER_API_URL, {
      headers: {
        Authorization: auth,
        'User-Agent': APP_USER_AGENT,
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

// ── Proxy: fetch gym visits ───────────────────────────────────────────────
app.get('/api/visits', async (req, res) => {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'No authorization header' });

  try {
    const response = await fetch(`${BFA_BASE}/api/member/gym-visits-total?from=2000-01-01&to=3000-12-31`, {
      headers: {
        Authorization: auth,
        'User-Agent': APP_USER_AGENT,
        'Content-Type': 'application/json',
      },
    });
    if (response.status === 401) return res.status(401).json({ error: 'Unauthorized' });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[visits] upstream error:', err.message);
    res.status(502).json({ error: 'Visits fetch failed' });
  }
});

// ── Fallback: serve index.html for any unmatched route ────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BasicShare Web running → http://localhost:${PORT}`);
});
