// KULJU CUP – intron kohtaukset ja tehosteet
// Eriytetty index.html:stä. Sisältö on siirretty sellaisenaan, ilman muutoksia.


// ── ADMIN INTRO FUNCTIONS ──
window._adminWatchIntro = function(){
  document.getElementById('settingsModal').style.display='none';
  var el=document.getElementById('introScreen');
  el.style.display='flex'; el.style.opacity='1'; el.style.transition='';
  el.classList.remove('expand');
  // reset all scenes
  document.querySelectorAll('.iscene').forEach(function(s){ s.style.opacity=''; s.style.transition=''; });
  // restart
  clearTimeout(window._introTimer);
  window._introCurrentScene=-1;
  setTimeout(function(){ window._introPlay(0); },300);
};

window._adminSendIntro = async function(){
  var status=document.getElementById('introSendStatus');
  status.textContent='Lähetetään...';
  try {
    if(!window._firebaseDb) throw new Error('Firebase ei ole valmis, yritä uudelleen');
    var {doc:fd2, setDoc:fsd2} = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    var introDoc = fd2(window._firebaseDb, 'app', 'intro_broadcast');
    await fsd2(introDoc, {active:true, sentAt:Date.now(), seenBy:[]});
    status.textContent='✅ Lähetetty! Kaikki näkevät intron seuraavalla kirjautumisella.';
    setTimeout(function(){ status.textContent=''; }, 5000);
  } catch(e) {
    status.textContent='❌ Virhe: '+e.message;
  }
};

// Refactor intro player to be restartable
window._introTimer=null;
window._introCurrentScene=-1;
window._introMusicFade=null;

window._introStartMusic=function(){
  var a=document.getElementById('introAudio'); if(!a) return;
  if(window._introMusicFade){ clearInterval(window._introMusicFade); window._introMusicFade=null; }
  a.volume=1;
  try{ a.currentTime=0; }catch(e){}
  var p=a.play(); if(p&&p.catch) p.catch(function(){}); // selain voi estää automaattisen äänen
};
window._introStopMusic=function(){
  var a=document.getElementById('introAudio'); if(!a) return;
  if(window._introMusicFade){ clearInterval(window._introMusicFade); window._introMusicFade=null; }
  var v=a.volume, i=0, steps=12;
  window._introMusicFade=setInterval(function(){
    i++; a.volume=Math.max(0, v*(1-i/steps));
    if(i>=steps){ clearInterval(window._introMusicFade); window._introMusicFade=null; a.pause(); try{ a.currentTime=0; }catch(e){} a.volume=1; }
  },60);
};


// ── KSN INTRO FX ENGINE ──
window._introHue=210;
window._introReduceMotion=(function(){ try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; } })();
window._introFxRAF=null; window._introParticles=[]; window._introFw=[]; window._introFxResize=null;
window._introFxStart=function(){
  if(window._introReduceMotion) return;
  window._introFxStop();
  var pc=document.getElementById('introParticles'), fc=document.getElementById('introFx');
  if(!pc||!fc) return;
  var resize=function(){ [pc,fc].forEach(function(c){ c.width=c.clientWidth||window.innerWidth; c.height=c.clientHeight||window.innerHeight; }); };
  resize(); window._introFxResize=resize; window.addEventListener('resize', resize);
  window._introParticles=[];
  var N=70;
  for(var i=0;i<N;i++){
    var far=Math.random()<0.55;
    window._introParticles.push({
      x:Math.random()*pc.width, y:Math.random()*pc.height,
      r: far?(Math.random()*1.2+0.5):(Math.random()*2.2+1.2),
      vy: far?(Math.random()*0.15+0.05):(Math.random()*0.35+0.15),
      vx:(Math.random()-0.5)*(far?0.15:0.3),
      a: far?(Math.random()*0.25+0.1):(Math.random()*0.45+0.25),
      tw:Math.random()*Math.PI*2, far:far
    });
  }
  window._introFw=[];
  var pctx=pc.getContext('2d'), fctx=fc.getContext('2d');
  var last=performance.now();
  var loop=function(now){
    var dt=Math.min(40, now-last); last=now;
    pctx.clearRect(0,0,pc.width,pc.height);
    for(var i=0;i<window._introParticles.length;i++){
      var p=window._introParticles[i];
      p.y-=p.vy*dt*0.12; p.x+=p.vx*dt*0.12; p.tw+=0.05;
      if(p.y<-6){ p.y=pc.height+6; p.x=Math.random()*pc.width; }
      if(p.x<-6) p.x=pc.width+6; if(p.x>pc.width+6) p.x=-6;
      var tw=0.6+0.4*Math.sin(p.tw);
      pctx.beginPath();
      pctx.fillStyle='hsla('+(window._introHue||210)+',80%,'+(p.far?'72%':'85%')+','+(p.a*tw)+')';
      pctx.arc(p.x,p.y,p.r,0,Math.PI*2); pctx.fill();
    }
    fctx.clearRect(0,0,fc.width,fc.height);
    for(var k=window._introFw.length-1;k>=0;k--){
      var sp2=window._introFw[k];
      sp2.x+=sp2.vx*dt*0.06; sp2.y+=sp2.vy*dt*0.06; sp2.vy+=0.018*dt*0.06; sp2.life-=dt;
      if(sp2.life<=0){ window._introFw.splice(k,1); continue; }
      fctx.globalAlpha=Math.max(0, sp2.life/sp2.max);
      fctx.fillStyle=sp2.color;
      fctx.beginPath(); fctx.arc(sp2.x,sp2.y,sp2.r,0,Math.PI*2); fctx.fill();
    }
    fctx.globalAlpha=1;
    window._introFxRAF=requestAnimationFrame(loop);
  };
  window._introFxRAF=requestAnimationFrame(loop);
};
window._introFxStop=function(){
  if(window._introFxRAF){ cancelAnimationFrame(window._introFxRAF); window._introFxRAF=null; }
  if(window._introFxResize){ window.removeEventListener('resize', window._introFxResize); window._introFxResize=null; }
  var pc=document.getElementById('introParticles'), fc=document.getElementById('introFx');
  try{ if(pc) pc.getContext('2d').clearRect(0,0,pc.width,pc.height); }catch(e){}
  try{ if(fc) fc.getContext('2d').clearRect(0,0,fc.width,fc.height); }catch(e){}
  window._introParticles=[]; window._introFw=[];
};
window._introBurst=function(cx,cy){
  if(window._introReduceMotion) return;
  var fc=document.getElementById('introFx'); if(!fc) return;
  cx=(cx==null)? fc.width*(0.3+Math.random()*0.4):cx;
  cy=(cy==null)? fc.height*(0.22+Math.random()*0.3):cy;
  var hues=[45,28,200,12,55], hue=hues[Math.floor(Math.random()*hues.length)];
  var n=46+Math.floor(Math.random()*20);
  for(var i=0;i<n;i++){
    var ang=(Math.PI*2)*(i/n), spd=1.6+Math.random()*2.6;
    window._introFw.push({
      x:cx, y:cy, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd,
      r:1.4+Math.random()*1.6, life:900+Math.random()*500, max:1400,
      color:'hsl('+(hue+(Math.random()*30-15))+',95%,'+(60+Math.random()*15)+'%)'
    });
  }
};
window._introFinaleFireworks=function(){
  if(window._introReduceMotion) return;
  var t=0, n=6;
  var fire=function(){ window._introBurst(); if(++t<n) setTimeout(fire, 350+Math.random()*300); };
  fire();
};
window._introPunch=function(sceneId){
  var el=document.getElementById(sceneId); if(!el) return;
  el.classList.remove('punch'); void el.offsetWidth; el.classList.add('punch');
  var sh=document.getElementById('introSheen');
  if(sh){ sh.classList.remove('sweep'); void sh.offsetWidth; sh.classList.add('sweep'); }
};
window._introYearRoll=function(){
  if(window._introReduceMotion) return;
  var el=document.querySelector('#is5 .year-num'); if(!el) return;
  var target=parseInt(String(el.textContent||'').replace(/\D/g,''),10);
  if(!target){ return; }
  var start=performance.now(), dur=1100, from=Math.max(0,target-40);
  var step=function(now){
    var t=Math.min(1,(now-start)/dur); var e=1-Math.pow(1-t,3);
    el.textContent=String(Math.round(from+(target-from)*e));
    if(t<1) requestAnimationFrame(step); else el.textContent=String(target);
  };
  requestAnimationFrame(step);
};
window._introSceneFX=function(sceneId, idx){
  var scr=document.getElementById('introScreen');
  var hue=Math.round(210-(idx/13)*(210-40));
  window._introHue=hue;
  if(scr) scr.style.setProperty('--introHue', hue);
  if(sceneId==='is1'){ var s0=document.getElementById('introSheen'); if(s0){ s0.classList.remove('sweep'); void s0.offsetWidth; s0.classList.add('sweep'); } }
  if(sceneId==='is5'){ window._introPunch('is5'); window._introYearRoll(); }
  if(sceneId==='is13'){ if(scr) scr.classList.add('fx-gold'); window._introPunch('is13'); window._introFinaleFireworks(); }
};

window._introPlay=function(idx){
  var SCENES=[
    ['is1',3500,false],['is2',6200,false],['is3',4400,false],['is4',5000,false],
    ['is5',4000,false],['is6',6500,false],['is7',6500,false],['is8',5600,false],
    ['is9',5600,false],['is10',6000,false],['is11',5600,false],['is12',5200,false],
    ['is13',4600,false],['is14',3600,false]
  ];
  if(idx===0){ window._introStartMusic(); var _scr0=document.getElementById('introScreen'); if(_scr0) _scr0.classList.remove('fx-gold'); window._introFxStart(); } // biisi alkaa videon alkaessa
  if(idx>=SCENES.length){
    window._introStopMusic(); window._introFxStop(); // biisi loppuu videon loppuessa
    var el=document.getElementById('introScreen');
    el.style.transition='opacity 1.5s'; el.style.opacity='0';
    setTimeout(function(){ el.style.display='none'; },1500);
    return;
  }
  var cur=window._introCurrentScene;
  if(cur>=0){
    var prev=document.getElementById(SCENES[cur][0]);
    prev.style.transition='opacity 0.7s ease'; prev.style.opacity='0';
    setTimeout(function(){ prev.style.opacity=''; },750);
  }
  if(idx===1) document.getElementById('introScreen').classList.add('expand');
  if(SCENES[idx][2]){
    var f=document.getElementById('introFlash');
    f.style.animation='none'; void f.offsetWidth;
    f.style.animation='introDoFlash 0.2s ease forwards';
  }
  var el2=document.getElementById(SCENES[idx][0]);
  el2.innerHTML=el2.innerHTML; // käynnistä kohtauksen sisäiset animaatiot uudelleen
  el2.style.transition='opacity 0.9s ease'; el2.style.opacity='1';
  try{ window._introSceneFX(SCENES[idx][0], idx); }catch(e){}
  window._introCurrentScene=idx;
  window._introTimer=setTimeout(function(){ window._introPlay(idx+1); },SCENES[idx][1]);
};
window._skipIntro=function(){ clearTimeout(window._introTimer); window._introStopMusic(); window._introFxStop(); var el=document.getElementById('introScreen'); el.style.transition='opacity 1.5s'; el.style.opacity='0'; setTimeout(function(){ el.style.display='none'; },1500); };
