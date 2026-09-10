// KULJU CUP – lisätoiminnot
// Ominaisuuskytkimet, muokattavat tekstit, ilmoitusasetukset, asetusten välilehdet,
// ulkoasun lisäsäädöt (lumisade + revontulen paletti) ja päivitysbanneri.
//
// Tämä tiedosto EI koske pisteytykseen eikä veikkausten tallennukseen.
// Kaikki uudet asetukset tallentuvat omiin Firestore-dokumentteihinsa:
//   app/features    – ominaisuuskytkimet (vain admin muokkaa)
//   app/texts       – viestipohjat ja häviäjän viestit
//   app/notifyPrefs – pelaajakohtaiset ilmoitusasetukset
//   app/ui          – lumisade ja muut ulkoasusäädöt

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // ───────────────────────────────────────────────────────────
  //  OMINAISUUSKYTKIMET
  //  Vain admin voi muuttaa. Kaikki oletuksena päällä, joten
  //  sovellus toimii täsmälleen kuten ennen jos dokumenttia ei ole.
  // ───────────────────────────────────────────────────────────
  var FEATURES = [
    { key: 'chat',              nimi: 'Chat',                  info: 'Pelaajien väliset viestit ja kelluvat chat-kuplat.' },
    { key: 'chatKuplat',        nimi: 'Kelluvat chat-kuplat',  info: 'Ruudulla kelluvat pikakuvakkeet avoimiin keskusteluihin.' },
    { key: 'pelit',             nimi: 'Minipelit',             info: '2048, Väistä kiekkoja ja Snake.' },
    { key: 'wrapped',           nimi: 'Kauden kooste',         info: 'Turnauksen päätyttyä näytettävä Wrapped-kooste.' },
    { key: 'hallOfFame',        nimi: 'Hall of Fame',          info: 'Historian ja uratilastojen näkymä.' },
    { key: 'profiili',          nimi: 'Profiilikortti',        info: 'Pelaajan profiilin avaaminen tulostaulusta ja valikosta.' },
    { key: 'intro',             nimi: 'Intro',                 info: 'Intro-animaatio ja sen lähettäminen pelaajille.' },
    { key: 'revontuli',         nimi: 'Revontulitausta',       info: 'Liikkuva revontuli taustalla.' },
    { key: 'lumisade',          nimi: 'Lumisade',              info: 'Putoavat hiutaleet taustalla.' },
    { key: 'tikkeri',           nimi: 'Uutistikkeri',          info: 'Vierivä tietopalkki sovelluksen yläosassa.' },
    { key: 'sijoitusnuolet',    nimi: 'Sijoitusmuutosnuolet',  info: 'Nuolet tulostaulussa: nousiko vai laskiko sijoitus.' },
    { key: 'haviajanViestit',   nimi: 'Häviäjän viestit',      info: 'Kannustusviesti viimeisenä olevalle pelaajalle.' },
    { key: 'merkkipaalut',      nimi: 'Merkkipaalujuhlat',     info: 'Konfetti ja onnittelu merkkipaaluista.' },
    { key: 'salaisetLoydot',    nimi: 'Salaiset löydöt',       info: 'Piilotetut easter egg -toiminnot.' }
  ];

  var feat = {};                      // avain -> true/false
  window._feat = function (key) {
    return feat[key] !== false;       // oletus: päällä
  };

  function applyFeatures() {
    var b = document.body;
    FEATURES.forEach(function (f) {
      b.classList.toggle('feat-off-' + f.key, feat[f.key] === false);
    });
    // Kelluvat chat-kuplat pois myös silloin kun koko chat on pois
    b.classList.toggle('feat-off-chatKuplat', feat.chat === false || feat.chatKuplat === false);
    if (window._snowRefresh) window._snowRefresh();
    syncSnowToFeature();
    renderFeatureAdmin();
  }

  // Estä toiminnon avaaminen jos se on kytketty pois
  function suojaa(nimi, avain, selite) {
    var alkup = window[nimi];
    if (typeof alkup !== 'function') return;
    window[nimi] = function () {
      if (!window._feat(avain)) {
        alert(selite || 'Tämä toiminto on kytketty pois käytöstä.');
        return;
      }
      return alkup.apply(this, arguments);
    };
  }

  // ───────────────────────────────────────────────────────────
  //  MUOKATTAVAT TEKSTIT
  // ───────────────────────────────────────────────────────────
  var OLETUS_POHJAT = [
    { label: '🏒 Ennuste',      text: '🏒 Suomi voittaa tänään 5-0. Tämä on virallinen ennuste!' },
    { label: '😴 Herätys',      text: '😴 Herätys! Veikkaukset lukittuu pian!' },
    { label: '🤡 Häpeä',        text: '🤡 Joku teistä veikkasi tosi huonosti viime kerralla... tiedätte kyllä kuka.' },
    { label: '💸 Juomat',       text: '💸 Häviäjä maksaa seuraavan illan juomat. Tämä on nyt virallista.' },
    { label: '🎯 Mestari',      text: '🎯 Tänään selviää kuka on todellinen veikkausmestari!' },
    { label: '⏰ Deadline',     text: '⏰ Tikitik... veikkausaika hupenee. Älä ole se joka unohti taas!' },
    { label: '🔒 Lukko',        text: '🔒 Veikkaukset menevät kohta lukkoon. Viimeiset sekunnit ratkaisevat mestarin!' },
    { label: '🧊 Pakkanen',     text: '🧊 Tuntuu kylmältä... vai oliko se vain jonkun jäätävä veikkaus?' },
    { label: '📉 Pohjakosketus',text: '📉 Tilastojen mukaan joku on matkalla kohti pohjaa. Käännä suunta ajoissa!' },
    { label: '🍀 Onnea',        text: '🍀 Onnea kaikille — paitsi sille, joka silti häviää. Te tiedätte tunteen.' },
    { label: '👑 Kruunu',       text: '👑 Kruunu odottaa voittajaa. Loput saavat tyytyä taputuksiin.' },
    { label: '🥶 Kanveesi',     text: '🥶 Joku tarvitsee taas lohdutushalin tämän kierroksen jälkeen. Valmistautukaa.' },
    { label: '📸 Todiste',      text: '📸 Muistakaa: tulokset tallentuvat. Häpeä on ikuista, voitto vielä ikuisempaa.' },
    { label: '🎙️ Selostus',     text: '🎙️ Hyvää iltaa hyvät veikkaajat — ja sinä siellä viimeisellä sijalla.' },
    { label: '🔥 Kuuma putki',  text: '🔥 Jollain on kuuma putki päällä. Muut: nyt olisi hyvä hetki herätä.' },
    { label: '🍕 Panokset',     text: '🍕 Tämän illan häviäjä tilaa pizzat ensi kerralla. Säännöt on säännöt.' },
    { label: '🤝 Sopu',         text: '🤝 Reilua peliä kaikille! (Paitsi voitto on silti minun.)' },
    { label: '🐔 Kana',         text: '🐔 Älä ole kana — uskalla veikata rohkeasti tällä kierroksella!' },
    { label: '🏆 Finaali',      text: '🏆 Ratkaisun hetki lähestyy. Tänään erotellaan legendat ja muut.' },
    { label: '💤 Myöhässä',     text: '💤 Sama porukka veikkaa taas viime tipassa... tiedätte kyllä keitä tarkoitan.' }
  ];

  var OLETUS_HAVIAJA = [
    { emoji: '💪', text: 'Tänään pohja, huomenna huippu. Älä anna periksi!' },
    { emoji: '🎯', text: 'Häviäminen on vain voittamista harjoittelua. Ensi kerralla paremmin!' },
    { emoji: '🧊', text: 'Jääkiekossa pudotuspelit ovat vasta alku. Sinulle tulee uusi mahdollisuus!' },
    { emoji: '🚀', text: 'Kaikki alkaa jostain. Nyt on hyvä hetki nousta.' },
    { emoji: '🍀', text: 'Onni kääntyy. Yksi hyvä ottelu riittää.' }
  ];

  window._texts = { broadcastTemplates: null, loserMessages: null };

  function pohjat() {
    var t = window._texts.broadcastTemplates;
    return (Array.isArray(t) && t.length) ? t : OLETUS_POHJAT;
  }
  function haviajat() {
    var t = window._texts.loserMessages;
    return (Array.isArray(t) && t.length) ? t : OLETUS_HAVIAJA;
  }

  function renderBroadcastTemplates() {
    var el = $('broadcastTemplates');
    if (!el) return;
    el.innerHTML = pohjat().map(function (p, i) {
      return '<button class="btn small secondary" style="font-size:12px" data-i="' + i + '">' + esc(p.label) + '</button>';
    }).join('');
    el.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        var p = pohjat()[+b.dataset.i];
        if (p && window._setBroadcast2) window._setBroadcast2(p.text);
      };
    });
  }

  // ───────────────────────────────────────────────────────────
  //  ULKOASU: lumisade + revontulen paletti
  // ───────────────────────────────────────────────────────────
  var SNOW_DEF = { on: true, count: 60, speed: 1, size: 1, opacity: 0.18 };
  window._snowCfg = Object.assign({}, SNOW_DEF);

  var PALETIT = [
    { key: 'klassinen', nimi: 'Klassinen' },
    { key: 'violetti',  nimi: 'Violetti' },
    { key: 'punainen',  nimi: 'Punainen' },
    { key: 'turkoosi',  nimi: 'Turkoosi' },
    { key: 'kulta',     nimi: 'Kulta' },
    { key: 'jaa',       nimi: 'Jää' }
  ];

  function syncSnowToFeature() {
    // Ominaisuuskytkin voittaa: jos lumisade on pois, se ei näy vaikka säädöt olisivat päällä
    if (feat.lumisade === false) window._snowCfg.on = false;
  }

  function renderUlkoasuLisa() {
    var el = $('setUlkoasuLisa');
    if (!el) return;
    var c = window._snowCfg;
    var pal = (window._auroraCfg && window._auroraCfg.pal) || 'klassinen';
    el.innerHTML =
      '<div class="separator"></div>' +
      '<h2 style="margin:8px 0">🎨 Revontulen väripaletti</h2>' +
      '<p class="muted" style="font-size:12px;margin:0 0 8px">Toimii kaikkien teemojen kanssa, myös OLED-mustan.</p>' +
      '<div class="stack" style="flex-wrap:wrap;gap:6px">' +
        PALETIT.map(function (p) {
          return '<button class="btn small secondary pal-btn' + (p.key === pal ? ' active' : '') +
                 '" data-pal="' + p.key + '">' + esc(p.nimi) + '</button>';
        }).join('') +
      '</div>' +
      '<div class="separator"></div>' +
      '<div class="stack" style="justify-content:space-between;align-items:center">' +
        '<h2 style="margin:8px 0">❄️ Lumisade</h2>' +
        '<button class="btn small ' + (c.on ? '' : 'secondary') + '" id="snowOnBtn">' + (c.on ? 'Päällä' : 'Pois') + '</button>' +
      '</div>' +
      '<p class="muted" style="font-size:12px;margin:0 0 8px">Toimii kaikkien teemojen kanssa, myös OLED-mustan.</p>' +
      sld('snowCount', 'Tiheys', 0, 250, Math.round(c.count), 'kpl') +
      sld('snowSpeed', 'Nopeus', 10, 400, Math.round(c.speed * 100), '%') +
      sld('snowSize',  'Koko',   30, 300, Math.round(c.size * 100), '%') +
      sld('snowOpacity', 'Näkyvyys', 0, 100, Math.round(c.opacity * 100), '%') +
      '<p class="muted" style="margin-top:6px;font-size:12px">Muutos näkyy kaikille pelaajille.</p>';

    el.querySelectorAll('.pal-btn').forEach(function (b) {
      b.onclick = function () { setAurora({ pal: b.dataset.pal }); };
    });
    var onBtn = $('snowOnBtn');
    if (onBtn) onBtn.onclick = function () { setSnow({ on: !window._snowCfg.on }); };

    bindSld('snowCount', 'count', 1);
    bindSld('snowSpeed', 'speed', 100);
    bindSld('snowSize', 'size', 100);
    bindSld('snowOpacity', 'opacity', 100);
  }

  function sld(id, label, min, max, val, unit) {
    return '<div class="aurora-sld"><label>' + label + '</label>' +
      '<input id="' + id + '" type="range" min="' + min + '" max="' + max + '" value="' + val + '">' +
      '<span id="' + id + 'Val">' + val + (unit === 'kpl' ? '' : unit) + '</span></div>';
  }

  function bindSld(id, key, jakaja) {
    var el = $(id); if (!el) return;
    el.oninput = function () {
      window._snowCfg[key] = (+el.value) / jakaja;
      var v = $(id + 'Val'); if (v) v.textContent = el.value + (jakaja === 1 ? '' : '%');
      if (window._snowRefresh) window._snowRefresh();
    };
    el.onchange = function () {
      var o = {}; o[key] = (+el.value) / jakaja;
      setSnow(o);
    };
  }

  // ───────────────────────────────────────────────────────────
  //  ASETUSTEN VÄLILEHDET
  // ───────────────────────────────────────────────────────────
  var aktiivinenSec = 'ulkoasu';
  function naytaSec(nimi) {
    aktiivinenSec = nimi;
    document.querySelectorAll('.set-sec').forEach(function (s) {
      s.style.display = (s.dataset.sec === nimi) ? '' : 'none';
    });
    document.querySelectorAll('.set-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.sec === nimi);
    });
    var box = document.querySelector('#settingsModal .modal-box');
    if (box) box.scrollTop = 0;
  }

  // Koko asetusikkuna on tarkoitettu vain ylläpitäjälle.
  function initTabs() {
    var admin = window._onkoAdmin ? window._onkoAdmin() : false;
    document.querySelectorAll('.set-tab').forEach(function (t) {
      t.onclick = function () { naytaSec(t.dataset.sec); };
    });
    if (!admin) {
      // Varmistus: jos ikkuna jostain syystä aukeaa muulle kuin ylläpitäjälle,
      // sisältöä ei näytetä lainkaan.
      document.querySelectorAll('.set-sec').forEach(function (s) { s.style.display = 'none'; });
      var palkki0 = $('setTabs'); if (palkki0) palkki0.style.display = 'none';
      return;
    }
    var palkki = $('setTabs'); if (palkki) palkki.style.display = '';
    naytaSec(aktiivinenSec);
  }

  // ───────────────────────────────────────────────────────────
  //  ASETUSNÄKYMÄT
  // ───────────────────────────────────────────────────────────
  function renderFeatureAdmin() {
    var el = $('setFeatures');
    if (!el) return;
    el.innerHTML =
      '<h2 style="margin:8px 0">🧩 Ominaisuudet</h2>' +
      '<p class="muted" style="font-size:12px;margin:0 0 10px">Kytke toimintoja pois tai päälle koko porukalta. Vain sinä näet tämän osion.</p>' +
      FEATURES.map(function (f) {
        var on = feat[f.key] !== false;
        return '<div class="feat-row">' +
          '<div class="feat-txt"><div class="feat-nimi">' + esc(f.nimi) + '</div>' +
          '<div class="feat-info">' + esc(f.info) + '</div></div>' +
          '<button class="btn small ' + (on ? '' : 'secondary') + ' feat-btn" data-k="' + f.key + '">' +
          (on ? 'Päällä' : 'Pois') + '</button></div>';
      }).join('') +
      '<p class="muted" id="featStatus" style="margin-top:6px;min-height:18px;font-size:12px"></p>';
    el.querySelectorAll('.feat-btn').forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.k;
        feat[k] = (feat[k] === false);   // pois -> päälle, muuten pois
        tallenna('features', kaikkiFeat(), 'featStatus');
        applyFeatures();
      };
    });
  }

  function kaikkiFeat() {
    var o = {};
    FEATURES.forEach(function (f) { o[f.key] = feat[f.key] !== false; });
    return o;
  }

  function renderTextsAdmin() {
    var el = $('setTexts');
    if (!el) return;
    var p = pohjat(), h = haviajat();
    el.innerHTML =
      '<h2 style="margin:8px 0">📢 Viestipohjat</h2>' +
      '<p class="muted" style="font-size:12px;margin:0 0 8px">Nämä näkyvät Viestit-ikkunan pikanappeina. Nimi on napin teksti.</p>' +
      '<div id="tplList"></div>' +
      '<button class="btn small secondary" id="tplAdd" style="width:100%;margin-top:6px">+ Lisää viestipohja</button>' +
      '<div class="separator"></div>' +
      '<h2 style="margin:8px 0">💬 Häviäjän viestit</h2>' +
      '<p class="muted" style="font-size:12px;margin:0 0 8px">Näytetään kerran viimeisenä olevalle pelaajalle. Tyhjä lista palauttaa oletusviestit.</p>' +
      '<div id="loserList"></div>' +
      '<button class="btn small secondary" id="loserAdd" style="width:100%;margin-top:6px">+ Lisää viesti</button>' +
      '<div class="stack" style="gap:8px;margin-top:12px">' +
        '<button class="btn small" id="textsSave">💾 Tallenna tekstit</button>' +
        '<button class="btn small secondary" id="textsReset">↺ Palauta oletukset</button>' +
      '</div>' +
      '<p class="muted" id="textsStatus" style="margin-top:6px;min-height:18px;font-size:12px"></p>';

    piirraTpl(p); piirraLoser(h);

    $('tplAdd').onclick = function () {
      var lista = keraaTpl(); lista.push({ label: 'Uusi', text: '' }); piirraTpl(lista);
    };
    $('loserAdd').onclick = function () {
      var lista = keraaLoser(); lista.push({ emoji: '💪', text: '' }); piirraLoser(lista);
    };
    $('textsSave').onclick = function () {
      var t = keraaTpl().filter(function (x) { return x.label.trim() && x.text.trim(); });
      var l = keraaLoser().filter(function (x) { return x.text.trim(); });
      window._texts.broadcastTemplates = t;
      window._texts.loserMessages = l;
      tallenna('texts', { broadcastTemplates: t, loserMessages: l }, 'textsStatus');
      renderBroadcastTemplates();
    };
    $('textsReset').onclick = function () {
      if (!confirm('Palautetaanko alkuperäiset tekstit?')) return;
      window._texts.broadcastTemplates = null;
      window._texts.loserMessages = null;
      tallenna('texts', { broadcastTemplates: [], loserMessages: [] }, 'textsStatus');
      renderTextsAdmin(); renderBroadcastTemplates();
    };
  }

  function piirraTpl(lista) {
    $('tplList').innerHTML = lista.map(function (p, i) {
      return '<div class="txt-row">' +
        '<input class="tpl-label" value="' + esc(p.label) + '" placeholder="Napin nimi">' +
        '<input class="tpl-text" value="' + esc(p.text) + '" placeholder="Viestin teksti">' +
        '<button class="btn small danger txt-del" data-i="' + i + '">✕</button></div>';
    }).join('');
    $('tplList').querySelectorAll('.txt-del').forEach(function (b) {
      b.onclick = function () { var l = keraaTpl(); l.splice(+b.dataset.i, 1); piirraTpl(l); };
    });
  }
  function keraaTpl() {
    return [].map.call($('tplList').querySelectorAll('.txt-row'), function (r) {
      return { label: r.querySelector('.tpl-label').value, text: r.querySelector('.tpl-text').value };
    });
  }
  function piirraLoser(lista) {
    $('loserList').innerHTML = lista.map(function (p, i) {
      return '<div class="txt-row">' +
        '<input class="ls-emoji" value="' + esc(p.emoji || '💪') + '" maxlength="4" style="flex:0 0 54px;text-align:center">' +
        '<input class="ls-text" value="' + esc(p.text) + '" placeholder="Viestin teksti">' +
        '<button class="btn small danger txt-del" data-i="' + i + '">✕</button></div>';
    }).join('');
    $('loserList').querySelectorAll('.txt-del').forEach(function (b) {
      b.onclick = function () { var l = keraaLoser(); l.splice(+b.dataset.i, 1); piirraLoser(l); };
    });
  }
  function keraaLoser() {
    return [].map.call($('loserList').querySelectorAll('.txt-row'), function (r) {
      return { emoji: r.querySelector('.ls-emoji').value, text: r.querySelector('.ls-text').value };
    });
  }

  // ───────────────────────────────────────────────────────────
  //  ILMOITUSASETUKSET
  // ───────────────────────────────────────────────────────────
  var ILM_TYYPIT = [
    { key: 'aamu',      nimi: 'Aamukooste',        info: 'Klo 9 lähtevä kooste päivän otteluista.' },
    { key: 'tunti',     nimi: 'Tunti ennen',       info: 'Muistutus tuntia ennen ottelun alkua.' },
    { key: 'muistutus', nimi: 'Veikkaus puuttuu',  info: 'Muistutus 30 min ennen, jos veikkaus on kesken.' },
    { key: 'admin',     nimi: 'Adminin ilmoitukset', info: 'Terojen lähettämät ilmoitukset.' },
    { key: 'chat',      nimi: 'Chat-viestit',      info: 'Ilmoitus uusista lukemattomista viesteistä.' }
  ];
  var ILM_DEF = { aamu: true, tunti: true, muistutus: true, admin: true, chat: true, hiljainenAlku: null, hiljainenLoppu: null };
  var notifyPrefs = {};
  var ilmValittu = null;          // ketä pelaajaa ylläpitäjä parhaillaan säätää

  function ilmKohde() {
    if (!ilmValittu) {
      var lista = window._pelaajat ? window._pelaajat() : [];
      ilmValittu = (window._nykyinenKayttaja && window._nykyinenKayttaja()) || lista[0] || null;
    }
    return ilmValittu;
  }
  function omatIlm() {
    var k = ilmKohde();
    return Object.assign({}, ILM_DEF, (k && notifyPrefs[k]) || {});
  }

  function renderNotify() {
    var el = $('setNotify');
    if (!el) return;
    if (!window._onkoAdmin || !window._onkoAdmin()) { el.innerHTML = ''; return; }
    var lista = window._pelaajat ? window._pelaajat() : [];
    var k = ilmKohde();
    if (!k) { el.innerHTML = '<p class="muted">Pelaajia ei ole ladattu.</p>'; return; }
    var c = omatIlm();
    el.innerHTML =
      '<h2 style="margin:8px 0">🔔 Ilmoitukset</h2>' +
      '<p class="muted" style="font-size:12px;margin:0 0 8px">Valitse pelaaja ja säädä hänen ilmoituksensa. ' +
      'Pelaajat eivät pääse näihin itse — he voivat vain sallia ilmoitukset puhelimessaan.</p>' +
      '<select id="ilmPelaaja" style="width:100%;margin-bottom:12px">' +
        lista.map(function (p) {
          var muok = notifyPrefs[p] ? ' ·  muokattu' : '';
          return '<option value="' + esc(p) + '"' + (p === k ? ' selected' : '') + '>' + esc(p) + muok + '</option>';
        }).join('') +
      '</select>' +
      ILM_TYYPIT.map(function (t) {
        var on = c[t.key] !== false;
        return '<div class="feat-row"><div class="feat-txt">' +
          '<div class="feat-nimi">' + esc(t.nimi) + '</div>' +
          '<div class="feat-info">' + esc(t.info) + '</div></div>' +
          '<button class="btn small ' + (on ? '' : 'secondary') + ' ilm-btn" data-k="' + t.key + '">' +
          (on ? 'Päällä' : 'Pois') + '</button></div>';
      }).join('') +
      '<div class="separator"></div>' +
      '<h2 style="margin:8px 0">🌙 Hiljainen aika</h2>' +
      '<p class="muted" style="font-size:12px;margin:0 0 8px">Tällä välillä ei lähetetä ilmoituksia. Jätä tyhjäksi jos et halua hiljaista aikaa.</p>' +
      '<div class="stack" style="gap:8px;align-items:center">' +
        '<input id="ilmAlku" type="number" min="0" max="23" placeholder="22" value="' + (c.hiljainenAlku == null ? '' : c.hiljainenAlku) + '" style="width:80px">' +
        '<span class="muted">–</span>' +
        '<input id="ilmLoppu" type="number" min="0" max="23" placeholder="8" value="' + (c.hiljainenLoppu == null ? '' : c.hiljainenLoppu) + '" style="width:80px">' +
        '<button class="btn small" id="ilmSave">💾 Tallenna</button>' +
      '</div>' +
      '<p class="muted" id="ilmStatus" style="margin-top:6px;min-height:18px;font-size:12px"></p>' +
      '<div class="stack" style="gap:8px;margin-top:4px">' +
        '<button class="btn small secondary" id="ilmOletukset">↺ Palauta oletukset tälle pelaajalle</button>' +
      '</div>' +
      '<div class="separator"></div>' +
      '<button class="btn small secondary" style="width:100%" onclick="window._openNotifyPanel()">📱 Ilmoitusluvat ja lähetys</button>';

    var sel = $('ilmPelaaja');
    if (sel) sel.onchange = function () { ilmValittu = sel.value; renderNotify(); };
    var oletus = $('ilmOletukset');
    if (oletus) oletus.onclick = function () {
      var kk = ilmKohde(); if (!kk) return;
      if (!confirm('Palautetaanko pelaajan ' + kk + ' ilmoitukset oletuksiin?')) return;
      delete notifyPrefs[kk];
      tallenna('notifyPrefs', notifyPrefs, 'ilmStatus');
      renderNotify();
    };

    el.querySelectorAll('.ilm-btn').forEach(function (b) {
      b.onclick = function () {
        var cc = omatIlm(); cc[b.dataset.k] = !(cc[b.dataset.k] !== false);
        tallennaIlm(cc);
      };
    });
    $('ilmSave').onclick = function () {
      var cc = omatIlm();
      var a = $('ilmAlku').value, l = $('ilmLoppu').value;
      cc.hiljainenAlku = a === '' ? null : Math.max(0, Math.min(23, +a));
      cc.hiljainenLoppu = l === '' ? null : Math.max(0, Math.min(23, +l));
      tallennaIlm(cc);
    };
  }

  function tallennaIlm(cc) {
    var k = ilmKohde();
    if (!k) return;
    notifyPrefs[k] = cc;
    tallenna('notifyPrefs', notifyPrefs, 'ilmStatus');
    renderNotify();
  }

  // ───────────────────────────────────────────────────────────
  //  TALLENNUS FIREBASEEN (käyttää app.js:n julkaisemaa apuria)
  // ───────────────────────────────────────────────────────────
  function tallenna(dokumentti, data, statusId) {
    var s = statusId && $(statusId);
    if (s) s.textContent = 'Tallennetaan…';
    if (!window._tallennaAsetus) { if (s) s.textContent = 'Virhe: yhteyttä ei ole.'; return; }
    window._tallennaAsetus(dokumentti, data)
      .then(function () { if (s) s.textContent = 'Tallennettu ✓'; setTimeout(function () { if (s) s.textContent = ''; }, 2500); })
      .catch(function (e) { if (s) s.textContent = 'Virhe: ' + (e && e.message || e); });
  }

  function setSnow(muutos) {
    Object.assign(window._snowCfg, muutos);
    if (window._snowRefresh) window._snowRefresh();
    tallenna('ui', { snow: window._snowCfg }, null);
    renderUlkoasuLisa();
  }
  function setAurora(muutos) {
    var c = Object.assign({ v: 0, strength: 1.8, amp: 2.6, speed: 3.2, pal: 'klassinen' }, window._auroraCfg || {}, muutos);
    window._auroraCfg = c;
    if (window._auroraRedraw) window._auroraRedraw();
    if (window._tallennaAurora) window._tallennaAurora(c);
    renderUlkoasuLisa();
  }

  // ───────────────────────────────────────────────────────────
  //  DATAN KOKO JA TALLENNUSRAKENNE
  // ───────────────────────────────────────────────────────────
  function kt(b) { return (b / 1024).toFixed(1).replace('.', ',') + ' kt'; }

  function renderData() {
    var el = $('setData');
    if (!el) return;
    if (!window._onkoAdmin || !window._onkoAdmin()) { el.innerHTML = ''; return; }
    var d = window._dataKoko ? window._dataKoko() : null;
    if (!d) { el.innerHTML = '<p class="muted">Datatietoja ei ole vielä ladattu.</p>'; return; }

    var suurin = d.v2 ? d.suurinTurnaus : d.yhdessaDokumentissa;
    var osuus = Math.min(100, Math.round(suurin / d.raja * 100));
    var vari = osuus > 80 ? '#ef4444' : osuus > 50 ? '#f59e0b' : '#22c55e';

    el.innerHTML =
      '<div class="separator"></div>' +
      '<h2 style="margin:8px 0">📦 Datan koko</h2>' +
      '<p class="muted" style="font-size:12px;margin:0 0 10px">Firestoren yläraja on 1 Mt yhtä dokumenttia kohti. ' +
        (d.v2 ? 'Uudessa rakenteessa raja koskee yhtä turnausta kerrallaan.'
              : 'Vanhassa rakenteessa kaikki turnaukset ovat samassa dokumentissa, joten raja koskee niitä yhdessä.') + '</p>' +
      '<div class="koko-palkki"><div class="koko-tayte" style="width:' + osuus + '%;background:' + vari + '"></div></div>' +
      '<div class="koko-luku">' + kt(suurin) + ' / ' + kt(d.raja) + ' &nbsp;(' + osuus + ' %)</div>' +
      '<div style="margin-top:12px">' +
        d.turnaukset.map(function (t) {
          return '<div class="koko-rivi"><span>' + esc(t.nimi) + (t.paattynyt ? ' ✅' : '') + '</span>' +
                 '<span class="muted">' + t.otteluita + ' ottelua · ' + kt(t.koko) + '</span></div>';
        }).join('') +
      '</div>' +
      '<div class="koko-rivi" style="border-top:1px solid var(--border);margin-top:6px;padding-top:8px">' +
        '<span><strong>Yhteensä</strong></span><span class="muted">' + kt(d.yhdessaDokumentissa) + '</span></div>' +
      '<div class="separator"></div>' +
      '<h2 style="margin:8px 0">🗄 Tallennusrakenne</h2>' +
      '<p class="muted" style="font-size:12px;margin:0 0 8px">Nykyinen: <strong>' +
        (d.v2 ? 'uusi – jokainen turnaus omassa dokumentissaan' : 'vanha – kaikki yhdessä dokumentissa') +
      '</strong></p>' +
      (d.v2
        ? '<button class="btn small secondary" id="rakV1" style="width:100%">↩︎ Palaa vanhaan rakenteeseen</button>'
        : '<button class="btn small" id="rakV2" style="width:100%">➜ Siirrä turnaukset omiin dokumentteihin</button>') +
      '<p class="muted" style="font-size:12px;margin-top:8px">Vanhaa dokumenttia ei poisteta missään vaiheessa, joten voit palata takaisin milloin tahansa. ' +
      'Ota silti varmuuskopio Vie JSON -napilla ennen siirtoa.</p>' +
      '<pre id="rakLoki" class="rak-loki"></pre>';

    var loki = $('rakLoki');
    function kirjoita(t) { loki.textContent += t + '\n'; loki.style.display = 'block'; }

    var b2 = $('rakV2');
    if (b2) b2.onclick = function () {
      if (!confirm('Siirretäänkö turnaukset omiin dokumentteihinsa?\n\nVanha data jää koskematta ja voit palata takaisin.')) return;
      b2.disabled = true; loki.textContent = '';
      window._siirraRakenteeseenV2(kirjoita)
        .then(function () { kirjoita('✅ Siirto onnistui.'); renderData(); })
        .catch(function (e) { kirjoita('❌ ' + (e && e.message || e)); b2.disabled = false; });
    };
    var b1 = $('rakV1');
    if (b1) b1.onclick = function () {
      if (!confirm('Palataanko vanhaan rakenteeseen?')) return;
      b1.disabled = true; loki.textContent = '';
      window._palaaRakenteeseenV1(kirjoita)
        .then(function () { kirjoita('✅ Palattu vanhaan rakenteeseen.'); renderData(); })
        .catch(function (e) { kirjoita('❌ ' + (e && e.message || e)); b1.disabled = false; });
    };
  }

  // ───────────────────────────────────────────────────────────
  //  PÄIVITYSBANNERI
  // ───────────────────────────────────────────────────────────
  // Oma versiotarkistus: version.json kertoo mikä versio palvelimella on.
  // Toimii vaikka service worker ei huomaisi muutosta.
  function omaVersio() {
    var m = document.querySelector('meta[name="app-version"]');
    return m ? m.content : null;
  }
  function initVersionCheck() {
    var oma = omaVersio();
    if (!oma) return;
    var banner = $('updateBanner'), teksti = $('updateBannerText');
    function tarkista() {
      fetch('version.json?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (v) {
          if (!v || !v.versio || v.versio === oma) return;
          if (teksti) teksti.textContent = 'Uusi versio ' + v.versio + ' on saatavilla.';
          if (banner) banner.classList.add('show');
        })
        .catch(function () {});
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tarkista(); });
    setInterval(tarkista, 15 * 60 * 1000);
    setTimeout(tarkista, 4000);
  }

  function initUpdateBanner() {
    var banner = $('updateBanner');
    if (!banner || !('serviceWorker' in navigator)) return;
    var btn = $('updateBannerBtn'), x = $('updateBannerX');
    var odottava = null;

    function nayta(sw) { odottava = sw; banner.classList.add('show'); }
    x.onclick = function () { banner.classList.remove('show'); };
    btn.onclick = function () {
      banner.classList.remove('show');
      if (odottava) { odottava.postMessage({ type: 'SKIP_WAITING' }); }
      setTimeout(function () { location.reload(); }, 300);
    };

    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) return;
      if (reg.waiting) nayta(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var uusi = reg.installing;
        if (!uusi) return;
        uusi.addEventListener('statechange', function () {
          if (uusi.state === 'installed' && navigator.serviceWorker.controller) nayta(uusi);
        });
      });
      // Tarkista päivitys sovelluksen palatessa etualalle
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) { try { reg.update(); } catch (e) {} }
      });
    }).catch(function () {});
  }

  // ───────────────────────────────────────────────────────────
  //  KÄYNNISTYS
  // ───────────────────────────────────────────────────────────
  function init() {
    initTabs();
    renderBroadcastTemplates();
    renderUlkoasuLisa();
    renderFeatureAdmin();
    renderTextsAdmin();
    renderNotify();
    renderData();
    initUpdateBanner();
    initVersionCheck();

    // Korjaus: pelitilastot ja huoltokatkon tila latautuvat nyt asetuksia avattaessa.
    // (Aiemmin js/games.js kietoi _openSettingsPanelin, mutta moduuli ylikirjoitti kääreen.)

    // Suojaa toiminnot ominaisuuskytkimillä
    suojaa('_openChat', 'chat', 'Chat on kytketty pois käytöstä.');
    suojaa('_openChatMonitor', 'chat', 'Chat on kytketty pois käytöstä.');
    suojaa('_open2048', 'pelit', 'Minipelit on kytketty pois käytöstä.');
    suojaa('_openSnake', 'pelit', 'Minipelit on kytketty pois käytöstä.');
    suojaa('_openDodge', 'pelit', 'Minipelit on kytketty pois käytöstä.');
    suojaa('_openGameScores', 'pelit', 'Minipelit on kytketty pois käytöstä.');
    suojaa('_openWrapped', 'wrapped', 'Kauden kooste on kytketty pois käytöstä.');
    suojaa('_openHallOfFame', 'hallOfFame', 'Hall of Fame on kytketty pois käytöstä.');
    suojaa('_openMyProfile', 'profiili', 'Profiili on kytketty pois käytöstä.');
    suojaa('_adminWatchIntro', 'intro', 'Intro on kytketty pois käytöstä.');
    suojaa('_adminSendIntro', 'intro', 'Intro on kytketty pois käytöstä.');
    suojaa('_openPelleCard', 'salaisetLoydot', 'Salaiset löydöt on kytketty pois käytöstä.');

    // Asetusikkunan avaus piirtää näkymät uudelleen
    var alkupOpen = window._openSettingsPanel;
    window._openSettingsPanel = function () {
      var r = alkupOpen ? alkupOpen.apply(this, arguments) : undefined;
      setTimeout(function () {
        renderFeatureAdmin(); renderTextsAdmin(); renderNotify(); renderUlkoasuLisa(); renderData(); initTabs();
        if (window._renderGameStats) { try { window._renderGameStats(); } catch (e) {} }
        if (window._updateMaintUI) { try { window._updateMaintUI(); } catch (e) {} }
      }, 60);
      return r;
    };

    // app.js kutsuu tätä kun asetusdokumentit päivittyvät
    window._asetuksetPaivittyi = function (mika, data) {
      if (mika === 'features') { feat = data || {}; applyFeatures(); }
      if (mika === 'texts') {
        window._texts.broadcastTemplates = (data && data.broadcastTemplates) || null;
        window._texts.loserMessages = (data && data.loserMessages) || null;
        renderBroadcastTemplates(); renderTextsAdmin();
      }
      if (mika === 'notifyPrefs') { notifyPrefs = data || {}; renderNotify(); }
      if (mika === 'ui') {
        if (data && data.snow) Object.assign(window._snowCfg, data.snow);
        syncSnowToFeature();
        if (window._snowRefresh) window._snowRefresh();
        renderUlkoasuLisa();
      }
      if (mika === 'aurora') renderUlkoasuLisa();
      if (mika === 'kirjautui') { renderNotify(); renderFeatureAdmin(); }
    };

    // Toista snapshotit jotka ehtivät saapua ennen tämän tiedoston käynnistystä
    var puskuri = window._asetusPuskuri || {};
    Object.keys(puskuri).forEach(function (k) {
      try { window._asetuksetPaivittyi(k, puskuri[k]); } catch (e) {}
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
