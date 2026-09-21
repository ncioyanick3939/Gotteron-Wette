import { firebaseConfig, ADMIN_EMAIL, BET_COST } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDoc, onSnapshot, query, orderBy, increment } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const state = { user:null, isAdmin:false, games:[], bets:[], konto:0, prevJackpot:0 };
const TROPHY_MIN = 10;
window._authMode = 'login';

// ============ HELPERS ============
const $ = id => document.getElementById(id);
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2600)}
function fmtFr(n){const r=Math.round(n*100)/100;return r%1===0?String(r):r.toFixed(2)}
function fmtDate(d){if(!d)return'';try{return new Date(d+'T00:00:00').toLocaleDateString('de-CH',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'})}catch(e){return d}}
function esc(s){const d=document.createElement('div');d.textContent=s??'';return d.innerHTML}
function initials(n){return(n||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
function avatarColor(n){let h=0;for(let i=0;i<(n||'').length;i++)h=n.charCodeAt(i)+((h<<5)-h);const c=['#e52535','#3b82f6','#22c55e','#f5b731','#a855f7','#ec4899','#14b8a6','#f97316','#06b6d4','#84cc16'];return c[Math.abs(h)%c.length]}

function daysUntil(dateStr){
  if(!dateStr)return null;
  const today=new Date();today.setHours(0,0,0,0);
  const target=new Date(dateStr+'T00:00:00');
  return Math.round((target-today)/86400000);
}
function countdownText(d){
  if(d===null)return'';
  if(d<0)return'⏱ Spiel isch verbi – warte uf Uswärtig';
  if(d===0)return'🔴 HÜT ISCH SPIELTAG!';
  if(d===1)return'⏰ Morn geits los!';
  return`📅 no ${d} Täg`;
}

// Animated number counter
function animateFigure(id,target,unit='Fr.'){
  const el=$(id);const from=parseFloat(el.dataset.val||0);
  const dur=800,start=performance.now();
  function tick(now){
    const p=Math.min((now-start)/dur,1);const ease=1-Math.pow(1-p,3);
    const cur=from+(target-from)*ease;
    el.innerHTML=fmtFr(cur)+'<span class="unit">'+unit+'</span>';
    if(p<1)requestAnimationFrame(tick);else el.dataset.val=target;
  }
  requestAnimationFrame(tick);
}

// ============ CONFETTI ============
function confetti(count=120){
  const colors=['#e52535','#ffffff','#f5b731','#ff3a4a','#22c55e'];
  for(let i=0;i<count;i++){
    const p=document.createElement('div');p.className='confetti-piece';
    p.style.left=Math.random()*100+'vw';
    p.style.background=colors[Math.floor(Math.random()*colors.length)];
    p.style.animationDuration=(2+Math.random()*2)+'s';
    p.style.animationDelay=Math.random()*.5+'s';
    p.style.borderRadius=Math.random()>.5?'50%':'2px';
    p.style.transform=`rotate(${Math.random()*360}deg)`;
    document.body.appendChild(p);
    setTimeout(()=>p.remove(),5000);
  }
}

// ============ CHANTS ============
const CHANTS=['HOPP GOTTÉRON! 🔴⚪','ALLEZ LES DRAGONS! 🐉','FRIBOURG! FRIBOURG! 📣','WIR SIND GOTTÉRON! 💪','HOPP HOPP HOPP! 🏒','GOTTÉRON MEISTER! 🏆','VAMOS DRAGONS! 🔥','DRAGONS ON FIRE! 🐲'];
function showChant(){
  const b=$('chant-bubble');b.textContent=CHANTS[Math.floor(Math.random()*CHANTS.length)];
  b.classList.add('show');confetti(40);
  setTimeout(()=>b.classList.remove('show'),1500);
}

// ============ TAUNTS ============
const BET_TOASTS=['Wett platziert! 🎯','Mutig! 💪','Das gaht uf! 🚀','Gueti Wahl! 🔥','Jetz wird\'s ernst! 😤','Dr Jackpot wachst! 💰','Hopp Gottéron! 🏒','Vertrau dim Bauch! 🎲'];

// ============ AUTH ============
$('login-btn').addEventListener('click',submitAuth);
$('login-pass').addEventListener('keydown',e=>{if(e.key==='Enter')submitAuth()});
$('logout-btn').addEventListener('click',()=>signOut(auth));
$('chant-btn').addEventListener('click',showChant);

async function submitAuth(){
  const name=$('login-name').value.trim(),email=$('login-email').value.trim().toLowerCase(),pass=$('login-pass').value,err=$('login-error');
  err.textContent='';
  if(!email||!pass){err.textContent='Bitte Email und Passwort iigäh';return}
  const btn=$('login-btn');btn.disabled=true;
  try{
    if(window._authMode==='register'){
      if(!name){err.textContent='Bitte Name iigäh';btn.disabled=false;return}
      const cred=await createUserWithEmailAndPassword(auth,email,pass);
      await updateProfile(cred.user,{displayName:name});
      confetti(80);toast('Willkomme im Team, '+name+'! 🎉');
    } else await signInWithEmailAndPassword(auth,email,pass);
    $('login-pass').value='';
  }catch(e){
    if(e.code==='auth/user-not-found'||e.code==='auth/invalid-credential')err.textContent='Email oder Passwort falsch 🤔';
    else if(e.code==='auth/email-already-in-use')err.textContent='Email scho registriert – gah uf "Iilogge"';
    else if(e.code==='auth/weak-password')err.textContent='Passwort z\'churz (min. 6 Zeiche)';
    else if(e.code==='auth/invalid-email')err.textContent='Ungültigi Email-Adrässe';
    else err.textContent='Fehler: '+(e.message||'Unbekannt');
  }
  btn.disabled=false;
}

onAuthStateChanged(auth,user=>{
  state.user=user;state.isAdmin=!!user&&user.email===ADMIN_EMAIL;
  if(user){
    $('auth-overlay').style.display='none';$('app-content').style.display='block';
    $('whoami-name').textContent=(state.isAdmin?'👔 ':'')+(user.displayName||user.email);
    $('admin-new-game').style.display=state.isAdmin?'block':'none';
    startSubs();
  }else{$('auth-overlay').style.display='flex';$('app-content').style.display='none'}
  render();
});

// ============ DATA ============
let subbed=false;
function startSubs(){
  if(subbed)return;subbed=true;
  onSnapshot(query(collection(db,'games'),orderBy('createdAt','desc')),s=>{state.games=s.docs.map(d=>({id:d.id,...d.data()}));render()});
  onSnapshot(collection(db,'bets'),s=>{state.bets=s.docs.map(d=>({id:d.id,...d.data()}));render()});
  onSnapshot(doc(db,'meta','konto'),s=>{state.konto=(s.exists()&&s.data().total)||0;animateFigure('konto-value',state.konto)});
}

$('ng-date').valueAsDate=new Date();
$('ng-create').addEventListener('click',async()=>{
  const o=$('ng-opponent').value.trim(),d=$('ng-date').value;
  if(!o){toast('Bitte Gägner iigäh');return}
  $('ng-create').disabled=true;
  try{await addDoc(collection(db,'games'),{opponent:o,date:d,status:'open',createdAt:Date.now()});$('ng-opponent').value='';toast('Spiel eröffnet! Los gahts 🏒')}catch(e){toast('Fehler: '+e.message)}
  $('ng-create').disabled=false;
});

async function placeBet(gid,inp){
  const p=inp.value.trim();
  if(!p){toast('Bitte Tipp iigäh 👆');inp.focus();return}
  if(!state.user)return;
  try{
    await addDoc(collection(db,'bets'),{gameId:gid,userId:state.user.uid,userName:state.user.displayName||state.user.email,prediction:p,createdAt:Date.now()});
    inp.value='';
    toast(BET_TOASTS[Math.floor(Math.random()*BET_TOASTS.length)]+' – '+BET_COST+' Fr.');
    // Check for trophy milestone
    const myCount=state.bets.filter(b=>b.userId===state.user.uid).length+1;
    if(myCount===TROPHY_MIN){setTimeout(()=>{confetti(150);toast('🏆 POKAL VERDIENT! '+TROPHY_MIN+' Wette!')},600)}
    else if(myCount===1){setTimeout(()=>toast('🎯 Dini erschti Wett – willkomme!'),500)}
  }catch(e){toast('Fehler: '+e.message)}
}

async function closeGame(gid,selIds){
  const gb=state.bets.filter(b=>b.gameId===gid),pot=gb.length*BET_COST;
  if(!pot){toast('Kei Wette bi däm Spiel');return}
  const w=gb.filter(b=>selIds.includes(b.id)),wu=[...new Set(w.map(x=>x.userId))];
  const hasW=wu.length>0,jh=hasW?pot/2:0,kh=pot-jh,pw=hasW?jh/wu.length:0;
  try{
    await updateDoc(doc(db,'games',gid),{status:'closed',closedAt:Date.now(),pot,winnerBetIds:selIds,winnerUserIds:wu,jackpotHalf:jh,kontoHalf:kh,perWinner:pw});
    const kr=doc(db,'meta','konto'),ks=await getDoc(kr);
    ks.exists()?await updateDoc(kr,{total:increment(kh)}):await setDoc(kr,{total:kh});
    confetti(100);toast(hasW?'🏆 Spiel abgschlosse – Gwünner sind bekannt!':'🍻 Alles is Bierkässeli!');
  }catch(e){toast('Fehler: '+e.message)}
}

const betsFor=gid=>state.bets.filter(b=>b.gameId===gid).sort((a,b)=>a.createdAt-b.createdAt);

// ============ USER STATS ============
function userStats(uid){
  const my=state.bets.filter(b=>b.userId===uid);
  const closed=state.games.filter(g=>g.status==='closed');
  let wins=0,earned=0,spent=my.length*BET_COST;
  closed.forEach(g=>{if((g.winnerUserIds||[]).includes(uid)){wins++;earned+=g.perWinner||0}});
  const gamesPlayed=new Set(my.map(b=>b.gameId)).size;
  return{bets:my.length,wins,earned,spent,gamesPlayed,net:earned-spent};
}

function badges(uid,stats,rank){
  const b=[];
  if(stats.bets>=TROPHY_MIN)b.push('🏆');
  if(rank===0&&stats.bets>0)b.push('👑');
  if(stats.wins>=3)b.push('🍀');
  if(stats.wins>=1&&stats.wins===stats.gamesPlayed&&stats.gamesPlayed>=2)b.push('🎯');
  if(stats.bets>=25)b.push('🔥');
  if(stats.net>0)b.push('💰');
  return b.join('');
}

// ============ RENDER ============
function render(){
  if(!state.user){['open-games','closed-games','notifs','leaderboard'].forEach(i=>$(i).innerHTML='');return}
  const og=state.games.filter(g=>g.status!=='closed'),cg=state.games.filter(g=>g.status==='closed');
  const jp=og.reduce((s,g)=>s+betsFor(g.id).length*BET_COST,0);
  animateFigure('jackpot-value',jp);
  $('jackpot-sub').textContent=og.length?`${og.length} offeni Spiel · ${og.reduce((s,g)=>s+betsFor(g.id).length,0)} Wette`:'kei offeni Spiel';
  $('konto-sub').textContent=state.konto>0?`🍻 ca. ${Math.floor(state.konto/6)} Bier`:'🍻 fürs Saisonändi';

  // My stats in nav
  const ms=userStats(state.user.uid);
  $('my-stats').innerHTML=`<span><b>${ms.bets}</b> Wette</span><span><b>${ms.wins}</b> Sieg${ms.wins===1?'':'e'}</span><span style="color:${ms.net>=0?'var(--green)':'var(--accent2)'}"><b>${ms.net>=0?'+':''}${fmtFr(ms.net)}</b> Fr.</span>`;

  renderNotifs(cg);renderLeaderboard();

  $('open-count').textContent=og.length||'';
  const oe=$('open-games');
  if(!og.length)oe.innerHTML='<div class="empty"><div class="big">😴</div>Kei offeni Spiel im Momänt.<br>Dr CEO mues zersch eis eröffne!</div>';
  else{oe.innerHTML='';og.forEach(g=>oe.appendChild(mkOpen(g)))}

  $('closed-count').textContent=cg.length||'';
  const ce=$('closed-games');$('closed-section').style.display=cg.length?'flex':'none';
  ce.innerHTML='';cg.forEach(g=>ce.appendChild(mkClosed(g)));
}

// ============ LEADERBOARD ============
function renderLeaderboard(){
  const wrap=$('leaderboard');
  if(!state.bets.length){wrap.innerHTML='';$('lb-section').style.display='none';return}
  $('lb-section').style.display='flex';
  const users={};
  state.bets.forEach(b=>{if(!users[b.userId])users[b.userId]={name:b.userName||'Öpper'}});
  const rows=Object.entries(users).map(([uid,u])=>({uid,name:u.name,...userStats(uid)}));
  rows.sort((a,b)=>b.bets-a.bets||b.wins-a.wins);
  const max=rows[0]?.bets||1;
  $('lb-count').textContent=rows.length+' Spieler';
  let html='';
  rows.forEach((r,i)=>{
    const isMe=r.uid===state.user.uid,pct=Math.round(r.bets/max*100),bd=badges(r.uid,r,i);
    const toTrophy=TROPHY_MIN-r.bets;
    html+=`<div class="lb-row${isMe?' me':''}">
      <div class="lb-rank r${i+1}">${i+1}</div>
      <div class="lb-avatar" style="background:${avatarColor(r.name)}">${initials(r.name)}</div>
      <div class="lb-info">
        <div class="lb-name">${esc(r.name)}${isMe?' <span style="font-size:.65rem;color:var(--accent)">DU</span>':''} <span class="lb-badges">${bd}</span></div>
        <div class="lb-meta"><span class="wins">${r.wins} Sieg${r.wins===1?'':'e'}</span><span>${r.spent} Fr. gsetzt</span><span style="color:${r.net>=0?'var(--green)':'var(--accent2)'}">${r.net>=0?'+':''}${fmtFr(r.net)} Fr.</span></div>
        <div class="lb-bar"><div class="lb-bar-fill" style="width:${pct}%"></div></div>
      </div>
      <div><div class="lb-count">${r.bets}<small>Wette</small></div>${toTrophy>0?`<div class="lb-trophy-progress">no ${toTrophy} bis 🏆</div>`:''}</div>
    </div>`;
  });
  wrap.innerHTML=`<div class="leaderboard">${html}</div>`;
}

// ============ NOTIFICATIONS ============
const dismissed=new Set(JSON.parse(localStorage.getItem('gott_dismissed')||'[]'));
function dismiss(id){dismissed.add(id);localStorage.setItem('gott_dismissed',JSON.stringify([...dismissed]))}
let celebratedWins=new Set(JSON.parse(localStorage.getItem('gott_celebrated')||'[]'));

function renderNotifs(cg){
  const w=$('notifs');w.innerHTML='';if(!state.user)return;
  const uid=state.user.uid;
  cg.forEach(g=>{
    if(dismissed.has(g.id))return;
    const my=betsFor(g.id).filter(b=>b.userId===uid);if(!my.length)return;
    const wbids=g.winnerBetIds||[],wuids=g.winnerUserIds||[],iWon=wuids.includes(uid);
    const pot=g.pot||0,pw=g.perWinner||0,myTotal=my.length*BET_COST;
    const wNames=[...new Set(betsFor(g.id).filter(b=>wbids.includes(b.id)).map(b=>b.userName||'?'))];
    const losers=betsFor(g.id).filter(b=>!wuids.includes(b.userId));
    const lNames=[...new Set(losers.map(b=>b.userName||'?'))];
    const n=document.createElement('div');
    if(iWon){
      if(!celebratedWins.has(g.id)){celebratedWins.add(g.id);localStorage.setItem('gott_celebrated',JSON.stringify([...celebratedWins]));setTimeout(()=>confetti(200),300)}
      n.className='notif win';
      n.innerHTML=`<div class="notif-icon">🏆</div><div class="notif-body"><div class="title">GWUNNE! Gottéron vs ${esc(g.opponent)}</div><div>Du überchunnsch <span class="twint-amount">${fmtFr(pw)} Fr.</span></div><div class="detail">${lNames.length?'💸 '+lNames.join(', ')+' schulde dir Twint.':'Kei Verlierer – alli hend gwunne!'}</div></div><button class="notif-close">&times;</button>`;
    }else if(wNames.length){
      const jh=g.jackpotHalf||pot/2,tl=losers.length||1;
      const myPay=(my.length/tl)*jh,perP=wuids.length?myPay/wuids.length:0;
      n.className='notif pay';
      n.innerHTML=`<div class="notif-icon">💸</div><div class="notif-body"><div class="title">Gottéron vs ${esc(g.opponent)} – Leider nid gwunne</div><div>Twint <span class="twint-amount">${fmtFr(perP)} Fr.</span> a ${wNames.length===1?'':'je '}${wNames.map(x=>'<b>'+esc(x)+'</b>').join(' und ')}</div><div class="detail">Dis Iisatz: ${myTotal} Fr. · Nächschts Mal klappt's! 💪</div></div><button class="notif-close">&times;</button>`;
    }else{
      n.className='notif neutral';
      n.innerHTML=`<div class="notif-icon">🍻</div><div class="notif-body"><div class="title">Gottéron vs ${esc(g.opponent)} – Kein Gwünner</div><div class="detail">${pot} Fr. gö is Bierkässeli. Dis Iisatz: ${myTotal} Fr. Prost! 🍺</div></div><button class="notif-close">&times;</button>`;
    }
    n.querySelector('.notif-close').addEventListener('click',()=>{dismiss(g.id);n.remove()});
    w.appendChild(n);
  });
}

// ============ GAME CARDS ============
const QUICK=['3:1','4:2','2:1','5:3','3:2','1:2','2:3','4:3'];

function mkOpen(g){
  const bets=betsFor(g.id),pot=bets.length*BET_COST,uid=state.user.uid;
  const d=daysUntil(g.date),cd=countdownText(d);
  const bettors=new Set(bets.map(b=>b.userId)).size;
  const c=document.createElement('div');c.className='game open';
  c.innerHTML=`<div class="game-top"><div class="game-info"><div class="matchup">Gottéron <span class="vs">VS</span> ${esc(g.opponent||'?')}</div><div class="date">${fmtDate(g.date)}</div>${cd?`<div class="countdown">${cd}</div>`:''}</div><div class="game-pot"><div class="amount">${pot}<span class="unit">Fr.</span></div><div class="label">Jackpot</div><div class="bettors">${bettors} Spieler · ${bets.length} Wette</div></div></div>`;

  if(bets.length){
    const bl=document.createElement('div');bl.className='game-bets';
    bets.forEach(b=>{const r=document.createElement('div');r.className='bet-row';const n=b.userName||'?';r.innerHTML=`<div class="left"><div class="bet-avatar" style="background:${avatarColor(n)}">${initials(n)}</div><span class="bet-user">${esc(n)}${b.userId===uid?'<span class="me-tag">DU</span>':''}</span></div><div class="bet-right"><div class="bet-pred">${esc(b.prediction)}</div><div class="bet-amount">${BET_COST} Fr.</div></div>`;bl.appendChild(r)});
    c.appendChild(bl);
  }else{const e=document.createElement('div');e.className='game-empty';e.textContent='🎲 No kei Wette – sig dr Erschti und setz dr Ton!';c.appendChild(e)}

  const qp=document.createElement('div');qp.className='quick-picks';
  qp.innerHTML='<div class="label">⚡ Quick-Tipp (Gottéron : Gägner)</div>';
  const inp=document.createElement('input');inp.type='text';inp.placeholder='oder eige Tipp, z.B. 4:2';
  QUICK.forEach(q=>{const b=document.createElement('button');b.className='qp';b.textContent=q;b.addEventListener('click',()=>{inp.value=q;inp.focus()});qp.appendChild(b)});
  c.appendChild(qp);

  const f=document.createElement('div');f.className='game-form';
  const btn=document.createElement('button');btn.textContent='🎯 Wette · '+BET_COST+' Fr.';
  btn.addEventListener('click',()=>placeBet(g.id,inp));inp.addEventListener('keydown',e=>{if(e.key==='Enter')placeBet(g.id,inp)});
  f.appendChild(inp);f.appendChild(btn);c.appendChild(f);

  if(state.isAdmin){
    const cp=document.createElement('div');cp.className='close-picker';cp.innerHTML='<div class="hint">👔 CEO: Gwünner uswähle</div>';const sel=new Set();
    if(!bets.length)cp.innerHTML+='<div style="color:var(--muted);font-size:.82rem">No kei Wette zum uswähle</div>';
    bets.forEach(b=>{const lb=document.createElement('label');const cb=document.createElement('input');cb.type='checkbox';cb.addEventListener('change',()=>{cb.checked?sel.add(b.id):sel.delete(b.id)});const sp=document.createElement('span');sp.textContent=`${b.userName||'?'} → ${b.prediction}`;lb.appendChild(cb);lb.appendChild(sp);cp.appendChild(lb)});
    const ac=document.createElement('div');ac.className='close-actions';const cb=document.createElement('button');cb.textContent='🏁 Spiel abschliesse & Jackpot usszahle';cb.addEventListener('click',()=>{if(!bets.length){toast('Kei Wette');return}if(!confirm(sel.size?`${sel.size} Gwünner uswählt. Abschliesse?`:'Kei Gwünner uswählt – ganze Topf is Bierkässeli. Sicher?'))return;closeGame(g.id,[...sel])});ac.appendChild(cb);cp.appendChild(ac);c.appendChild(cp);
  }
  return c;
}

function mkClosed(g){
  const bets=betsFor(g.id),wids=g.winnerBetIds||[],uid=state.user.uid;
  const c=document.createElement('div');c.className='game';
  c.innerHTML=`<div class="game-top"><div class="game-info"><div class="matchup">Gottéron <span class="vs">VS</span> ${esc(g.opponent||'?')}</div><div class="date">${fmtDate(g.date)}</div></div><span class="status-closed">Abgschlosse</span></div>`;
  if(bets.length){const bl=document.createElement('div');bl.className='game-bets';bets.forEach(b=>{const isW=wids.includes(b.id),n=b.userName||'?';const r=document.createElement('div');r.className='bet-row'+(isW?' winner':'');r.innerHTML=`<div class="left"><div class="bet-avatar" style="background:${avatarColor(n)}">${initials(n)}</div><span class="bet-user">${esc(n)}${isW?' 🏆':''}${b.userId===uid?'<span class="me-tag">DU</span>':''}</span></div><div class="bet-right"><div class="bet-pred">${esc(b.prediction)}</div><div class="bet-amount">${BET_COST} Fr.</div></div>`;bl.appendChild(r)});c.appendChild(bl)}
  const sm=document.createElement('div');sm.className='closed-summary';const pot=g.pot||bets.length,pw=g.perWinner||0,wc=(g.winnerUserIds||[]).length;
  sm.innerHTML=wc>0?`💰 Topf <b>${pot} Fr.</b> · 🏆 Jackpot <b>${fmtFr(g.jackpotHalf||pot/2)} Fr.</b> für ${wc} Gwünner (je <b>${fmtFr(pw)} Fr.</b>) · 🍻 Bierkässeli <b>+${fmtFr(g.kontoHalf||pot/2)} Fr.</b>`:`💰 Topf <b>${pot} Fr.</b> · Kein Gwünner – 🍻 alles <b>${fmtFr(pot)} Fr.</b> is Bierkässeli`;
  c.appendChild(sm);return c;
}
