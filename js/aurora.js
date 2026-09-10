// KULJU CUP – revontulitausta
// Eriytetty index.html:stä. Sisältö on siirretty sellaisenaan, ilman muutoksia.

/* ===== REVONTULI-TAUSTA (visuaalinen; ei kosketa pisteytykseen/dataan) ===== */
window._auroraCfg = window._auroraCfg || { v:0, strength:1.8, amp:2.6, speed:3.2, pal:'klassinen' };
(function(){
  var cvs=document.getElementById('aurora-bg'); if(!cvs) return;
  var ctx=cvs.getContext('2d');
  var dpr=Math.min(window.devicePixelRatio||1,2), W=0,H=0;
  var reduce=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SPECTRUM=[
    { col:[ 64,255,150], baseY:0.50, amp:0.060, h:0.40, f1:0.0016, f2:0.0041, s1:0.10, s2:0.17, ph:0.0, alpha:0.42 },
    { col:[ 40,235,190], baseY:0.45, amp:0.075, h:0.42, f1:0.0013, f2:0.0037, s1:0.08, s2:0.14, ph:1.1, alpha:0.40 },
    { col:[ 34,211,238], baseY:0.39, amp:0.085, h:0.44, f1:0.0019, f2:0.0033, s1:0.12, s2:0.19, ph:2.3, alpha:0.36 },
    { col:[ 70,140,255], baseY:0.33, amp:0.095, h:0.46, f1:0.0011, f2:0.0029, s1:0.07, s2:0.12, ph:3.5, alpha:0.32 },
    { col:[150, 95,245], baseY:0.27, amp:0.105, h:0.48, f1:0.0015, f2:0.0044, s1:0.10, s2:0.16, ph:4.6, alpha:0.28 },
    { col:[225, 80,210], baseY:0.21, amp:0.115, h:0.50, f1:0.0012, f2:0.0026, s1:0.06, s2:0.11, ph:5.8, alpha:0.22 }
  ];
  var VARIANTS=[ {idx:[0,1,2,3,4,5],mul:1.0}, {idx:[0,1,2,3],mul:1.05}, {idx:[0,2,3,4],mul:0.62} ];
  // Väripaletit. 'klassinen' = alkuperäinen. Valinta tulee window._auroraCfg.pal-kentästä.
  var PALETTES = {
    klassinen: null, // käyttää SPECTRUMia sellaisenaan
    violetti: [[140,80,255],[120,70,240],[165,95,250],[190,110,255],[150,95,245],[225,80,210]],
    punainen: [[255,110,90],[240,85,70],[255,140,80],[230,60,90],[255,90,140],[200,50,110]],
    turkoosi: [[60,230,220],[40,215,200],[34,211,238],[70,200,255],[80,180,245],[110,160,255]],
    kulta:    [[255,205,90],[250,180,70],[255,225,140],[240,160,60],[255,190,110],[220,140,50]],
    jaa:      [[190,225,255],[160,205,245],[210,240,255],[140,190,240],[175,215,250],[120,170,230]]
  };
  function spectrumFor(pal){
    var cols = PALETTES[pal];
    if(!cols) return SPECTRUM;
    return SPECTRUM.map(function(b,i){ return Object.assign({}, b, { col: cols[i % cols.length] }); });
  }
  function resize(){ W=cvs.width=Math.floor(window.innerWidth*dpr); H=cvs.height=Math.floor(window.innerHeight*dpr); cvs.style.width=window.innerWidth+'px'; cvs.style.height=window.innerHeight+'px'; }
  window.addEventListener('resize',resize); resize();
  function curtain(b,time,strength,ampMul,speedMul,mul){
    var t=time/1000;
    function topY(x){ return H*b.baseY + Math.sin(x*b.f1+t*b.s1*speedMul+b.ph)*H*b.amp*ampMul + Math.sin(x*b.f2+t*b.s2*0.8*speedMul+b.ph*1.6)*H*b.amp*0.5*ampMul + Math.sin(t*0.05*speedMul+b.ph)*H*0.015; }
    var breathe=0.78+0.22*Math.sin(t*0.18+b.ph);
    var a=b.alpha*strength*mul*breathe, curtainH=H*b.h, step=Math.max(6,Math.floor(W/120));
    ctx.beginPath(); ctx.moveTo(0,topY(0));
    for(var x=step;x<=W;x+=step) ctx.lineTo(x,topY(x));
    ctx.lineTo(W,topY(W)+curtainH);
    for(var x2=W;x2>=0;x2-=step) ctx.lineTo(x2,topY(x2)+curtainH);
    ctx.closePath();
    var yC=H*b.baseY, g=ctx.createLinearGradient(0,yC-H*b.amp,0,yC+curtainH), c=b.col.join(',');
    g.addColorStop(0,'rgba('+c+',0)'); g.addColorStop(0.10,'rgba('+c+','+(a*0.95)+')');
    g.addColorStop(0.45,'rgba('+c+','+(a*0.45)+')'); g.addColorStop(1,'rgba('+c+',0)');
    ctx.fillStyle=g; ctx.fill();
  }
  function frame(time){
    var cfg=window._auroraCfg||{v:0,strength:1.8,amp:2.6,speed:3.2};
    var V=VARIANTS[cfg.v]||VARIANTS[0];
    var SP=spectrumFor(cfg.pal||'klassinen');
    ctx.clearRect(0,0,W,H); ctx.globalCompositeOperation='lighter';
    for(var i=0;i<V.idx.length;i++) curtain(SP[V.idx[i]],time,cfg.strength,cfg.amp,cfg.speed,V.mul);
    if(!reduce) raf=requestAnimationFrame(frame);
  }
  var raf=requestAnimationFrame(frame);
  window._auroraRedraw=function(){ if(reduce){ cancelAnimationFrame(raf); requestAnimationFrame(frame); } };
})();
