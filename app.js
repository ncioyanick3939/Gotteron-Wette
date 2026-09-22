import { firebaseConfig, ADMIN_EMAIL, BET_COST } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDocs, deleteDoc, onSnapshot, query, orderBy, writeBatch } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ===== INIT =====
let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  document.body.innerHTML = '<div style="color:#fff;padding:40px;font-family:sans-serif"><h2>Firebase-Fehler</h2><pre>' + e.message + '</pre></div>';
  throw e;
}

// ===== IISTELLIGE =====
const HALF = BET_COST / 2;          // CHF 2.50 in Jackpot, CHF 2.50 is Bierkässeli
const BEER_PRICE = 6;               // für «reicht für ca. X Bier»
const LIVE_MIN = 150;               // so lang gilt es Spiel nach em Aaspiel als «lauft»
const DEF = { kickoff: '19:45', stopMin: 15, revealMin: 10, openHours: 48 };
const TWINT_URL = '';               // Später e Twint-Link iifüege. Leer = Betrag wird kopiert.
const QUICK = ['2:1', '3:1', '3:2', '4:2', '4:1', '1:2', '2:3', '1:3'];
const BADGES = [
  { name: 'Pokal', text: '10 Tipps abgäh', done: s => s.bets >= 10, prog: s => `${Math.min(s.bets, 10)} / 10` },
  { name: 'Stammgast', text: '25 Tipps abgäh', done: s => s.bets >= 25, prog: s => `${Math.min(s.bets, 25)} / 25` },
  { name: 'Glückspilz', text: '3 Spiel gwunne', done: s => s.wins >= 3, prog: s => `${Math.min(s.wins, 3)} / 3` },
  { name: 'Treffsicher', text: 'Jedes gspilte Spiel gwunne, mindestens 2', done: s => s.played >= 2 && s.wins === s.played, prog: s => `${s.wins} / ${s.played}` }
];

const state = { user: null, isAdmin: false, games: [], bets: [], loaded: false, selectedId: null };
const ui = { drafts: {}, slips: {}, results: {}, lastPot: {}, nextBoundary: Infinity, editId: null, home: true };
window._authMode = window._authMode || 'login';

// ===== HELPERS =====
const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
const pad = n => String(n).padStart(2, '0');
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const icon = (n, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const matchName = g => 'Gottéron – ' + (g.opponent || '?');
const initials = n => (n || '?').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
const round05 = x => Math.round(x * 20) / 20;

function toast(m) {
  const t = $('toast'); if (!t) return;
  t.textContent = m; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800);
}
// Schwiizer Schriibwiis: CHF 1'250.– / CHF 7.50
function chf(n) {
  const r = Math.round((n || 0) * 100) / 100;
  const [i, d] = Math.abs(r).toFixed(2).split('.');
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  return (r < 0 ? '− ' : '') + 'CHF ' + int + (d === '00' ? '.–' : '.' + d);
}
const amt = n => chf(n).replace('CHF ', '');
function parseScore(p) {
  const m = String(p || '').match(/^\s*(\d{1,2})\s*[:\-]\s*(\d{1,2})\s*$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// ----- Zit -----
function atTime(date, hhmm) {
  if (!date) return NaN;
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const d = new Date(date + 'T00:00:00');
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d.getTime();
}
const numOr = (v, f) => (typeof v === 'number' && Number.isFinite(v)) ? v : f;
const hm = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dateLong = ms => new Date(ms).toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' });
const dateShort = ms => new Date(ms).toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric' });
function dayLabel(ms) {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(ms); b.setHours(0, 0, 0, 0);
  const d = Math.round((b - a) / 86400000);
  const noWeekday = dateLong(ms).replace(/^[^,]+,\s*/, '');
  if (d === 0) return 'Hüt, ' + noWeekday;
  if (d === 1) return 'Morn, ' + noWeekday;
  return dateLong(ms);
}
function fmtUntil(ms) {
  if (ms <= 0) return '00:00:00';
  if (ms >= 172800000) return Math.floor(ms / 86400000) + ' Täg';
  if (ms >= 86400000) return '1 Tag, ' + Math.floor((ms - 86400000) / 3600000) + ' Std.';
  const s = Math.floor(ms / 1000);
  return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60);
}

// Alli Ziite vo me Spiel (au für älteri Spiel ohni nöii Fälder)
function times(g) {
  const stop = numOr(g.stopAtMs, atTime(g.date, g.stopTime || g.cutoffTime || '19:30'));
  const kick = numOr(g.kickoffMs, g.kickoff ? atTime(g.date, g.kickoff) : stop + DEF.stopMin * 60000);
  const reveal = Math.max(numOr(g.revealAtMs, g.revealTime ? atTime(g.date, g.revealTime) : stop + (DEF.stopMin - DEF.revealMin) * 60000), stop);
  const open = numOr(g.openAtMs, 0);
  return { open, stop, reveal, kick };
}
function phase(g, now = Date.now()) {
  if (g.status === 'closed') return 'done';
  const t = times(g);
  if (now < t.open) return 'planned';
  if (now < t.stop) return 'open';
  if (now < t.reveal) return 'locked';
  if (now < t.kick) return 'visible';
  if (now < t.kick + LIVE_MIN * 60000) return 'live';
  return 'pending';
}
const PHASE = { planned: 'Wetten no nid offe', open: 'Jetzt tippe', locked: 'Wetten gschlosse', visible: 'Tipps sichtbar', live: 'Spiel lauft', pending: 'Uswärtig usstehend', done: 'Abgrechnet' };
const statusHtml = g => { const p = phase(g); return `<span class="status st-${p}">${PHASE[p]}</span>`; };
const isRevealed = g => ['visible', 'live', 'pending', 'done'].includes(phase(g));
const canSeeAll = g => state.isAdmin || isRevealed(g);

// ===== EVENTS =====
function setupEvents() {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('login-btn', 'click', submitAuth);
  on('login-pass', 'keydown', e => { if (e.key === 'Enter') submitAuth(); });
  on('logout-btn', 'click', logout);
  on('logout-top', 'click', logout);
  setStoreLinks();
  on('gf-date', 'change', recomputeForm);
  on('gf-kick', 'change', recomputeForm);
  on('gf-home', 'click', () => setVenue(true));
  on('gf-away', 'click', () => setVenue(false));
  on('gf-save', 'click', saveGame);
  on('gf-cancel', 'click', resetForm);
  on('gf-delete', 'click', deleteGame);
  on('reset-all', 'click', resetAll);
  resetForm();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupEvents);
else setupEvents();

// ===== HOCKEY-LINKS: uf em Handy diräkt i d'App (bzw. App Store / Play Store) =====
function setStoreLinks() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const links = {
    'link-topscorers': { ios: 'https://apps.apple.com/ch/app/topscorers/id1545443064', android: 'https://play.google.com/store/apps/details?id=ch.topscorers.topscorers', web: 'https://topscorers.ch/de', host: 'topscorers.ch/', pkg: 'ch.topscorers.topscorers' },
    'link-nl': { ios: 'https://apps.apple.com/ch/app/national-league-official-app/id1628840021', android: 'https://play.google.com/store/apps/details?id=ch.opten.nationalleague', web: 'https://www.nationalleague.ch/', host: 'www.nationalleague.ch/', pkg: 'ch.opten.nationalleague' }
  };
  Object.entries(links).forEach(([id, l]) => {
    const a = $(id); if (!a) return;
    if (android) {
      // Chrome-Intent: öffnet d'App, wenn si installiert isch, süsch dr Play Store
      a.href = `intent://${l.host}#Intent;scheme=https;package=${l.pkg};S.browser_fallback_url=${encodeURIComponent(l.android)};end`;
      a.removeAttribute('target');
    } else a.href = ios ? l.ios : l.web;
  });
}

async function logout() {
  try { await signOut(auth); window.showView && window.showView('home'); }
  catch (e) { toast('Usloge nid möglich: ' + e.message); }
}

// ===== AUTH =====
async function submitAuth() {
  const name = $('login-name').value.trim();
  const email = $('login-email').value.trim().toLowerCase();
  const pass = $('login-pass').value;
  const err = $('login-error');
  err.textContent = '';
  if (!email || !pass) { err.textContent = 'Bitte E-Mail und Passwort iigäh.'; return; }
  const btn = $('login-btn'); btn.disabled = true;
  try {
    if (window._authMode === 'register') {
      if (!name) { err.textContent = 'Bitte e Name iigäh.'; btn.disabled = false; return; }
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      toast('Konto erstellt');
      render();
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
    $('login-pass').value = '';
  } catch (e) {
    if (['auth/user-not-found', 'auth/invalid-credential', 'auth/wrong-password'].includes(e.code)) err.textContent = 'E-Mail oder Passwort stimmt nid.';
    else if (e.code === 'auth/email-already-in-use') err.textContent = 'Die E-Mail het scho es Konto. Wächsle zu «Iilogge».';
    else if (e.code === 'auth/weak-password') err.textContent = 'S\'Passwort bruucht mindestens 6 Zeiche.';
    else if (e.code === 'auth/invalid-email') err.textContent = 'Die E-Mail-Adrässe isch ungültig.';
    else err.textContent = 'Fehler: ' + (e.message || 'unbekannt');
  }
  btn.disabled = false;
}

onAuthStateChanged(auth, user => {
  try {
    state.user = user;
    state.isAdmin = !!user && user.email === ADMIN_EMAIL;
    if (user) {
      $('auth-overlay').style.display = 'none';
      $('app-content').style.display = 'block';
      $('nav-admin').hidden = !state.isAdmin;
      const want = (location.hash || '').replace('#', '');
      window.showView && window.showView(['tipps', 'rangliste', 'kasse', 'profil', 'admin'].includes(want) ? want : 'home');
      startSubs();
    } else {
      $('auth-overlay').style.display = 'flex';
      $('app-content').style.display = 'none';
    }
    render();
  } catch (e) {
    console.error('Auth state error:', e);
    $('auth-overlay').style.display = 'flex';
    $('app-content').style.display = 'none';
  }
});

// ===== DATE =====
let subbed = false;
function startSubs() {
  if (subbed) return; subbed = true;
  onSnapshot(query(collection(db, 'games'), orderBy('createdAt', 'desc')),
    s => { state.games = s.docs.map(d => ({ id: d.id, ...d.data() })); state.loaded = true; render(); },
    e => console.error('games sub error:', e));
  onSnapshot(collection(db, 'bets'),
    s => { state.bets = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); },
    e => console.error('bets sub error:', e));
}

const betsFor = gid => state.bets.filter(b => b.gameId === gid).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const upcoming = () => state.games.filter(g => g.status !== 'closed').sort((a, b) => times(a).kick - times(b).kick);
const settled = () => state.games.filter(g => g.status === 'closed').sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
const nameOf = uid => (state.bets.find(b => b.userId === uid) || {}).userName || '?';

// Uszahlig pro Benutzer (nöii Spiel: payouts; älteri: perWinner pro Gwünner)
function payoutsOf(g) {
  if (g.status !== 'closed') return {};
  if (g.payouts) return g.payouts;
  const o = {}; (g.winnerUserIds || []).forEach(u => { o[u] = g.perWinner || 0; }); return o;
}
function tipPayout(g, bet) {
  if (!(g.winnerBetIds || []).includes(bet.id)) return 0;
  if (typeof g.perWinningBet === 'number') return g.perWinningBet;
  const n = betsFor(g.id).filter(b => b.userId === bet.userId && g.winnerBetIds.includes(b.id)).length || 1;
  return (payoutsOf(g)[bet.userId] || 0) / n;
}
// Wär zahlt wäm wie vil (Jackpot, nach em Spiel)
function settlement(g) {
  const all = betsFor(g.id), pay = payoutsOf(g);
  if (!all.length || !Object.keys(pay).length) return [];
  const net = {};
  all.forEach(b => { net[b.userId] = (net[b.userId] || 0) - HALF; });
  Object.entries(pay).forEach(([u, v]) => { net[u] = (net[u] || 0) + v; });
  const cred = Object.entries(net).filter(([, v]) => v > 0.001), debt = Object.entries(net).filter(([, v]) => v < -0.001);
  const sumPos = cred.reduce((s, [, v]) => s + v, 0);
  const out = [];
  debt.forEach(([d, dv]) => cred.forEach(([c, cv]) => {
    const amount = round05(-dv * cv / sumPos);
    if (amount > 0) out.push({ gameId: g.id, from: d, to: c, amount });
  }));
  return out;
}
function computedKonto() {
  let total = state.bets.length * HALF;
  settled().forEach(g => { if (!Object.keys(payoutsOf(g)).length) total += betsFor(g.id).length * HALF; });
  return total;
}
function userStats(uid) {
  const my = state.bets.filter(b => b.userId === uid);
  let wins = 0, earned = 0, played = 0, bier = my.length * HALF, jackpotStake = 0;
  settled().forEach(g => {
    const mine = betsFor(g.id).filter(b => b.userId === uid);
    if (mine.length) played++;
    const pay = payoutsOf(g), p = pay[uid];
    if (p) { wins++; earned += p; }
    if (!Object.keys(pay).length) bier += mine.length * HALF;
    else jackpotStake += mine.length * HALF;
  });
  return { bets: my.length, wins, earned, played, bier, staked: my.length * BET_COST, jackpotNet: earned - jackpotStake };
}
function ranking() {
  const users = {};
  state.bets.forEach(b => { if (!users[b.userId]) users[b.userId] = b.userName || '?'; });
  return Object.entries(users).map(([uid, name]) => ({ uid, name, ...userStats(uid) }))
    .sort((a, b) => b.wins - a.wins || b.earned - a.earned || b.bets - a.bets);
}

// Erledigti Twint-Zahlige (pro Grät gspeicheret)
const paid = new Set(JSON.parse(localStorage.getItem('gott_paid') || '[]'));
const payKey = t => `${t.gameId}|${t.from}|${t.to}`;
function markPaid(list) { list.forEach(t => paid.add(payKey(t))); localStorage.setItem('gott_paid', JSON.stringify([...paid])); render(); }
function openTransfers() {
  const uid = state.user.uid;
  return settled().flatMap(settlement).filter(t => (t.from === uid || t.to === uid) && !paid.has(payKey(t)));
}

// ===== AKTIONE =====
async function placeTips(g, list) {
  const p = phase(g);
  if (p !== 'open') {
    toast(p === 'planned' ? 'Wetten no nid offe.' : 'Wetten gschlosse. Dini Tipps chöi nüm gänderet wärde.');
    render(); return false;
  }
  const before = state.bets.filter(b => b.userId === state.user.uid).length;
  try {
    const batch = writeBatch(db), now = Date.now();
    list.forEach((pred, i) => batch.set(doc(collection(db, 'bets')), {
      gameId: g.id, userId: state.user.uid, userName: state.user.displayName || state.user.email, prediction: pred, createdAt: now + i
    }));
    await batch.commit();
    ui.drafts[g.id] = { h: null, a: null }; ui.slips[g.id] = [];
    toast(list.length === 1 ? 'Tipp ' + list[0] + ' abgäh' : list.length + ' Tipps abgäh');
    if (before < 10 && before + list.length >= 10) setTimeout(() => toast('Uszeichnig: Pokal'), 3000);
    return true;
  } catch (e) {
    toast(e.code === 'permission-denied' ? 'Wetten gschlosse. Dini Tipps chöi nüm gänderet wärde.' : 'Fehler: ' + e.message);
    return false;
  }
}

async function settleGame(g, h, a) {
  const gb = betsFor(g.id), pot = gb.length * BET_COST, jackpot = gb.length * HALF;
  const win = gb.filter(b => { const s = parseScore(b.prediction); return s && s[0] === h && s[1] === a; });
  const perBet = win.length ? jackpot / win.length : 0;
  const payouts = {};
  win.forEach(b => { payouts[b.userId] = Math.round(((payouts[b.userId] || 0) + perBet) * 100) / 100; });
  const winUsers = Object.keys(payouts);
  try {
    await updateDoc(doc(db, 'games', g.id), {
      status: 'closed', closedAt: Date.now(), result: { h, a }, pot,
      winnerBetIds: win.map(b => b.id), winnerUserIds: winUsers, payouts,
      jackpotHalf: jackpot, kontoHalf: pot / 2 + (win.length ? 0 : jackpot),
      perWinningBet: perBet, perWinner: winUsers.length ? jackpot / winUsers.length : 0
    });
    delete ui.results[g.id];
    toast(win.length ? `Abgrechnet: ${plural(winUsers.length, 'Gwünner', 'Gwünner')}` : 'Abgrechnet: Jackpot gaht is Bierkässeli');
  } catch (e) { toast('Fehler: ' + e.message); }
}

async function resetAll() {
  if (!confirm('Alli Spiel und Tipps lösche? Das cha me nid rückgängig mache.')) return;
  try {
    const bs = await getDocs(collection(db, 'bets'));
    for (const b of bs.docs) await deleteDoc(doc(db, 'bets', b.id));
    const gs = await getDocs(collection(db, 'games'));
    for (const g of gs.docs) await deleteDoc(doc(db, 'games', g.id));
    try { await setDoc(doc(db, 'meta', 'konto'), { total: 0 }); } catch (e) {}
    toast('Alli Date glöscht');
  } catch (e) { toast('Fehler: ' + e.message); }
}

// ----- Spiel-Formular (CEO) -----
function setVenue(home) {
  ui.home = home;
  $('gf-home').classList.toggle('is-active', home);
  $('gf-away').classList.toggle('is-active', !home);
}
function recomputeForm() {
  const date = $('gf-date').value, kick = $('gf-kick').value || DEF.kickoff;
  if (!date) return;
  const k = atTime(date, kick);
  $('gf-open').value = toLocalInput(k - DEF.openHours * 3600000);
  $('gf-stop').value = hm(k - DEF.stopMin * 60000);
  $('gf-reveal').value = hm(k - DEF.revealMin * 60000);
}
function resetForm() {
  ui.editId = null;
  $('gf-title').textContent = 'Spiel erstelle';
  $('gf-save').textContent = 'Spiel speichere';
  $('gf-cancel').hidden = true; $('gf-delete').hidden = true;
  $('gf-opp').value = '';
  const d = new Date(); $('gf-date').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  $('gf-kick').value = DEF.kickoff;
  setVenue(true); recomputeForm();
}
function editGame(g) {
  const t = times(g);
  ui.editId = g.id;
  $('gf-title').textContent = 'Spiel bearbeite';
  $('gf-save').textContent = 'Änderige speichere';
  $('gf-cancel').hidden = false;
  $('gf-delete').hidden = betsFor(g.id).length > 0;
  $('gf-opp').value = g.opponent || '';
  $('gf-date').value = g.date || '';
  $('gf-kick').value = hm(t.kick);
  $('gf-open').value = toLocalInput(t.open || (t.kick - DEF.openHours * 3600000));
  $('gf-stop').value = hm(t.stop);
  $('gf-reveal').value = hm(t.reveal);
  setVenue(g.home !== false);
  window.setAdminTab('spiel');
  $('game-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function saveGame() {
  const opp = $('gf-opp').value.trim(), date = $('gf-date').value, kick = $('gf-kick').value;
  const stop = $('gf-stop').value, reveal = $('gf-reveal').value, openV = $('gf-open').value;
  if (!opp) { toast('Bitte e Gägner iigäh'); $('gf-opp').focus(); return; }
  if (!date || !kick) { toast('Bitte Datum und Aaspiel iigäh'); return; }
  const kickMs = atTime(date, kick), stopMs = atTime(date, stop || hm(kickMs - DEF.stopMin * 60000));
  const revealMs = atTime(date, reveal || hm(kickMs - DEF.revealMin * 60000));
  const openMs = openV ? new Date(openV).getTime() : kickMs - DEF.openHours * 3600000;
  if (stopMs > kickMs) { toast('Dr Tipp-Stopp muess vor em Aaspiel sy'); return; }
  if (revealMs < stopMs) { toast('«Tipps sichtbar» muess nach em Tipp-Stopp sy'); return; }
  if (openMs >= stopMs) { toast('«Wetten öffne» muess vor em Tipp-Stopp sy'); return; }
  const data = {
    opponent: opp, home: ui.home, date, kickoff: kick, stopTime: hm(stopMs), revealTime: hm(revealMs), cutoffTime: hm(stopMs),
    openAtMs: openMs, kickoffMs: kickMs, stopAtMs: stopMs, revealAtMs: revealMs
  };
  const btn = $('gf-save'); btn.disabled = true;
  try {
    if (ui.editId) { await updateDoc(doc(db, 'games', ui.editId), data); toast('Spiel gspeicheret'); }
    else { await addDoc(collection(db, 'games'), { ...data, status: 'open', createdAt: Date.now() }); toast('Spiel erstellt'); }
    resetForm();
  } catch (e) { toast('Fehler: ' + e.message); }
  btn.disabled = false;
}
async function deleteGame() {
  if (!ui.editId) return;
  const g = state.games.find(x => x.id === ui.editId);
  if (betsFor(ui.editId).length) { toast('Spiel mit Tipps cha nid glöscht wärde'); return; }
  if (!confirm(matchName(g) + ' lösche?')) return;
  try { await deleteDoc(doc(db, 'games', ui.editId)); toast('Spiel glöscht'); resetForm(); } catch (e) { toast('Fehler: ' + e.message); }
}

// ===== RENDER =====
function render() {
  try {
    if (!state.user) return;
    const up = upcoming(), done = settled();
    const now = Date.now();
    ui.nextBoundary = up.reduce((m, g) => {
      const t = times(g);
      const next = [t.open, t.stop, t.reveal, t.kick, t.kick + LIVE_MIN * 60000].filter(x => x > now);
      return Math.min(m, ...next);
    }, Infinity);
    renderHome(up, done);
    renderMyTips();
    renderRanking();
    renderKasse(up);
    renderProfil();
    if (state.isAdmin) renderAdmin(up, done);
  } catch (e) { console.error('Render error:', e); }
}

function pickCurrent(up) {
  return up.find(g => g.id === state.selectedId) || up.find(g => phase(g) !== 'pending') || up[0] || null;
}

// ---- Home ----
function renderHome(up, done) {
  if (!state.loaded) return;
  const g = pickCurrent(up);
  state.selectedId = g ? g.id : null;
  renderMatch(g, done);
  renderTipsList(g);
  renderLast(done);
  const rest = up.filter(x => !g || x.id !== g.id);
  $('next-block').hidden = !rest.length;
  $('next-games').innerHTML = rest.map(x => {
    const t = times(x), n = betsFor(x.id).length;
    return `<li><button class="grow" data-id="${x.id}">
      <div class="row-main"><div class="game-t">${esc(matchName(x))}</div><div class="row-s">${esc(dateShort(t.kick))}, ${hm(t.kick)}${x.home === false ? ', uswärts' : ''}</div>${statusHtml(x)}</div>
      ${n ? `<div style="text-align:right"><div class="money num" style="font-weight:700">${chf(n * HALF)}</div><div class="row-s">${plural(n, 'Tipp', 'Tipps')}</div></div>` : ''}
      ${icon('chev')}
    </button></li>`;
  }).join('');
  $('next-games').querySelectorAll('.grow').forEach(b => b.addEventListener('click', () => {
    state.selectedId = b.dataset.id; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

function renderMatch(g, done) {
  const box = $('match');
  if (!g) {
    box.className = 'match match-empty';
    box.innerHTML = `<svg class="rink" aria-hidden="true"><use href="#rink"/></svg>
      <span class="status st-done">Kei offes Spiel</span>
      <div class="team">S'nächschte Spiel folgt</div>
      <p>Sobald dr CEO s'nächschte Spiel erfasst, gsehsch es hie.${done.length ? ' Unde findsch ds letschte Resultat.' : ''}</p>
      ${state.isAdmin ? `<button class="btn-secondary" style="margin-top:14px" onclick="showView('admin');setAdminTab('spiel')">Spiel erstelle</button>` : ''}`;
    return;
  }
  const p = phase(g), t = times(g), bets = betsFor(g.id), uid = state.user.uid;
  const mine = bets.filter(b => b.userId === uid);
  const draft = ui.drafts[g.id] || (ui.drafts[g.id] = { h: null, a: null });
  const slip = ui.slips[g.id] || (ui.slips[g.id] = []);
  const pot = bets.length * HALF;

  const cd = { planned: ['Wetten öffne in', t.open], open: ['Tipp-Stopp in', t.stop], locked: ['Tipps sichtbar in', t.reveal], visible: ['Aaspiel in', t.kick] }[p];
  const stepper = side => {
    const v = draft[side], team = side === 'h' ? 'Gottéron' : (g.opponent || 'Gägner');
    return `<div class="stepper" data-side="${side}">
      <button class="st-btn" data-act="-1" aria-label="${esc(team)} ei Tor weniger">${icon('minus')}</button>
      <output class="st-val num ${v === null ? 'is-empty' : ''}" aria-label="Tore ${esc(team)}">${v === null ? '–' : v}</output>
      <button class="st-btn" data-act="1" aria-label="${esc(team)} ei Tor meh">${icon('plus')}</button></div>`;
  };
  const score = side => p === 'open' ? stepper(side) : `<div class="sb-score">–</div>`;
  const msgs = {
    planned: `Wetten no nid offe. Tippe chasch ab <b>${esc(dateShort(t.open))}, ${hm(t.open)}</b>.`,
    locked: `Wetten gschlosse. Dini Tipps chöi nüm gänderet wärde. D'Tipps wärde ab <b>${hm(t.reveal)}</b> für alli sichtbar.`,
    visible: `Alli Tipps sy jetzt sichtbar. Aaspiel um <b>${hm(t.kick)}</b>.`,
    live: `S'Spiel lauft. S'Resultat wird nach em Spiel erfasst.`,
    pending: `Uswärtig steit no us. Sobald dr CEO s'Resultat iiträit, wird abgrechnet.`
  };

  box.className = 'match';
  box.innerHTML = `<svg class="rink" aria-hidden="true"><use href="#rink"/></svg>
    <div class="m-top">${statusHtml(g)}${cd ? `<span class="m-count">${cd[0]} <span class="num" data-until="${cd[1]}">${fmtUntil(cd[1] - Date.now())}</span></span>` : ''}</div>
    <div class="m-head">
      <div><div class="m-date">${esc(dayLabel(t.kick))}</div><div class="m-kick wide num">${hm(t.kick)}</div><div class="m-venue">${g.home === false ? 'Uswärtsspiel' : g.home === true ? 'Heimspiel' : ''}</div></div>
      <div class="m-pot"><div class="m-pot-l">Jackpot</div><div class="m-pot-v wide money num" id="pot-value">${chf(pot)}</div><div class="m-pot-s">${plural(bets.length, 'Tipp', 'Tipps')}</div></div>
    </div>
    <div class="sb" role="group" aria-label="Din Tipp: Gottéron zersch">
      <div class="sb-row gott"><div class="team">Gottéron</div>${score('h')}</div>
      <div class="sb-row"><div class="team">${esc(g.opponent || '?')}</div>${score('a')}</div>
    </div>
    ${p === 'open' ? `
      <div class="quick" role="group" aria-label="Schnälltipps">${QUICK.map(q => `<button class="qt num" data-q="${q}">${q}</button>`).join('')}</div>
      <div class="slip"><span id="slip"></span><button class="add-btn" id="add-btn">${icon('plus')}Weitere Tipp</button></div>
      <button class="btn-primary split" id="bet-btn" style="margin-top:12px"><span>Tipp abgäh</span><span class="num">${chf(BET_COST)}</span></button>
      <p class="m-fine">Pro Tipp ${chf(BET_COST)}: ${chf(HALF)} in Jackpot, ${chf(HALF)} is Bierkässeli.</p>`
    : `<p class="m-msg">${msgs[p] || ''}</p>${state.isAdmin && ['live', 'pending', 'visible', 'locked'].includes(p) ? `<button class="btn-secondary sm" style="margin-top:12px" onclick="showView('admin');setAdminTab('resultat')">Resultat erfasse</button>` : ''}`}
    ${mine.length ? `<div class="m-mine">Dini Tipps${mine.map(b => `<b class="num">${esc(b.prediction)}</b>`).join('')}</div>` : ''}`;

  // Jackpot-Update sichtbar mache
  if (ui.lastPot[g.id] !== undefined && pot > ui.lastPot[g.id]) $('pot-value').classList.add('bump');
  ui.lastPot[g.id] = pot;

  if (p !== 'open') return;
  const current = () => draft.h !== null && draft.a !== null ? draft.h + ':' + draft.a : null;
  const sync = () => {
    box.querySelectorAll('.stepper').forEach(st => {
      const v = draft[st.dataset.side], out = st.querySelector('.st-val');
      out.textContent = v === null ? '–' : v; out.classList.toggle('is-empty', v === null);
      st.querySelector('[data-act="-1"]').disabled = v === null || v === 0;
    });
    const cur = current();
    box.querySelectorAll('.qt').forEach(b => b.classList.toggle('is-on', b.dataset.q === cur));
    const n = slip.length + (cur ? 1 : 0);
    const bet = $('bet-btn');
    bet.disabled = n === 0;
    bet.firstElementChild.textContent = n === 0 ? 'Resultat iistelle' : n === 1 ? 'Tipp ' + (cur || slip[0]) + ' abgäh' : n + ' Tipps abgäh';
    bet.lastElementChild.textContent = chf(Math.max(n, 1) * BET_COST);
    $('add-btn').disabled = !cur;
    const sl = $('slip');
    sl.innerHTML = (slip.length ? `<span class="slip-l">Uf em Zettel</span>` : '') + slip.map((s, i) => `<span class="chip num">${s}<button data-rm="${i}" aria-label="Tipp ${s} entferne">${icon('x')}</button></span>`).join('');
    sl.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { slip.splice(Number(b.dataset.rm), 1); sync(); }));
  };
  box.querySelectorAll('.stepper').forEach(st => st.querySelectorAll('.st-btn').forEach(b => b.addEventListener('click', () => {
    const side = st.dataset.side, step = Number(b.dataset.act), v = draft[side];
    draft[side] = v === null ? (step > 0 ? 1 : 0) : Math.max(0, Math.min(15, v + step));
    sync();
  })));
  box.querySelectorAll('.qt').forEach(b => b.addEventListener('click', () => {
    const [h, a] = b.dataset.q.split(':').map(Number); draft.h = h; draft.a = a; sync();
  }));
  $('add-btn').addEventListener('click', () => {
    const cur = current(); if (!cur) { toast('Zersch es Resultat iistelle'); return; }
    slip.push(cur); draft.h = null; draft.a = null; sync();
  });
  $('bet-btn').addEventListener('click', async e => {
    const cur = current(), list = [...slip, ...(cur ? [cur] : [])];
    if (!list.length) return;
    e.currentTarget.disabled = true;
    await placeTips(g, list);
    render();
  });
  sync();
}

function renderTipsList(g) {
  const tb = $('tips-block');
  if (!g || phase(g) === 'planned') { tb.hidden = true; return; }
  tb.hidden = false;
  const bets = betsFor(g.id), uid = state.user.uid, t = times(g), see = canSeeAll(g), hint = $('tips-hint');
  $('tips-count').textContent = bets.length ? plural(bets.length, 'Tipp', 'Tipps') + ' vo ' + plural(new Set(bets.map(b => b.userId)).size, 'Spieler', 'Spieler') : '';
  hint.hidden = isRevealed(g);
  hint.textContent = isRevealed(g) ? '' : state.isAdmin
    ? `Nume du gsehsch alli Tipps. Für di andere sichtbar ab ${hm(t.reveal)}.`
    : `Tipps sy bis ${hm(t.reveal)} verdeckt. Dini eigete gsehsch immer.`;
  $('tips').innerHTML = bets.length
    ? bets.map(b => {
        const show = see || b.userId === uid;
        return `<li><div class="row"><span class="name"><span>${esc(b.userName || '?')}</span>${b.userId === uid ? '<span class="tag-me">Du</span>' : ''}</span>${show
          ? `<span class="tip num">${esc(b.prediction)}</span>` : `<span class="hidden-tip">${icon('lock')}Tipp verdeckt</span>`}</div></li>`;
      }).join('')
    : `<li class="empty-line">No kei Tipps. Du chasch dr Erscht sy.</li>`;
}

function renderLast(done) {
  const g = done[0], block = $('last-block');
  block.hidden = !g; if (!g) return;
  const t = times(g), bets = betsFor(g.id), pay = payoutsOf(g), winners = Object.keys(pay), uid = state.user.uid;
  const jackpot = g.jackpotHalf ?? bets.length * HALF;
  $('last-date').textContent = dateShort(t.kick);
  const score = g.result ? `${g.result.h} : ${g.result.a}` : '–';
  const wids = g.winnerBetIds || [];
  let note;
  if (!bets.length) note = 'Kei Tipps bi däm Spiel.';
  else if (!winners.length) note = `Kei richtige Tipp. Dr Jackpot vo <b class="money">${chf(jackpot)}</b> gaht is Bierkässeli.`;
  else if (winners.length > 1) note = `${winners.length} Gwünner teile dr Jackpot vo <b class="money">${chf(jackpot)}</b>.`;
  else note = `Jackpot <b class="money">${chf(jackpot)}</b>`;
  const mine = settlement(g).filter(x => (x.from === uid || x.to === uid) && !paid.has(payKey(x)));
  const owe = mine.filter(x => x.from === uid).reduce((s, x) => s + x.amount, 0);
  const get = mine.filter(x => x.to === uid).reduce((s, x) => s + x.amount, 0);
  $('last-result').innerHTML = `<div class="lr">
    <div class="lr-score"><span class="lr-team">Gottéron</span><span class="lr-num num">${score}</span><span class="lr-team">${esc(g.opponent || '?')}</span></div>
    <p class="lr-note">${note}</p>
    ${winners.length ? `<ul class="list">${winners.map(w => {
      const tips = bets.filter(b => b.userId === w && wids.includes(b.id)).map(b => b.prediction);
      return `<li><div class="row"><span class="name"><span>${esc(nameOf(w))}</span>${w === uid ? '<span class="tag-me">Du</span>' : ''}</span><span class="tip num">${esc(tips.join(' '))}</span><span class="money num" style="font-weight:700;min-width:96px;text-align:right">${chf(pay[w])}</span></div></li>`;
    }).join('')}</ul>` : ''}
    ${owe > 0 ? `<div class="me-line"><span>Du schuldisch <b class="money num">${chf(owe)}</b></span><button class="btn-secondary sm" onclick="showView('kasse')">Zur Kasse</button></div>` : ''}
    ${get > 0 ? `<div class="me-line plus"><span>Du bechunnsch <b class="money num">${chf(get)}</b></span><button class="btn-secondary sm" onclick="showView('kasse')">Zur Kasse</button></div>` : ''}
  </div>`;
}

// ---- Mini Tipps ----
function renderMyTips() {
  const uid = state.user.uid, mine = state.bets.filter(b => b.userId === uid), s = userStats(uid);
  $('mt-count').textContent = mine.length ? plural(mine.length, 'Tipp', 'Tipps') : '';
  const openCount = mine.filter(b => { const g = state.games.find(x => x.id === b.gameId); return g && g.status !== 'closed'; }).length;
  $('mt-summary').innerHTML = `<div class="stats">
    <div><div class="stat-v num">${s.bets}</div><div class="stat-l">Tipps</div></div>
    <div><div class="stat-v num">${openCount}</div><div class="stat-l">Offe</div></div>
    <div><div class="stat-v money num">${amt(s.staked)}</div><div class="stat-l">Iisatz</div></div>
    <div><div class="stat-v money num">${amt(s.earned)}</div><div class="stat-l">Gwinn</div></div>
  </div>`;
  const group = (g, rows) => {
    const t = times(g);
    return `<div class="tg"><div class="tg-head"><div><div class="game-t">${esc(matchName(g))}</div><div class="tg-s">${esc(dateShort(t.kick))}, ${hm(t.kick)}${g.result ? `, Resultat ${g.result.h}:${g.result.a}` : ''}</div></div>${statusHtml(g)}</div><ul class="tl">${rows}</ul></div>`;
  };
  const openGames = upcoming().filter(g => mine.some(b => b.gameId === g.id));
  $('mt-open').innerHTML = openGames.length
    ? openGames.map(g => group(g, mine.filter(b => b.gameId === g.id).map(b => `<li><span class="tip num">${esc(b.prediction)}</span><span class="amt num">${chf(BET_COST)}</span><span class="res-t open">Offe</span></li>`).join(''))).join('')
    : `<p class="empty-line">Kei offeni Tipps.</p>${upcoming().some(g => phase(g) === 'open') ? `<button class="btn-secondary sm" onclick="showView('home')">Jetzt tippe</button>` : ''}`;
  const doneGames = settled().filter(g => mine.some(b => b.gameId === g.id));
  $('mt-done-block').hidden = !doneGames.length;
  $('mt-done').innerHTML = doneGames.map(g => group(g, mine.filter(b => b.gameId === g.id).map(b => {
    const win = tipPayout(g, b);
    return `<li class="${win ? 'won' : ''}"><span class="tip num">${win ? icon('check') : ''}${esc(b.prediction)}</span><span class="amt num ${win ? 'pos' : ''}">${win ? '+ ' + chf(win) : '− ' + chf(HALF)}</span><span class="res-t ${win ? 'ok' : 'no'}">${win ? 'Richtig' : 'Falsch'}</span></li>`;
  }).join(''))).join('');
}

// ---- Rangliste ----
function renderRanking() {
  const rows = ranking(), uid = state.user.uid, wrap = $('leaderboard');
  $('lb-count').textContent = rows.length ? plural(rows.length, 'Spieler', 'Spieler') : '';
  const idx = rows.findIndex(r => r.uid === uid), me = idx >= 0 ? rows[idx] : { bets: 0, wins: 0 };
  const lead = rows[0];
  const gap = lead && idx > 0 ? lead.wins - me.wins : 0;
  $('my-rank').innerHTML = `<div class="stats">
      <div><div class="stat-v num">${idx >= 0 ? '#' + (idx + 1) : '–'}</div><div class="stat-l">Position</div></div>
      <div><div class="stat-v num">${idx >= 0 ? gap : '–'}</div><div class="stat-l">Rückstand</div></div>
      <div><div class="stat-v num">${me.bets}</div><div class="stat-l">Tipps</div></div>
      <div><div class="stat-v num">${me.wins}</div><div class="stat-l">Siege</div></div>
    </div><p class="stat-note">${idx === 0 ? 'Du füehrsch d\'Rangliste.' : 'Rückstand: Siege hinter Platz 1.'} Sortiert nach Siege, denn Gwinn, denn Aazahl Tipps.</p>`;
  if (!rows.length) { wrap.innerHTML = '<p class="empty-line" style="margin-top:20px">D\'Rangliste erschiint nach em erschte Tipp.</p>'; return; }
  const max = Math.max(lead.wins, 1);
  wrap.innerHTML = `<ol class="lb">${rows.map((r, i) => {
    const tags = BADGES.filter(b => b.done(r)).map(b => b.name), d = lead.wins - r.wins;
    return `<li class="lb-row ${i === 0 ? 'lead' : ''} ${r.uid === uid ? 'me' : ''}">
      <div class="lb-rank num">${i + 1}</div>
      <div style="min-width:0">
        <div class="lb-name"><span>${esc(r.name)}</span>${r.uid === uid ? '<span class="tag-me">Du</span>' : ''}</div>
        <div class="lb-meta"><span>${plural(r.bets, 'Tipp', 'Tipps')}</span><span>Gwinn <span class="money num">${chf(r.earned)}</span></span>${i > 0 && d > 0 ? `<span class="lb-gap">${plural(d, 'Sieg', 'Siege')} Rückstand</span>` : ''}</div>
        ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
        <div class="lb-track"><i style="width:${Math.max(3, Math.round(r.wins / max * 100))}%"></i></div>
      </div>
      <div class="lb-score"><div class="num">${r.wins}</div><div class="lb-score-l">${r.wins === 1 ? 'Sieg' : 'Siege'}</div></div>
    </li>`;
  }).join('')}</ol>`;
}

// ---- Kasse ----
function renderKasse(up) {
  const uid = state.user.uid, konto = computedKonto(), s = userStats(uid);
  $('konto-value').textContent = chf(konto);
  $('konto-sub').textContent = konto >= BEER_PRICE ? 'Reicht für ca. ' + Math.floor(konto / BEER_PRICE) + ' Bier' : 'No leer';
  $('my-contrib').textContent = chf(s.bier);
  $('konto-total').textContent = chf(konto);

  const open = openTransfers();
  const owe = open.filter(t => t.from === uid), get = open.filter(t => t.to === uid);
  const byPerson = (list, key) => Object.values(list.reduce((m, t) => {
    const p = t[key]; (m[p] = m[p] || { uid: p, amount: 0, games: new Set(), list: [] });
    m[p].amount += t.amount; m[p].games.add(t.gameId); m[p].list.push(t); return m;
  }, {}));
  const gameName = id => { const g = state.games.find(x => x.id === id); return g ? matchName(g) : ''; };
  const section = (title, list, key, btnText) => {
    const people = byPerson(list, key), total = list.reduce((a, t) => a + t.amount, 0);
    return `<div class="owe"><div><div class="k-l">${title}</div><div class="owe-v wide money num">${chf(total)}</div></div></div>
      <ul class="list">${people.map(p => `<li><div class="row pay-row"><div class="row-main"><div class="row-t">${esc(nameOf(p.uid))}</div><div class="row-s">${[...p.games].map(gameName).map(esc).join(', ')}</div></div>
        <span class="money num" style="font-weight:700">${chf(p.amount)}</span><button class="btn-secondary" data-key="${key}" data-uid="${p.uid}">${btnText}</button></div></li>`).join('')}</ul>`;
  };
  let html = '';
  if (owe.length) html += section('Du schuldisch', owe, 'to', 'Erledigt') + `<button class="btn-primary" id="twint-open" style="margin-top:14px">Twint öffne</button><p class="hint" style="margin-top:10px">Nach em Überwiise bi dr Person uf «Erledigt» tippe.</p>`;
  if (get.length) html += `<div style="margin-top:${owe.length ? 22 : 0}px">` + section('Du bechunnsch', get, 'from', 'Erhalte') + '</div>';
  if (!html) html = `<p class="empty-line">Alles usglichen. Nach em nächschte abgrechnete Spiel gsehsch hie, wär wäm wie vil schuldet.</p>`;
  $('twint').innerHTML = html;
  $('twint').querySelectorAll('[data-uid]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.key, p = b.dataset.uid;
    markPaid((k === 'to' ? owe : get).filter(t => t[k] === p));
  }));
  const tb = $('twint-open');
  if (tb) tb.addEventListener('click', async () => {
    const total = owe.reduce((a, t) => a + t.amount, 0).toFixed(2);
    if (TWINT_URL) { location.href = TWINT_URL; return; }
    try { await navigator.clipboard.writeText(total); toast('Betrag ' + total + ' kopiert. Öffne jetzt d\'Twint-App.'); }
    catch (e) { toast('Öffne d\'Twint-App und überwiis ' + chf(Number(total))); }
  });

  const withBets = up.filter(g => betsFor(g.id).length);
  $('jackpots').innerHTML = withBets.length
    ? `<ul class="list">${withBets.map(g => { const n = betsFor(g.id).length, t = times(g); return `<li><div class="row"><div class="row-main"><div class="game-t">${esc(matchName(g))}</div><div class="row-s">${esc(dateShort(t.kick))}, ${hm(t.kick)}, ${plural(n, 'Tipp', 'Tipps')}</div></div><span class="wide money num" style="font-size:20px">${chf(n * HALF)}</span></div></li>`; }).join('')}</ul>`
    : '<p class="empty-line">Momentan kei offeni Jackpots.</p>';
}

// ---- Profil ----
function renderProfil() {
  const u = state.user, s = userStats(u.uid), name = u.displayName || u.email;
  $('profil').innerHTML = `<div class="prof"><div class="avatar">${esc(initials(name))}</div><div class="row-main">
      <div class="prof-name"><span>${esc(name)}</span>${state.isAdmin ? '<span class="tag">CEO</span>' : ''}</div><div class="prof-mail">${esc(u.email || '')}</div></div></div>
    <div class="stats">
      <div><div class="stat-v num">${s.bets}</div><div class="stat-l">Tipps</div></div>
      <div><div class="stat-v num">${s.wins}</div><div class="stat-l">Siege</div></div>
      <div><div class="stat-v money num">${amt(s.earned)}</div><div class="stat-l">Gwinn</div></div>
      <div><div class="stat-v money num">${amt(s.bier)}</div><div class="stat-l">Bierkässeli</div></div>
    </div>`;
  $('badges').innerHTML = BADGES.map(b => {
    const ok = b.done(s);
    return `<div class="badge ${ok ? 'on' : ''}"><span class="tag">${b.name}</span><span class="badge-d">${b.text}</span><span class="badge-p num">${ok ? icon('check') + 'Erreicht' : b.prog(s)}</span></div>`;
  }).join('');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  $('install-block').hidden = !!standalone;
}

// ---- Admin ----
function renderAdmin(up, done) {
  // Übersicht
  const g = pickCurrent(up), konto = computedKonto();
  const pendingGames = up.filter(x => ['locked', 'visible', 'live', 'pending'].includes(phase(x)));
  let dash = '';
  if (g) {
    const n = betsFor(g.id).length, t = times(g);
    dash += `<section class="block flush"><div class="h2-row"><h2 class="h2">Nächschts Spiel</h2>${statusHtml(g)}</div>
      <div class="game-t" style="font-size:20px">${esc(matchName(g))}</div>
      <div class="row-s" style="margin-bottom:12px">${esc(dateLong(t.kick))}, ${hm(t.kick)}, Tipp-Stopp ${hm(t.stop)}, sichtbar ${hm(t.reveal)}</div>
      <div class="stats">
        <div><div class="stat-v num">${n}</div><div class="stat-l">Tipps</div></div>
        <div><div class="stat-v money num">${amt(n * BET_COST)}</div><div class="stat-l">Iinahme</div></div>
        <div><div class="stat-v money num">${amt(n * HALF)}</div><div class="stat-l">Jackpot</div></div>
        <div><div class="stat-v money num">${amt(n * HALF)}</div><div class="stat-l">Bierkässeli</div></div>
      </div></section>`;
  } else dash += `<section class="block flush"><p class="empty-line">Kei plannts Spiel.</p></section>`;
  dash += pendingGames.map(x => `<div class="todo"><span>Resultat erfasse: <b>${esc(matchName(x))}</b></span><button class="btn-secondary sm" onclick="setAdminTab('resultat')">Erfasse</button></div>`).join('');
  dash += `<section class="block" style="margin-top:12px"><div class="h2-row"><h2 class="h2">Saison</h2></div><div class="stats three">
      <div><div class="stat-v money num">${amt(konto)}</div><div class="stat-l">Bierkässeli</div></div>
      <div><div class="stat-v num">${done.length}</div><div class="stat-l">Abgrechnet</div></div>
      <div><div class="stat-v num">${new Set(state.bets.map(b => b.userId)).size}</div><div class="stat-l">Spieler</div></div>
    </div>
    <div class="actions"><button class="btn-secondary" onclick="setAdminTab('spiel')">${icon('plus')}Spiel erstelle</button><button class="btn-secondary" onclick="setAdminTab('abrechnig')">Abrächnig</button></div></section>`;
  $('adm-dash').innerHTML = dash;

  // Plannti Spiel
  $('adm-games').innerHTML = up.length ? up.map(x => {
    const t = times(x), n = betsFor(x.id).length;
    return `<li><button class="grow" data-edit="${x.id}"><div class="row-main"><div class="game-t">${esc(matchName(x))}</div><div class="row-s">${esc(dateShort(t.kick))}, ${hm(t.kick)}, ${x.home === false ? 'uswärts' : 'heim'}, ${plural(n, 'Tipp', 'Tipps')}</div>${statusHtml(x)}</div>${icon('chev')}</button></li>`;
  }).join('') : '<li class="empty-line">No kei Spiel plannt.</li>';
  $('adm-games').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editGame(state.games.find(x => x.id === b.dataset.edit))));

  // Resultat erfasse
  const wrap = $('adm-results');
  wrap.innerHTML = pendingGames.length ? pendingGames.map(x => {
    const r = ui.results[x.id] || (ui.results[x.id] = { h: null, a: null }), t = times(x);
    const st = side => `<div class="stepper" data-side="${side}"><button class="st-btn" data-act="-1" aria-label="Ei Tor weniger">${icon('minus')}</button><output class="st-val num ${r[side] === null ? 'is-empty' : ''}">${r[side] === null ? '–' : r[side]}</output><button class="st-btn" data-act="1" aria-label="Ei Tor meh">${icon('plus')}</button></div>`;
    return `<div class="adm-game" data-id="${x.id}">
      <div class="h2-row"><div><div class="game-t">${esc(matchName(x))}</div><div class="row-s">${esc(dateShort(t.kick))}, ${hm(t.kick)}, ${plural(betsFor(x.id).length, 'Tipp', 'Tipps')}</div></div>${statusHtml(x)}</div>
      <div class="adm-sb"><div class="sb-row gott"><div class="team">Gottéron</div>${st('h')}</div><div class="sb-row"><div class="team">${esc(x.opponent || '?')}</div>${st('a')}</div></div>
      <p class="preview" data-preview></p>
      <button class="btn-primary" data-save style="margin-top:12px">Resultat speichere</button></div>`;
  }).join('') : '<p class="empty-line" style="margin-top:12px">Kei Spiel zum Uswärte. Resultat chasch erfasse, sobald dr Tipp-Stopp verbi isch.</p>';
  wrap.querySelectorAll('.adm-game').forEach(el => {
    const x = state.games.find(y => y.id === el.dataset.id), r = ui.results[x.id];
    const preview = () => {
      const pv = el.querySelector('[data-preview]'), save = el.querySelector('[data-save]');
      el.querySelectorAll('.stepper').forEach(st => { const v = r[st.dataset.side], o = st.querySelector('.st-val'); o.textContent = v === null ? '–' : v; o.classList.toggle('is-empty', v === null); });
      if (r.h === null || r.a === null) { pv.textContent = 'Schlussresultat iistelle.'; save.disabled = true; return; }
      save.disabled = false;
      const gb = betsFor(x.id), jackpot = gb.length * HALF;
      const win = gb.filter(b => { const s = parseScore(b.prediction); return s && s[0] === r.h && s[1] === r.a; });
      if (!gb.length) pv.innerHTML = 'Kei Tipps. Ds Spiel wird ohni Uszahlig abgschlosse.';
      else if (!win.length) pv.innerHTML = `Kei richtige Tipp. Dr Jackpot vo <b class="money">${chf(jackpot)}</b> gaht is Bierkässeli.`;
      else pv.innerHTML = `${plural(win.length, 'richtige Tipp', 'richtigi Tipps')}: <b>${[...new Set(win.map(b => esc(b.userName || '?')))].join(', ')}</b>. ${win.length > 1 ? 'Je' : 'Uszahlig'} <b class="money">${chf(jackpot / win.length)}</b>${win.length > 1 ? ' pro Tipp' : ''}.`;
    };
    el.querySelectorAll('.stepper').forEach(st => st.querySelectorAll('.st-btn').forEach(b => b.addEventListener('click', () => {
      const side = st.dataset.side, step = Number(b.dataset.act), v = r[side];
      r[side] = v === null ? (step > 0 ? 1 : 0) : Math.max(0, Math.min(15, v + step)); preview();
    })));
    el.querySelector('[data-save]').addEventListener('click', () => {
      if (r.h === null || r.a === null) return;
      if (confirm(`Resultat Gottéron ${r.h}:${r.a} ${x.opponent} speichere und abrächne? Das cha me nid rückgängig mache.`)) settleGame(x, r.h, r.a);
    });
    preview();
  });

  // Abrächnig
  const rows = ranking();
  const sumBier = rows.reduce((a, r) => a + r.bier, 0);
  $('adm-billing').innerHTML = `<section class="block flush" style="padding-top:14px"><div class="h2-row"><h2 class="h2">Bierkässeli pro Person</h2><span class="h2-aside">am Saisonändi iizieh</span></div>
    <ul class="list billing"><li><span class="h">Name</span><span class="h r">Tipps</span><span class="h r">Bierkässeli</span></li>
    ${rows.map(r => `<li><div class="row-main"><div class="row-t">${esc(r.name)}</div><div class="row-s">Jackpot-Saldo ${r.jackpotNet > 0 ? '+ ' : ''}${chf(r.jackpotNet)}</div></div><span class="r num">${r.bets}</span><span class="r money num">${chf(r.bier)}</span></li>`).join('')}
    <li><span class="row-t">Total</span><span class="r num">${state.bets.length}</span><span class="r money num" style="font-weight:700">${chf(sumBier)}</span></li></ul>
    <p class="hint" style="margin-top:10px">Jackpot-Saldo: gwunne minus iigsetzti Jackpot-Aateil (CHF 2.50 pro Tipp). D'Jackpots wärde nach jedem Spiel direkt per Twint usglichen.</p></section>`;
}

// ===== Live: Countdown und automatische Status-Wächsel =====
setInterval(() => {
  const now = Date.now();
  let refresh = now >= ui.nextBoundary;
  document.querySelectorAll('[data-until]').forEach(el => {
    const left = Number(el.dataset.until) - now;
    if (left <= 0) refresh = true; else el.textContent = fmtUntil(left);
  });
  if (refresh) render();
}, 1000);
