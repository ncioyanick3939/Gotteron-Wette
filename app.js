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

const state = { user: null, isAdmin: false, games: [], bets: [], konto: 0 };
let authMode = 'login'; // or 'register'

function $(id) { return document.getElementById(id); }

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 2400);
}
function fmtFr(n) { const r = Math.round(n*100)/100; return r%1===0 ? String(r) : r.toFixed(2); }
function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d+'T00:00:00').toLocaleDateString('de-CH',{weekday:'short',day:'2-digit',month:'2-digit'}); }
  catch(e) { return d; }
}
function escHtml(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function setFig(id,n) { $(id).innerHTML = fmtFr(n)+'<span class="unit">Fr.</span>'; }
function initials(name) { return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function avatarColor(name) {
  let h=0; for(let i=0;i<(name||'').length;i++) h=name.charCodeAt(i)+((h<<5)-h);
  const colors=['#e52535','#3b82f6','#22c55e','#f5a623','#a855f7','#ec4899','#14b8a6','#f97316'];
  return colors[Math.abs(h)%colors.length];
}

// ---- AUTH TABS ----
$('tab-login').addEventListener('click', () => switchTab('login'));
$('tab-register').addEventListener('click', () => switchTab('register'));

function switchTab(mode) {
  authMode = mode;
  $('tab-login').classList.toggle('active', mode==='login');
  $('tab-register').classList.toggle('active', mode==='register');
  $('login-name').style.display = mode==='register' ? 'block' : 'none';
  $('login-btn').textContent = mode==='register' ? 'Registriere' : 'Iilogge';
  $('login-error').textContent = '';
}

$('login-btn').addEventListener('click', submitAuth);
$('login-pass').addEventListener('keydown', e => { if(e.key==='Enter') submitAuth(); });
$('logout-btn').addEventListener('click', () => signOut(auth));

async function submitAuth() {
  const name = $('login-name').value.trim();
  const email = $('login-email').value.trim().toLowerCase();
  const pass = $('login-pass').value;
  const err = $('login-error');
  err.textContent = '';

  if (!email||!pass) { err.textContent='Bitte Email und Passwort iigäh'; return; }

  const btn = $('login-btn');
  btn.disabled = true;
  try {
    if (authMode === 'register') {
      if (!name) { err.textContent='Bitte Name iigäh'; btn.disabled=false; return; }
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      toast('Konto erstellt! Willkomme, '+name);
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
    $('login-pass').value = '';
  } catch(e) {
    if (e.code==='auth/user-not-found'||e.code==='auth/invalid-credential') {
      err.textContent = 'Email oder Passwort falsch. Nöis Konto? → Registriere';
    } else if (e.code==='auth/email-already-in-use') {
      err.textContent = 'Die Email isch scho registriert. Probier "Iilogge"';
    } else if (e.code==='auth/weak-password') {
      err.textContent = 'Passwort z\'churz – mindestens 6 Zeiche';
    } else {
      err.textContent = 'Fehler: ' + (e.message||'Unbekannt');
    }
  }
  btn.disabled = false;
}

onAuthStateChanged(auth, user => {
  state.user = user;
  state.isAdmin = !!user && user.email === ADMIN_EMAIL;

  if (user) {
    $('auth-overlay').style.display = 'none';
    $('nav').style.display = 'flex';
    $('overview-wrap').style.display = 'grid';
    $('whoami-name').textContent = user.displayName || user.email;
    $('admin-new-game').style.display = state.isAdmin ? 'block' : 'none';
    startSubs();
  } else {
    $('auth-overlay').style.display = 'flex';
    $('nav').style.display = 'none';
    $('overview-wrap').style.display = 'none';
    $('admin-new-game').style.display = 'none';
  }
  render();
});

// ---- DATA ----
let subbed = false;
function startSubs() {
  if (subbed) return; subbed = true;
  onSnapshot(query(collection(db,'games'),orderBy('createdAt','desc')), snap => {
    state.games = snap.docs.map(d=>({id:d.id,...d.data()})); render();
  });
  onSnapshot(collection(db,'bets'), snap => {
    state.bets = snap.docs.map(d=>({id:d.id,...d.data()})); render();
  });
  onSnapshot(doc(db,'meta','konto'), snap => {
    state.konto = (snap.exists() && snap.data().total)||0; setFig('konto-value',state.konto);
  });
}

$('ng-date').valueAsDate = new Date();
$('ng-create').addEventListener('click', async () => {
  const opp=$('ng-opponent').value.trim(), date=$('ng-date').value;
  if(!opp){toast('Bitte Gägner iigäh');return;}
  $('ng-create').disabled=true;
  try { await addDoc(collection(db,'games'),{opponent:opp,date,status:'open',createdAt:Date.now()}); $('ng-opponent').value=''; toast('Spiel erstellt'); }
  catch(e){toast('Fehler: '+e.message);}
  $('ng-create').disabled=false;
});

async function placeBet(gameId, inputEl) {
  const pred=inputEl.value.trim();
  if(!pred){toast('Bitte Tipp iigäh');return;}
  if(!state.user){$('auth-overlay').style.display='flex';return;}
  try {
    await addDoc(collection(db,'bets'),{gameId,userId:state.user.uid,userName:state.user.displayName||state.user.email,prediction:pred,createdAt:Date.now()});
    inputEl.value=''; toast('Wett platziert – '+BET_COST+' Fr.');
  } catch(e){toast('Fehler: '+e.message);}
}

async function closeGame(gameId, selectedBetIds) {
  const gb=state.bets.filter(b=>b.gameId===gameId), pot=gb.length*BET_COST;
  if(!pot){toast('Kei Wette');return;}
  const winners=gb.filter(b=>selectedBetIds.includes(b.id));
  const wuids=[...new Set(winners.map(w=>w.userId))];
  const hasW=wuids.length>0, jh=hasW?pot/2:0, kh=pot-jh, pw=hasW?jh/wuids.length:0;
  try {
    await updateDoc(doc(db,'games',gameId),{status:'closed',closedAt:Date.now(),pot,winnerBetIds:selectedBetIds,winnerUserIds:wuids,jackpotHalf:jh,kontoHalf:kh,perWinner:pw});
    const kr=doc(db,'meta','konto'), ks=await getDoc(kr);
    ks.exists() ? await updateDoc(kr,{total:increment(kh)}) : await setDoc(kr,{total:kh});
    toast('Spiel abgschlosse');
  } catch(e){toast('Fehler: '+e.message);}
}

function betsFor(gid) { return state.bets.filter(b=>b.gameId===gid).sort((a,b)=>a.createdAt-b.createdAt); }

// ---- RENDER ----
function render() {
  if(!state.user){$('open-games').innerHTML='';$('closed-games').innerHTML='';$('notifs').innerHTML='';return;}
  const og=state.games.filter(g=>g.status!=='closed'), cg=state.games.filter(g=>g.status==='closed');
  setFig('jackpot-value', og.reduce((s,g)=>s+betsFor(g.id).length*BET_COST,0));

  renderNotifs(cg);

  const oe=$('open-games');
  if(!og.length){oe.innerHTML='<div class="empty">Kei offeni Spiel im Momänt.</div>';}
  else{oe.innerHTML='';og.forEach(g=>oe.appendChild(mkOpen(g)));}

  const ce=$('closed-games');
  $('closed-section').style.display=cg.length?'block':'none';
  ce.innerHTML=''; cg.forEach(g=>ce.appendChild(mkClosed(g)));
}

// ---- TWINT NOTIFICATIONS ----
const dismissedGames = new Set();

function renderNotifs(closedGames) {
  const wrap = $('notifs');
  wrap.innerHTML = '';
  if (!state.user) return;
  const uid = state.user.uid;

  closedGames.forEach(g => {
    if (dismissedGames.has(g.id)) return;
    const myBets = betsFor(g.id).filter(b => b.userId === uid);
    if (!myBets.length) return; // user didn't bet on this game

    const winnerBetIds = g.winnerBetIds || [];
    const winnerUserIds = g.winnerUserIds || [];
    const iWon = winnerUserIds.includes(uid);
    const pot = g.pot || 0;
    const perWinner = g.perWinner || 0;
    const myTotalBet = myBets.length * BET_COST;

    // Find winner names from bets
    const winnerNames = [...new Set(
      betsFor(g.id).filter(b => winnerBetIds.includes(b.id)).map(b => b.userName || 'Öpper')
    )];

    // Find loser names (people who bet but didn't win)
    const loserEntries = betsFor(g.id).filter(b => !winnerUserIds.includes(b.userId));
    const loserNames = [...new Set(loserEntries.map(b => b.userName || 'Öpper'))];

    const notif = document.createElement('div');

    if (iWon) {
      // WINNER notification
      notif.className = 'notif win';
      notif.innerHTML = `
        <div class="notif-icon">🏆</div>
        <div class="notif-body">
          <div class="title">Gottéron vs ${escHtml(g.opponent)} – Du hesch gwunne!</div>
          <div>Du überchunnsch <span class="twint-amount">${fmtFr(perWinner)} Fr.</span></div>
          <div class="detail">${loserNames.length ? loserNames.join(', ') + ' schulde dir Twint-Zahlige.' : 'Kei Verlierer zum Iizahle.'}</div>
        </div>
        <button class="notif-close" data-gid="${g.id}">&times;</button>
      `;
    } else if (winnerNames.length > 0) {
      // LOSER notification – must pay winners
      const numWinners = winnerUserIds.length;
      const myShare = myTotalBet; // what I owe total (my bets go into the pot)
      // Each loser pays proportionally to winners
      // Simple: total jackpot half / number of losers who bet
      const totalLosers = betsFor(g.id).filter(b => !winnerUserIds.includes(b.userId));
      const totalLoserBets = totalLosers.length;
      const totalBets = betsFor(g.id).length;
      // Each person twinsts their bet amount to the winner(s)
      // Winners get jackpotHalf split evenly
      // So losers collectively pay jackpotHalf
      // Each loser's share: (their bets / total loser bets) * jackpotHalf
      const jackpotHalf = g.jackpotHalf || pot / 2;
      const myPayment = totalLoserBets > 0 ? (myBets.length / totalLoserBets) * jackpotHalf : 0;
      const perPerson = numWinners > 0 ? myPayment / numWinners : 0;

      notif.className = 'notif pay';
      notif.innerHTML = `
        <div class="notif-icon">💸</div>
        <div class="notif-body">
          <div class="title">Gottéron vs ${escHtml(g.opponent)} – Leider nid gwunne</div>
          <div>Twint <span class="twint-amount">${fmtFr(perPerson)} Fr.</span> a ${winnerNames.length === 1 ? '' : 'je '}${winnerNames.map(n => '<b>' + escHtml(n) + '</b>').join(' und ')}</div>
          <div class="detail">Dis Iisatz: ${myTotalBet} Fr. (${myBets.length} Wett${myBets.length > 1 ? 'e' : ''})</div>
        </div>
        <button class="notif-close" data-gid="${g.id}">&times;</button>
      `;
    } else {
      // No winner
      notif.className = 'notif neutral';
      notif.innerHTML = `
        <div class="notif-icon">🍻</div>
        <div class="notif-body">
          <div class="title">Gottéron vs ${escHtml(g.opponent)} – Kein Gwünner</div>
          <div class="detail">Ganzi ${pot} Fr. gö is Bierkässeli. Dis Iisatz: ${myTotalBet} Fr.</div>
        </div>
        <button class="notif-close" data-gid="${g.id}">&times;</button>
      `;
    }

    notif.querySelector('.notif-close').addEventListener('click', () => {
      dismissedGames.add(g.id);
      notif.remove();
    });

    wrap.appendChild(notif);
  });
}

function mkOpen(g) {
  const bets=betsFor(g.id), pot=bets.length*BET_COST;
  const card=document.createElement('div'); card.className='game';
  card.innerHTML=`<div class="game-top"><div class="game-info"><div class="matchup">Gottéron<span class="vs">vs</span>${escHtml(g.opponent||'?')}</div><div class="date">${fmtDate(g.date)}</div></div><div class="game-pot"><div class="amount">${pot}<span class="unit">Fr.</span></div><div class="label">Jackpot</div></div></div>`;

  if(bets.length) {
    const bl=document.createElement('div'); bl.className='game-bets';
    bets.forEach(b=>{
      const r=document.createElement('div'); r.className='bet-row';
      const n=b.userName||'Öpper';
      r.innerHTML=`<div class="left"><div class="bet-avatar" style="background:${avatarColor(n)}">${initials(n)}</div><span class="bet-user">${escHtml(n)}</span></div><div class="bet-right"><div class="bet-pred">${escHtml(b.prediction)}</div><div class="bet-amount">${BET_COST} Fr.</div></div>`;
      bl.appendChild(r);
    });
    card.appendChild(bl);
  } else {
    const em=document.createElement('div'); em.className='game-empty'; em.textContent='No kei Wette – sig dr Erschti.'; card.appendChild(em);
  }

  const form=document.createElement('div'); form.className='game-form';
  const inp=document.createElement('input'); inp.type='text'; inp.placeholder='Dis Tipp, z.B. 4:2';
  const btn=document.createElement('button'); btn.textContent='Wette · '+BET_COST+' Fr.';
  btn.addEventListener('click',()=>placeBet(g.id,inp));
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')placeBet(g.id,inp);});
  form.appendChild(inp); form.appendChild(btn); card.appendChild(form);

  if(state.isAdmin) {
    const cp=document.createElement('div'); cp.className='close-picker';
    cp.innerHTML='<div class="hint">Admin: Gwünner uswähle und Spiel abschliesse</div>';
    const sel=new Set();
    bets.forEach(b=>{
      const lb=document.createElement('label');
      const cb=document.createElement('input'); cb.type='checkbox';
      cb.addEventListener('change',()=>{cb.checked?sel.add(b.id):sel.delete(b.id);});
      const sp=document.createElement('span'); sp.textContent=`${b.userName||'?'}: ${b.prediction}`;
      lb.appendChild(cb); lb.appendChild(sp); cp.appendChild(lb);
    });
    const ac=document.createElement('div'); ac.className='close-actions';
    const cb=document.createElement('button'); cb.textContent='Abschliesse & Jackpot usszahle';
    cb.addEventListener('click',()=>{if(!bets.length){toast('Kei Wette');return;} closeGame(g.id,[...sel]);});
    ac.appendChild(cb); cp.appendChild(ac); card.appendChild(cp);
  }
  return card;
}

function mkClosed(g) {
  const bets=betsFor(g.id), wids=g.winnerBetIds||[];
  const card=document.createElement('div'); card.className='game';
  card.innerHTML=`<div class="game-top"><div class="game-info"><div class="matchup">Gottéron<span class="vs">vs</span>${escHtml(g.opponent||'?')}</div><div class="date">${fmtDate(g.date)}</div></div><span class="status-closed">Abgschlosse</span></div>`;

  if(bets.length) {
    const bl=document.createElement('div'); bl.className='game-bets';
    bets.forEach(b=>{
      const isW=wids.includes(b.id), n=b.userName||'Öpper';
      const r=document.createElement('div'); r.className='bet-row'+(isW?' winner':'');
      r.innerHTML=`<div class="left"><div class="bet-avatar" style="background:${avatarColor(n)}">${initials(n)}</div><span class="bet-user">${escHtml(n)}${isW?' 🏆':''}</span></div><div class="bet-right"><div class="bet-pred">${escHtml(b.prediction)}</div><div class="bet-amount">${BET_COST} Fr.</div></div>`;
      bl.appendChild(r);
    });
    card.appendChild(bl);
  }

  const sm=document.createElement('div'); sm.className='closed-summary';
  const pot=g.pot||bets.length, pw=g.perWinner||0, wc=(g.winnerUserIds||[]).length;
  sm.innerHTML=wc>0
    ?`Topf <b>${pot} Fr.</b> · Jackpot <b>${fmtFr(g.jackpotHalf||pot/2)} Fr.</b> für ${wc} Gwünner, je <b>${fmtFr(pw)} Fr.</b> · Bierkässeli <b>${fmtFr(g.kontoHalf||pot/2)} Fr.</b>`
    :`Topf <b>${pot} Fr.</b> · Kein Gwünner – ganzi <b>${fmtFr(pot)} Fr.</b> is Bierkässeli`;
  card.appendChild(sm);
  return card;
}
