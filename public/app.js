'use strict';

// ─── Constants (mirrored from Flutter source) ──────────────────────────────
const IOS_CLIENT_ID    = 'q6KqjlQINmjOC86rqt9JdU_i41nhD_Z4DwygpBxGiIs';
const IOS_REDIRECT_URI = 'com.basicfit.bfa:/oauthredirect';
const LOGIN_BASE_URL   = 'https://login.basic-fit.com';

// ─── App State ─────────────────────────────────────────────────────────────
const state = {
  cardNumber:    '',
  deviceId:      '',
  accessToken:   '',
  refreshToken:  '',
  memberName:    '',
  homeClub:      '',
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

function regenerateGuid() {
  state.persistentGuid = generateGuid();
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
let _activePollTimer    = null;   // server-code polling interval
let _pastePollTimer     = null;   // delayed paste-panel reveal timeout

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
  if (!search) return raw; // treat entire input as bare code
  return new URLSearchParams(search).get('code') || '';
}

async function loginWithOAuth() {
  cleanupOAuth();

  const codeVerifier  = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const stateParam    = generateCodeVerifier();
  _activeCodeVerifier = codeVerifier;

  const oauthUrl =
    `${LOGIN_BASE_URL}/?state=${stateParam}` +
    `&response_type=code` +
    `&code_challenge_method=S256` +
    `&app=true` +
    `&code_challenge=${codeChallenge}` +
    `&redirect_uri=${encodeURIComponent(IOS_REDIRECT_URI)}` +
    `&client_id=${IOS_CLIENT_ID}` +
    `&auto_login=true`;

  showLoginMessage('Connecte-toi dans le popup BasicFit…', 'info');

  const popup = window.open(oauthUrl, 'BasicFit Login',
    'width=520,height=700,left=200,top=80,toolbar=no,menubar=no');

  if (!popup || popup.closed) {
    showLoginMessage('Les popups sont bloquées. Autorise-les pour ce site ou utilise l\'entrée manuelle.', 'error');
    return;
  }

  _activePopup = popup;

  // Detect if the popup is closed without completing login
  _activePollTimer = setInterval(() => {
    if (_activePopup && _activePopup.closed) {
      cleanupOAuth();
      if (!state.cardNumber) {
        showLoginMessage('Popup fermé. Réessaie ou utilise l\'entrée manuelle.', 'warning');
        showPastePanel(true);
      }
    }
  }, 500);

  // Reveal paste panel after a few seconds so the user can copy the link
  _pastePollTimer = setTimeout(() => {
    _pastePollTimer = null;
    if (!state.cardNumber) showPastePanel(true);
  }, 5000);
}

// Called by the "OK" button next to the paste input
async function handlePasteSubmit() {
  const raw  = document.getElementById('oauth-paste-input').value;
  const code = extractCodeFromUrl(raw);

  if (!code) {
    showLoginMessage('Lien invalide. Copie bien l\'adresse du lien "Continue".', 'error');
    return;
  }
  if (!_activeCodeVerifier) {
    showLoginMessage('Session expirée. Clique à nouveau sur "Se connecter".', 'error');
    return;
  }

  cleanupOAuth();
  showPastePanel(false);
  showLoginMessage('Échange du code d\'autorisation…', 'info');
  await exchangeCodeForToken(code, _activeCodeVerifier, IOS_REDIRECT_URI);
}

const _isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

function showPastePanel(show) {
  const panel = document.getElementById('oauth-paste-panel');
  panel.style.display = show ? 'block' : 'none';
  if (!show) {
    document.getElementById('oauth-paste-input').value = '';
    return;
  }

  // Render instructions appropriate for the current device
  const list = document.getElementById('oauth-steps-list');
  if (_isMobile) {
    list.innerHTML = `
      <li>Connecte-toi avec ton email BasicFit</li>
      <li>Quand tu vois <strong>"Continue"</strong>, <strong>appuie longuement</strong> dessus</li>
      <li>Choisis <strong>"Copier le lien"</strong></li>
      <li>Reviens ici et colle le lien ci-dessous :</li>`;
  } else {
    list.innerHTML = `
      <li>Connecte-toi avec ton email BasicFit</li>
      <li>Quand tu vois <strong>"Continue"</strong>, <strong>fais un clic droit</strong> dessus</li>
      <li>Clique sur <strong>"Copier l'adresse du lien"</strong></li>
      <li>Colle le lien ci-dessous :</li>`;
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
        `Échange de token échoué (${res.status}). Utilise l'entrée manuelle.`,
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

    showLoginMessage('Connecté. Chargement de ton profil…', 'success');
    showLoadingOverlay(true);

    await loadMemberInfo();
  } catch (err) {
    console.error('[token exchange]', err);
    showLoginMessage('Erreur réseau lors de l\'échange. Utilise l\'entrée manuelle.', 'error');
  }
}

async function loadMemberInfo() {
  try {
    const res = await fetch('/api/member', {
      headers: { Authorization: `Bearer ${state.accessToken}` },
    });

    if (res.status === 401) {
      // Try to refresh first
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        await loadMemberInfo(); // retry once
        return;
      }
      showLoginMessage('Session expirée. Reconnecte-toi.', 'error');
      showLoadingOverlay(false);
      return;
    }

    if (!res.ok) {
      showLoginMessage(
        'Impossible de charger le profil. Utilise l\'entrée manuelle.',
        'warning'
      );
      showLoadingOverlay(false);
      return;
    }

    const data   = await res.json();
    const member = data.member;

    state.cardNumber  = member.cardnumber;
    state.deviceId    = member.deviceId;
    state.memberName  = `${member.firstname} ${member.lastname}`;
    state.homeClub    = member.homeClub || '';

    localStorage.setItem('card_number',  state.cardNumber);
    localStorage.setItem('device_id',    state.deviceId);
    localStorage.setItem('member_name',  state.memberName);
    localStorage.setItem('home_club',    state.homeClub);

    showLoadingOverlay(false);
    showDashboard();
  } catch (err) {
    console.error('[member info]', err);
    showLoginMessage(
      'Erreur réseau. Utilise l\'entrée manuelle ci-dessous.',
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

  document.getElementById('qr-card-label').textContent = `Carte ${state.cardNumber}`;

  try {
    await renderQrCode();
    startQrRefresh();
  } catch (err) {
    console.error('[QR render]', err);
    document.getElementById('qr-card-label').textContent = `Erreur: ${err.message}`;
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
  stopQrRefresh(); // clear any existing timer

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
  // Force reflow so the animation restarts from 0
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

// ─── People ID helpers ─────────────────────────────────────────────────────

function extractPeopleId(input) {
  input = input.trim();
  // Full export URL → pull peopleId query param
  try {
    const url = new URL(input);
    const pid = url.searchParams.get('peopleId');
    if (pid) return pid;
  } catch (_) {}
  // Bare UUID anywhere in the string
  const m = input.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (m) return m[0];
  // Return as-is (device ID in another format)
  return input || '';
}

// ─── Screen / UI helpers ───────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showDashboard() {
  document.getElementById('member-name').textContent = state.memberName || 'Membre';
  document.getElementById('member-club').textContent = state.homeClub   || '';
  document.getElementById('card-number').textContent = state.cardNumber || '—';
  showScreen('dashboard-screen');
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

  if (savedCard && savedDevice) {
    state.cardNumber   = savedCard;
    state.deviceId     = savedDevice;
    state.memberName   = localStorage.getItem('member_name') || 'Membre';
    state.homeClub     = localStorage.getItem('home_club')   || '';
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

  // ── People ID Login button ────────────────────────────────────────────────
  document.getElementById('btn-peopleid').addEventListener('click', () => {
    const card = document.getElementById('pid-card').value.trim();
    const raw  = document.getElementById('pid-url').value.trim();

    if (!card || !raw) {
      showLoginMessage('Remplis les deux champs pour continuer.', 'error');
      return;
    }

    const peopleId = extractPeopleId(raw);
    if (!peopleId) {
      showLoginMessage('Lien ou People ID invalide.', 'error');
      return;
    }

    state.cardNumber = card;
    state.deviceId   = peopleId;
    state.memberName = 'Membre';
    state.homeClub   = '';

    localStorage.setItem('card_number', card);
    localStorage.setItem('device_id',   peopleId);

    hideLoginMessage();
    showDashboard();
  });

  // ── Manual Login button ───────────────────────────────────────────────────
  document.getElementById('btn-manual').addEventListener('click', () => {
    const card   = document.getElementById('manual-card').value.trim();
    const device = document.getElementById('manual-device').value.trim();

    if (!card || !device) {
      showLoginMessage('Remplis les deux champs pour continuer.', 'error');
      return;
    }

    state.cardNumber = card;
    state.deviceId   = device;
    state.memberName = 'Membre';
    state.homeClub   = '';

    localStorage.setItem('card_number', card);
    localStorage.setItem('device_id',   device);

    hideLoginMessage();
    showDashboard();
  });

  // ── Show QR Code ──────────────────────────────────────────────────────────
  document.getElementById('btn-show-qr').addEventListener('click', openQrModal);

  // ── Close QR modal (button) ───────────────────────────────────────────────
  document.getElementById('btn-close-qr').addEventListener('click', closeQrModal);

  // ── Close QR modal (backdrop tap) ────────────────────────────────────────
  document.getElementById('qr-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('qr-modal')) closeQrModal();
  });

  // ── Keyboard: Escape closes modal ────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeQrModal();
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  document.getElementById('btn-logout').addEventListener('click', () => {
    stopQrRefresh();
    localStorage.clear();
    Object.assign(state, {
      cardNumber: '', deviceId: '', accessToken: '', refreshToken: '',
      memberName: '', homeClub: '', persistentGuid: null, qrTimer: null,
    });
    hideLoginMessage();
    showPastePanel(false);
    _activeCodeVerifier = null;
    cleanupOAuth();
    // Clear manual form
    document.getElementById('manual-card').value   = '';
    document.getElementById('manual-device').value = '';
    showScreen('login-screen');
  });
});
