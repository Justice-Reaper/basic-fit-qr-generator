'use strict';

// ─── Constants ──────────────────────────────
const CLIENT_ID    = 'q6KqjlQINmjOC86rqt9JdU_i41nhD_Z4DwygpBxGiIs';
const REDIRECT_URI = 'com.basicfit.bfa:/oauthredirect';
const AUTH_BASE_URL   = 'https://login.basic-fit.com';

// ─── App State ─────────────────────────────────────────────────────────────
const state = {
  cardNumber:    '',
  deviceId:      '',
  accessToken:   '',
  refreshToken:  '',
  persistentGuid: null,
  qrTimer:       null,
};

// ─── QR Generation ─────────────────────────────────────────────────────────
async function sha256hex(str) {
  const data   = new TextEncoder().encode(str);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateGuid(size = 3) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: size }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

function getOrCreateGuid() {
  if (!state.persistentGuid) {
    state.persistentGuid = generateGuid();
  }
  return state.persistentGuid;
}

async function generateQrData() {
  const guid  = getOrCreateGuid();
  const time  = Math.floor(Date.now() / 1000);
  const input = `${state.cardNumber}${guid}${time}${state.deviceId}`;
  const hex   = await sha256hex(input);
  const hash  = hex.slice(-8).toUpperCase();
  return `GM2:${state.cardNumber}:${guid}:${time}:${hash}`;
}

// ─── PKCE Helpers ──────────────────────────────────────────────────────────
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const data   = new TextEncoder().encode(verifier);
  const hash   = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── OAuth Flow ────────────────────────────────────────────────────────────
let _activeCodeVerifier = null;
let _activePopup        = null;
let _activePollTimer    = null;
let _pastePollTimer     = null;

function cleanupOAuth() {
  if (_activePollTimer) { clearInterval(_activePollTimer); _activePollTimer = null; }
  if (_pastePollTimer)  { clearTimeout(_pastePollTimer);  _pastePollTimer  = null; }
  if (_activePopup && !_activePopup.closed) { _activePopup.close(); _activePopup = null; }
}

function extractCodeFromUrl(raw) {
  raw = raw.trim();
  const search = raw.includes('?') ? raw.split('?')[1]
               : raw.includes('code=') ? raw
               : null;
  if (!search) return raw;
  return new URLSearchParams(search).get('code') || '';
}

async function loginWithOAuth() {
  cleanupOAuth();

  const codeVerifier  = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const stateParam    = generateCodeVerifier();
  _activeCodeVerifier = codeVerifier;

  const oauthUrl =
    `${AUTH_BASE_URL}/?state=${stateParam}` +
    `&response_type=code` +
    `&code_challenge_method=S256` +
    `&app=true` +
    `&code_challenge=${codeChallenge}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&client_id=${CLIENT_ID}` +
    `&auto_login=true`;

  showLoginMessage('Log in through the BasicFit popup…', 'info');

  const popup = window.open(oauthUrl, 'BasicFit Login',
    'width=520,height=700,left=200,top=80,toolbar=no,menubar=no');

  if (!popup || popup.closed) {
    showLoginMessage('Popups are blocked. Allow them for this site and try again.', 'error');
    return;
  }

  _activePopup = popup;

  _activePollTimer = setInterval(() => {
    if (_activePopup && _activePopup.closed) {
      cleanupOAuth();
      if (!state.cardNumber) {
        showLoginMessage('Popup closed. Try again.', 'warning');
        showPastePanel(true);
      }
    }
  }, 500);

  _pastePollTimer = setTimeout(() => {
    _pastePollTimer = null;
    if (!state.cardNumber) showPastePanel(true);
  }, 5000);
}

async function handlePasteSubmit() {
  const raw  = document.getElementById('oauth-paste-input').value;
  const code = extractCodeFromUrl(raw);

  if (!code) {
    showLoginMessage('Invalid link. Make sure to copy the "Continue" link address.', 'error');
    return;
  }
  if (!_activeCodeVerifier) {
    showLoginMessage('Session expired. Click "Log in" again.', 'error');
    return;
  }

  cleanupOAuth();
  showPastePanel(false);
  showLoginMessage('Exchanging authorization code…', 'info');
  await exchangeCodeForToken(code, _activeCodeVerifier, REDIRECT_URI);
}

const _isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

function showPastePanel(show) {
  const panel = document.getElementById('oauth-paste-panel');
  panel.style.display = show ? 'block' : 'none';
  if (!show) {
    document.getElementById('oauth-paste-input').value = '';
    return;
  }

  const list = document.getElementById('oauth-steps-list');
  if (_isMobile) {
    list.innerHTML = `
      <li>Log in with your email and password</li>
      <li>When you see <strong>"You will be redirected. Click Continue"</strong>, <strong>long press</strong> on <strong>"Continue"</strong> and select <strong>"Copy link"</strong></li>
      <li>Come back here, paste the link and click <strong>Connect</strong></li>`;
  } else {
    list.innerHTML = `
      <li>Log in with your email and password</li>
      <li>When you see <strong>"You will be redirected. Click Continue"</strong>, right-click or long press on <strong>"Continue"</strong> and select <strong>"Copy link address"</strong></li>
      <li>Paste the link and click <strong>Connect</strong></li>`;
  }
}

async function exchangeCodeForToken(code, codeVerifier, redirectUri) {
  try {
    const res = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: redirectUri }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showLoginMessage(
        `Token exchange failed (${res.status}). Try again.`,
        'error'
      );
      console.error('[token] error:', err);
      return;
    }

    const data = await res.json();
    state.accessToken  = data.access_token  || '';
    state.refreshToken = data.refresh_token || '';

    localStorage.setItem('access_token',  state.accessToken);
    localStorage.setItem('refresh_token', state.refreshToken);

    showLoginMessage('Connected. Loading your profile…', 'success');
    showLoadingOverlay(true);

    await loadMemberInfo();
  } catch (err) {
    console.error('[token exchange]', err);
    showLoginMessage('Network error during exchange. Try again.', 'error');
  }
}

async function loadMemberInfo() {
  try {
    const res = await fetch('/api/member', {
      headers: { Authorization: `Bearer ${state.accessToken}` },
    });

    if (res.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        await loadMemberInfo();
        return;
      }
      showLoginMessage('Session expired. Log in again.', 'error');
      showLoadingOverlay(false);
      return;
    }

    if (!res.ok) {
      showLoginMessage(
        'Unable to load profile. Try again.',
        'warning'
      );
      showLoadingOverlay(false);
      return;
    }

    const data   = await res.json();
    const member = data.member;

    state.cardNumber  = member.cardnumber;
    state.deviceId    = member.deviceId;

    localStorage.setItem('card_number',  state.cardNumber);
    localStorage.setItem('device_id',    state.deviceId);

    showLoadingOverlay(false);
    showDashboard();
  } catch (err) {
    console.error('[member info]', err);
    showLoginMessage(
      'Network error. Try again.',
      'error'
    );
    showLoadingOverlay(false);
  }
}

async function refreshAccessToken() {
  if (!state.refreshToken) return false;
  try {
    const res = await fetch('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token:  state.accessToken,
        refresh_token: state.refreshToken,
      }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.access_token) return false;

    state.accessToken  = data.access_token;
    state.refreshToken = data.refresh_token || state.refreshToken;
    localStorage.setItem('access_token',  state.accessToken);
    localStorage.setItem('refresh_token', state.refreshToken);
    return true;
  } catch {
    return false;
  }
}

// ─── QR Code Modal ─────────────────────────────────────────────────────────
async function openQrModal() {
  const modal = document.getElementById('qr-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  document.getElementById('qr-card-label').textContent = `Card ${state.cardNumber}`;

  try {
    await renderQrCode();
    startQrRefresh();
  } catch (err) {
    console.error('[QR render]', err);
    document.getElementById('qr-card-label').textContent = `Error: ${err.message}`;
  }
}

async function renderQrCode() {
  const data = await generateQrData();

  const res = await fetch(`/api/qr?data=${encodeURIComponent(data)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const { url } = await res.json();
  document.getElementById('qr-img').src = url;
}

function startQrRefresh() {
  triggerProgressAnimation();
  stopQrRefresh();

  state.qrTimer = setInterval(async () => {
    await renderQrCode();
    triggerProgressAnimation();
  }, 5000);
}

function stopQrRefresh() {
  if (state.qrTimer) {
    clearInterval(state.qrTimer);
    state.qrTimer = null;
  }
}

function triggerProgressAnimation() {
  const bar = document.getElementById('qr-progress');
  bar.classList.remove('animating');
  void bar.offsetWidth;
  bar.classList.add('animating');
}

function closeQrModal() {
  const modal = document.getElementById('qr-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  stopQrRefresh();
}

// ─── Screen / UI helpers ───────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

let _cooldownTimer = null;

const PAID_ARTICLES = {
  massagechair: 'Massage Chair',
};

const FREE_EXTRAS = ['Yanga Sportswater'];

function showDashboard() {
  showScreen('dashboard-screen');
  if (state.accessToken) loadDashboardData();
}

async function loadDashboardData() {
  const authHeader = { Authorization: `Bearer ${state.accessToken}` };

  document.getElementById('last-visit-text').style.display = '';
  document.getElementById('last-visit-text').textContent = 'Loading...';

  try {
    const [memberRes, visitsRes] = await Promise.all([
      fetch('/api/member', { headers: authHeader }),
      fetch('/api/visits', { headers: authHeader }),
    ]);

    if (!memberRes.ok || !visitsRes.ok) {
      document.getElementById('last-visit-text').textContent = 'Could not load data';
      return;
    }

    const memberData = await memberRes.json();
    const visitsData = await visitsRes.json();
    const member = memberData.member;

    renderLastVisit(visitsData.visits || [], member.restrictedEntryTime || 180);
    renderMembership(member.membershipType || '');
    renderExtras(member.articles || []);
  } catch (err) {
    console.error('[loadDashboardData]', err);
    document.getElementById('last-visit-text').textContent = 'Error loading data';
  }
}

function renderLastVisit(visits, restrictedEntryTime) {
  const text = document.getElementById('last-visit-text');

  if (visits.length === 0) {
    text.textContent = 'No visits recorded';
    return;
  }

  const last = visits[0];
  const visitDate = new Date(last.swipeDateTime);

  const now = new Date();
  const diffMs = now - visitDate;

  const dateStr = visitDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = visitDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  text.textContent = `Last visit: ${dateStr} at ${timeStr}`;

  const cooldownSec = restrictedEntryTime * 60;
  const elapsedSec = Math.floor(diffMs / 1000);

  if (elapsedSec < cooldownSec) {
    startCooldownTimer(cooldownSec, elapsedSec);
  } else {
    document.getElementById('cooldown-bar-container').style.display = 'none';
    if (_cooldownTimer) { clearInterval(_cooldownTimer); _cooldownTimer = null; }
  }
}

function startCooldownTimer(totalSec, elapsedSec) {
  const container = document.getElementById('cooldown-bar-container');
  const fill = document.getElementById('cooldown-fill');
  const text = document.getElementById('cooldown-text');
  container.style.display = '';

  if (_cooldownTimer) clearInterval(_cooldownTimer);

  function update() {
    elapsedSec++;
    const remaining = totalSec - elapsedSec;
    if (remaining <= 0) {
      fill.style.width = '100%';
      text.textContent = 'Cooldown complete — you can enter again';
      clearInterval(_cooldownTimer);
      _cooldownTimer = null;
      return;
    }
    const pct = (elapsedSec / totalSec) * 100;
    fill.style.width = pct + '%';
    const remHrs = Math.floor(remaining / 3600);
    const remMin = Math.floor((remaining % 3600) / 60);
    const remSec = remaining % 60;
    text.textContent = `Re-entry in ${remHrs}h ${String(remMin).padStart(2, '0')}m ${String(remSec).padStart(2, '0')}s`;
  }

  update();
  _cooldownTimer = setInterval(update, 1000);
}

function renderMembership(type) {
  if (!type) return;
  const el = document.getElementById('membership-type');
  el.style.display = '';
  el.textContent = 'Plan: ' + type.charAt(0).toUpperCase() + type.slice(1);
}

function renderExtras(articles) {
  const paid = articles.filter(slug => PAID_ARTICLES[slug]).map(slug => PAID_ARTICLES[slug]);
  const all = [...paid, ...FREE_EXTRAS];
  const el = document.getElementById('extras-text');
  el.style.display = '';
  el.textContent = 'Extras: ' + all.join(', ');
}

function showLoginMessage(msg, type = 'info') {
  const el = document.getElementById('login-message');
  el.textContent  = msg;
  el.className    = `login-message ${type}`;
  el.style.display = 'block';
}

function hideLoginMessage() {
  document.getElementById('login-message').style.display = 'none';
}

function showLoadingOverlay(show) {
  document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // ── Restore session from localStorage ────────────────────────────────────
  const savedCard   = localStorage.getItem('card_number');
  const savedDevice = localStorage.getItem('device_id');

  showLoadingOverlay(false);
  if (savedCard && savedDevice) {
    state.cardNumber   = savedCard;
    state.deviceId     = savedDevice;
    state.accessToken  = localStorage.getItem('access_token')  || '';
    state.refreshToken = localStorage.getItem('refresh_token') || '';
    showDashboard();
  } else {
    showScreen('login-screen');
  }

  // ── OAuth Login button ────────────────────────────────────────────────────
  document.getElementById('btn-oauth').addEventListener('click', loginWithOAuth);

  // ── Paste-URL submit button ───────────────────────────────────────────────
  document.getElementById('btn-paste-submit').addEventListener('click', handlePasteSubmit);
  document.getElementById('oauth-paste-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handlePasteSubmit();
  });

  // ── Show QR Code ──────────────────────────────────────────────────────────
  document.getElementById('btn-show-qr').addEventListener('click', openQrModal);

  // ── Close QR modal (button) ───────────────────────────────────────────────
  document.getElementById('btn-close-qr').addEventListener('click', closeQrModal);

  // ── Close QR modal (backdrop tap) ────────────────────────────────────────
  document.getElementById('qr-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('qr-modal')) closeQrModal();
  });

  // ── Refresh dashboard data when user returns to the tab ───────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.accessToken && document.getElementById('dashboard-screen').classList.contains('active')) {
      loadDashboardData();
    }
  });

  // ── Keyboard: Escape closes modal ────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeQrModal(); }
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  document.getElementById('btn-logout').addEventListener('click', () => {
    stopQrRefresh();
    if (_cooldownTimer) { clearInterval(_cooldownTimer); _cooldownTimer = null; }
    localStorage.clear();
    Object.assign(state, {
      cardNumber: '', deviceId: '', accessToken: '', refreshToken: '',
      persistentGuid: null, qrTimer: null,
    });
    hideLoginMessage();
    showPastePanel(false);
    _activeCodeVerifier = null;
    cleanupOAuth();
    showScreen('login-screen');
  });
});
