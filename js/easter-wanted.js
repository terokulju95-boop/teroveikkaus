// KULJU CUP – salainen WANTED-löytö
// Eriytetty index.html:stä. Sisältö on siirretty sellaisenaan, ilman muutoksia.


// ── WANTED EASTER EGG ──
(function(){
  var pressTimer=null;
  var TIMO='Timo';

  function attachLongPress(){
    // Yritetään löytää Timo-nappi pelaajagridistä
    var grid=document.getElementById('playerGrid');
    if(!grid){ setTimeout(attachLongPress,1000); return; }
    var obs=new MutationObserver(function(){
      var btns=grid.querySelectorAll('.player-btn');
      btns.forEach(function(btn){
        if(btn.textContent.trim().startsWith(TIMO) && !btn._wantedBound){
          btn._wantedBound=true;
          btn.addEventListener('mousedown', startPress);
          btn.addEventListener('touchstart', startPress, {passive:true});
          btn.addEventListener('mouseup', cancelPress);
          btn.addEventListener('mouseleave', cancelPress);
          btn.addEventListener('touchend', cancelPress);
        }
      });
    });
    obs.observe(grid,{childList:true,subtree:true});
    // Myös pistekortit sovelluksessa
    // Score-card long press (delegated to document)
    function handleScorePress(e){
      var el=e.target.closest('.score-card');
      if(!el) return;
      var nameEl=el.querySelector('.name');
      if(nameEl && nameEl.textContent.replace(/[^a-zA-ZäöåÄÖÅ]/g,'').toLowerCase().indexOf('timo')!==-1){
        startPress();
      }
    }
    document.addEventListener('mousedown', handleScorePress);
    document.addEventListener('touchstart', function(e){ handleScorePress(e); }, {passive:true});
    document.addEventListener('mouseup', cancelPress);
    document.addEventListener('mouseleave', cancelPress);
    document.addEventListener('touchend', cancelPress);
    document.addEventListener('touchcancel', cancelPress);
  }

  function startPress(){
    pressTimer=setTimeout(function(){
      document.getElementById('wantedOverlay').classList.add('show');
    }, 800);
  }
  function cancelPress(){ clearTimeout(pressTimer); }

  attachLongPress();
})();
