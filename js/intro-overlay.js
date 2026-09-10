// KULJU CUP – intro-ruudun näyttölogiikka
// Eriytetty index.html:stä. Sisältö on siirretty sellaisenaan, ilman muutoksia.

// ── INTRO ──
(function(){
  // (Vanha intro-ohjain poistettu kuolleena – aktiivinen ohjain on window._introPlay.)

  // Piilotetaan intro heti - naytetaan VAIN jos Firebase-lippu on asetettu
  document.getElementById('introScreen').style.display='none';

  // Odotetaan että Firebase on valmis, sitten tarkistetaan lippu
  (function waitForFirebase(){
    if(!window._firebaseDb){
      setTimeout(waitForFirebase, 100);
      return;
    }
    (async function checkIntroBroadcast(){
      try{
        var {getDoc:gd2,doc:d2,setDoc:sd2}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        var fdb2=window._firebaseDb;
        var introDoc=d2(fdb2,'app','intro_broadcast');
        var snap=await gd2(introDoc);
        if(!snap.exists()) return;
        var data=snap.data();
        if(!data.active) return;

        // Laitteen uniikki id
        var deviceKey='';
        try{ deviceKey=localStorage.getItem('tv_device_id'); }catch(e){}
        if(!deviceKey){
          deviceKey='dev_'+Math.random().toString(36).substr(2,9);
          try{ localStorage.setItem('tv_device_id',deviceKey); }catch(e){}
        }

        var seenBy=data.seenBy||[];
        if(seenBy.includes(deviceKey)) return;

        // Merkitaan nahdyksi heti
        seenBy=seenBy.concat([deviceKey]);
        await sd2(introDoc,Object.assign({},data,{seenBy:seenBy}));

        // Naytetaan intro
        var el=document.getElementById('introScreen');
        el.style.display='flex'; el.style.opacity='1';
        setTimeout(function(){ window._introPlay(0); },300);
      }catch(e){ console.error('Intro broadcast error:',e); }
    })();
  })();
})();
