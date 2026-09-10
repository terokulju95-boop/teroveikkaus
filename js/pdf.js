// KULJU CUP – PDF-raportti (jsPDF)
// Eriytetty index.html:stä. Sisältö on siirretty sellaisenaan, ilman muutoksia.

document.getElementById('downloadPdfBtn').addEventListener('click', function(){
  if(!window.jspdf){ alert('Odota hetki ja yritä uudelleen.'); return; }
  var t = window.getTournament ? window.getTournament() : null;
  if(!t){ alert('Valitse ensin turnaus.'); return; }
  var {jsPDF} = window.jspdf;
  var doc = new jsPDF({orientation:'portrait', unit:'mm', format:'a4'});

  // VÄRIT
  var ORANGE = [249,115,22];
  var DARK   = [15,23,42];
  var DARK2  = [30,41,59];
  var WHITE  = [255,255,255];
  var GRAY   = [148,163,184];
  var GOLD   = [251,191,36];
  var SILVER = [203,213,225];
  var BRONZE = [180,130,70];
  var PURPLE = [124,58,237];
  var GREEN  = [34,197,94];
  var BAR_ORANGE = [249,115,22];
  var BAR_BLUE   = [147,197,253];
  var BAR_BG     = [241,245,249];

  var W = 210, H = 297, ML = 12, MR = 12, CW = W-ML-MR;
  var y = 0;

  var PLIST = window.PLAYERS || [];
  var tots = window.calcTotals ? window.calcTotals(t) : {};
  var sorted = PLIST.slice().sort(function(a,b){ return (tots[b]||0)-(tots[a]||0); });
  var cmPts = window.calcMatchPts || function(){ return 0; };
  var cmProx = window.calcTimeProximityPts || function(){ return {}; };
  var fmatch = window.fieldMatch || function(k,p,a){ return (p||'').toLowerCase()===(a||'').toLowerCase(); };
  var today = new Date().toLocaleDateString('fi-FI');
  var aT3 = t.actualTopThree || [];

  var FLIST = [
    {key:'lopputulos',label:'Lopputulos'},{key:'ekan_maalintekija',label:'Ekan maalintekija'},
    {key:'ekan_maali_aika',label:'Ekan maalin tekoaika'},{key:'ekan_jahyn_saaja',label:'Ekan jaahyn saaja'},
    {key:'ekan_jahyn_syy',label:'Ekan jaahyn syy'},{key:'montako_jahyja',label:'Montako jaahyda'},
    {key:'parempi_laukasu',label:'Kummalla parempi laukaus%'},{key:'parempi_alotus',label:'Kummalla parempi aloitus%'},
    {key:'parempi_torjunta',label:'Kummalla parempi torjunta%'},{key:'parempi_alivoima',label:'Kummalla parempi alivoima%'},
    {key:'parempi_ylivoima',label:'Kummalla parempi ylivoima%'},{key:'era1',label:'1. era tulos'},
    {key:'era2',label:'2. era tulos'},{key:'valmentaja_haasto',label:'Valmentaja haasto'},{key:'maali_tyhjiin',label:'Maali tyhjiin'}
  ];

  function rgb(c){ doc.setFillColor(c[0],c[1],c[2]); }
  function tc(c){ doc.setTextColor(c[0],c[1],c[2]); }
  function dc(c){ doc.setDrawColor(c[0],c[1],c[2]); }
  function chk(n){ if(y+n>H-10){ doc.addPage(); pageBg(); y=20; } }

  function pageBg(){
    // White page background
    doc.setFillColor(255,255,255);
    doc.rect(0,0,W,H,'F');
    // Top black bar
    doc.setFillColor(15,23,42);
    doc.rect(0,0,W,8,'F');
    // Bottom black bar
    doc.setFillColor(15,23,42);
    doc.rect(0,H-8,W,8,'F');
  }
  pageBg();

  // ---- ORANSSI HEADER ----
  rgb(ORANGE); doc.rect(0,0,W,22,'F');
  tc(WHITE); doc.setFontSize(16); doc.setFont('helvetica','bold');
  doc.text('KULJU CUP - '+t.name, W/2, 14, {align:'center'});
  y = 28;
  tc([100,116,139]); doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text('Luotu: '+today, W-MR, y, {align:'right'});
  y += 8;

  // ---- SECTION HEADER fn ----
  function secHeader(txt, color){
    chk(12);
    rgb(color||ORANGE); doc.roundedRect(ML, y, CW, 9, 2, 2, 'F');
    tc(WHITE); doc.setFontSize(10); doc.setFont('helvetica','bold');
    doc.text(txt, ML+4, y+6);
    y += 13;
  }

  // ---- LOPPUSIJOITUKSET ----
  secHeader('LOPPUSIJOITUKSET', ORANGE);

  // Top 3 podium boxes
  var boxW = CW/3 - 3;
  var boxColors = [GOLD, SILVER, BRONZE];
  var boxLabels = ['1.','2.','3.'];
  sorted.slice(0,3).forEach(function(p,i){
    var bx = ML + i*(boxW+4);
    chk(28);
    doc.setFillColor(boxColors[i][0],boxColors[i][1],boxColors[i][2]);
    doc.roundedRect(bx, y, boxW, 26, 3, 3, 'F');
    tc(DARK2); doc.setFontSize(16); doc.setFont('helvetica','bold');
    doc.text(boxLabels[i], bx+boxW/2, y+9, {align:'center'});
    doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text(p, bx+boxW/2, y+16, {align:'center'});
    doc.setFontSize(12);
    doc.text((tots[p]||0)+' p', bx+boxW/2, y+23, {align:'center'});
  });
  y += 30;

  // Rankings table
  chk(8);
  doc.setFillColor(241,245,249); doc.rect(ML,y,CW,7,'F');
  tc([100,116,139]); doc.setFontSize(8); doc.setFont('helvetica','bold');
  doc.text('Sija', ML+3, y+5);
  doc.text('Pelaaja', ML+35, y+5);
  doc.text('Pisteet', ML+100, y+5);
  y += 7;
  var rank=1;
  sorted.forEach(function(p,i){
    chk(7);
    if(i>0 && (tots[p]||0)<(tots[sorted[i-1]]||0)) rank=i+1;
    var isTop3 = rank<=3;
    var isSameRank = i>0 && (tots[p]||0)===(tots[sorted[i-1]]||0);
    if(i%2===0){ doc.setFillColor(248,250,252); doc.rect(ML,y,CW,7,'F'); }
    var suf = rank>3 ? ' (poo)' : '';
    tc(rank>3 ? [100,116,139] : DARK2);
    doc.setFontSize(9);
    doc.setFont('helvetica', rank<=3 ? 'bold' : 'normal');
    doc.text(rank+'.'+suf, ML+3, y+5);
    doc.text(p, ML+35, y+5);
    doc.setFont('helvetica','bold');
    doc.text((tots[p]||0)+' p', ML+100, y+5);
    y+=7;
    dc([229,231,235]); doc.line(ML,y,ML+CW,y);
  });
  y += 6;

  // ---- KOLMEN KÄRKI ----
  secHeader('KOLMEN KARKI \u2013 VEIKKAUKSET', ORANGE);
  tc(DARK2); doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.text('Oikea jarjestys:', ML, y); y+=5;

  var t3Colors = [GOLD, SILVER, BRONZE];
  aT3.forEach(function(tm,i){
    chk(8);
    doc.setFillColor(t3Colors[i][0],t3Colors[i][1],t3Colors[i][2]);
    doc.roundedRect(ML, y, CW, 7, 1.5, 1.5, 'F');
    tc(DARK2); doc.setFontSize(9); doc.setFont('helvetica','bold');
    doc.text((i+1)+'. sija:', ML+3, y+5);
    doc.text(tm||'—', ML+25, y+5);
    y+=8;
  });
  y+=3;

  // Top3 predictions table
  tc(DARK2); doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.text('Pelaajien veikkaukset:', ML, y); y+=5;
  chk(8);
  doc.setFillColor(241,245,249); doc.rect(ML,y,CW,7,'F');
  tc([100,116,139]); doc.setFontSize(8); doc.setFont('helvetica','bold');
  var cws=[38,36,36,36,20];
  var cx=ML+2;
  ['Pelaaja','1. sija','2. sija','3. sija','Pisteet'].forEach(function(h,i){ doc.text(h,cx,y+5); cx+=cws[i]; });
  y+=7;
  sorted.forEach(function(p,ri){
    chk(7);
    var pred=(t.topThreePrediction||{})[p]||['','',''];
    var pts=0;
    pred.forEach(function(v,i){ if(v&&aT3[i]&&v.trim().toUpperCase()===(aT3[i]||'').trim().toUpperCase()) pts+=2; });
    if(ri%2===0){ doc.setFillColor(248,250,252); doc.rect(ML,y,CW,7,'F'); }
    cx=ML+2;
    doc.setFontSize(9);
    // Player name - bold if has points
    doc.setFont('helvetica', pts>0?'bold':'normal');
    tc(DARK2); doc.text(p, cx, y+5); cx+=cws[0];
    // Each prediction cell - color if correct/wrong
    pred.forEach(function(v,i){
      var av=aT3[i]||'';
      var ok=av&&v&&v.trim().toUpperCase()===av.trim().toUpperCase();
      var bad=av&&v&&!ok;
      if(ok){ doc.setFillColor(34,197,94); doc.rect(cx-1,y+0.5,cws[i+1]-2,6,'F'); }
      else if(bad){ doc.setFillColor(252,165,165); doc.rect(cx-1,y+0.5,cws[i+1]-2,6,'F'); }
      doc.setFont('helvetica', ok?'bold':'normal');
      tc(ok?WHITE:bad?[127,29,29]:DARK2);
      doc.text(v||'', cx, y+5); cx+=cws[i+1];
    });
    doc.setFont('helvetica','bold');
    tc(pts>0?[22,163,74]:DARK2);
    doc.text(pts+' p', cx, y+5);
    y+=7;
    dc([229,231,235]); doc.line(ML,y,ML+CW,y);
  });
  y+=6;

  // ---- PISTEET OTTELUITTAIN ----
  secHeader('PISTEET OTTELUITTAIN', DARK2);

  (t.matches||[]).forEach(function(m){
    var act=(t.actuals||{})[m.id]||{};
    var sc=act.lopputulos?' ('+act.lopputulos+')':'';
    chk(12);
    // Match header box
    doc.setFillColor(241,245,249); doc.roundedRect(ML,y,CW,8,2,2,'F');
    dc([203,213,225]); doc.roundedRect(ML,y,CW,8,2,2,'S');
    tc(DARK2); doc.setFontSize(10); doc.setFont('helvetica','bold');
    doc.text(m.name+' '+sc, ML+4, y+5.5);
    y+=10;

    // Get match points, find max
    var mp=sorted.map(function(p){ return {p:p, pts:cmPts(t,m.id,p)+(cmProx(t,m.id)[p]||0)}; })
                 .sort(function(a,b){ return b.pts-a.pts; });
    var maxPts=mp[0]?mp[0].pts:15;
    if(maxPts===0) maxPts=15;
    var barMaxW=CW-50;

    mp.forEach(function(item){
      chk(8);
      var isTop = item.pts===maxPts;
      var barW = maxPts>0 ? Math.round(item.pts/maxPts*barMaxW) : 0;

      // Player name
      doc.setFontSize(9); doc.setFont('helvetica', isTop?'bold':'normal');
      tc(isTop?DARK2:DARK2);
      doc.text(item.p, ML, y+5);

      // Bar background
      doc.setFillColor(BAR_BG[0],BAR_BG[1],BAR_BG[2]);
      doc.roundedRect(ML+32, y+1, barMaxW, 5, 1, 1, 'F');

      // Bar fill
      if(barW>0){
        if(isTop){ doc.setFillColor(BAR_ORANGE[0],BAR_ORANGE[1],BAR_ORANGE[2]); }
        else { doc.setFillColor(BAR_BLUE[0],BAR_BLUE[1],BAR_BLUE[2]); }
        doc.roundedRect(ML+32, y+1, barW, 5, 1, 1, 'F');
      }

      // Points
      tc(DARK2); doc.setFont('helvetica','bold');
      doc.text(item.pts+' p', ML+32+barMaxW+3, y+5);
      y+=7;
    });
    y+=4;
  });

  // ---- PARHAAT SUORITUKSET ----
  secHeader('PARHAAT SUORITUKSET', PURPLE);

  // Find best overall
  var best=null;
  (t.matches||[]).forEach(function(m){
    sorted.forEach(function(p){
      var pts=cmPts(t,m.id,p)+(cmProx(t,m.id)[p]||0);
      if(!best||pts>best.pts) best={player:p,matchName:m.name,pts:pts};
    });
  });
  if(best){
    chk(20);
    doc.setFillColor(124,58,237); doc.roundedRect(ML,y,CW,18,3,3,'F');
    tc([196,181,253]); doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.text('Paras yksittainen suoritus', ML+4, y+5);
    tc(WHITE); doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text(best.player, ML+4, y+12);
    doc.text(best.pts+' p', ML+CW-4, y+12, {align:'right'});
    tc([196,181,253]); doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.text(best.matchName, ML+4, y+16);
    y+=22;
  }

  tc(DARK2); doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.text('Pelaajien parhaat ottelut:', ML, y); y+=6;
  sorted.forEach(function(p){
    chk(6);
    var b=null;
    (t.matches||[]).forEach(function(m){ var pts=cmPts(t,m.id,p)+(cmProx(t,m.id)[p]||0); if(!b||pts>b.pts) b={matchName:m.name,pts:pts}; });
    doc.setFontSize(9); doc.setFont('helvetica','bold'); tc(DARK2);
    doc.text(p+':', ML+3, y);
    doc.setFont('helvetica','normal'); tc([100,116,139]);
    doc.text((b?b.matchName:'—')+' \u2013 '+(b?b.pts:0)+' p', ML+28, y);
    y+=5.5;
  });
  y+=4;

  // ---- TILASTOJA VASTAUKSISTA ----
  secHeader('TILASTOJA VASTAUKSISTA', DARK2);

  var fs=FLIST.map(function(f){
    var ok=0,tot=0;
    (t.matches||[]).forEach(function(m){
      var av=((t.actuals||{})[m.id]||{})[f.key];
      if(av==null||av==='') return;
      sorted.forEach(function(p){ tot++; var pv=(((t.predictions||{})[m.id]||{})[p]||{})[f.key]||''; if(fmatch(f.key,pv,av)) ok++; });
    });
    return {label:f.label,ok:ok,tot:tot,pct:tot>0?Math.round(ok/tot*100):0};
  }).filter(function(f){ return f.tot>0; });

  if(fs.length){
    // Easy/hard boxes side by side
    var easy=fs.reduce(function(a,b){ return a.pct>b.pct?a:b; });
    var hard=fs.reduce(function(a,b){ return a.pct<b.pct?a:b; });
    tc(DARK2); doc.setFontSize(9); doc.setFont('helvetica','bold');
    doc.text('Helpoin ja vaikein kohde:', ML, y); y+=5;
    chk(18);
    var hw=(CW-4)/2;
    // Easy box - green tint
    doc.setFillColor(220,252,231); doc.roundedRect(ML,y,hw,16,2,2,'F');
    dc([134,239,172]); doc.roundedRect(ML,y,hw,16,2,2,'S');
    tc([22,101,52]); doc.setFontSize(8); doc.setFont('helvetica','bold');
    doc.text('Helpoin: '+easy.label, ML+3, y+6);
    doc.setFont('helvetica','normal'); tc([21,128,61]);
    doc.text(easy.ok+'/'+easy.tot+' oikein ('+easy.pct+'%)', ML+3, y+12);
    // Hard box - red tint
    var hx=ML+hw+4;
    doc.setFillColor(254,226,226); doc.roundedRect(hx,y,hw,16,2,2,'F');
    dc([252,165,165]); doc.roundedRect(hx,y,hw,16,2,2,'S');
    tc([153,27,27]); doc.setFontSize(8); doc.setFont('helvetica','bold');
    doc.text('Vaikein: '+hard.label, hx+3, y+6);
    doc.setFont('helvetica','normal'); tc([185,28,28]);
    doc.text(hard.ok+'/'+hard.tot+' oikein ('+hard.pct+'%)', hx+3, y+12);
    y+=20;

    // Stats table header
    secHeader('OIKEAT VASTAUKSET \u2013 MONTAKO ARVASI OIKEIN', GREEN);

    // Table header row
    chk(7);
    doc.setFillColor(241,245,249); doc.rect(ML,y,CW,7,'F');
    tc([100,116,139]); doc.setFontSize(8); doc.setFont('helvetica','bold');
    doc.text('Kysymys', ML+2, y+5);
    doc.text('Oikein', ML+85, y+5);
    doc.text('%', ML+CW-8, y+5, {align:'right'});
    y+=7;

    var barCW=55;
    fs.slice().sort(function(a,b){ return b.pct-a.pct; }).forEach(function(f,i){
      chk(7);
      if(i%2===0){ doc.setFillColor(248,250,252); doc.rect(ML,y,CW,7,'F'); }
      tc(DARK2); doc.setFontSize(8); doc.setFont('helvetica','normal');
      doc.text(f.label, ML+2, y+5);
      doc.text(f.ok+'/'+f.tot, ML+85, y+5);

      // Color bar
      var barColor;
      if(f.pct>=50) barColor=[34,197,94];
      else if(f.pct>=25) barColor=[249,115,22];
      else barColor=[239,68,68];

      var bx=ML+105, bw=barCW;
      doc.setFillColor(229,231,235); doc.roundedRect(bx,y+1.5,bw,4,1,1,'F');
      if(f.pct>0){
        doc.setFillColor(barColor[0],barColor[1],barColor[2]);
        doc.roundedRect(bx,y+1.5,Math.max(1,Math.round(f.pct/100*bw)),4,1,1,'F');
      }
      tc(DARK2); doc.setFont('helvetica','bold');
      doc.text(f.pct+'%', ML+CW-2, y+5, {align:'right'});
      y+=7;
      dc([229,231,235]); doc.line(ML,y,ML+CW,y);
    });
  }

  // ---- LOPPUSIVU ----
  doc.addPage(); pageBg();
  // Full dark background
  doc.setFillColor(15,23,42); doc.rect(0,8,W,H-16,'F');
  // Orange stripes top/bottom already in pageBg
  doc.setFillColor(249,115,22); doc.rect(0,0,W,8,'F');
  doc.setFillColor(249,115,22); doc.rect(0,H-8,W,8,'F');

  var cy=80;
  tc(ORANGE); doc.setFontSize(22); doc.setFont('helvetica','bold');
  doc.text('Kiitos osallistumisesta!', W/2, cy, {align:'center'}); cy+=14;
  tc(WHITE); doc.setFontSize(12); doc.setFont('helvetica','normal');
  doc.text('Turnaus: '+t.name, W/2, cy, {align:'center'}); cy+=16;

  // Winner box
  if(sorted.length){
    var winner=sorted[0];
    var wbW=90, wbH=38, wbX=(W-wbW)/2;
    doc.setFillColor(249,115,22); doc.roundedRect(wbX,cy,wbW,wbH,4,4,'F');
    tc(WHITE); doc.setFontSize(9); doc.setFont('helvetica','bold');
    doc.text('TURNAUKSEN VOITTAJA', W/2, cy+9, {align:'center'});
    doc.setFontSize(20); doc.setFont('helvetica','bold');
    doc.text(winner, W/2, cy+22, {align:'center'});
    doc.setFontSize(12);
    doc.text((tots[winner]||0)+' pistettä', W/2, cy+32, {align:'center'});
    cy+=44;
  }

  cy+=6;
  tc([148,163,184]); doc.setFontSize(8); doc.setFont('helvetica','normal');
  doc.text('Kaikki sijoitukset:', W/2, cy, {align:'center'}); cy+=7;
  var rank2=1;
  sorted.forEach(function(p,i){
    if(i>0&&(tots[p]||0)<(tots[sorted[i-1]]||0)) rank2=i+1;
    var suf=rank2>3?' (poo)':'';
    var isTop=rank2<=3;
    doc.setFontSize(isTop?11:9);
    doc.setFont('helvetica',isTop?'bold':'normal');
    tc(isTop?WHITE:GRAY);
    doc.text(rank2+'. '+p+' - '+(tots[p]||0)+' p'+suf, W/2, cy, {align:'center'});
    cy+=isTop?7:6;
  });
  cy+=8;
  tc(ORANGE); doc.setFontSize(14); doc.setFont('helvetica','bold');
  doc.text('* * *', W/2, cy, {align:'center'}); cy+=8;
  tc(GRAY); doc.setFontSize(8); doc.setFont('helvetica','normal');
  doc.text('KULJU CUP - raportti '+today, W/2, cy, {align:'center'});

  // ---- PELLE-SIVU PDF:ssä ----
  // Haetaan data asynkronisesti ja tallennetaan PDF sen jälkeen
  (async function(){
    try {
      var {getDoc: gd, doc: dd} = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    } catch(e){}
    // Käytetään globaaleja jotka on jo ladattu
    var pelleData = {};
    try {
      if(window._getPelleData) pelleData = await window._getPelleData();
    } catch(e){}

    var counts = pelleData.counts || {};
    var total  = pelleData.total  || 0;
    if(total > 0){
      doc.addPage(); pageBg();
      doc.setFillColor(15,23,42); doc.rect(0,8,W,H-16,'F');
      doc.setFillColor(249,115,22); doc.rect(0,0,W,8,'F');
      doc.setFillColor(249,115,22); doc.rect(0,H-8,W,8,'F');

      var py = 50;
      tc(ORANGE); doc.setFontSize(20); doc.setFont('helvetica','bold');
      doc.text('🤡 TIMO ON PELLE -tilasto', W/2, py, {align:'center'}); py+=12;
      tc(WHITE); doc.setFontSize(11); doc.setFont('helvetica','normal');
      doc.text('Nappia on painettu yhteensä '+total+' kertaa', W/2, py, {align:'center'}); py+=14;

      if(pelleData.lastPressed){
        var lp = pelleData.lastPressed;
        var lpStr = new Date(lp.ts).toLocaleString('fi-FI',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
        tc(GRAY); doc.setFontSize(9);
        doc.text('Viimeksi painoi: '+lp.player+' ('+lpStr+')', W/2, py, {align:'center'}); py+=14;
      }

      // Taulukko pelaajittain
      var bw = 80;
      var bx = (W-bw)/2 - 20;
      PLIST.forEach(function(p){
        var c = counts[p] || 0;
        doc.setFillColor(30,41,59); doc.roundedRect(ML, py, CW, 10, 2,2,'F');
        tc(WHITE); doc.setFontSize(9); doc.setFont('helvetica','bold');
        doc.text(p, ML+4, py+7);
        tc(ORANGE); doc.setFont('helvetica','bold');
        doc.text(c+' kertaa', ML+CW-4, py+7, {align:'right'});
        // Palkki
        if(total > 0){
          var pct = c/total;
          doc.setFillColor(249,115,22,0.3); doc.roundedRect(bx, py+2, bw, 6, 1,1,'F');
          if(pct>0){ doc.setFillColor(249,115,22); doc.roundedRect(bx, py+2, Math.max(2,Math.round(pct*bw)), 6, 1,1,'F'); }
        }
        py+=13;
      });
    }
    doc.save('turnausveikkaus_'+t.name.replace(/\s+/g,'_')+'.pdf');
  })();
});
