// KULJU CUP – minipelit: 2048, Väistä kiekkoja, Snake + tulokset
// Eriytetty index.html:stä. Sisältö on siirretty sellaisenaan, ilman muutoksia.


// ── EASTER EGG PELIT v2: 2048, VÄISTÄ KIEKKOJA & SNAKE ──
(function(){

// ══════════════════════════════════════════
//  YHTEISET: TYYLIT & APUFUNKTIOT
// ══════════════════════════════════════════
var GAME_CSS = `
@keyframes g-pop{0%{transform:scale(1)}50%{transform:scale(1.18)}100%{transform:scale(1)}}
@keyframes g-fadein{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes g-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
@keyframes g-glow{0%,100%{box-shadow:0 0 0 rgba(249,115,22,0)}50%{box-shadow:0 0 20px rgba(249,115,22,0.6)}}
@keyframes tile-appear{0%{transform:scale(0);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
@keyframes tile-merge{0%{transform:scale(1)}40%{transform:scale(1.22)}70%{transform:scale(0.95)}100%{transform:scale(1)}}
@keyframes score-pop{0%{transform:scale(1)}40%{transform:scale(1.3)}100%{transform:scale(1)}}
.g-overlay{position:fixed;inset:0;z-index:99990;background:linear-gradient(160deg,#060d1a 0%,#0a1628 60%,#0d1f0d 100%);display:flex;flex-direction:column;align-items:center;touch-action:none;overflow:hidden;}
.g-header{display:flex;align-items:center;justify-content:space-between;width:100%;max-width:440px;padding:14px 16px 6px;flex-shrink:0;}
.g-title{font-size:19px;font-weight:900;letter-spacing:-0.5px;}
.g-close{background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:#fff;font-size:18px;font-weight:700;cursor:pointer;padding:5px 13px;line-height:1.4;transition:background 0.15s;}
.g-close:active{background:rgba(255,255,255,0.25);}
.g-stat-box{background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:7px 16px;text-align:center;min-width:70px;}
.g-stat-label{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;}
.g-stat-val{font-size:22px;font-weight:900;line-height:1.1;}
.g-btn{display:inline-flex;align-items:center;gap:6px;border:none;border-radius:12px;padding:11px 20px;font-weight:800;cursor:pointer;font-size:14px;transition:all 0.15s;letter-spacing:0.2px;}
.g-btn:active{transform:scale(0.93);}
.g-btn-orange{background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;box-shadow:0 4px 12px rgba(249,115,22,0.35);}
.g-btn-green{background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;box-shadow:0 4px 12px rgba(34,197,94,0.35);}
.g-btn-blue{background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;box-shadow:0 4px 12px rgba(59,130,246,0.35);}
.g-btn-ghost{background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);color:#94a3b8;}
.g-gameover{position:absolute;inset:0;background:rgba(6,13,26,0.93);border-radius:inherit;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;animation:g-fadein 0.3s ease;}
.g-gameover-icon{font-size:56px;animation:g-pop 0.5s ease;}
.g-gameover-title{color:#fff;font-size:24px;font-weight:900;}
.g-gameover-score{font-size:42px;font-weight:900;color:#f97316;line-height:1;}
.g-gameover-sub{color:#64748b;font-size:13px;}
.g-hint{color:#475569;font-size:11px;text-align:center;padding:6px 0;flex-shrink:0;}
`;
if(!document.getElementById('g-styles')){
  var s=document.createElement('style'); s.id='g-styles'; s.textContent=GAME_CSS;
  document.head.appendChild(s);
}

// Haptinen palaute
function haptic(type){
  try{
    if(!navigator.vibrate) return;
    if(type==='light') navigator.vibrate(10);
    else if(type==='medium') navigator.vibrate(25);
    else if(type==='heavy') navigator.vibrate([20,30,20]);
    else if(type==='error') navigator.vibrate([40,20,40]);
  }catch(e){}
}

// Pisteiden tallennus: Firebase (jaettu kaikille) + localStorage-välimuisti
var SCORES_KEY = 'tv_game_scores_v2';

function getScoresLocal(){
  try{ return JSON.parse(localStorage.getItem(SCORES_KEY)||'{}'); }catch(e){ return {}; }
}
function setScoresLocal(all){
  try{ localStorage.setItem(SCORES_KEY, JSON.stringify(all)); }catch(e){}
}

// Hae Firestore-viittaus pelituloksiin (tai null jos Firebase ei ole valmis)
async function _gamesFbRef(){
  if(!window._firebaseDb) return null;
  try{
    var fs = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    return { fs: fs, ref: fs.doc(window._firebaseDb, 'app', 'gamescores') };
  }catch(e){ return null; }
}

// Hae kaikki tulokset Firebasesta (fallback: localStorage-välimuisti)
async function getScoresRemote(){
  var fb = await _gamesFbRef();
  if(!fb) return getScoresLocal();
  try{
    var snap = await fb.fs.getDoc(fb.ref);
    var data = snap.exists() ? (snap.data().games || {}) : {};
    setScoresLocal(data); // päivitä välimuisti
    return data;
  }catch(e){ return getScoresLocal(); }
}

// Tallenna tulos: päivitä välimuisti heti + yhdistä Firebaseen (lue–muokkaa–kirjoita)
async function saveScore(game, pts){
  var player = window.currentUser || (function(){ try{ return localStorage.getItem('tv_user')||'?'; }catch(e){ return '?'; } })();
  var entry = { player:player, pts:pts, ts:new Date().toISOString() };

  // 1) Paikallinen välimuisti heti (nopea fallback jos verkko pätkii)
  var local = getScoresLocal();
  local[game] = (local[game]||[]).concat([entry]);
  local[game].sort(function(a,b){ return b.pts-a.pts; });
  local[game] = local[game].slice(0,20);
  setScoresLocal(local);

  // 2) Firebase: kaikkien jaettu, pysyvä tallennus
  var fb = await _gamesFbRef();
  if(fb){
    try{
      var snap = await fb.fs.getDoc(fb.ref);
      var data = snap.exists() ? (snap.data().games || {}) : {};
      var arr = (data[game]||[]).concat([entry]);
      arr.sort(function(a,b){ return b.pts-a.pts; });
      arr = arr.slice(0,20);
      data[game] = arr;
      await fb.fs.setDoc(fb.ref, { games: data });
      local[game] = arr; setScoresLocal(local); // synkkaa välimuisti
      return arr;
    }catch(e){ /* käytetään paikallista tulosta alla */ }
  }
  return local[game];
}

// Admin: renderöi pelitilastot asetuksiin (lukee Firebasesta → näkee KAIKKIEN tulokset)
window._renderGameStats = async function(){
  var el = document.getElementById('gameStatsArea');
  if(!el) return;
  el.innerHTML = '<p style="color:#6b7280;font-size:13px">Ladataan…</p>';
  var games = [
    {key:'2048', label:'🏒 2048 Kiekko'},
    {key:'dodge', label:'⛸️ Väistä Kiekkoja'},
    {key:'snake', label:'🐍 Snake Kiekko'}
  ];
  var all = await getScoresRemote();
  var html = '';
  games.forEach(function(g){
    var top = (all[g.key]||[]).slice(0,5);
    html += '<div style="margin-bottom:14px;">';
    html += '<div style="font-weight:800;font-size:13px;margin-bottom:7px;color:#f97316">'+g.label+'</div>';
    if(!top.length){
      html += '<div style="font-size:12px;color:#6b7280;padding:6px 0">Ei tuloksia vielä.</div>';
    } else {
      var medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
      top.forEach(function(e,i){
        var ts = new Date(e.ts).toLocaleString('fi-FI',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-radius:8px;background:'+(i===0?'rgba(249,115,22,0.1)':'rgba(255,255,255,0.03)')+';margin-bottom:4px;border:1px solid '+(i===0?'rgba(249,115,22,0.3)':'rgba(255,255,255,0.06)')+'">';
        html += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:16px">'+medals[i]+'</span><div><div style="font-weight:700;font-size:13px">'+e.player+'</div><div style="font-size:10px;color:#6b7280">'+ts+'</div></div></div>';
        html += '<div style="font-weight:900;font-size:16px;color:#f97316">'+e.pts+'</div>';
        html += '</div>';
      });
    }
    html += '</div>';
  });
  el.innerHTML = html || '<p style="color:#6b7280;font-size:13px">Ei pelattuja pelejä.</p>';
};

window._resetGameStats = async function(){
  if(!confirm('Nollataan kaikki pelitilastot?')) return;
  try{ localStorage.removeItem(SCORES_KEY); }catch(e){}
  var fb = await _gamesFbRef();
  if(fb){ try{ await fb.fs.setDoc(fb.ref, { games: {} }); }catch(e){} }
  window._renderGameStats();
};

// Käynnistä stats automaattisesti kun asetukset avataan
var _origOpenSettings = window._openSettingsPanel;
window._openSettingsPanel = function(){
  if(_origOpenSettings) _origOpenSettings();
  setTimeout(window._renderGameStats, 100);
  if(window._updateMaintUI) window._updateMaintUI();
};

// Luo pelioverlay
function makeOverlay(id){
  var ex = document.getElementById(id);
  if(ex) ex.remove();
  var el = document.createElement('div');
  el.id = id;
  el.className = 'g-overlay';
  document.body.appendChild(el);
  return el;
}

// Game-over ruutu
async function showGameOver(containerId, icon, title, pts, game, onRestart){
  var go = document.getElementById(containerId+'-go');
  if(!go) return;
  // Näytä ruutu heti (ei jää odottamaan verkkoa)
  go.style.display = 'flex';
  go.innerHTML =
    '<div class="g-gameover-icon">'+icon+'</div>'+
    '<div class="g-gameover-title">'+title+'</div>'+
    '<div class="g-gameover-score">'+pts+'</div>'+
    '<div class="g-gameover-sub">pistettä</div>'+
    '<div style="display:flex;gap:10px;margin-top:8px;">'+
      '<button class="g-btn g-btn-orange" onclick="window._gameRestart_'+containerId+'&&window._gameRestart_'+containerId+'()">Uudelleen!</button>'+
      '<button class="g-btn g-btn-ghost" onclick="document.getElementById(\''+containerId+'\').remove()">Sulje</button>'+
    '</div>';
  window['_gameRestart_'+containerId] = onRestart;
  haptic('heavy');

  // Tallenna tulos (Firebase + välimuisti) ja näytä sijoitus kun valmis
  try{
    var sc = await saveScore(game, pts);
    var rank = sc.findIndex(function(e){ return e.pts===pts && e.player===(window.currentUser||'?'); });
    var rankTxt = rank===0 ? '🏆 Uusi ennätys!' : rank===1 ? '🥈 Toinen sija!' : rank===2 ? '🥉 Kolmas sija!' : '';
    if(rankTxt && go.isConnected){
      var scoreEl = go.querySelector('.g-gameover-score');
      if(scoreEl && !go.querySelector('.g-gameover-rank')){
        var badge = document.createElement('div');
        badge.className = 'g-gameover-rank';
        badge.style.cssText = 'color:#fbbf24;font-weight:800;font-size:14px';
        badge.textContent = rankTxt;
        scoreEl.insertAdjacentElement('afterend', badge);
      }
    }
  }catch(e){}
}

// ══════════════════════════════════════════
//  PELI 1: 2048 KIEKKOVERSIO (parannettu)
// ══════════════════════════════════════════
var TILE_EMOJI = {2:'🏒',4:'⛸️',8:'🥅',16:'🇫🇮',32:'🏆',64:'💯',128:'🌟',256:'👑',512:'🎰',1024:'🔥',2048:'🏒🏒'};
var TILE_BG = {
  2:'linear-gradient(135deg,#1e3a5f,#1a3252)',
  4:'linear-gradient(135deg,#1e4d8c,#163a70)',
  8:'linear-gradient(135deg,#1a5c2e,#144823)',
  16:'linear-gradient(135deg,#7c3206,#5c2504)',
  32:'linear-gradient(135deg,#6b1f5c,#521748)',
  64:'linear-gradient(135deg,#0e6e8a,#0a5268)',
  128:'linear-gradient(135deg,#4a1e8a,#36156a)',
  256:'linear-gradient(135deg,#8a5c0e,#6a460a)',
  512:'linear-gradient(135deg,#0e6e5c,#0a5245)',
  1024:'linear-gradient(135deg,#8a1e1e,#6a1616)',
  2048:'linear-gradient(135deg,#f97316,#ea580c)'
};
var TILE_GLOW = {128:'rgba(139,92,246,0.5)',256:'rgba(251,191,36,0.5)',512:'rgba(34,197,94,0.5)',1024:'rgba(239,68,68,0.6)',2048:'rgba(249,115,22,0.8)'};

window._open2048 = function(){
  var SIZE=4, board=[], score=0, best=0, mergedCells=[], newCells=[];

  var overlay = makeOverlay('game2048Overlay');

  overlay.innerHTML =
    '<div class="g-header">'+
      '<div class="g-title" style="color:#f97316">🏒 2048 Kiekko</div>'+
      '<div style="display:flex;gap:8px;align-items:center;">'+
        '<div class="g-stat-box"><div class="g-stat-label">Pisteet</div><div id="g2-score" class="g-stat-val" style="color:#f97316">0</div></div>'+
        '<div class="g-stat-box"><div class="g-stat-label">Paras</div><div id="g2-best" class="g-stat-val" style="color:#fbbf24">0</div></div>'+
        '<button class="g-close" onclick="document.getElementById(\'game2048Overlay\').remove()">✕</button>'+
      '</div>'+
    '</div>'+
    '<div style="width:100%;max-width:400px;padding:0 12px;flex:1;display:flex;flex-direction:column;justify-content:center;">'+
      '<div style="display:flex;justify-content:flex-end;margin-bottom:10px;">'+
        '<button class="g-btn g-btn-orange" onclick="window._restart2048()" style="padding:8px 16px;font-size:13px;">🔄 Uusi peli</button>'+
      '</div>'+
      '<div style="position:relative;border-radius:16px;overflow:hidden;">'+
        '<div id="g2048-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:10px;"></div>'+
        '<div id="game2048Overlay-go" class="g-gameover" style="border-radius:16px;"></div>'+
      '</div>'+
    '</div>'+
    '<div class="g-hint">Swipaa yhdistääksesi kiekot · Tavoite: 🏒🏒</div>';

  function newBoard(){
    board=[];
    for(var i=0;i<SIZE*SIZE;i++) board.push(0);
    score=0; mergedCells=[]; newCells=[];
    addRandom(); addRandom();
    render2048();
  }
  function addRandom(){
    var empty=[];
    for(var i=0;i<board.length;i++) if(!board[i]) empty.push(i);
    if(!empty.length) return;
    var idx=empty[Math.floor(Math.random()*empty.length)];
    board[idx]=Math.random()<0.9?2:4;
    newCells.push(idx);
  }
  function slide(row){
    var prev=row.slice();
    var filtered=row.filter(Boolean), merged=[], gained=0, i=0;
    while(i<filtered.length){
      if(i+1<filtered.length && filtered[i]===filtered[i+1]){
        var val=filtered[i]*2; merged.push(val); gained+=val; i+=2;
      } else { merged.push(filtered[i]); i++; }
    }
    while(merged.length<SIZE) merged.push(0);
    return {row:merged, gained:gained, changed:JSON.stringify(prev)!==JSON.stringify(merged)};
  }
  function rotCW(b){ var r=[]; for(var c=0;c<SIZE;c++) for(var rr=SIZE-1;rr>=0;rr--) r.push(b[rr*SIZE+c]); return r; }
  function move(dir){
    var b=board.slice(), gained=0, anyChanged=false;
    var rots={left:0,right:2,up:3,down:1};
    var n=rots[dir]; for(var i=0;i<n;i++) b=rotCW(b);
    var nb=[];
    mergedCells=[];
    for(var r=0;r<SIZE;r++){
      var row=b.slice(r*SIZE,(r+1)*SIZE);
      var res=slide(row);
      if(res.changed) anyChanged=true;
      gained+=res.gained;
      for(var c=0;c<SIZE;c++) nb.push(res.row[c]);
    }
    var unrots={left:0,right:2,up:1,down:3};
    n=unrots[dir]; for(var j=0;j<n;j++) nb=rotCW(nb);
    if(anyChanged){
      board=nb; score+=gained; newCells=[];
      if(gained>0){ haptic('light'); animScorePop(); }
      addRandom();
      if(score>best) best=score;
      render2048();
    }
  }
  function animScorePop(){
    var el=document.getElementById('g2-score');
    if(!el) return;
    el.style.animation='score-pop 0.3s ease';
    setTimeout(function(){ el.style.animation=''; },350);
  }
  function isGameOver(){
    for(var i=0;i<board.length;i++){
      if(!board[i]) return false;
      var r=Math.floor(i/SIZE),c=i%SIZE;
      if(c+1<SIZE&&board[i]===board[i+1]) return false;
      if(r+1<SIZE&&board[i]===board[i+SIZE]) return false;
    }
    return true;
  }
  function render2048(){
    var grid=document.getElementById('g2048-grid');
    if(!grid) return;
    var cells=grid.querySelectorAll('.g2-cell');
    // Ensimmäinen render: luo solut
    if(cells.length!==SIZE*SIZE){
      grid.innerHTML='';
      for(var i=0;i<SIZE*SIZE;i++){
        var cell=document.createElement('div');
        cell.className='g2-cell';
        cell.style.cssText='border-radius:10px;display:flex;align-items:center;justify-content:center;aspect-ratio:1;min-height:64px;font-size:28px;transition:background 0.1s;position:relative;overflow:hidden;';
        grid.appendChild(cell);
      }
      cells=grid.querySelectorAll('.g2-cell');
    }
    for(var idx=0;idx<board.length;idx++){
      var v=board[idx];
      var cell2=cells[idx];
      var bg=v?(TILE_BG[v]||'linear-gradient(135deg,#334155,#1e293b)'):'rgba(255,255,255,0.03)';
      cell2.style.background=bg;
      cell2.style.boxShadow=v&&TILE_GLOW[v]?'0 0 14px '+TILE_GLOW[v]:'none';
      cell2.style.border=v&&TILE_GLOW[v]?'1px solid rgba(255,255,255,0.2)':'1px solid rgba(255,255,255,0.05)';
      var em=v?(TILE_EMOJI[v]||('')):'';
      var numLabel=v&&!TILE_EMOJI[v]?'<span style="font-size:16px;color:#fff;font-weight:900">'+v+'</span>':'';
      cell2.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;line-height:1;">'+em+numLabel+'</div>';
      if(newCells.indexOf(idx)!==-1){
        cell2.style.animation='tile-appear 0.2s ease forwards';
        setTimeout((function(c){ return function(){ c.style.animation=''; }; })(cell2), 250);
      }
    }
    var sc=document.getElementById('g2-score');
    if(sc) sc.textContent=score;
    var bs=document.getElementById('g2-best');
    if(bs) bs.textContent=best;
    if(isGameOver()){
      setTimeout(function(){ showGameOver('game2048Overlay','🏒','Peli ohi!',score,'2048',window._restart2048); },300);
    }
  }
  window._restart2048=function(){
    newBoard();
  };
  newBoard();

  // Swipe
  var tx=0,ty=0,swiping=false;
  overlay.addEventListener('touchstart',function(e){ tx=e.touches[0].clientX; ty=e.touches[0].clientY; swiping=true; },{passive:true});
  overlay.addEventListener('touchend',function(e){
    if(!swiping) return; swiping=false;
    var dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
    if(Math.abs(dx)<20&&Math.abs(dy)<20) return;
    move(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));
  },{passive:true});
  function onKey2(e){ var m={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}; if(m[e.key]){e.preventDefault();move(m[e.key]);} }
  document.addEventListener('keydown',onKey2);
  new MutationObserver(function(ms){ ms.forEach(function(m){ m.removedNodes.forEach(function(n){ if(n.id==='game2048Overlay') document.removeEventListener('keydown',onKey2); }); }); }).observe(document.body,{childList:true});
};

// ══════════════════════════════════════════
//  PELI 2: VÄISTÄ KIEKKOJA v2 (parannettu)
// ══════════════════════════════════════════
window._openDodge = function(){
  var W,H,player,pucks,particles,score,lives,gameRunning,animId,lastTime,spawnTimer,spawnInterval,hitFlash;
  var PSPEED=7;

  var overlay=makeOverlay('gameDodgeOverlay');
  overlay.innerHTML=
    '<div class="g-header">'+
      '<div class="g-title" style="color:#22c55e">⛸️ Väistä Kiekkoja</div>'+
      '<button class="g-close" onclick="if(window._dgStop)window._dgStop();document.getElementById(\'gameDodgeOverlay\').remove()">✕</button>'+
    '</div>'+
    '<div style="width:100%;max-width:440px;padding:0 12px 6px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">'+
      '<div style="display:flex;gap:8px;">'+
        '<div class="g-stat-box"><div class="g-stat-label">Pisteet</div><div id="dg2-score" class="g-stat-val" style="color:#22c55e">0</div></div>'+
        '<div class="g-stat-box"><div class="g-stat-label">Korkein</div><div id="dg2-best" class="g-stat-val" style="color:#fbbf24">0</div></div>'+
      '</div>'+
      '<div id="dg2-lives" style="font-size:22px;letter-spacing:2px;">❤️❤️❤️</div>'+
    '</div>'+
    '<div style="position:relative;width:100%;max-width:440px;padding:0 12px;flex:1;">'+
      '<canvas id="dg2-canvas" style="border-radius:16px;width:100%;display:block;touch-action:none;border:1px solid rgba(255,255,255,0.07);"></canvas>'+
      '<div id="gameDodgeOverlay-go" class="g-gameover" style="border-radius:16px;top:0;left:12px;right:12px;bottom:0;"></div>'+
    '</div>'+
    '<div class="g-hint">Liikuta sormea — väistä kiekkoja! Pysyt elossa 3 osumaa</div>';

  var canvas=document.getElementById('dg2-canvas');
  var ctx=canvas.getContext('2d');
  var bestScore=0;

  function resize(){
    var maxW=Math.min(window.innerWidth-24,440);
    canvas.width=maxW;
    canvas.height=Math.min(window.innerHeight-220,Math.round(maxW*1.5));
    W=canvas.width; H=canvas.height;
  }
  resize();

  // Kiekkotyyppi
  var PUCK_TYPES=[
    {emoji:'🏒',r:18,speed:1.0,color:'rgba(249,115,22,0.7)'},
    {emoji:'⛸️',r:16,speed:1.3,color:'rgba(59,130,246,0.7)'},
    {emoji:'🥅',r:22,speed:0.7,color:'rgba(139,92,246,0.7)'},
    {emoji:'💣',r:14,speed:1.6,color:'rgba(239,68,68,0.8)'}
  ];

  function initGame(){
    player={x:W/2,y:H-70,r:20,trail:[]};
    pucks=[]; particles=[]; score=0; lives=3;
    spawnInterval=1600; spawnTimer=0; lastTime=null; hitFlash=0;
    gameRunning=true;
    var go=document.getElementById('gameDodgeOverlay-go');
    if(go) go.style.display='none';
    updateHUD();
  }

  function updateHUD(){
    var sc=document.getElementById('dg2-score'); if(sc) sc.textContent=score;
    var bs=document.getElementById('dg2-best'); if(bs) bs.textContent=bestScore;
    var lv=document.getElementById('dg2-lives'); if(lv) lv.textContent='❤️'.repeat(Math.max(0,lives))+'🖤'.repeat(Math.max(0,3-lives));
    if(score>bestScore) bestScore=score;
  }

  function spawnPuck(){
    var type=PUCK_TYPES[Math.floor(Math.random()*PUCK_TYPES.length)];
    var margin=30;
    // Aaltomainen liikerata
    var baseVy=(2.5+Math.random()*2+score*0.008)*type.speed;
    var amp=Math.random()*1.5;
    var freq=0.03+Math.random()*0.04;
    var phase=Math.random()*Math.PI*2;
    pucks.push({
      x:margin+Math.random()*(W-margin*2),
      y:-type.r*2,
      vx:(Math.random()-0.5)*2,
      vy:baseVy,
      r:type.r,
      emoji:type.emoji,
      color:type.color,
      amp:amp,
      freq:freq,
      phase:phase,
      age:0,
      wobble:0
    });
  }

  function spawnParticle(x,y,color,count){
    for(var i=0;i<(count||8);i++){
      var angle=Math.random()*Math.PI*2;
      var speed=2+Math.random()*4;
      particles.push({x:x,y:y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-2,life:1,color:color,r:3+Math.random()*4});
    }
  }

  var touchPos={x:null,y:null};
  canvas.addEventListener('touchmove',function(e){
    e.preventDefault();
    var rect=canvas.getBoundingClientRect();
    touchPos.x=(e.touches[0].clientX-rect.left)*(W/rect.width);
    touchPos.y=(e.touches[0].clientY-rect.top)*(H/rect.height);
  },{passive:false});
  canvas.addEventListener('touchend',function(){ touchPos.x=null; touchPos.y=null; },{passive:true});
  canvas.addEventListener('mousemove',function(e){
    var rect=canvas.getBoundingClientRect();
    touchPos.x=(e.clientX-rect.left)*(W/rect.width);
    touchPos.y=(e.clientY-rect.top)*(H/rect.height);
  });
  canvas.addEventListener('mouseleave',function(){ touchPos.x=null; touchPos.y=null; });

  function gameLoop(ts){
    if(!gameRunning) return;
    animId=requestAnimationFrame(gameLoop);
    var dt=lastTime?Math.min(ts-lastTime,50):16;
    lastTime=ts;
    if(hitFlash>0) hitFlash-=dt;

    // Pelaajan liike
    if(touchPos.x!==null){
      var pdx=touchPos.x-player.x, pdy=touchPos.y-player.y;
      var pd=Math.sqrt(pdx*pdx+pdy*pdy);
      if(pd>3){
        var spd=Math.min(pd*0.18, PSPEED*(dt/16));
        player.x+=pdx/pd*spd;
        player.y+=pdy/pd*spd;
      }
    }
    player.x=Math.max(player.r,Math.min(W-player.r,player.x));
    player.y=Math.max(player.r,Math.min(H-player.r,player.y));
    // Trail
    player.trail.push({x:player.x,y:player.y});
    if(player.trail.length>12) player.trail.shift();

    // Spawn
    spawnTimer+=dt;
    if(spawnTimer>=spawnInterval){ spawnTimer=0; spawnPuck(); spawnInterval=Math.max(550,spawnInterval-15); }

    // Päivitä kiekot
    for(var i=pucks.length-1;i>=0;i--){
      var p=pucks[i];
      p.age+=dt;
      p.wobble=Math.sin(p.age*p.freq+p.phase)*p.amp;
      p.x+=p.vx+p.wobble*(dt/16);
      p.y+=p.vy*(dt/16);
      if(p.x<p.r||p.x>W-p.r) p.vx*=-1;
      // Törmäys
      var dx=player.x-p.x, dy2=player.y-p.y;
      if(Math.sqrt(dx*dx+dy2*dy2)<player.r+p.r-4){
        spawnParticle(p.x,p.y,p.color,12);
        pucks.splice(i,1); lives--;
        hitFlash=400;
        haptic('heavy');
        updateHUD();
        if(lives<=0){ endGame(); return; }
        continue;
      }
      // Väistetty onnistuneesti
      if(p.y>H+p.r*2){
        spawnParticle(p.x,H-10,'rgba(34,197,94,0.8)',5);
        pucks.splice(i,1);
        score++;
        updateHUD();
      }
    }

    // Päivitä partikkelit
    for(var pi=particles.length-1;pi>=0;pi--){
      var pt=particles[pi];
      pt.x+=pt.vx*(dt/16); pt.y+=pt.vy*(dt/16); pt.vy+=0.15*(dt/16); pt.life-=0.03*(dt/16);
      if(pt.life<=0) particles.splice(pi,1);
    }

    // PIIRTO
    ctx.clearRect(0,0,W,H);

    // Tausta
    var grad=ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,'#060d1a');
    grad.addColorStop(1,'#0a1a10');
    ctx.fillStyle=grad;
    ctx.fillRect(0,0,W,H);

    // Jääkentän viivat
    ctx.strokeStyle='rgba(148,210,255,0.04)';
    ctx.lineWidth=1;
    for(var ly=0;ly<H;ly+=50){ ctx.beginPath(); ctx.moveTo(0,ly); ctx.lineTo(W,ly); ctx.stroke(); }
    ctx.strokeStyle='rgba(148,210,255,0.03)';
    for(var lx=0;lx<W;lx+=50){ ctx.beginPath(); ctx.moveTo(lx,0); ctx.lineTo(lx,H); ctx.stroke(); }

    // Punainen välähdys osumasta
    if(hitFlash>0){
      ctx.fillStyle='rgba(239,68,68,'+(hitFlash/400*0.25)+')';
      ctx.fillRect(0,0,W,H);
    }

    // Partikkelit
    particles.forEach(function(pt){
      ctx.globalAlpha=pt.life;
      ctx.fillStyle=pt.color;
      ctx.beginPath(); ctx.arc(pt.x,pt.y,pt.r*pt.life,0,Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha=1;

    // Pelaajan trail
    for(var ti=0;ti<player.trail.length;ti++){
      var t=player.trail[ti];
      var alpha=(ti/player.trail.length)*0.3;
      ctx.globalAlpha=alpha;
      ctx.fillStyle='#22c55e';
      ctx.beginPath(); ctx.arc(t.x,t.y,(player.r*0.6)*(ti/player.trail.length),0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;

    // Pelaaja (luistelin + hehku)
    ctx.shadowBlur=hitFlash>0?16:8;
    ctx.shadowColor=hitFlash>0?'#ef4444':'#22c55e';
    ctx.font=(player.r*2)+'px serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('⛸️',player.x,player.y);
    ctx.shadowBlur=0;

    // Kiekot
    pucks.forEach(function(p){
      // Varjo/hehku
      ctx.shadowBlur=12; ctx.shadowColor=p.color;
      ctx.font=(p.r*2)+'px serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(p.emoji,p.x,p.y);
      ctx.shadowBlur=0;
    });
  }

  function endGame(){
    gameRunning=false;
    if(animId) cancelAnimationFrame(animId);
    showGameOver('gameDodgeOverlay','⛸️','Peli ohi!',score,'dodge',window._restartDodge);
  }

  window._restartDodge=function(){ initGame(); animId=requestAnimationFrame(gameLoop); };
  window._dgStop=function(){ gameRunning=false; if(animId) cancelAnimationFrame(animId); };

  new MutationObserver(function(ms){ ms.forEach(function(m){ m.removedNodes.forEach(function(n){ if(n.id==='gameDodgeOverlay'){ gameRunning=false; if(animId) cancelAnimationFrame(animId); } }); }); }).observe(document.body,{childList:true});

  initGame();
  animId=requestAnimationFrame(gameLoop);
};

// ══════════════════════════════════════════
//  PELI 3: SNAKE KIEKKO (swipe-ohjaus)
// ══════════════════════════════════════════
window._openSnake = function(){
  var CELL=20, COLS, ROWS, W2, H2;
  var snake,dir,nextDir,food,score2,gameRunning2,loopTimer,speed,bestSnake;
  bestSnake=0;

  var overlay=makeOverlay('gameSnakeOverlay');
  overlay.innerHTML=
    '<div class="g-header">'+
      '<div class="g-title" style="color:#3b82f6">🐍 Snake Kiekko</div>'+
      '<button class="g-close" onclick="if(window._snakeStop)window._snakeStop();document.getElementById(\'gameSnakeOverlay\').remove()">✕</button>'+
    '</div>'+
    '<div style="width:100%;max-width:440px;padding:0 12px 6px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">'+
      '<div style="display:flex;gap:8px;">'+
        '<div class="g-stat-box"><div class="g-stat-label">Pisteet</div><div id="sn-score" class="g-stat-val" style="color:#3b82f6">0</div></div>'+
        '<div class="g-stat-box"><div class="g-stat-label">Korkein</div><div id="sn-best" class="g-stat-val" style="color:#fbbf24">0</div></div>'+
      '</div>'+
      '<div id="sn-speed" style="font-size:12px;color:#475569;font-weight:700;"></div>'+
    '</div>'+
    '<div style="position:relative;width:100%;max-width:440px;padding:0 12px;flex:1;">'+
      '<canvas id="sn-canvas" style="border-radius:16px;width:100%;display:block;touch-action:none;border:1px solid rgba(255,255,255,0.07);"></canvas>'+
      '<div id="gameSnakeOverlay-go" class="g-gameover" style="border-radius:16px;top:0;left:12px;right:12px;bottom:0;"></div>'+
    '</div>'+
    '<div class="g-hint">Swipaa suuntaan · Syö kiekot kasvaksesi!</div>';

  var canvas2=document.getElementById('sn-canvas');
  var ctx2=canvas2.getContext('2d');

  function resize2(){
    var maxW=Math.min(window.innerWidth-24,440);
    COLS=Math.floor(maxW/CELL); ROWS=Math.floor(Math.min(window.innerHeight-220,Math.round(maxW*1.4))/CELL);
    canvas2.width=COLS*CELL; canvas2.height=ROWS*CELL;
    W2=canvas2.width; H2=canvas2.height;
  }
  resize2();

  var FOOD_EMOJIS=['🏒','⛸️','🥅','🇫🇮','🏆'];
  var FOOD_PTS=[1,2,3,5,10];
  var HEAD_EMOJIS=['😎','🤩','😤'];

  function initSnake(){
    var mx=Math.floor(COLS/2), my=Math.floor(ROWS/2);
    snake=[{x:mx,y:my},{x:mx-1,y:my},{x:mx-2,y:my}];
    dir={x:1,y:0}; nextDir={x:1,y:0};
    score2=0; speed=220;
    placeFood();
    gameRunning2=true;
    var go=document.getElementById('gameSnakeOverlay-go');
    if(go) go.style.display='none';
    updateSnakeHUD();
  }

  function placeFood(){
    var fi=Math.floor(Math.random()*FOOD_EMOJIS.length);
    var fx,fy,onSnake;
    do{
      fx=Math.floor(Math.random()*COLS); fy=Math.floor(Math.random()*ROWS);
      onSnake=snake.some(function(s){ return s.x===fx&&s.y===fy; });
    }while(onSnake);
    food={x:fx,y:fy,ei:fi,pulse:0};
  }

  function updateSnakeHUD(){
    var sc=document.getElementById('sn-score'); if(sc) sc.textContent=score2;
    var bs=document.getElementById('sn-best'); if(bs) bs.textContent=bestSnake;
    var sp=document.getElementById('sn-speed');
    if(sp){
      var lvl=score2<10?'Aloittelija':score2<25?'Luistelija':score2<50?'Ammattilainen':'Legenda 🏆';
      sp.textContent=lvl;
    }
  }

  function stepSnake(){
    if(!gameRunning2) return;
    dir=nextDir;
    var head={x:snake[0].x+dir.x, y:snake[0].y+dir.y};
    // Seinä = peli ohi
    if(head.x<0||head.x>=COLS||head.y<0||head.y>=ROWS){ endSnake(); return; }
    // Oma keho
    if(snake.some(function(s){ return s.x===head.x&&s.y===head.y; })){ endSnake(); return; }

    snake.unshift(head);
    if(head.x===food.x&&head.y===food.y){
      var pts=FOOD_PTS[food.ei];
      score2+=pts;
      if(score2>bestSnake) bestSnake=score2;
      haptic('light');
      // Nopeutuu
      speed=Math.max(80,speed-6);
      placeFood();
      updateSnakeHUD();
    } else {
      snake.pop();
    }
    renderSnake();
    loopTimer=setTimeout(stepSnake, speed);
  }

  function renderSnake(){
    ctx2.clearRect(0,0,W2,H2);

    // Tausta
    var g=ctx2.createLinearGradient(0,0,0,H2);
    g.addColorStop(0,'#060d1a'); g.addColorStop(1,'#080d20');
    ctx2.fillStyle=g; ctx2.fillRect(0,0,W2,H2);

    // Ruudukko
    ctx2.strokeStyle='rgba(148,210,255,0.04)'; ctx2.lineWidth=0.5;
    for(var cx=0;cx<W2;cx+=CELL){ ctx2.beginPath(); ctx2.moveTo(cx,0); ctx2.lineTo(cx,H2); ctx2.stroke(); }
    for(var cy=0;cy<H2;cy+=CELL){ ctx2.beginPath(); ctx2.moveTo(0,cy); ctx2.lineTo(W2,cy); ctx2.stroke(); }

    // Käärme keho – gradient väri
    snake.forEach(function(seg,i){
      var t=i/snake.length;
      var r=Math.round(59+t*(30-59)), gv=Math.round(130+t*(80-130)), b=Math.round(246+t*(180-246));
      ctx2.fillStyle='rgb('+r+','+gv+','+b+')';
      ctx2.shadowBlur=i===0?12:4;
      ctx2.shadowColor='rgba(59,130,246,'+(i===0?0.8:0.3)+')';
      var pad=i===0?1:3;
      ctx2.beginPath();
      ctx2.roundRect(seg.x*CELL+pad, seg.y*CELL+pad, CELL-pad*2, CELL-pad*2, i===0?6:4);
      ctx2.fill();
    });
    ctx2.shadowBlur=0;

    // Pää emoji
    ctx2.font='16px serif';
    ctx2.textAlign='center'; ctx2.textBaseline='middle';
    ctx2.fillText(HEAD_EMOJIS[Math.floor(score2/20)%HEAD_EMOJIS.length], snake[0].x*CELL+CELL/2, snake[0].y*CELL+CELL/2);

    // Ruoka + pulssi
    food.pulse=(food.pulse||0)+0.08;
    var sc2=0.85+Math.sin(food.pulse)*0.15;
    ctx2.save();
    ctx2.translate(food.x*CELL+CELL/2, food.y*CELL+CELL/2);
    ctx2.scale(sc2,sc2);
    ctx2.shadowBlur=10; ctx2.shadowColor='rgba(249,115,22,0.8)';
    ctx2.font='15px serif'; ctx2.textAlign='center'; ctx2.textBaseline='middle';
    ctx2.fillText(FOOD_EMOJIS[food.ei],0,0);
    ctx2.restore();
    ctx2.shadowBlur=0;

    // Pistepisteet ruuan päällä
    ctx2.fillStyle='#fbbf24'; ctx2.font='bold 10px system-ui';
    ctx2.textAlign='center'; ctx2.textBaseline='bottom';
    ctx2.fillText('+'+FOOD_PTS[food.ei], food.x*CELL+CELL/2, food.y*CELL);
  }

  function endSnake(){
    gameRunning2=false;
    clearTimeout(loopTimer);
    haptic('error');
    showGameOver('gameSnakeOverlay','🐍','Peli ohi!',score2,'snake',window._restartSnake);
  }

  window._restartSnake=function(){ clearTimeout(loopTimer); initSnake(); stepSnake(); };
  window._snakeStop=function(){ gameRunning2=false; clearTimeout(loopTimer); };

  // Swipe-ohjaus
  var stx=0,sty=0;
  overlay.addEventListener('touchstart',function(e){ stx=e.touches[0].clientX; sty=e.touches[0].clientY; },{passive:true});
  overlay.addEventListener('touchend',function(e){
    var dx=e.changedTouches[0].clientX-stx, dy=e.changedTouches[0].clientY-sty;
    if(Math.abs(dx)<15&&Math.abs(dy)<15) return;
    if(Math.abs(dx)>Math.abs(dy)){
      if(dx>0&&dir.x!==-1) nextDir={x:1,y:0};
      else if(dx<0&&dir.x!==1) nextDir={x:-1,y:0};
    } else {
      if(dy>0&&dir.y!==-1) nextDir={x:0,y:1};
      else if(dy<0&&dir.y!==1) nextDir={x:0,y:-1};
    }
  },{passive:true});
  // Näppäimistö
  function onSnakeKey(e){
    var m={ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1}};
    if(m[e.key]){
      e.preventDefault();
      var nd=m[e.key];
      if(nd.x!==-dir.x||nd.y!==-dir.y) nextDir=nd;
    }
  }
  document.addEventListener('keydown',onSnakeKey);
  new MutationObserver(function(ms){ ms.forEach(function(m){ m.removedNodes.forEach(function(n){ if(n.id==='gameSnakeOverlay'){ gameRunning2=false; clearTimeout(loopTimer); document.removeEventListener('keydown',onSnakeKey); } }); }); }).observe(document.body,{childList:true});

  initSnake();
  stepSnake();
};

// ══════════════════════════════════════════
//  PELIVALIKKO
// ══════════════════════════════════════════
function openGameMenu(){
  var ex=document.getElementById('gameMenuOverlay'); if(ex) ex.remove();
  var overlay=document.createElement('div');
  overlay.id='gameMenuOverlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:99989;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;padding:20px;animation:g-fadein 0.2s ease;backdrop-filter:blur(4px);';
  overlay.innerHTML=
    '<div style="background:linear-gradient(160deg,#0f172a,#0a1628,#0d1a0d);border:1px solid rgba(255,255,255,0.1);border-radius:24px;padding:28px 24px;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.8);">'+
      '<div style="font-size:48px;margin-bottom:4px;animation:g-pop 0.5s ease;">🏒</div>'+
      '<div style="font-size:22px;font-weight:900;background:linear-gradient(90deg,#f97316,#fbbf24);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px;">Salainen Pelihuone</div>'+
      '<div style="font-size:12px;color:#475569;margin-bottom:24px;font-weight:600;letter-spacing:0.5px;">VALITSE PELI</div>'+
      '<div style="display:grid;gap:10px;">'+
        '<button onclick="document.getElementById(\'gameMenuOverlay\').remove();window._open2048();" style="background:linear-gradient(135deg,rgba(249,115,22,0.15),rgba(249,115,22,0.05));border:1px solid rgba(249,115,22,0.4);border-radius:16px;padding:14px 18px;cursor:pointer;color:#fff;display:flex;align-items:center;gap:14px;transition:all 0.15s;">'+
          '<div style="font-size:32px;flex-shrink:0;">🏒</div>'+
          '<div style="text-align:left;"><div style="font-size:16px;font-weight:800;color:#f97316">2048 Kiekko</div><div style="font-size:12px;color:#64748b;margin-top:2px">Yhdistä kiekot · swipe-ohjaus</div></div>'+
        '</button>'+
        '<button onclick="document.getElementById(\'gameMenuOverlay\').remove();window._openDodge();" style="background:linear-gradient(135deg,rgba(34,197,94,0.15),rgba(34,197,94,0.05));border:1px solid rgba(34,197,94,0.4);border-radius:16px;padding:14px 18px;cursor:pointer;color:#fff;display:flex;align-items:center;gap:14px;transition:all 0.15s;">'+
          '<div style="font-size:32px;flex-shrink:0;">⛸️</div>'+
          '<div style="text-align:left;"><div style="font-size:16px;font-weight:800;color:#22c55e">Väistä Kiekkoja</div><div style="font-size:12px;color:#64748b;margin-top:2px">Selviä hengissä · sormiohjaus</div></div>'+
        '</button>'+
        '<button onclick="document.getElementById(\'gameMenuOverlay\').remove();window._openSnake();" style="background:linear-gradient(135deg,rgba(59,130,246,0.15),rgba(59,130,246,0.05));border:1px solid rgba(59,130,246,0.4);border-radius:16px;padding:14px 18px;cursor:pointer;color:#fff;display:flex;align-items:center;gap:14px;transition:all 0.15s;">'+
          '<div style="font-size:32px;flex-shrink:0;">🐍</div>'+
          '<div style="text-align:left;"><div style="font-size:16px;font-weight:800;color:#3b82f6">Snake Kiekko</div><div style="font-size:12px;color:#64748b;margin-top:2px">Syö kiekot kasvaksesi · swipe</div></div>'+
        '</button>'+
      '</div>'+
      '<button onclick="window._openGameScores();" style="background:linear-gradient(135deg,rgba(251,191,36,0.15),rgba(251,191,36,0.05));border:1px solid rgba(251,191,36,0.4);border-radius:16px;padding:12px 18px;cursor:pointer;color:#fff;display:flex;align-items:center;justify-content:center;gap:10px;margin-top:12px;font-weight:800;font-size:14px;">🏆 Tulostaulu</button>'+      '<button onclick="document.getElementById(\'gameMenuOverlay\').remove()" class="g-btn g-btn-ghost" style="margin-top:12px;width:100%;justify-content:center;">Sulje</button>'+
    '</div>';
  overlay.addEventListener('click',function(e){ if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// Porukan tulostaulu minipeleihin (näyttää olemassa olevat tulokset; ei kirjoita dataa)
window._openGameScores = async function(){
  var ex=document.getElementById('gameScoresOverlay'); if(ex) ex.remove();
  var overlay=document.createElement('div');
  overlay.id='gameScoresOverlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;padding:20px;animation:g-fadein 0.2s ease;backdrop-filter:blur(4px);';
  overlay.innerHTML='<div style="background:linear-gradient(160deg,#0f172a,#0a1628,#0d1a0d);border:1px solid rgba(255,255,255,0.1);border-radius:24px;padding:24px 20px;max-width:360px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.8);max-height:84vh;overflow-y:auto;">'+
    '<div style="font-size:40px;margin-bottom:2px;">🏆</div>'+
    '<div style="font-size:20px;font-weight:900;background:linear-gradient(90deg,#f97316,#fbbf24);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:16px;">Tulostaulu</div>'+
    '<div id="gameScoresBody"><div style="font-size:13px;color:#64748b;padding:10px">Ladataan…</div></div>'+
    '<button onclick="document.getElementById(\'gameScoresOverlay\').remove()" class="g-btn g-btn-ghost" style="margin-top:8px;width:100%;justify-content:center;">Sulje</button>'+
  '</div>';
  overlay.addEventListener('click',function(e){ if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  var games=[{key:'2048',label:'\ud83c\udfd2 2048 Kiekko',c:'#f97316'},{key:'dodge',label:'\u26f8\ufe0f V\u00e4ist\u00e4 Kiekkoja',c:'#22c55e'},{key:'snake',label:'\ud83d\udc0d Snake Kiekko',c:'#3b82f6'}];
  var all={}; try{ all=await getScoresRemote(); }catch(e){ all={}; }
  var me=window.currentUser||'';
  var body=document.getElementById('gameScoresBody'); if(!body) return;
  var medals=['\ud83e\udd47','\ud83e\udd48','\ud83e\udd49','4\ufe0f\u20e3','5\ufe0f\u20e3'];
  var html='';
  games.forEach(function(g){
    var top=(all[g.key]||[]).slice(0,5);
    html+='<div style="margin-bottom:16px;text-align:left;">';
    html+='<div style="font-weight:800;font-size:13px;margin-bottom:7px;color:'+g.c+'">'+g.label+'</div>';
    if(!top.length){ html+='<div style="font-size:12px;color:#64748b;padding:6px 0">Ei tuloksia viel\u00e4.</div>'; }
    else { top.forEach(function(e,i){
      var mine = me && e.player===me;
      html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 9px;border-radius:8px;background:'+(mine?'rgba(249,115,22,0.18)':'rgba(255,255,255,0.04)')+';margin-bottom:4px;border:1px solid '+(mine?'rgba(249,115,22,0.5)':'rgba(255,255,255,0.07)')+'">';
      html+='<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:15px">'+medals[i]+'</span><span style="font-weight:700;font-size:13px;color:#fff">'+e.player+(mine?' (sin\u00e4)':'')+'</span></div>';
      html+='<span style="font-weight:900;font-size:15px;color:'+g.c+'">'+e.pts+'</span>';
      html+='</div>';
    }); }
    html+='</div>';
  });
  body.innerHTML=html;
};

// ══════════════════════════════════════════
//  TRIGGERIT
// ══════════════════════════════════════════
var LONG_PRESS_MS=700;

function attachTeroPress(){
  var sb=document.getElementById('scoreboard');
  if(!sb){ setTimeout(attachTeroPress,1000); return; }
  new MutationObserver(function(){
    sb.querySelectorAll('.score-card').forEach(function(card){
      if(card._gameBound) return;
      var nm=card.querySelector('.name');
      if(!nm||nm.textContent.toLowerCase().indexOf('tero')===-1) return;
      card._gameBound=true;
      var t=null;
      card.addEventListener('mousedown',function(){ t=setTimeout(openGameMenu,LONG_PRESS_MS); });
      card.addEventListener('touchstart',function(){ t=setTimeout(openGameMenu,LONG_PRESS_MS); },{passive:true});
      ['mouseup','mouseleave','touchend','touchcancel'].forEach(function(ev){ card.addEventListener(ev,function(){ clearTimeout(t); }); });
    });
  }).observe(sb,{childList:true,subtree:true});
}
attachTeroPress();



})();
