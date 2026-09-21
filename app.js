import { firebaseConfig, ADMIN_EMAIL, BET_COST } from './firebase-config.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDoc,
  onSnapshot, query, orderBy, increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  user: null,       // firebase auth user
  isAdmin: false,
  games: [],
  bets: [],
  konto: 0,
};

function $(id) { return document.getElementById(id); }

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function fmtFr(n) {
  const r = Math.round(n * 100) / 100;
  return (r % 1 === 0) ? String(r) : r.toFixed(2);
}

function fmtDate(d) {
  if (!d) return '';
  try {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit' });
  } catch (e) { return d; }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function setFigure(elId, amount) {
  $(elId).innerHTML = fmtFr(amount) + '<span class="unit">Fr.</span>';
}

// ---------- AUTH ----------

$('login-btn').addEventListener('click', submitLogin);
$('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitLogin(); });
$('logout-btn').addEventListener('click', () => signOut(auth));

async function submitLogin() {
  const name = $('login-name').value.trim();
  const email = $('login-email').value.trim().toLowerCase();
  const pass = $('login-pass').value;
  const errEl = $('login-error');
  errEl.textContent = '';

  if (!email || !pass) { errEl.textContent = 'Bitte Email und Passwort iigäh'; return; }

  const btn = $('login-btn');
  btn.disabled = true;
  try {
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        if (!name) { errEl.textContent = 'Nöis Konto: bitte a Name iigäh'; btn.disabled = false; return; }
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(cred.user, { displayName: name });
        toast('Konto erstellt für ' + name);
      } else if (err.code === 'auth/wrong-password') {
        errEl.textContent = 'Passwort stimmt nid';
        btn.disabled = false;
        return;
      } else {
        errEl.textContent = 'Fehler: ' + err.message;
        btn.disabled = false;
        return;
      }
    }
    $('login-overlay').style.display = 'none';
    $('login-pass').value = '';
  } catch (e) {
    errEl.textContent = 'Fehler bim Iiloge. Nomol probiere.';
  }
  btn.disabled = false;
}

onAuthStateChanged(auth, (user) => {
  state.user = user;
  state.isAdmin = !!user && user.email === ADMIN_EMAIL;

  if (user) {
    $('login-overlay').style.display = 'none';
    $('whoami').style.display = 'flex';
    $('whoami-name').textContent = user.displayName || user.email;
    $('admin-new-game').style.display = state.isAdmin ? 'block' : 'none';
    startSubscriptions();
  } else {
    $('whoami').style.display = 'none';
    $('login-overlay').style.display = 'flex';
    $('admin-new-game').style.display = 'none';
  }
  render();
});

// ---------- DATA ----------

let subscribed = false;
function startSubscriptions() {
  if (subscribed) return;
  subscribed = true;

  onSnapshot(query(collection(db, 'games'), orderBy('createdAt', 'desc')), (snap) => {
    state.games = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  });

  onSnapshot(collection(db, 'bets'), (snap) => {
    state.bets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  });

  onSnapshot(doc(db, 'meta', 'konto'), (snap) => {
    state.konto = (snap.exists() && snap.data().total) || 0;
    setFigure('konto-value', state.konto);
  });
}

$('ng-date').valueAsDate = new Date();
$('ng-create').addEventListener('click', createGame);

async function createGame() {
  const opponent = $('ng-opponent').value.trim();
  const date = $('ng-date').value;
  if (!opponent) { toast('Bitte Gägner iigäh'); return; }
  $('ng-create').disabled = true;
  try {
    await addDoc(collection(db, 'games'), { opponent, date, status: 'open', createdAt: Date.now() });
    $('ng-opponent').value = '';
    toast('Spiel erstellt');
  } catch (e) {
    toast('Fehler bim Erstelle: ' + e.message);
  }
  $('ng-create').disabled = false;
}

async function placeBet(gameId, inputEl) {
  const prediction = inputEl.value.trim();
  if (!prediction) { toast('Bitte Tipp iigäh'); return; }
  if (!state.user) { $('login-overlay').style.display = 'flex'; return; }
  try {
    await addDoc(collection(db, 'bets'), {
      gameId,
      userId: state.user.uid,
      userName: state.user.displayName || state.user.email,
      prediction,
      createdAt: Date.now()
    });
    inputEl.value = '';
    toast('Wett platziert – ' + BET_COST + ' Fr.');
  } catch (e) {
    toast('Fehler bi dr Wett: ' + e.message);
  }
}

async function closeGame(gameId, selectedBetIds) {
  const gameBets = state.bets.filter(b => b.gameId === gameId);
  const pot = gameBets.length * BET_COST;
  if (pot === 0) { toast('Kei Wette bi däm Spiel'); return; }
  const winners = gameBets.filter(b => selectedBetIds.includes(b.id));
  const winnerUserIds = [...new Set(winners.map(w => w.userId))];
  const hasWinner = winnerUserIds.length > 0;
  const jackpotHalf = hasWinner ? pot / 2 : 0;
  const kontoHalf = pot - jackpotHalf;
  const perWinner = hasWinner ? jackpotHalf / winnerUserIds.length : 0;

  try {
    await updateDoc(doc(db, 'games', gameId), {
      status: 'closed', closedAt: Date.now(), pot,
      winnerBetIds: selectedBetIds, winnerUserIds, jackpotHalf, kontoHalf, perWinner
    });
    const kontoRef = doc(db, 'meta', 'konto');
    const snap = await getDoc(kontoRef);
    if (snap.exists()) {
      await updateDoc(kontoRef, { total: increment(kontoHalf) });
    } else {
      await setDoc(kontoRef, { total: kontoHalf });
    }
    toast('Spiel abgschlosse');
  } catch (e) {
    toast('Fehler bim Abschliesse: ' + e.message);
  }
}

function betsForGame(gameId) {
  return state.bets.filter(b => b.gameId === gameId).sort((a, b) => a.createdAt - b.createdAt);
}

// ---------- RENDER ----------

function render() {
  if (!state.user) {
    $('open-games').innerHTML = '';
    $('closed-games').innerHTML = '';
    return;
  }

  const openGames = state.games.filter(g => g.status !== 'closed');
  const closedGames = state.games.filter(g => g.status === 'closed');

  const openPot = openGames.reduce((sum, g) => sum + betsForGame(g.id).length * BET_COST, 0);
  setFigure('jackpot-value', openPot);

  const openEl = $('open-games');
  if (openGames.length === 0) {
    openEl.innerHTML = '<div class="empty">Kei offeni Spiel im Momänt.</div>';
  } else {
    openEl.innerHTML = '';
    openGames.forEach(g => openEl.appendChild(renderOpenGame(g)));
  }

  const closedEl = $('closed-games');
  const closedTitle = $('closed-title');
  closedTitle.style.display = closedGames.length ? 'block' : 'none';
  closedEl.innerHTML = '';
  closedGames.forEach(g => closedEl.appendChild(renderClosedGame(g)));
}

function renderOpenGame(g) {
  const bets = betsForGame(g.id);
  const pot = bets.length * BET_COST;

  const card = document.createElement('div');
  card.className = 'game';

  const header = document.createElement('div');
  header.className = 'game-header';
  header.innerHTML = `
    <div>
      <div class="game-title">Gottéron &ndash; ${escapeHtml(g.opponent || '?')}</div>
      <div class="game-date">${fmtDate(g.date)}</div>
    </div>
    <div class="pot-figure">${pot}<span class="unit">Fr.</span></div>
  `;
  card.appendChild(header);

  const betsList = document.createElement('div');
  betsList.className = 'bets-list';
  bets.forEach(b => {
    const row = document.createElement('div');
    row.className = 'bet-row';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'bet-name';
    nameSpan.textContent = b.userName || 'Öpper';
    const predSpan = document.createElement('span');
    predSpan.className = 'bet-pred';
    predSpan.textContent = b.prediction + ' · ' + BET_COST + ' Fr.';
    row.appendChild(nameSpan);
    row.appendChild(predSpan);
    betsList.appendChild(row);
  });
  if (bets.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = 'var(--muted)';
    empty.style.fontSize = '0.82rem';
    empty.style.marginTop = '8px';
    empty.textContent = 'No kei Wette – sig dr Erschti.';
    betsList.appendChild(empty);
  }
  card.appendChild(betsList);

  const form = document.createElement('div');
  form.className = 'bet-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Dis Tipp, z.B. 4:2 für Gottéron';
  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.textContent = 'Wette, ' + BET_COST + ' Fr.';
  btn.addEventListener('click', () => placeBet(g.id, input));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') placeBet(g.id, input); });
  form.appendChild(input);
  form.appendChild(btn);
  card.appendChild(form);

  if (state.isAdmin) {
    const closeSection = document.createElement('div');
    closeSection.className = 'close-picker';
    closeSection.innerHTML = `<span class="hint">Als CEO: wähl wär richtig tippt het und schliess ab</span>`;
    const selected = new Set();
    bets.forEach(b => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => { cb.checked ? selected.add(b.id) : selected.delete(b.id); });
      const span = document.createElement('span');
      span.textContent = `${b.userName || 'Öpper'}: ${b.prediction}`;
      label.appendChild(cb);
      label.appendChild(span);
      closeSection.appendChild(label);
    });
    const actions = document.createElement('div');
    actions.className = 'close-actions';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-red btn-small';
    closeBtn.textContent = 'Spiel abschliesse & usszahle';
    closeBtn.addEventListener('click', () => {
      if (bets.length === 0) { toast('Kei Wette bi däm Spiel'); return; }
      closeGame(g.id, [...selected]);
    });
    actions.appendChild(closeBtn);
    closeSection.appendChild(actions);
    card.appendChild(closeSection);
  }

  return card;
}

function renderClosedGame(g) {
  const bets = betsForGame(g.id);
  const winnerBetIds = g.winnerBetIds || [];

  const card = document.createElement('div');
  card.className = 'game';
  const header = document.createElement('div');
  header.className = 'game-header';
  header.innerHTML = `
    <div>
      <div class="game-title">Gottéron &ndash; ${escapeHtml(g.opponent || '?')}</div>
      <div class="game-date">${fmtDate(g.date)}</div>
    </div>
    <span class="status-closed">Abgschlosse</span>
  `;
  card.appendChild(header);

  const betsList = document.createElement('div');
  betsList.className = 'bets-list';
  bets.forEach(b => {
    const row = document.createElement('div');
    row.className = 'bet-row' + (winnerBetIds.includes(b.id) ? ' winner' : '');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'bet-name';
    nameSpan.textContent = (b.userName || 'Öpper') + (winnerBetIds.includes(b.id) ? ' — Gwünner' : '');
    const predSpan = document.createElement('span');
    predSpan.className = 'bet-pred';
    predSpan.textContent = b.prediction + ' · ' + BET_COST + ' Fr.';
    row.appendChild(nameSpan);
    row.appendChild(predSpan);
    betsList.appendChild(row);
  });
  card.appendChild(betsList);

  const summary = document.createElement('div');
  summary.className = 'closed-summary';
  const pot = g.pot || bets.length;
  const perWinner = g.perWinner || 0;
  const winnerCount = (g.winnerUserIds || []).length;
  summary.innerHTML = winnerCount > 0
    ? `Topf <b>${pot} Fr.</b> &nbsp;&middot;&nbsp; Jackpot <b>${fmtFr(g.jackpotHalf || pot / 2)} Fr.</b> für ${winnerCount} Gwünner, je <b>${fmtFr(perWinner)} Fr.</b> &nbsp;&middot;&nbsp; Bierkässeli <b>${fmtFr(g.kontoHalf || pot / 2)} Fr.</b>`
    : `Topf <b>${pot} Fr.</b> &nbsp;&middot;&nbsp; Kein Gwünner &ndash; ganzi <b>${fmtFr(pot)} Fr.</b> gö is Bierkässeli`;
  card.appendChild(summary);

  return card;
}
