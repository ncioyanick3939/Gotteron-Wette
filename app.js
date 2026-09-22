import { firebaseConfig, ADMIN_EMAIL, BET_COST } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDocs, deleteDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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

const HALF = BET_COST / 2;       // Fr. 2.50 in Jackpot, Fr. 2.50 is Bierkässeli
const TROPHY_MIN = 10;           // Pokal ab 10 Tipps
const BEER_PRICE = 6;            // für "reicht für ca. X Bier"
const QUICK = ['2:1', '3:1', '3:2', '4:2', '4:1', '1:2', '2:3', '1:3'];

const state = { user: null, isAdmin: false, games: [], bets: [], selectedId: null, loaded: false };
const ui = { drafts: {}, expanded: new Set(), closeSel: {} };
window._authMode = window._authMode || 'login';

// ===== HELPERS =====
const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };

function toast(m) {
  const t = $('toast'); if (!t) return;
  t.textContent = m; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600);
}
// Schwiizer Schriibwiis: Fr. 20.– / Fr. 7.50
function chf(n) {
  const r = Math.round((n || 0) * 100) / 100;
  return 'Fr. ' + (Number.isInteger(r) ? r + '.–' : r.toFixed(2));
}
function dateLong(d) {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { return d; }
}
function dateShort(d) {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric' }); } catch (e) { return d; }
}
function daysUntil(d) {
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(d + 'T00:00:00') - today) / 86400000);
}
function dayLabel(g) {
  const d = daysUntil(g.date), long = dateLong(g.date);
  if (d === 0) return 'Hüt, ' + long.replace(/^[^,]+,\s*/, '');
  if (d === 1) return 'Morn, ' + long.replace(/^[^,]+,\s*/, '');
  return long;
}
function timeOnDate(date, hhmm) {
  if (!date) return Infinity;
  const [hh, mm] = String(hhmm).split(':').map(Number);
  const c = new Date(date + 'T00:00:00');
  c.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0);
  return c.getTime();
}
function cutoffTime(g) { return g.cutoffTime || '19:30'; }
function cutoffMs(g) { return timeOnDate(g.date, cutoffTime(g)); }
const isCutoffPassed = g => Date.now() > cutoffMs(g);

// Tipps vo de andere sy verdeckt bis zur Freigab-Zit (Standard 22:00),
// nie vor em Wette-Stopp. Dr CEO gseht alli Tipps immer.
function revealTime(g) { return g.revealTime || '22:00'; }
function revealMs(g) { return Math.max(timeOnDate(g.date, revealTime(g)), cutoffMs(g)); }
const isRevealed = g => g.status === 'closed' || Date.now() >= revealMs(g);
const canSeeTips = g => state.isAdmin || isRevealed(g);
function fmtCountdown(ms) {
  if (ms >= 86400000) { const d = Math.floor(ms / 86400000); return 'in ' + d + (d === 1 ? ' Tag' : ' Täg'); }
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return 'in ' + h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

const P = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevDown: '<path d="M6 9l6 6 6-6"/>',
  chevRight: '<path d="M9 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>'
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
const matchName = g => 'Gottéron – ' + (g.opponent || '?');

// ===== EVENTS =====
function setupEvents() {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('login-btn', 'click', submitAuth);
  on('login-pass', 'keydown', e => { if (e.key === 'Enter') submitAuth(); });
  on('logout-btn', 'click', () => signOut(auth));
  on('ng-create', 'click', createGame);
  on('reset-konto', 'click', resetAll);
  const ngDate = $('ng-date'); if (ngDate) try { ngDate.valueAsDate = new Date(); } catch (e) {}
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupEvents);
else setupEvents();

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
      $('whoami-name').textContent = name;
      toast('Konto erstellt');
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
    $('login-pass').value = '';
  } catch (e) {
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') err.textContent = 'E-Mail oder Passwort stimmt nid.';
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
      $('whoami-name').textContent = user.displayName || user.email;
      $('whoami-role').hidden = !state.isAdmin;
      $('nav-ceo').hidden = !state.isAdmin;
      const want = (location.hash || '').replace('#', '');
      if (window.showView) window.showView(['rangliste', 'ceo'].includes(want) ? want : 'spiel');
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

// ===== DATA =====
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

async function createGame() {
  const oEl = $('ng-opponent'), dEl = $('ng-date'), cEl = $('ng-cutoff'), rEl = $('ng-reveal'), btn = $('ng-create');
  const o = oEl.value.trim(), d = dEl.value, c = (cEl && cEl.value) || '19:30', r = (rEl && rEl.value) || '22:00';
  if (!o) { toast('Bitte e Gägner iigäh'); oEl.focus(); return; }
  if (!d) { toast('Bitte es Spieldatum wähle'); dEl.focus(); return; }
  if (r < c) { toast('«Tipps sichtbar ab» muess nach em Wette-Stopp sy'); rEl.focus(); return; }
  btn.disabled = true;
  try {
    const ref = await addDoc(collection(db, 'games'), { opponent: o, date: d, cutoffTime: c, revealTime: r, status: 'open', createdAt: Date.now() });
    oEl.value = '';
    state.selectedId = ref.id;
    toast('Spiel eröffnet');
    window.showView && window.showView('spiel');
  } catch (e) { toast('Fehler: ' + e.message); }
  btn.disabled = false;
}

async function placeBet(gid, pred) {
  if (!state.user) return;
  const g = state.games.find(x => x.id === gid);
  if (g && isCutoffPassed(g)) { toast('Wette-Stopp isch verbi'); render(); return; }
  try {
    await addDoc(collection(db, 'bets'), { gameId: gid, userId: state.user.uid, userName: state.user.displayName || state.user.email, prediction: pred, createdAt: Date.now() });
    ui.drafts[gid] = { h: null, a: null };
    toast('Tipp ' + pred + ' abgäh');
    const mine = state.bets.filter(b => b.userId === state.user.uid).length + 1;
    if (mine === TROPHY_MIN) setTimeout(() => toast('Pokal verdient: ' + TROPHY_MIN + ' Tipps'), 2800);
  } catch (e) { toast('Fehler: ' + e.message); }
}

async function closeGame(gid, selIds) {
  const gb = state.bets.filter(b => b.gameId === gid), pot = gb.length * BET_COST;
  if (!pot) { toast('Bi däm Spiel git\'s no kei Tipps'); return; }
  const wu = [...new Set(gb.filter(b => selIds.includes(b.id)).map(b => b.userId))];
  const hasW = wu.length > 0, jackpot = pot / 2;
  const pw = hasW ? jackpot / wu.length : 0;
  const kontoHalf = pot / 2 + (hasW ? 0 : jackpot);
  try {
    await updateDoc(doc(db, 'games', gid), { status: 'closed', closedAt: Date.now(), pot, winnerBetIds: selIds, winnerUserIds: wu, jackpotHalf: jackpot, kontoHalf, perWinner: pw });
    delete ui.closeSel[gid];
    toast(hasW ? 'Spiel abgschlosse' : 'Spiel abgschlosse, Jackpot is Bierkässeli');
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

// ===== CALC =====
const betsFor = gid => state.bets.filter(b => b.gameId === gid).sort((a, b) => a.createdAt - b.createdAt);

// Bierkässeli = Fr. 2.50 pro Tipp + Jackpot vo Spiel ohni Gwünner
function computedKonto() {
  let total = state.bets.length * HALF;
  state.games.forEach(g => {
    if (g.status === 'closed' && !(g.winnerUserIds || []).length) total += betsFor(g.id).length * HALF;
  });
  return total;
}

function userStats(uid) {
  const my = state.bets.filter(b => b.userId === uid);
  let wins = 0, earned = 0;
  state.games.filter(g => g.status === 'closed').forEach(g => { if ((g.winnerUserIds || []).includes(uid)) { wins++; earned += g.perWinner || 0; } });
  const gamesPlayed = new Set(my.map(b => b.gameId)).size;
  return { bets: my.length, wins, earned, gamesPlayed, bierBeitrag: my.length * HALF };
}

function tagsFor(s, rank) {
  const t = [];
  if (rank === 0 && s.bets > 0) t.push('Spitze');
  if (s.bets >= TROPHY_MIN) t.push('Pokal');
  if (s.bets >= 25) t.push('Stammgast');
  if (s.wins >= 3) t.push('Glückspilz');
  if (s.wins >= 1 && s.wins === s.gamesPlayed && s.gamesPlayed >= 2) t.push('Treffsicher');
  return t;
}

// ===== RENDER =====
function render() {
  try {
    if (!state.user) return;
    const og = state.games.filter(g => g.status !== 'closed').sort((a, b) => cutoffMs(a) - cutoffMs(b));
    const cg = state.games.filter(g => g.status === 'closed').sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
    renderNotifs(cg);
    renderMatch(og);
    renderMore(og);
    renderKasse(og);
    renderClosed(cg);
    renderLeaderboard();
    if (state.isAdmin) renderCeo(og);
  } catch (e) { console.error('Render error:', e); }
}

// ---- Next game as a scoreboard ----
function renderMatch(og) {
  const box = $('match'), tb = $('tips-block');
  if (!state.loaded) return;
  if (!og.length) {
    state.selectedId = null;
    box.className = 'match match-empty';
    box.innerHTML = `<svg class="rink" aria-hidden="true"><use href="#rink"/></svg>
      <div class="team">Kei offeni Spiel</div>
      <p>Sobald dr CEO s'nächschte Spiel eröffnet, chasch hie diin Tipp abgäh.</p>
      ${state.isAdmin ? `<button class="btn-secondary" onclick="showView('ceo')">Neus Spiel eröffne</button>` : ''}`;
    tb.hidden = true;
    return;
  }
  let g = og.find(x => x.id === state.selectedId) || og.find(x => !isCutoffPassed(x)) || og[0];
  state.selectedId = g.id;
  const bets = betsFor(g.id), locked = isCutoffPassed(g), uid = state.user.uid;
  const mine = bets.filter(b => b.userId === uid);
  const draft = ui.drafts[g.id] || (ui.drafts[g.id] = { h: null, a: null });

  const stepper = side => {
    const v = draft[side], team = side === 'h' ? 'Gottéron' : (g.opponent || 'Gägner');
    return `<div class="stepper" data-side="${side}">
      <button class="st-btn" data-act="-1" aria-label="${esc(team)} ei Tor weniger">${icon('minus')}</button>
      <output class="st-val num ${v === null ? 'is-empty' : ''}" aria-label="Tore ${esc(team)}">${v === null ? '–' : v}</output>
      <button class="st-btn" data-act="1" aria-label="${esc(team)} ei Tor meh">${icon('plus')}</button>
    </div>`;
  };
  const score = side => locked ? `<div class="sb-dash">–</div>` : stepper(side);

  box.className = 'match';
  box.innerHTML = `<svg class="rink" aria-hidden="true"><use href="#rink"/></svg>
    <div class="m-head">
      <div>
        <div class="m-date">${esc(dayLabel(g))}</div>
        <div class="m-stop ${locked ? 'is-locked' : ''}">${icon(locked ? 'lock' : 'clock')}
          <span>${locked ? 'Tipps gschlosse' : 'Wette-Stopp ' + esc(cutoffTime(g))}</span>
          ${locked ? '' : `<span class="m-count num" data-cutoff="${cutoffMs(g)}">${fmtCountdown(cutoffMs(g) - Date.now())}</span>`}
        </div>
      </div>
      <div class="m-pot"><div class="m-pot-l">Jackpot</div><div class="m-pot-v wide money num">${chf(bets.length * HALF)}</div></div>
    </div>
    <div class="sb" role="group" aria-label="Din Tipp">
      <div class="sb-row home"><div class="team">Gottéron</div>${score('h')}</div>
      <div class="sb-row"><div class="team">${esc(g.opponent || '?')}</div>${score('a')}</div>
    </div>
    ${locked
      ? `<p class="m-locked">D'Tipps für das Spiel sind gschlosse. Dr CEO trait s'Resultat nach em Spiel ii.</p>`
      : `<div class="quick" role="group" aria-label="Schnälltipps">${QUICK.map(q => `<button class="qt num" data-q="${q}">${q}</button>`).join('')}</div>
         <button class="btn-primary split" id="bet-btn"><span>Tipp abgäh</span><span class="num">${chf(BET_COST)}</span></button>`}
    ${mine.length ? `<p class="m-mine">Dini Tipps${mine.map(b => `<b class="num">${esc(b.prediction)}</b>`).join('')}</p>` : ''}`;

  if (!locked) {
    const sync = () => {
      box.querySelectorAll('.stepper').forEach(st => {
        const v = draft[st.dataset.side], out = st.querySelector('.st-val');
        out.textContent = v === null ? '–' : v;
        out.classList.toggle('is-empty', v === null);
        st.querySelector('[data-act="-1"]').disabled = v === null || v === 0;
      });
      const cur = draft.h !== null && draft.a !== null ? draft.h + ':' + draft.a : '';
      box.querySelectorAll('.qt').forEach(b => b.classList.toggle('is-on', b.dataset.q === cur));
      const btn = $('bet-btn');
      btn.disabled = !cur;
      btn.firstElementChild.textContent = cur ? 'Tipp ' + cur + ' abgäh' : 'Resultat iistelle';
    };
    box.querySelectorAll('.stepper').forEach(st => {
      st.querySelectorAll('.st-btn').forEach(b => b.addEventListener('click', () => {
        const side = st.dataset.side, step = Number(b.dataset.act);
        const v = draft[side];
        draft[side] = v === null ? (step > 0 ? 1 : 0) : Math.max(0, Math.min(15, v + step));
        sync();
      }));
    });
    box.querySelectorAll('.qt').forEach(b => b.addEventListener('click', () => {
      const [h, a] = b.dataset.q.split(':').map(Number);
      draft.h = h; draft.a = a; sync();
    }));
    $('bet-btn').addEventListener('click', async e => {
      if (draft.h === null || draft.a === null) return;
      e.currentTarget.disabled = true;
      await placeBet(g.id, draft.h + ':' + draft.a);
      render();
    });
    sync();
  }

  // Tipps vo allne für das Spiel
  tb.hidden = false;
  $('tips-count').textContent = bets.length ? plural(bets.length, 'Tipp', 'Tipps') + ' vo ' + plural(new Set(bets.map(b => b.userId)).size, 'Spieler', 'Spieler') : '';
  const open = isRevealed(g), see = canSeeTips(g), hint = $('tips-hint');
  hint.hidden = open;
  hint.innerHTML = open ? '' : (state.isAdmin
    ? `Nume du gsehsch d'Tipps. Für alli andere sichtbar ab ${esc(revealTime(g))}.`
    : `D'Tipps vo de andere sy verdeckt bis ${esc(revealTime(g))}. Diini eigete gsehsch immer.`)
    + `<span data-reveal="${revealMs(g)}" hidden></span>`;
  $('tips').innerHTML = bets.length
    ? bets.map(b => {
        const show = see || b.userId === uid;
        return `<li><span class="tl-name"><span>${esc(b.userName || '?')}</span>${b.userId === uid ? '<span class="tag-me">Du</span>' : ''}</span>${show
          ? `<span class="tl-tip num">${esc(b.prediction)}</span>`
          : `<span class="tl-hidden">${icon('lock')}verdeckt</span>`}</li>`;
      }).join('')
    : `<li class="empty-line" style="border:0">No kei Tipps. Du chasch dr Erscht sy.</li>`;
}

function renderMore(og) {
  const rest = og.filter(g => g.id !== state.selectedId);
  $('more-block').hidden = !rest.length;
  $('more-games').innerHTML = rest.map(g => {
    const n = betsFor(g.id).length;
    return `<li><button class="grow" data-id="${g.id}">
      <div class="grow-main"><div class="grow-t">${esc(matchName(g))}</div><div class="grow-s">${esc(dateShort(g.date))}, ${isCutoffPassed(g) ? 'Tipps gschlosse' : 'Tipps bis ' + esc(cutoffTime(g))}</div></div>
      <div class="grow-pot"><div class="money num">${chf(n * HALF)}</div><div class="grow-s">${plural(n, 'Tipp', 'Tipps')}</div></div>
      ${icon('chevRight')}
    </button></li>`;
  }).join('');
  $('more-games').querySelectorAll('.grow').forEach(b => b.addEventListener('click', () => {
    state.selectedId = b.dataset.id; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

function renderKasse(og) {
  const openBets = og.reduce((s, g) => s + betsFor(g.id).length, 0);
  const konto = computedKonto(), mine = userStats(state.user.uid);
  $('jackpot-value').textContent = chf(openBets * HALF);
  $('jackpot-sub').textContent = og.length ? plural(openBets, 'Tipp', 'Tipps') + ' uf ' + plural(og.length, 'Spiel', 'Spiel') : 'Kei offeni Spiel';
  $('konto-value').textContent = chf(konto);
  $('konto-sub').textContent = konto >= BEER_PRICE ? 'Reicht für ca. ' + Math.floor(konto / BEER_PRICE) + ' Bier' : 'No leer';
  $('split-j').textContent = chf(HALF) + ' pro Tipp in Jackpot';
  $('split-b').textContent = chf(HALF) + ' pro Tipp is Bierkässeli';
  $('my-contrib').textContent = chf(mine.bierBeitrag);
}

function renderClosed(cg) {
  const sec = $('closed-section'); sec.hidden = !cg.length;
  $('closed-count').textContent = cg.length ? plural(cg.length, 'Spiel', 'Spiel') : '';
  const uid = state.user.uid, wrap = $('closed-games');
  wrap.innerHTML = cg.map(g => {
    const bets = betsFor(g.id), wids = g.winnerBetIds || [], wc = (g.winnerUserIds || []).length;
    const iWon = (g.winnerUserIds || []).includes(uid), open = ui.expanded.has(g.id);
    const pot = g.pot || bets.length * BET_COST, jp = g.jackpotHalf || pot / 2;
    const status = iWon ? `${icon('check')}Gwunne` : (wc ? plural(wc, 'Gwünner', 'Gwünner') : 'Kei Gwünner');
    return `<div class="res ${open ? 'is-open' : ''}" data-id="${g.id}">
      <button class="res-head" aria-expanded="${open}">
        <div class="res-main"><div class="res-match">${esc(matchName(g))}</div><div class="res-date">${esc(dateShort(g.date))}, ${plural(bets.length, 'Tipp', 'Tipps')}</div></div>
        <span class="res-status ${iWon ? 'won' : ''}">${status}</span>
        ${icon('chevDown', 'res-chev')}
      </button>
      <div class="res-body">
        <ul class="tiplist">${bets.map(b => { const w = wids.includes(b.id); return `<li class="${w ? 'won' : ''}"><span class="tl-name"><span>${esc(b.userName || '?')}</span>${b.userId === uid ? '<span class="tag-me">Du</span>' : ''}</span><span class="tl-tip num">${w ? icon('check') : ''}${esc(b.prediction)}</span></li>`; }).join('')}</ul>
        <dl class="res-sum">
          <div><dt>Iisätz</dt><dd class="num">${chf(pot)}</dd></div>
          <div><dt>Jackpot</dt><dd class="num money">${chf(jp)}</dd>${wc > 1 ? `<dd class="num" style="font-weight:400;font-size:12px;color:var(--text-3)">je ${chf(g.perWinner || 0)}</dd>` : ''}</div>
          <div><dt>Is Bierkässeli</dt><dd class="num money">${chf(g.kontoHalf || pot / 2)}</dd></div>
        </dl>
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.res-head').forEach(h => h.addEventListener('click', () => {
    const r = h.parentElement, id = r.dataset.id;
    ui.expanded.has(id) ? ui.expanded.delete(id) : ui.expanded.add(id);
    r.classList.toggle('is-open'); h.setAttribute('aria-expanded', r.classList.contains('is-open'));
  }));
}

// ---- Result notices (Twint) ----
const dismissed = new Set(JSON.parse(localStorage.getItem('gott_dismissed') || '[]'));
function dismiss(id) { dismissed.add(id); localStorage.setItem('gott_dismissed', JSON.stringify([...dismissed])); }

function renderNotifs(cg) {
  const w = $('notifs'); w.innerHTML = '';
  const uid = state.user.uid;
  cg.forEach(g => {
    if (dismissed.has(g.id)) return;
    const all = betsFor(g.id), my = all.filter(b => b.userId === uid);
    if (!my.length) return;
    const wu = g.winnerUserIds || [], iWon = wu.includes(uid);
    const nameOf = id => (all.find(b => b.userId === id) || {}).userName || '?';
    const loserIds = [...new Set(all.filter(b => !wu.includes(b.userId)).map(b => b.userId))];
    const n = document.createElement('div');
    if (iWon) {
      // Jede Verlierer zahlt Fr. 2.50 pro Tipp, ufteilt uf alli Gwünner
      const owed = loserIds.map(id => `${esc(nameOf(id))} (${chf(all.filter(b => b.userId === id).length * HALF / wu.length)})`);
      n.className = 'note note-win';
      n.innerHTML = `<div class="note-main"><div class="note-t">Gwunne: ${esc(matchName(g))}</div>
        <p>Du bechunnsch <b class="money">${chf(g.perWinner || 0)}</b> us em Jackpot.</p>
        <p class="note-s">${owed.length ? 'Per Twint vo: ' + owed.join(', ') : 'Kei anderi Tipps, du bechunnsch diini eigete Iisätz zrugg.'}</p></div>`;
    } else if (wu.length) {
      const pay = my.length * HALF / wu.length;
      const names = wu.map(id => `<b>${esc(nameOf(id))}</b>`);
      n.className = 'note note-pay';
      n.innerHTML = `<div class="note-main"><div class="note-t">Nid gwunne: ${esc(matchName(g))}</div>
        <p>Bitte per Twint <b class="money">${chf(pay)}</b> ${wu.length > 1 ? 'je ' : ''}a ${names.join(' und ')}.</p>
        <p class="note-s">Dis Bierkässeli-Aateil (${chf(my.length * HALF)}) zahlsch erscht am Saisonändi.</p></div>`;
    } else {
      n.className = 'note';
      n.innerHTML = `<div class="note-main"><div class="note-t">Kei Gwünner: ${esc(matchName(g))}</div>
        <p>Dr Jackpot vo <b class="money">${chf(all.length * HALF)}</b> gaht is Bierkässeli. Du muesch nüt überwiise.</p></div>`;
    }
    const x = document.createElement('button');
    x.className = 'note-x'; x.setAttribute('aria-label', 'Usblende'); x.innerHTML = icon('x');
    x.addEventListener('click', () => { dismiss(g.id); n.remove(); });
    n.appendChild(x);
    w.appendChild(n);
  });
}

// ---- Leaderboard ----
function renderLeaderboard() {
  const wrap = $('leaderboard'), uid = state.user.uid;
  const users = {};
  state.bets.forEach(b => { if (!users[b.userId]) users[b.userId] = b.userName || '?'; });
  const rows = Object.entries(users).map(([id, name]) => ({ uid: id, name, ...userStats(id) }))
    .sort((a, b) => b.bets - a.bets || b.wins - a.wins);
  $('lb-count').textContent = rows.length ? plural(rows.length, 'Spieler', 'Spieler') : '';

  const meIdx = rows.findIndex(r => r.uid === uid);
  const me = meIdx >= 0 ? rows[meIdx] : { bets: 0, wins: 0, bierBeitrag: 0 };
  const toTrophy = TROPHY_MIN - me.bets;
  $('my-stats').innerHTML = `<div class="mine">
      <div><div class="mine-v num">${meIdx >= 0 ? meIdx + 1 + '.' : '–'}</div><div class="mine-l">Platz</div></div>
      <div><div class="mine-v num">${me.bets}</div><div class="mine-l">Tipps</div></div>
      <div><div class="mine-v num">${me.wins}</div><div class="mine-l">${me.wins === 1 ? 'Sieg' : 'Siege'}</div></div>
      <div><div class="mine-v num money">${chf(me.bierBeitrag).replace('Fr. ', '')}</div><div class="mine-l">Bierkässeli</div></div>
    </div>
    <p class="mine-note">${toTrophy > 0 ? 'No ' + plural(toTrophy, 'Tipp', 'Tipps') + ' bis zum Pokal.' : 'Pokal verdient.'}</p>`;

  if (!rows.length) { wrap.innerHTML = '<p class="empty-line" style="margin-top:20px">D\'Rangliste erschiint nach em erschte Tipp.</p>'; return; }
  const lead = rows[0], max = lead.bets || 1;
  wrap.innerHTML = `<ol class="lb">${rows.map((r, i) => {
    const gap = lead.bets - r.bets, tags = tagsFor(r, i);
    return `<li class="lb-row ${i === 0 ? 'lead' : ''} ${r.uid === uid ? 'me' : ''}">
      <div class="lb-rank num">${i + 1}</div>
      <div>
        <div class="lb-name"><span>${esc(r.name)}</span>${r.uid === uid ? '<span class="tag-me">Du</span>' : ''}</div>
        <div class="lb-meta"><span>${plural(r.wins, 'Sieg', 'Siege')}</span><span>Bierkässeli <span class="money num">${chf(r.bierBeitrag)}</span></span>${i > 0 ? `<span class="lb-gap">${gap > 0 ? plural(gap, 'Tipp', 'Tipps') + ' hinter ' + esc(lead.name) : 'gliichuf mit ' + esc(lead.name)}</span>` : ''}</div>
        ${tags.length ? `<div class="lb-tags">${tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
        <div class="lb-track"><i style="width:${Math.max(4, Math.round(r.bets / max * 100))}%"></i></div>
      </div>
      <div class="lb-score"><div class="num">${r.bets}</div><div class="lb-score-l">${r.bets === 1 ? 'Tipp' : 'Tipps'}</div></div>
    </li>`;
  }).join('')}</ol>`;
}

// ---- CEO: Resultat erfasse ----
function renderCeo(og) {
  const wrap = $('ceo-results'); if (!wrap) return;
  if (!og.length) { wrap.innerHTML = '<p class="empty-line" style="margin-top:12px">Kei offeni Spiel.</p>'; return; }
  wrap.innerHTML = og.map(g => {
    const bets = betsFor(g.id), sel = ui.closeSel[g.id] || (ui.closeSel[g.id] = new Set());
    [...sel].forEach(id => { if (!bets.some(b => b.id === id)) sel.delete(id); });
    const wu = new Set(bets.filter(b => sel.has(b.id)).map(b => b.userId)).size;
    const jp = bets.length * HALF;
    const sum = !bets.length ? 'No kei Tipps.' : wu ? `${plural(wu, 'Gwünner', 'Gwünner')}, je ${chf(jp / wu)} us em Jackpot.` : `Kei Gwünner uswählt: dr Jackpot vo ${chf(jp)} gaht is Bierkässeli.`;
    return `<div class="ceo-game" data-id="${g.id}">
      <div class="res-match">${esc(matchName(g))}</div>
      <div class="res-date">${esc(dateShort(g.date))}, ${isCutoffPassed(g) ? 'Tipps gschlosse' : 'Tipps no offe bis ' + esc(cutoffTime(g))}, ${isRevealed(g) ? 'für alli sichtbar' : 'für alli sichtbar ab ' + esc(revealTime(g))}</div>
      ${bets.length ? `<ul class="pick">${bets.map(b => `<li><button class="pick-row ${sel.has(b.id) ? 'on' : ''}" data-bid="${b.id}" aria-pressed="${sel.has(b.id)}">
        <span class="pick-box">${icon('check')}</span><span class="pick-name">${esc(b.userName || '?')}</span><span class="pick-tip num">${esc(b.prediction)}</span></button></li>`).join('')}</ul>` : ''}
      <p class="ceo-sum">${sum}</p>
      ${bets.length ? `<button class="btn-secondary" data-close>Spiel abschliesse</button>` : ''}
    </div>`;
  }).join('');
  wrap.querySelectorAll('.ceo-game').forEach(el => {
    const gid = el.dataset.id, sel = ui.closeSel[gid];
    el.querySelectorAll('.pick-row').forEach(b => b.addEventListener('click', () => {
      sel.has(b.dataset.bid) ? sel.delete(b.dataset.bid) : sel.add(b.dataset.bid);
      renderCeo(state.games.filter(g => g.status !== 'closed').sort((a, c) => cutoffMs(a) - cutoffMs(c)));
    }));
    const cb = el.querySelector('[data-close]');
    if (cb) cb.addEventListener('click', () => {
      const g = state.games.find(x => x.id === gid);
      const msg = sel.size ? `${matchName(g)} mit de uswählte Gwünner abschliesse?` : `${matchName(g)} ohni Gwünner abschliesse? Dr Jackpot gaht is Bierkässeli.`;
      if (confirm(msg)) closeGame(gid, [...sel]);
    });
  });
}

// ===== Live-Countdown bis zum Wette-Stopp =====
setInterval(() => {
  let expired = false;
  document.querySelectorAll('[data-cutoff]').forEach(el => {
    const left = Number(el.dataset.cutoff) - Date.now();
    if (left <= 0) expired = true; else el.textContent = fmtCountdown(left);
  });
  document.querySelectorAll('[data-reveal]').forEach(el => { if (Date.now() >= Number(el.dataset.reveal)) expired = true; });
  if (expired) render();
}, 1000);
