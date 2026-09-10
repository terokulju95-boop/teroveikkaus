// KULJU CUP – sovelluksen ydin (Firebase, veikkaukset, pisteet, chat, admin)
// Eriytetty index.html:stä. Sisältö on siirretty sellaisenaan, ilman muutoksia.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAsUte6gqukH14_80R6QE-sYR8d_nnaAFA",
  authDomain: "turnausveikkaus.firebaseapp.com",
  projectId: "turnausveikkaus",
  storageBucket: "turnausveikkaus.firebasestorage.app",
  messagingSenderId: "102156409247",
  appId: "1:102156409247:web:25a4d876f8a7fdf0e5c5aa"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);
window._firebaseDb = db; // Expose globally for non-module scripts
const DATA_DOC = doc(db, "app", "data");
const PINS_DOC = doc(db, "app", "pins");
// Jokaisella pelaajalla oma veikkausdokumentti – ei enää race conditionia
function predDoc(player){ return doc(db, "predictions", player); }

// ═══════════════════════════════════════════════════════════════
//  TALLENNUSRAKENNE
//  v1 = kaikki turnaukset yhdessä dokumentissa  app/data
//  v2 = jokainen turnaus omassa dokumentissaan  tournaments/{id}
//       ja luettelo dokumentissa                app/index
//
//  Vanhaa app/data-dokumenttia EI poisteta missään vaiheessa, joten
//  vanhaan rakenteeseen voi aina palata. Siirto tehdään käsin
//  Asetukset → Data -välilehdeltä.
// ═══════════════════════════════════════════════════════════════
const INDEX_DOC = doc(db, "app", "index");
function tourDoc(id){ return doc(db, "tournaments", String(id)); }
window._rakenneV2 = false;
let _tourSnapshotit = {};          // id -> unsubscribe
let _tourViimeksi   = {};          // id -> viimeksi tallennettu JSON-merkkijono

// Poimii turnauksesta vain rakenteen (veikkaukset tallennetaan erikseen)
function _puhdistaTurnaus(t){
  const copy = { ...t };
  delete copy.predictions;
  delete copy.topThreePrediction;
  delete copy._predSavedAt;
  return copy;
}

// Lukee rakenteen kerran, kummasta tahansa mallista
async function lueRakenne(){
  let idxSnap = null;
  try { idxSnap = await getDoc(INDEX_DOC); } catch(e){}
  const idx = (idxSnap && idxSnap.exists()) ? (idxSnap.data()||{}) : null;
  if (idx && idx.rakenne === 'v2') {
    window._rakenneV2 = true;
    const lista = Array.isArray(idx.tournaments) ? idx.tournaments : [];
    const snaps = await Promise.all(lista.map(x => getDoc(tourDoc(x.id)).catch(()=>null)));
    const tournaments = [];
    snaps.forEach((sn, i) => {
      if (!sn || !sn.exists()) return;
      try {
        const t = JSON.parse(sn.data().json || 'null');
        if (t) { tournaments.push(t); _tourViimeksi[String(t.id)] = sn.data().json; }
      } catch(e){}
    });
    return { tournaments, selectedTournamentId: idx.selectedTournamentId || null,
             selectedMatchId: idx.selectedMatchId || null };
  }
  window._rakenneV2 = false;
  const snap = await getDoc(DATA_DOC);
  if (!snap.exists()) return null;
  return JSON.parse(snap.data().json);
}

// Kirjoittaa rakenteen oikeaan malliin. toSave on sama olio kuin ennenkin.
async function kirjoitaRakenne(toSave){
  if (!window._rakenneV2) {
    await setDoc(DATA_DOC, { json: JSON.stringify(toSave) });
    return;
  }
  const turnaukset = toSave.tournaments || [];
  const idxLista = turnaukset.map(t => ({ id: String(t.id), name: t.name || '', finished: !!t.finished }));
  // 1) Kirjoita vain ne turnaukset joiden sisältö on muuttunut
  for (const t of turnaukset) {
    const j = JSON.stringify(t);
    if (_tourViimeksi[String(t.id)] === j) continue;
    await setDoc(tourDoc(t.id), { json: j, name: t.name || '', ts: Date.now() });
    _tourViimeksi[String(t.id)] = j;
  }
  // 2) Poista turnaukset jotka on poistettu sovelluksesta
  const elossa = new Set(turnaukset.map(t => String(t.id)));
  for (const id of Object.keys(_tourViimeksi)) {
    if (!elossa.has(id)) {
      try { await deleteDoc(tourDoc(id)); } catch(e){}
      delete _tourViimeksi[id];
    }
  }
  // 3) Päivitä luettelo
  await setDoc(INDEX_DOC, { rakenne:'v2', tournaments: idxLista,
    selectedTournamentId: toSave.selectedTournamentId || null,
    selectedMatchId: toSave.selectedMatchId || null, ts: Date.now() });
}

// Reaaliaikainen seuranta uudessa rakenteessa
function seuraaRakennettaV2(){
  onSnapshot(INDEX_DOC, async snap => {
    if (!snap.exists() || isSavingStructure) return;
    const idx = snap.data() || {};
    if (idx.rakenne !== 'v2') { return; }
    window._rakenneV2 = true;
    const lista = Array.isArray(idx.tournaments) ? idx.tournaments : [];
    const idt = lista.map(x => String(x.id));
    // Sulje kuuntelijat poistuneilta turnauksilta
    Object.keys(_tourSnapshotit).forEach(id => {
      if (idt.indexOf(id) === -1) { try { _tourSnapshotit[id](); } catch(e){} delete _tourSnapshotit[id]; }
    });
    // Avaa kuuntelija uusille
    idt.forEach(id => {
      if (_tourSnapshotit[id]) return;
      _tourSnapshotit[id] = onSnapshot(tourDoc(id), s2 => {
        if (isSavingStructure || !s2.exists()) return;
        try {
          const t = JSON.parse(s2.data().json || 'null');
          if (!t) return;
          _tourViimeksi[String(t.id)] = s2.data().json;
          const uusi = { tournaments: (data.tournaments||[]).map(x =>
                          String(x.id)===String(t.id) ? t : x),
                         selectedTournamentId: data.selectedTournamentId,
                         selectedMatchId: data.selectedMatchId };
          if (!uusi.tournaments.some(x => String(x.id)===String(t.id))) uusi.tournaments.push(t);
          window._kasitteleRakenne(uusi);
        } catch(e){}
      });
    });
  });
}
window._seuraaRakennettaV2 = seuraaRakennettaV2;

// ── Datan koon seuranta ──────────────────────────────────────────
const FIRESTORE_RAJA = 1048576;   // 1 Mt / dokumentti
window._dataKoko = function(){
  const rivit = [];
  let yht = 0;
  (data.tournaments||[]).forEach(t => {
    const j = JSON.stringify(_puhdistaTurnaus(t));
    const koko = new Blob([j]).size;
    yht += koko;
    rivit.push({
      nimi: t.name || t.id,
      koko: koko,
      otteluita: (t.matches||[]).length,
      paattynyt: !!t.finished
    });
  });
  const kokoRakenne = new Blob([JSON.stringify({
    ...data,
    tournaments: (data.tournaments||[]).map(_puhdistaTurnaus)
  })]).size;
  const veikkaukset = PLAYERS.map(pl => {
    let n = 0;
    (data.tournaments||[]).forEach(t => {
      Object.values(t.predictions||{}).forEach(m => { if (m[pl]) n++; });
    });
    return { pelaaja: pl, veikkauksia: n };
  });
  return {
    v2: !!window._rakenneV2,
    turnaukset: rivit,
    yhdessaDokumentissa: kokoRakenne,
    suurinTurnaus: rivit.reduce((a,b)=>Math.max(a,b.koko),0),
    raja: FIRESTORE_RAJA,
    veikkaukset: veikkaukset
  };
};

// ── Siirto uuteen rakenteeseen (peruutettavissa) ─────────────────
window._siirraRakenteeseenV2 = async function(loki){
  const kerro = (t) => { try { loki(t); } catch(e){} };
  if (currentUser !== ADMIN) throw new Error('Vain ylläpitäjä voi siirtää datan.');
  const puhtaat = (data.tournaments||[]).map(_puhdistaTurnaus);
  if (!puhtaat.length) throw new Error('Ei turnauksia siirrettäväksi.');

  // 1) Varmuuskopio: kirjoitetaan nykytila vielä vanhaan dokumenttiin
  kerro('1/5 Varmistetaan vanha rakenne (app/data)…');
  await setDoc(DATA_DOC, { json: JSON.stringify({
    ...data,
    tournaments: puhtaat,
    selectedTournamentId: tid, selectedMatchId: mid
  })});

  // 2) Kirjoitetaan jokainen turnaus omaan dokumenttiinsa
  for (let i = 0; i < puhtaat.length; i++) {
    const t = puhtaat[i];
    kerro(`2/5 Kirjoitetaan turnaus ${i+1}/${puhtaat.length}: ${t.name || t.id}…`);
    await setDoc(tourDoc(t.id), { json: JSON.stringify(t), name: t.name || '', ts: Date.now() });
  }

  // 3) Luetaan takaisin ja verrataan – jos yksikin poikkeaa, keskeytetään
  for (let i = 0; i < puhtaat.length; i++) {
    const t = puhtaat[i];
    kerro(`3/5 Tarkistetaan turnaus ${i+1}/${puhtaat.length}…`);
    const sn = await getDoc(tourDoc(t.id));
    if (!sn.exists()) throw new Error('Turnausta ei löytynyt siirron jälkeen: ' + (t.name||t.id));
    if (sn.data().json !== JSON.stringify(t)) {
      throw new Error('Turnauksen sisältö ei täsmää: ' + (t.name||t.id) + '. Siirto keskeytetty, mitään ei otettu käyttöön.');
    }
  }

  // 4) Vasta kun kaikki täsmää, otetaan uusi rakenne käyttöön
  kerro('4/5 Otetaan uusi rakenne käyttöön…');
  await setDoc(INDEX_DOC, { rakenne:'v2',
    tournaments: puhtaat.map(t => ({ id:String(t.id), name:t.name||'', finished:!!t.finished })),
    selectedTournamentId: tid, selectedMatchId: mid, ts: Date.now() });
  window._rakenneV2 = true;
  puhtaat.forEach(t => { _tourViimeksi[String(t.id)] = JSON.stringify(t); });

  kerro('5/5 Valmis. Vanha app/data jäi ennalleen varmuuskopioksi.');
  return true;
};

// ── Paluu vanhaan rakenteeseen ───────────────────────────────────
window._palaaRakenteeseenV1 = async function(loki){
  const kerro = (t) => { try { loki(t); } catch(e){} };
  if (currentUser !== ADMIN) throw new Error('Vain ylläpitäjä voi vaihtaa rakennetta.');
  kerro('1/2 Kirjoitetaan nykyinen tila vanhaan dokumenttiin…');
  await setDoc(DATA_DOC, { json: JSON.stringify({
    ...data,
    tournaments: (data.tournaments||[]).map(_puhdistaTurnaus),
    selectedTournamentId: tid, selectedMatchId: mid
  })});
  kerro('2/2 Palataan vanhaan rakenteeseen…');
  await setDoc(INDEX_DOC, { rakenne:'v1', ts: Date.now() });
  window._rakenneV2 = false;
  kerro('Valmis. Turnausdokumentit jäivät talteen, joten voit siirtyä takaisin milloin vain.');
  return true;
};

// ============================
// FIREBASE AUTH
// ============================
window._fbDoLogin = async function(){
    const email = document.getElementById('fbLoginEmail').value.trim();
    const password = document.getElementById('fbLoginPassword').value;
    const err = document.getElementById('fbLoginError');
    const btn = document.getElementById('fbLoginBtn');
    err.textContent = '';
    if(!email || !password){ err.textContent = 'Täytä sähköposti ja salasana.'; return; }
    btn.textContent = 'Kirjaudutaan...';
    btn.disabled = true;
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch(e) {
        btn.textContent = 'Kirjaudu sisään';
        btn.disabled = false;
        if(e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found'){
            err.textContent = 'Väärä sähköposti tai salasana.';
        } else if(e.code === 'auth/too-many-requests'){
            err.textContent = 'Liian monta yritystä. Yritä myöhemmin.';
        } else {
            err.textContent = 'Kirjautumisvirhe. Tarkista yhteys.';
        }
    }
};

document.getElementById('fbLoginPassword').addEventListener('keydown', e => {
    if(e.key === 'Enter') window._fbDoLogin();
});
document.getElementById('fbLoginEmail').addEventListener('keydown', e => {
    if(e.key === 'Enter') document.getElementById('fbLoginPassword').focus();
});

onAuthStateChanged(auth, user => {
    if(user){
        // Firebase-kirjautuminen onnistui — piilota Firebase-ruutu
        document.getElementById('firebaseLoginScreen').style.display = 'none';
        // Nayta PIN-valinta VAIN jos sovellus ei ole jo auki localStorage-sessiosta
        if(document.getElementById('appScreen').style.display === 'none') {
            document.getElementById('loginScreen').style.display = '';
        }
    } else {
        // Ei Firebase-kirjautumista — nayta Firebase-kirjautumisruutu
        document.getElementById('firebaseLoginScreen').style.display = 'flex';
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('appScreen').style.display = 'none';
        document.getElementById('fbLoginBtn').textContent = 'Kirjaudu sisaan';
        document.getElementById('fbLoginBtn').disabled = false;
    }
});

// ============================
// VAKIOT
// ============================
const PLAYERS = ["Roosa","Timo","Tero","Tiina","Tepa","Äiti","Iskä"];
const ADMIN = "Tero";
const PENALTY_REASONS = ['Koukkaaminen','Mailasta kiinnipitäminen','Estäminen','Päähän kohdistuva taklaus','Huitominen','Väkivaltaisuus','Ryntäys','Tappelu','Liian monta pelaajaa jäällä','Poikittainen maila','Kampitus','Kiinnipitäminen','Mailan tai esineen heittäminen','Laitataklaus','Sukeltaminen','Kyynärpäätaklaus','Pelin viivyttäminen','Kiekon sulkeminen','Korkea maila','Selästä taklaaminen','Käytösrangaistus','Päällä iskeminen','Polvitaklaus','Mailan päällä lyöminen tai sen yritys','Keihästäminen','Jalkapyyhkäisy','Rikkoutuneella mailalla pelaaminen','Väärä varuste','Pelaajaa ei ole merkitty pöytäkirjaan','Potkaisee tai sylkee','Ei jäähyä'];
const DEFAULT_ROSTER = ['Harri Säteri (MV)','Joonas Korpisalo (MV)','Justus Annunen (MV)','Kevin Lankinen (MV)','Juuse Saros (MV)','Olli Määttä (P)','Miro Heiskanen (P)','Esa Lindell (P)','Niko Mikkola (P)','Rasmus Ristolainen (P)','Mikko Lehtonen (P)','Henri Jokiharju (P)','Vili Saarijärvi (P)','Nikolas Matinpalo (P)','Ville Heinola (P)','Mikael Seppälä (P)','Urho Vaakanainen (P)','Jesse Puljujärvi (H)','Sebastian Aho (H)','Aleksander Barkov (H)','Mikael Granlund (H)','Oliver Kapanen (H)','Joel Kiviranta (H)','Joel Armia (H)','Mikko Rantanen (H)','Kaapo Kakko (H)','Eeli Tolvanen (H)','Erik Haula (H)','Eetu Luostarinen (H)','Artturi Lehkonen (H)','Roope Hintz (H)','Waltteri Merelä (H)','Patrik Puistola (H)','Konsta Helenius (H)','Sami Päivärinta (H)','Hannes Björninen (H)','Janne Kuokkanen (H)','Anton Lundell (H)','Aatu Räty (H)','Eemil Erholtz (H)','Sakari Manninen (H)','Saku Mäenalanen (H)','Teuvo Teräväinen (H)','Lenni Hämeenaho (H)'];
// getRoster: palauttaa turnauksen oman pelaajalistan, tai oletuslistan jos turnauksella ei vielä ole omaa.
function getRoster(t){ return (t && Array.isArray(t.players) && t.players.length) ? t.players.slice() : DEFAULT_ROSTER.slice(); }
// ensureRoster: varmistaa että turnauksella on oma muokattava lista (materialisoi oletuksesta tarvittaessa).
function ensureRoster(t){ if(!t) return []; if(!Array.isArray(t.players) || !t.players.length){ t.players = DEFAULT_ROSTER.slice(); } return t.players; }
// 1. maalintekijän vaihtoehdot. Tallennettu valinta pidetään aina mukana, vaikka pelaaja olisi poistettu listalta.
function scorerOptions(t, stored){ const opts = ['', ...getRoster(t), 'Ei maalia']; if(stored && opts.indexOf(stored)===-1) opts.push(stored); return opts; }
// 1. jäähyn saajan vaihtoehdot (johdetaan samasta listasta + erikoisvaihtoehdot).
function penaltyTakerOptions(t, stored){ const opts = ['', ...getRoster(t), 'Ei jäähyä', 'Joukkuerangaistus']; if(stored && opts.indexOf(stored)===-1) opts.push(stored); return opts; }
const FIELDS = [
  {key:'lopputulos',label:'Lopputulos'},{key:'ekan_maalintekija',label:'1. Maalintekijä'},
  {key:'ekan_maali_aika',label:'1. Maalin aika'},{key:'kumpi_tekee_ekan_maalin',label:'1. Maali'},
  {key:'voittomaalin_tekija',label:'Viimeisen maalintekijä'},
  {key:'ekan_jahyn_saaja',label:'1. Jäähyn saaja'},
  {key:'ekan_jahyn_syy',label:'1. Jäähyn syy'},{key:'montako_jahyja',label:'Jäähyjä yhteensä'},
  {key:'yli_alle_maalit',label:'Yli/Alle 5,5 maalia'},
  {key:'parempi_laukasu',label:'Laukaus%'},{key:'parempi_alotus',label:'Aloitus%'},
  {key:'parempi_torjunta',label:'Torjunta%'},{key:'parempi_alivoima',label:'Alivoima%'},
  {key:'parempi_ylivoima',label:'Ylivoima%'},{key:'era1',label:'1. erä'},
  {key:'era2',label:'2. erä'},{key:'valmentaja_haasto',label:'Valmentajan haasto'},{key:'maali_tyhjiin',label:'Maali tyhjään'},
  {key:'yv_av_maali',label:'YV/AV maali'},{key:'jatkoaika_tai_rankkarit',label:'JA tai VL'}
];
// Kenttäkohtaiset vihjeet (i-painike). 'lopputulos' jätetty tarkoituksella pois (ei infoa).
const FIELD_INFO = {
  ekan_maalintekija:'Kuka tekee Suomen ensimmäisen maalin',
  ekan_maali_aika:'Mihin aikaan Suomen ensimmäinen maali syntyy',
  kumpi_tekee_ekan_maalin:'Kumpi joukkue tekee ensimmäisen maalin',
  voittomaalin_tekija:'Kuka tekee Suomen viimeisen maalin',
  ekan_jahyn_saaja:'Kuka ottaa Suomen ensimmäisen jäähyn',
  ekan_jahyn_syy:'Mikä on Suomen ensimmäisen jäähyn syy',
  montako_jahyja:'Montako jäähyä Suomi saa ottelussa',
  yli_alle_maalit:'Montako maalia ottelussa tulee yhteensä',
  parempi_laukasu:'Kummalla joukkueella on parempi laukausprosentti',
  parempi_alotus:'Kummalla joukkueella on parempi aloitusprosentti',
  parempi_torjunta:'Kummalla joukkueella on parempi torjuntaprosentti',
  parempi_alivoima:'Kummalla joukkueella on parempi alivoimaprosentti',
  parempi_ylivoima:'Kummalla joukkueella on parempi ylivoimaprosentti',
  era1:'Kumpi tekee ensimmäisessä erässä enemmän maaleja',
  era2:'Kumpi tekee toisessa erässä enemmän maaleja',
  valmentaja_haasto:'Tuleeko ottelussa valmentajan haasto',
  maali_tyhjiin:'Tuleeko ottelussa maali tyhjään maaliin',
  yv_av_maali:'Tuleeko ottelussa ylivoima- tai alivoimamaali',
  jatkoaika_tai_rankkarit:'Meneekö ottelu jatkoajalle tai voittolaukauskisaan'
};
function infoBtn(key){ var t=(typeof FIELD_INFO!=='undefined')&&FIELD_INFO[key]; return t?`<button type="button" class="info-btn" onclick="window._fieldInfo(event,'${key}')" aria-label="Tietoa kentästä">i</button>`:''; }
const ONE_X_TWO = new Set(['parempi_laukasu','parempi_alotus','parempi_torjunta','parempi_alivoima','parempi_ylivoima','era1','era2','kumpi_tekee_ekan_maalin']);
const KYLLA_EI = new Set(['valmentaja_haasto','maali_tyhjiin','yv_av_maali','jatkoaika_tai_rankkarit']);
const NUMBER_K = new Set(['montako_jahyja']);
const YLI_ALLE = new Set(['yli_alle_maalit']);

// ============================
// TILA
// ============================
let data = {tournaments:[]};
let pins = {};
let tid = null; // selected tournament id
let mid = null; // selected match id
let currentUser = null;
let isSavingStructure = false;
let saveStructureQueued = false;
let isSavingPred = false;
let savePredQueued = false;
// Taaksepäin yhteensopivuus – käytetään onSnapshot-tarkistukseen
Object.defineProperty(window, 'isSaving', { get(){ return isSavingStructure||isSavingPred; } });
let cdTimer = null;      // countdown setInterval handle
let cdRunning = false;   // guard: is countdown active?
let adminEditMatchId = null;   // admin edit mode: match ID being edited
let adminEditPlayer  = null;   // admin edit mode: player being edited

// ============================
// HELPERS
// ============================
const $ = id => document.getElementById(id);
const ciEq = (a,b) => (a||'').trim().toLowerCase() === (b||'').trim().toLowerCase();
const getTournament = () => (data.tournaments||[]).find(t => String(t.id)===String(tid)) || null;
const getMatch = () => { const t=getTournament(); return t ? (t.matches||[]).find(m=>String(m.id)===String(mid))||null : null; };
const isLocked = m => !!(m && m.startTime && Date.now() >= new Date(m.startTime).getTime());

function timeMatch(p,a){
  const parse = s => { const m=(s||'').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1]*60 + +m[2] : null; };
  const ps=parse(p), as=parse(a);
  return ps!==null && as!==null && Math.abs(ps-as)<=60;
}
function fieldMatch(key,pv,av){
  if(!av || !pv) return false;
  if(key==='ekan_maali_aika') return timeMatch(pv,av);
  return ciEq(pv,av);
}
function calcMatchPts(t, matchId, player){
  const pr = ((t.predictions||{})[matchId]||{})[player]||{};
  const ac = (t.actuals||{})[matchId]||{};
  let s=0;
  let correctCount=0, scorableCount=0;
  FIELDS.forEach(f=>{
    if(ac[f.key]==null || ac[f.key]==='') return;
    scorableCount++;
    if(f.key==='lopputulos'){
      if(ciEq(pr[f.key]||'', ac[f.key])){ s+=2; correctCount++; }
    } else if(f.key==='ekan_maali_aika'){
      const parse = s => { const m=(s||'').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1]*60 + +m[2] : null; };
      const pp=parse(pr[f.key]||''), ap=parse(ac[f.key]);
      if(pp!==null && ap!==null && pp===ap){ s+=3; correctCount++; }
    } else {
      if(fieldMatch(f.key, pr[f.key]||'', ac[f.key])){ s++; correctCount++; }
    }
  });
  // Bonuspiste: KAIKKI kentät täytetty ja oikein
  const allFieldsAnswered = FIELDS.every(f => (pr[f.key]!=null && pr[f.key]!==''));
  if(allFieldsAnswered && scorableCount===FIELDS.length && correctCount===FIELDS.length) s+=1;
  return s;
}
function calcTimeProximityPts(t, matchId){
  // Lisää 1p lähimmälle maalintekoajan veikkaajalle, jos kukaan ei osunut täysin oikein
  const ac = (t.actuals||{})[matchId]||{};
  const actualTime = ac['ekan_maali_aika'];
  if(!actualTime) return {};
  const parse = s => { const m=(s||'').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1]*60 + +m[2] : null; };
  const ap = parse(actualTime);
  if(ap===null) return {};
  // Tarkista onko kukaan osunut täysin oikein
  const anyExact = PLAYERS.some(p => {
    const pr = ((t.predictions||{})[matchId]||{})[p]||{};
    const pp = parse(pr['ekan_maali_aika']||'');
    return pp!==null && pp===ap;
  });
  if(anyExact) return {}; // täysin oikein saanut → ei lähimmäksi-pistettä kenellekään
  // Laske etäisyydet ±1 min sisällä oleville
  let minDiff = Infinity;
  const diffs = {};
  PLAYERS.forEach(p => {
    const pr = ((t.predictions||{})[matchId]||{})[p]||{};
    const pp = parse(pr['ekan_maali_aika']||'');
    if(pp!==null && Math.abs(pp-ap)<=60){
      const diff = Math.abs(pp-ap);
      diffs[p] = diff;
      if(diff < minDiff) minDiff = diff;
    }
  });
  if(minDiff===Infinity) return {};
  const pts = {};
  PLAYERS.forEach(p => { if(diffs[p]===minDiff) pts[p]=1; });
  return pts;
}
function calcTotals(t){
  const tot={}; PLAYERS.forEach(p=>tot[p]=0);
  (t.matches||[]).forEach(m => {
    PLAYERS.forEach(p => { tot[p] += calcMatchPts(t, m.id, p); });
    const prox = calcTimeProximityPts(t, m.id);
    PLAYERS.forEach(p => { if(prox[p]) tot[p] += prox[p]; });
  });
  if(t.topThreePrediction){
    const aT = t.actualTopThree||[];
    PLAYERS.forEach(p => {
      const pr = t.topThreePrediction[p]||[];
      let pts=0; pr.forEach((team,i) => { if(team && aT[i] && ciEq(team,aT[i])) pts+=2; });
      tot[p] += pts;
    });
  }
  return tot;
}

// ============================
// TIEBREAKER-LOGIIKKA
// ============================
function calcTiebreakerStats(t, player){
  const matches = (t.matches||[]).filter(m => {
    const ac = (t.actuals||{})[m.id]||{};
    return Object.values(ac).some(v => v && v!=='');
  });
  // 2. Otteluvoitot
  let matchWins = 0;
  matches.forEach(m => {
    const myPts = calcMatchPts(t,m.id,player)+(calcTimeProximityPts(t,m.id)[player]||0);
    const maxPts = Math.max(...PLAYERS.map(p => calcMatchPts(t,m.id,p)+(calcTimeProximityPts(t,m.id)[p]||0)));
    if(myPts===maxPts && myPts>0) matchWins++;
  });
  // 3. Paras yksittäinen ottelutulos
  let bestMatch = 0;
  matches.forEach(m => {
    const pts = calcMatchPts(t,m.id,player)+(calcTimeProximityPts(t,m.id)[player]||0);
    if(pts>bestMatch) bestMatch=pts;
  });
  // 4. Lopputulos-osumat
  let correctResults = 0;
  matches.forEach(m => {
    const pr=((t.predictions||{})[m.id]||{})[player]||{};
    const ac=(t.actuals||{})[m.id]||{};
    if(ac['lopputulos']&&ciEq(pr['lopputulos']||'',ac['lopputulos'])) correctResults++;
  });
  // 5. Maalintekijä-osumat
  let correctScorers = 0;
  matches.forEach(m => {
    const pr=((t.predictions||{})[m.id]||{})[player]||{};
    const ac=(t.actuals||{})[m.id]||{};
    if(ac['ekan_maalintekija']&&ciEq(pr['ekan_maalintekija']||'',ac['ekan_maalintekija'])) correctScorers++;
  });
  // 6. Viimeisin ottelu
  let lastMatchPts = 0;
  if(matches.length>0){
    const last=matches[matches.length-1];
    lastMatchPts=calcMatchPts(t,last.id,player)+(calcTimeProximityPts(t,last.id)[player]||0);
  }
  return {matchWins,bestMatch,correctResults,correctScorers,lastMatchPts};
}

function sortedStandings(t){
  const totals=calcTotals(t);
  const entries=Object.entries(totals);
  entries.sort((a,b)=>{
    if(b[1]!==a[1]) return b[1]-a[1];
    const sa=calcTiebreakerStats(t,a[0]);
    const sb=calcTiebreakerStats(t,b[0]);
    if(sb.matchWins!==sa.matchWins) return sb.matchWins-sa.matchWins;
    if(sb.bestMatch!==sa.bestMatch) return sb.bestMatch-sa.bestMatch;
    if(sb.correctResults!==sa.correctResults) return sb.correctResults-sa.correctResults;
    if(sb.correctScorers!==sa.correctScorers) return sb.correctScorers-sa.correctScorers;
    return sb.lastMatchPts-sa.lastMatchPts;
  });
  return entries;
}

window._openTiebreakerModal = function(){
  const modal=document.getElementById('tiebreakerModal');
  if(!modal) return;
  modal.style.display='flex';
  window._renderTiebreaker();
};

window._renderTiebreaker = function(){
  const el=document.getElementById('tiebreakerArea');
  if(!el) return;
  const t=getTournament();
  if(!t){ el.innerHTML='<p class="muted" style="font-size:13px">Valitse ensin turnaus.</p>'; return; }
  const totals=calcTotals(t);
  const sorted=sortedStandings(t);
  const CRITERIA=['matchWins','bestMatch','correctResults','correctScorers','lastMatchPts'];
  const LABELS={'matchWins':'2️⃣ Otteluvoitot','bestMatch':'3️⃣ Paras ottelutulos','correctResults':'4️⃣ Lopputulos-osumat','correctScorers':'5️⃣ Maalintekijä-osumat','lastMatchPts':'6️⃣ Viimeisin ottelu'};
  const UNITS={'matchWins':'voittoa','bestMatch':'p','correctResults':'kpl','correctScorers':'kpl','lastMatchPts':'p'};
  const stats={};
  sorted.forEach(([p])=>{ stats[p]=calcTiebreakerStats(t,p); });
  const tiedPairs=[];
  for(let i=0;i<sorted.length-1;i++)
    for(let j=i+1;j<sorted.length;j++)
      if(sorted[i][1]===sorted[j][1]) tiedPairs.push([sorted[i][0],sorted[j][0]]);

  let html='';
  // Yhteenvetokortit
  html+='<div style="display:grid;gap:6px;margin-bottom:16px;">';
  sorted.forEach(([p,pts],i)=>{
    const s=stats[p];
    const inTie=tiedPairs.some(pair=>pair.includes(p));
    const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'💩';
    const bg=inTie?'background:rgba(251,191,36,0.07);border-color:rgba(251,191,36,0.3)':'background:var(--bg);border-color:var(--border)';
    html+=`<div style="${bg};border:1px solid;border-radius:10px;padding:10px 12px;">`;
    html+=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">`;
    html+=`<div style="font-weight:800;font-size:14px">${medal} ${inTie?'⚠️ ':''} ${p}</div>`;
    html+=`<div style="font-weight:900;font-size:16px;color:var(--primary)">${pts} p</div></div>`;
    html+=`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:11px;color:var(--muted)">`;
    html+=`<div>Otteluvoitot: <strong>${s.matchWins}</strong></div>`;
    html+=`<div>Paras ottelu: <strong>${s.bestMatch} p</strong></div>`;
    html+=`<div>Lopputulokset: <strong>${s.correctResults} kpl</strong></div>`;
    html+=`<div>Maalintekijät: <strong>${s.correctScorers} kpl</strong></div>`;
    html+=`<div>Viimeisin: <strong>${s.lastMatchPts} p</strong></div>`;
    html+=`</div></div>`;
  });
  html+='</div>';

  if(tiedPairs.length===0){
    html+='<div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:10px 14px;font-size:13px;font-weight:700;color:#22c55e">✅ Ei tasatilanteita — kaikki sijoitukset määräytyvät suoraan pisteiden mukaan.</div>';
  } else {
    html+='<div style="font-weight:800;font-size:14px;margin-bottom:10px">⚠️ Tasatilanteiden läpikäynti:</div>';
    tiedPairs.forEach(([a,b])=>{
      const sa=stats[a],sb=stats[b];
      const posA=sorted.findIndex(([p])=>p===a)+1;
      const posB=sorted.findIndex(([p])=>p===b)+1;
      html+=`<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:12px;font-size:13px">`;
      html+=`<div style="font-weight:900;font-size:14px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">${a} (${posA}. sija) vs ${b} (${posB}. sija)</div>`;
      // Kriteeri 1
      html+=`<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;padding:8px;border-radius:8px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2)">`;
      html+=`<div style="font-size:18px;flex-shrink:0">➖</div><div><div style="font-weight:800">1️⃣ Kokonaispisteet — ei ratkaissut</div>`;
      html+=`<div style="color:var(--muted);margin-top:2px">${a}: <strong>${totals[a]} p</strong> · ${b}: <strong>${totals[b]} p</strong> — Tasan, siirrytään seuraavaan.</div></div></div>`;
      // Kriteerit 2–6
      let resolved=false;
      CRITERIA.forEach((c)=>{
        if(resolved) return;
        const va=sa[c],vb=sb[c];
        if(va!==vb){
          const winner=va>vb?a:b, loser=winner===a?b:a;
          const wVal=winner===a?va:vb, lVal=winner===a?vb:va;
          html+=`<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;padding:8px;border-radius:8px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.3)">`;
          html+=`<div style="font-size:18px;flex-shrink:0">✅</div><div><div style="font-weight:800;color:#22c55e">${LABELS[c]} — RATKAISI</div>`;
          html+=`<div style="color:var(--muted);margin-top:2px">${a}: <strong>${va} ${UNITS[c]}</strong> · ${b}: <strong>${vb} ${UNITS[c]}</strong></div>`;
          html+=`<div style="margin-top:4px;font-weight:700">🏆 ${winner} voittaa (${wVal} vs ${lVal} ${UNITS[c]})</div></div></div>`;
          resolved=true;
        } else {
          html+=`<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;padding:8px;border-radius:8px;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2)">`;
          html+=`<div style="font-size:18px;flex-shrink:0">➖</div><div><div style="font-weight:800">${LABELS[c]} — ei ratkaissut</div>`;
          html+=`<div style="color:var(--muted);margin-top:2px">${a}: <strong>${va} ${UNITS[c]}</strong> · ${b}: <strong>${vb} ${UNITS[c]}</strong> — Tasan, siirrytään seuraavaan.</div></div></div>`;
        }
      });
      if(!resolved){
        html+=`<div style="display:flex;align-items:flex-start;gap:8px;padding:8px;border-radius:8px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3)">`;
        html+=`<div style="font-size:18px;flex-shrink:0">❌</div><div><div style="font-weight:800;color:#dc2626">Kaikki 6 kriteeriä tasan</div>`;
        html+=`<div style="color:var(--muted);margin-top:2px">Järjestys säilyy nykyisellään.</div></div></div>`;
      }
      html+=`</div>`;
    });
  }
  el.innerHTML=html;
};

// ============================
// FAQ TOGGLE
// ============================
window._toggleFaq = function(btn) {
  const body = document.getElementById('faqBody');
  const arrow = document.getElementById('faqArrow');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if(arrow) arrow.textContent = isOpen ? '▼' : '▲';
};

window._toggleFaq2 = function(btn) {
  const body = document.getElementById('faqBody2');
  const arrow = document.getElementById('faqArrow2');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if(arrow) arrow.textContent = isOpen ? '▼' : '▲';
};

// ============================
// PELAAJAN PROFIILISIVU
// ============================
window.showPlayerProfile = function(player) {
  const html = window._buildProfileHTML(player);
  if(html==null) return;
  document.getElementById('playerProfileContent').innerHTML = html;
  document.getElementById('playerProfileModal').style.display = 'flex';
};

// Avaa oman profiilin (Lisää-välilehden Profiili-nappi) – sama modaali kuin pistetaulua klikatessa
window._openMyProfile = function(){
  if(!currentUser) return;
  const t = getTournament();
  if(!t){ alert('Valitse ensin turnaus.'); return; }
  window.showPlayerProfile(currentUser);
};

window._buildProfileHTML = function(player) {
  const t = getTournament();
  if (!t) return;
  const totals = calcTotals(t);
  const totalPts = totals[player] || 0;
  const sorted = sortedStandings(t);
  const rank = sorted.findIndex(([n])=>n===player) + 1;
  const medals = ['🥇','🥈','🥉'];
  const rankIcon = rank<=3 ? medals[rank-1] : (rank===sorted.length ? '💩' : rank+'.');

  // Ottelukohtaiset pisteet
  const matchRows = (t.matches||[]).map(m => {
    const pts = calcMatchPts(t, m.id, player) + (calcTimeProximityPts(t, m.id)[player]||0);
    const maxPts = FIELDS.length + 2; // karkea max
    const pct = Math.round((pts/maxPts)*100);
    const bar = `<div style="display:inline-block;width:${Math.min(pct,100)}%;background:var(--primary);height:4px;border-radius:2px;margin-top:3px;min-width:2px"></div>`;
    return `<div class="profile-match-row">
      <div><div style="font-weight:600">${m.name}</div><div style="background:var(--border);border-radius:2px;height:4px;margin-top:3px;width:80px">${bar}</div></div>
      <div class="pts-badge">${pts} p</div>
    </div>`;
  }).join('');

  // Laskenta: oikeiden vastausten % kaikista kentistä joihin on vastattu
  let correctCount = 0, totalAnswered = 0;
  (t.matches||[]).forEach(m => {
    const pr = ((t.predictions||{})[m.id]||{})[player]||{};
    const ac = (t.actuals||{})[m.id]||{};
    FIELDS.forEach(f => {
      if(ac[f.key] && ac[f.key]!=='' && pr[f.key] && pr[f.key]!=='') {
        totalAnswered++;
        if(fieldMatch(f.key, pr[f.key], ac[f.key])) correctCount++;
      }
    });
  });
  const accuracy = totalAnswered > 0 ? Math.round((correctCount/totalAnswered)*100) : 0;
  const best = getPersonalBest(player);
  const lastEdit = getLastEditedTime(t, player);
  const lastEditStr = lastEdit
    ? new Date(lastEdit).toLocaleString('fi-FI',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})
    : '–';

  const avatar = (window._getAvatar ? window._getAvatar(player) : '🏒');

  const html = `
    <div class="profile-header">
      <div class="profile-avatar">${avatar}</div>
      <div class="profile-name">${player===ADMIN?'👑 ':''}${player}</div>
      <div style="font-size:13px;color:var(--muted);margin-top:4px">${rankIcon} Sijalla ${rank}/${sorted.length}</div>
      <div class="profile-pts">${totalPts} p</div>
    </div>
    <div class="profile-stat-grid">
      <div class="profile-stat-box">
        <div class="profile-stat-val">${accuracy}%</div>
        <div class="profile-stat-lbl">Osumis-%</div>
      </div>
      <div class="profile-stat-box">
        <div class="profile-stat-val">${best&&best.pts>0?best.pts+' p':'–'}</div>
        <div class="profile-stat-lbl">Oma ennätys</div>
      </div>
      <div class="profile-stat-box">
        <div class="profile-stat-val">${correctCount}</div>
        <div class="profile-stat-lbl">Oikeita vastauksia</div>
      </div>
      <div class="profile-stat-box">
        <div class="profile-stat-val" style="font-size:13px">${lastEditStr}</div>
        <div class="profile-stat-lbl">Viimeksi veikannut</div>
      </div>
    </div>
    ${matchRows ? `<div style="font-weight:700;margin-bottom:6px;font-size:14px">📊 Ottelukohtaiset pisteet</div>${matchRows}` : '<p class="muted" style="font-size:13px">Ei otteluita vielä.</p>'}
  `;

  return html;
};

// Tallenna/palauta valinnat
function saveSelections(){ try{ localStorage.setItem('tv_sel', JSON.stringify({t:tid,m:mid})); }catch(e){} }
function restoreSelections(){
  try{
    const s = JSON.parse(localStorage.getItem('tv_sel')||'{}');
    if(!tid && s.t) tid=s.t;
    if(!mid && s.m) mid=s.m;
  }catch(e){}
}

// ============================
// STATUS BAR
// ============================
// 20 hauskaa vahvistusviestiä veikkauksen tallennukseen
const CONFIRM_MSGS = [
  'Veikkaus tallessa kuin kiekko verkossa! 🥅',
  'Pukit purkissa – veikkaus tallennettu! 🏒',
  'Nappiin meni! Veikkaus lukittu ja ladattu 💪',
  'Veikkaus jäissä, odotellaan tuloksia ❄️',
  'Boom! Veikkauksesi on kirjattu kovaa kyytiä 🚀',
  'Tallennettu! Nyt vain peli päälle 🚨',
  'Veikkaus matkalla maalille – perille meni! 🥅',
  'Siisti veto! Veikkaus on nyt turvassa 🔒',
  'Kiekko on sinun – veikkaus tallennettu! 🏒',
  'Maalivahti ei pysäyttänyt tätä – tallennettu! ✅',
  'Veikkaus pakastimessa, valmiina kisaan 🧊',
  'Hyvä veto! Veikkauksesi on nyt kirjoissa 📒',
  'Veikkaus tallessa – nyt sormet ristiin! 🤞',
  'Täydellinen syöttö – veikkaus perille! 🏒',
  'Veikkaus lukittu kuin halli pelin jälkeen 🔐',
  'Mahtavaa! Veikkauksesi luistaa jo jäällä ⛸️',
  'Tallennettu! Saunan jälkeen tulokset 🧖',
  'Veikkaus napsahti talteen – hyvä sinä! 👏',
  'Kiekko kaukalossa, veikkaus tallessa 🏟️',
  'Done! Veikkauksesi odottaa vihellystä 📣'
];
window._showSaveConfirm = function(){
  var msg = CONFIRM_MSGS[Math.floor(Math.random()*CONFIRM_MSGS.length)];
  var t = document.getElementById('saveConfirmToast');
  if(!t){ t=document.createElement('div'); t.id='saveConfirmToast'; t.className='save-confirm-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  try{ if(navigator.vibrate) navigator.vibrate(30); }catch(e){}
  clearTimeout(window._saveConfirmT);
  window._saveConfirmT = setTimeout(function(){ t.classList.remove('show'); }, 2800);
};
function showStatus(msg, color){
  const el=$('fb-status'); if(!el) return;
  el.textContent=msg; el.style.background=color||'#f97316'; el.style.color='#fff'; el.style.opacity='1';
}
function hideStatus(){ setTimeout(()=>{ const el=$('fb-status'); if(el) el.style.opacity='0'; }, 1800); }

// ============================
// FIREBASE – RAKENNE (turnaukset, ottelut, actuals, jne.)
// Ei sisällä veikkauksia – ne menevät predDoc:iin
// ============================
async function saveStructure(){
  data.selectedTournamentId = tid;
  data.selectedMatchId = mid;
  if(currentUser && mid){
    const t=getTournament();
    if(t){
      t.editHistory=t.editHistory||{};
      t.editHistory[mid]=t.editHistory[mid]||{};
      t.editHistory[mid][currentUser]=new Date().toISOString();
    }
  }
  try{ localStorage.setItem('tv_bkp', JSON.stringify(data)); }catch(e){}
  if(isSavingStructure){ saveStructureQueued=true; return; }
  isSavingStructure=true; showStatus('💾 Tallennetaan…','#f97316');
  try{
    // Poistetaan predictions ja topThreePrediction – ne tallennetaan erikseen
    const toSave={
      ...data,
      tournaments:(data.tournaments||[]).map(t=>{
        const copy={...t};
        delete copy.predictions;
        delete copy.topThreePrediction;
        delete copy._predSavedAt;
        return copy;
      })
    };
    await kirjoitaRakenne(toSave);
    showStatus('✅ Tallennettu','#22c55e'); hideStatus();
    try{ if(currentUser===ADMIN && typeof _maybeSysMsg==='function') _maybeSysMsg(); }catch(e){}
  }catch(e){ showStatus('❌ Tallennus epäonnistui','#dc2626'); }
  isSavingStructure=false;
  if(saveStructureQueued){ saveStructureQueued=false; saveStructure(); }
}

// ============================
// FIREBASE – PELAAJAN VEIKKAUKSET
// Kirjoittaa vain yhden pelaajan omaan dokumenttiin
// ============================
async function savePredictions(player){
  if(!player) return;
  try{ localStorage.setItem('tv_bkp', JSON.stringify(data)); }catch(e){}
  if(isSavingPred){ savePredQueued=true; return; }
  isSavingPred=true; showStatus('💾 Tallennetaan…','#f97316');
  try{
    // Rakennetaan uusi data muistissa olevasta tilasta
    const newPlayerData={ matches:{}, topThree:{} };
    (data.tournaments||[]).forEach(t=>{
      const matchPreds={};
      (t.matches||[]).forEach(m=>{
        const pr=((t.predictions||{})[m.id]||{})[player];
        if(pr && Object.keys(pr).length) matchPreds[m.id]=pr;
      });
      if(Object.keys(matchPreds).length) newPlayerData.matches[t.id]=matchPreds;
      const top3=(t.topThreePrediction||{})[player];
      if(top3) newPlayerData.topThree[t.id]=top3;
    });
    // Aikaleima: pelaajan oma tallennusaika valittuun otteluun (ei jaettuun rakenteeseen)
    newPlayerData.savedAt={};
    if(tid && mid){ newPlayerData.savedAt[String(tid)]={}; newPlayerData.savedAt[String(tid)][String(mid)]=new Date().toISOString(); }
    // KORJAUS: Haetaan ensin Firebasesta vanha data ja yhdistetään –
    // estää vanhojen pelien ylikirjoituksen jos muistissa on vain osa peleistä
    try{
      const existingSnap = await getDoc(predDoc(player));
      if(existingSnap.exists()){
        const existing = JSON.parse(existingSnap.data().json||'{}');
        // Yhdistä matches: Firebase on pohja, muistissa oleva data korvaa päällimmäisenä
        const mergedMatches = {...(existing.matches||{})};
        Object.entries(newPlayerData.matches).forEach(([tId, matchData])=>{
          mergedMatches[tId] = {...(mergedMatches[tId]||{}), ...matchData};
        });
        newPlayerData.matches = mergedMatches;
        // Yhdistä topThree samoin
        newPlayerData.topThree = {...(existing.topThree||{}), ...newPlayerData.topThree};
        // Yhdistä aikaleimat: muiden turnausten/otteluiden leimat säilyvät
        const mergedSaved={...(existing.savedAt||{})};
        Object.entries(newPlayerData.savedAt).forEach(([tId,mt])=>{ mergedSaved[tId]={...(mergedSaved[tId]||{}),...mt}; });
        newPlayerData.savedAt=mergedSaved;
      }
    }catch(mergeErr){ /* jos haku epäonnistuu, tallennetaan mitä muistissa on */ }
    await setDoc(predDoc(player),{json:JSON.stringify(newPlayerData)});
    showStatus('✅ Tallennettu','#22c55e'); hideStatus();
  }catch(e){ showStatus('❌ Tallennus epäonnistui','#dc2626'); }
  isSavingPred=false;
  if(savePredQueued){ savePredQueued=false; savePredictions(player); }
}

// Yhteensopivuusapu: tuonti ja muut erityistilanteet
async function save(){
  await Promise.all([saveStructure(), savePredictions(currentUser)]);
}

// ============================
// KÄYTTÖKERTOJEN SEURANTA
// ============================
const LOGINS_DOC = doc(db, "app", "logins");
const PELLE_DOC  = doc(db, "app", "pelle");

const LOGIN_MILESTONES = {
  1: { emoji: '🎉', title: 'Tervetuloa mukaan!', text: 'Ensimmäinen kirjautuminen tehty. Veikkausura alkaa!' },
  10: { emoji: '🔟', title: '10 käyntiä!', text: 'Kymppi täynnä! Tästä se lähtee.' },
  25: { emoji: '🏒', title: '25 käyntiä!', text: 'Neljännesfinaaliin selvitty. Ei paha!' },
  50: { emoji: '🏆', title: '50 käyntiä!', text: 'Veikkaaminen on selvästi elämäntapa 🏒' },
  100: { emoji: '💯', title: '100 käyntiä!', text: 'Legenda saapuu paikalle 👑' },
  150: { emoji: '🚀', title: '150 käyntiä!', text: 'Toinen sata lähestyy. Vauhti vain kiihtyy!' },
  200: { emoji: '⭐', title: '200 käyntiä!', text: 'Kaksisataa! Olet vakiokasvo näillä jäillä.' },
  250: { emoji: '🔥', title: '250 käyntiä!', text: 'Oletko edes nukkunut? 😂' },
  300: { emoji: '🧊', title: '300 käyntiä!', text: 'Jää alkaa tunnistaa sinut nimeltä.' },
  350: { emoji: '🏅', title: '350 käyntiä!', text: 'Kohta sinulle pitää varata oma penkki.' },
  400: { emoji: '💪', title: '400 käyntiä!', text: 'Neljäsataa! Peukalo on jo huippukunnossa.' },
  450: { emoji: '🎯', title: '450 käyntiä!', text: 'Lähestytään puolta tuhatta. Tarkkana!' },
  500: { emoji: '🌟', title: '500 käyntiä!', text: 'Hall of Fame -taso saavutettu. Kunnioitettavaa!' },
  550: { emoji: '📈', title: '550 käyntiä!', text: 'Käyrä osoittaa vain ylöspäin. Hyvä niin!' },
  600: { emoji: '🥅', title: '600 käyntiä!', text: 'Maalivahtikin pitäisi tauon — sinä et.' },
  650: { emoji: '🦾', title: '650 käyntiä!', text: 'Sormi ei väsy koskaan.' },
  700: { emoji: '🏒', title: '700 käyntiä!', text: 'Seitsemänsataa! Tämä on jo ammattilaistasoa.' },
  750: { emoji: '👑', title: '750 käyntiä!', text: 'Kolme neljäsosaa tuhannesta. Kruunu kiiltää.' },
  800: { emoji: '🚂', title: '800 käyntiä!', text: 'Juna kulkee. Ei jarruja näköpiirissä!' },
  850: { emoji: '⚡', title: '850 käyntiä!', text: 'Salamannopeaa sitoutumista.' },
  900: { emoji: '🎢', title: '900 käyntiä!', text: 'Tuhat häämöttää jo horisontissa.' },
  950: { emoji: '🛎️', title: '950 käyntiä!', text: 'Vielä viiskyt niin paukkuu tuhat. Pinna kireällä!' },
  1000: { emoji: '🎆', title: '1000 käyntiä!', text: 'TUHAT KÄYNTIÄ! Otetaanko yhteyttä Guinnessiin? 📕' },
  1050: { emoji: '🌙', title: '1050 käyntiä!', text: 'Tuhat ja päälle. Nukkuminen on yliarvostettua, vai?' },
  1100: { emoji: '🧭', title: '1100 käyntiä!', text: 'Löydät sovellukseen jo silmät kiinni.' },
  1150: { emoji: '🪐', title: '1150 käyntiä!', text: 'Olet omalla kiertoradallasi. Jatka matkaa!' },
  1200: { emoji: '🏔️', title: '1200 käyntiä!', text: 'Huippu vain nousee korkeammalle.' },
  1250: { emoji: '💎', title: '1250 käyntiä!', text: 'Neljäsosa tiestä neljääntuhanteen. Timanttista!' },
  1300: { emoji: '🔋', title: '1300 käyntiä!', text: 'Akku ei näytä loppuvan koskaan.' },
  1350: { emoji: '🎩', title: '1350 käyntiä!', text: 'Tyylillä, kuten aina.' },
  1400: { emoji: '🛰️', title: '1400 käyntiä!', text: 'Olet kiertänyt sovelluksen tuhansia kertoja. Kirjaimellisesti.' },
  1450: { emoji: '🌊', title: '1450 käyntiä!', text: 'Aalto vie eteenpäin. Pian puolitoistatuhatta!' },
  1500: { emoji: '🏰', title: '1500 käyntiä!', text: 'Oma jäälinna rakennettu!' },
  1550: { emoji: '🦅', title: '1550 käyntiä!', text: 'Korkealla lennetään. Maa näyttää pieneltä.' },
  1600: { emoji: '⛸️', title: '1600 käyntiä!', text: 'Terävät terät, vakaa vire.' },
  1650: { emoji: '🧱', title: '1650 käyntiä!', text: 'Tiili tiileltä kohti legendaa.' },
  1700: { emoji: '🌋', title: '1700 käyntiä!', text: 'Into ei laannut hetkeksikään.' },
  1750: { emoji: '🎺', title: '1750 käyntiä!', text: 'Fanfaarit soimaan!' },
  1800: { emoji: '🛤️', title: '1800 käyntiä!', text: 'Pitkä matka takana, vielä pidempi edessä. Eteenpäin!' },
  1850: { emoji: '🪂', title: '1850 käyntiä!', text: 'Vapaapudotusta innostukseen.' },
  1900: { emoji: '🔭', title: '1900 käyntiä!', text: 'Voitto näkyy jo kaukoputkesta.' },
  1950: { emoji: '🥁', title: '1950 käyntiä!', text: 'Rummutus kiihtyy — kaksituhatta lähestyy!' },
  2000: { emoji: '🎇', title: '2000 käyntiä!', text: 'KAKSITUHATTA! Puolimatkassa neljääntuhanteen.' },
  2050: { emoji: '☕', title: '2050 käyntiä!', text: 'Kahvikuposten määrä taitaa olla sama.' },
  2100: { emoji: '🧗', title: '2100 käyntiä!', text: 'Kiivetään kohti pilviä.' },
  2150: { emoji: '🛡️', title: '2150 käyntiä!', text: 'Kilpi kiiltää käytöstä.' },
  2200: { emoji: '🌠', title: '2200 käyntiä!', text: 'Tähdenlento toisensa jälkeen.' },
  2250: { emoji: '🏹', title: '2250 käyntiä!', text: 'Tähtäys osuu joka kerta. Tarkkaa!' },
  2300: { emoji: '🦁', title: '2300 käyntiä!', text: 'Kuningaslaji hallussa.' },
  2350: { emoji: '🎮', title: '2350 käyntiä!', text: 'Combo jatkuu vailla vertaa!' },
  2400: { emoji: '🚁', title: '2400 käyntiä!', text: 'Korkeuksissa pyöritään. Ei laskeutumista.' },
  2450: { emoji: '🧊', title: '2450 käyntiä!', text: 'Pidätkö koskaan lomaa? Et tietenkään.' },
  2500: { emoji: '💫', title: '2500 käyntiä!', text: 'Kaksi ja puoli tuhatta! Yli puolivälin.' },
  2550: { emoji: '🌐', title: '2550 käyntiä!', text: 'Maailma pyörii, sinä kirjaudut.' },
  2600: { emoji: '🔱', title: '2600 käyntiä!', text: 'Valtikka pysyy tukevasti kädessä.' },
  2650: { emoji: '🎲', title: '2650 käyntiä!', text: 'Sinnikkyys palkitaan aina.' },
  2700: { emoji: '🗼', title: '2700 käyntiä!', text: 'Korkea torni rakennettu käynti kerrallaan.' },
  2750: { emoji: '🏔️', title: '2750 käyntiä!', text: 'Kolme neljäsosaa kolmesta tuhannesta!' },
  2800: { emoji: '🛸', title: '2800 käyntiä!', text: 'Jo toisella tasolla menossa.' },
  2850: { emoji: '🧨', title: '2850 käyntiä!', text: 'Räjähtävää menoa!' },
  2900: { emoji: '🪙', title: '2900 käyntiä!', text: 'Kohta kolmetuhatta kolikkoa kassaan.' },
  2950: { emoji: '⏳', title: '2950 käyntiä!', text: 'Hiekka valuu sinun eduksesi.' },
  3000: { emoji: '🎉', title: '3000 käyntiä!', text: 'KOLMETUHATTA! Tämä on jo myyttistä tasoa.' },
  3050: { emoji: '🌁', title: '3050 käyntiä!', text: 'Sumukin väistyy edestäsi.' },
  3100: { emoji: '🦾', title: '3100 käyntiä!', text: 'Kyborgitason sitoutumista.' },
  3150: { emoji: '🏟️', title: '3150 käyntiä!', text: 'Oma areena täynnä faneja!' },
  3200: { emoji: '🌅', title: '3200 käyntiä!', text: 'Aurinko nousee sinun mukanasi.' },
  3250: { emoji: '💠', title: '3250 käyntiä!', text: 'Moniulotteista omistautumista.' },
  3300: { emoji: '🛞', title: '3300 käyntiä!', text: 'Pyörä pyörii eikä pysähdy.' },
  3350: { emoji: '🪄', title: '3350 käyntiä!', text: 'Sovellus tottelee jo ajatuksiasi.' },
  3400: { emoji: '🗿', title: '3400 käyntiä!', text: 'Kestävää kuin kivipatsas.' },
  3450: { emoji: '🌪️', title: '3450 käyntiä!', text: 'Kukaan ei pysy perässä.' },
  3500: { emoji: '👑', title: '3500 käyntiä!', text: 'Kruunu painaa jo kullan verran.' },
  3550: { emoji: '🛰️', title: '3550 käyntiä!', text: 'Loppusuora lähestyy!' },
  3600: { emoji: '🔥', title: '3600 käyntiä!', text: 'Liekki palaa kirkkaampana kuin koskaan.' },
  3650: { emoji: '🎯', title: '3650 käyntiä!', text: 'Lähes vuosi käyntejä per päivä. Uskomatonta!' },
  3700: { emoji: '🏆', title: '3700 käyntiä!', text: 'Pokaalihylly alkaa olla täynnä.' },
  3750: { emoji: '🚀', title: '3750 käyntiä!', text: 'Kolme neljäsosaa neljästä tuhannesta!' },
  3800: { emoji: '🌟', title: '3800 käyntiä!', text: 'Tähti loistaa kirkkaimmillaan.' },
  3850: { emoji: '🧬', title: '3850 käyntiä!', text: 'Veikkaaminen taitaa olla jo DNA:ssasi.' },
  3900: { emoji: '🎆', title: '3900 käyntiä!', text: 'Vielä satanen niin paukkuu neljätuhatta!' },
  3950: { emoji: '🏁', title: '3950 käyntiä!', text: 'Maali näkyy! Viimeiset metrit.' },
  4000: { emoji: '🏆', title: '4000 käyntiä!', text: 'NELJÄTUHATTA KÄYNTIÄ! Huippu saavutettu. Nyt voisi ehkä käydä ulkonakin… 😄' },
};

function showMilestoneCelebration(name, count) {
  const m = LOGIN_MILESTONES[count];
  if (!m) return;
  // Luo modaali
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99997;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeInOverlay 0.3s ease';
  overlay.innerHTML = `
    <div style="background:var(--card);border-radius:20px;padding:28px 24px;max-width:340px;width:100%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.4);animation:slideUpModal 0.3s ease;border:2px solid var(--primary)">
      <div style="font-size:72px;line-height:1;margin-bottom:12px">${m.emoji}</div>
      <div style="font-size:22px;font-weight:900;margin-bottom:8px">${m.title}</div>
      <div style="font-size:14px;color:var(--muted);margin-bottom:6px">${name}</div>
      <div style="font-size:16px;margin-bottom:20px">${m.text}</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:20px">Käyntikerta numero <strong style="color:var(--primary);font-size:18px">${count}</strong></div>
      <button style="background:var(--primary);color:#fff;border:none;border-radius:12px;padding:12px 32px;font-size:16px;font-weight:700;cursor:pointer;width:100%" onclick="this.closest('[data-milestone]').remove()">Jee! 🎊</button>
    </div>`;
  overlay.setAttribute('data-milestone', '1');
  overlay.addEventListener('click', e => { if(e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  // Konfetti-efekti
  spawnConfetti();
}

function spawnConfetti() {
  const colors = ['#f97316','#22c55e','#3b82f6','#f59e0b','#ec4899','#8b5cf6'];
  for (let i = 0; i < 60; i++) {
    const el = document.createElement('div');
    const size = Math.random() * 10 + 6;
    el.style.cssText = `position:fixed;z-index:99999;width:${size}px;height:${size}px;border-radius:${Math.random()>0.5?'50%':'2px'};background:${colors[Math.floor(Math.random()*colors.length)]};left:${Math.random()*100}vw;top:-20px;pointer-events:none`;
    document.body.appendChild(el);
    const duration = Math.random() * 2000 + 1500;
    const drift = (Math.random() - 0.5) * 200;
    el.animate([
      { transform: `translateY(0) translateX(0) rotate(0deg)`, opacity: 1 },
      { transform: `translateY(110vh) translateX(${drift}px) rotate(${Math.random()*720}deg)`, opacity: 0 }
    ], { duration, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)', fill: 'forwards' })
      .onfinish = () => el.remove();
  }
}

async function trackLoginEvent(name) {
  try {
    const snap = await getDoc(LOGINS_DOC);
    const loginData = snap.exists() ? snap.data() : {};
    const now = new Date().toISOString();
    const userEntry = loginData[name] || { count: 0, sessions: [] };
    userEntry.count = (userEntry.count || 0) + 1;
    userEntry.sessions = [...(userEntry.sessions || []), now].slice(-20);
    userEntry.lastSeen = now;
    loginData[name] = userEntry;
    await setDoc(LOGINS_DOC, loginData);
    // Tarkista merkkipaalu
    if (LOGIN_MILESTONES[userEntry.count]) {
      setTimeout(() => showMilestoneCelebration(name, userEntry.count), 1200);
    }
  } catch(e) { /* ei kriittinen */ }
}

// ============================
// VIESTIJÄRJESTELMÄ
// ============================
const MESSAGES_DOC  = doc(db, "app", "messages");
const ALERTS_DOC    = doc(db, "app", "alerts");
const BROADCAST_DOC = doc(db, "app", "broadcast");
// ============================
// HUOLTOKATKO (KSN maintenance)
// ============================
const MAINT_DOC = doc(db, "app", "maintenance");
const DEFAULT_MAINT_MSG = "Kulju Sport Network (KSN) huoltaa sovellusta parhaillaan. Palaamme pian – kiitos kärsivällisyydestä! 🏒";
let _maintState = { active:false, message:"" };

function applyMaintenance(){
  const scr = document.getElementById('maintenanceScreen');
  const banner = document.getElementById('maintAdminBanner');
  const isAdmin = (currentUser === ADMIN);
  const active = !!(_maintState && _maintState.active);
  if (scr){
    if (active && currentUser && !isAdmin){
      const t = document.getElementById('maintMsgText');
      if (t) t.textContent = (_maintState.message && String(_maintState.message).trim()) ? _maintState.message : DEFAULT_MAINT_MSG;
      scr.style.display = 'flex';
    } else {
      scr.style.display = 'none';
    }
  }
  if (banner){
    banner.style.display = (active && isAdmin) ? 'flex' : 'none';
  }
}
window._applyMaintenance = applyMaintenance;

window._toggleMaintenance = function(){
  if (currentUser !== ADMIN) return;
  const next = !(_maintState && _maintState.active);
  const inp = document.getElementById('maintMsgInput');
  const msg = (inp && inp.value.trim()) ? inp.value.trim() : DEFAULT_MAINT_MSG;
  setDoc(MAINT_DOC, { active: next, message: msg, ts: Date.now() })
    .catch(function(e){ alert('Huoltokatkon tilan tallennus epäonnistui: ' + (e && e.message || e)); });
};

window._saveMaintMessage = function(){
  if (currentUser !== ADMIN) return;
  const inp = document.getElementById('maintMsgInput');
  const msg = (inp && inp.value.trim()) ? inp.value.trim() : DEFAULT_MAINT_MSG;
  const active = !!(_maintState && _maintState.active);
  setDoc(MAINT_DOC, { active: active, message: msg, ts: Date.now() })
    .then(function(){ var s=document.getElementById('maintSaveStatus'); if(s){ s.textContent='Ilmoitus tallennettu ✓'; setTimeout(function(){ s.textContent=''; }, 2500); } })
    .catch(function(e){ alert('Tallennus epäonnistui: ' + (e && e.message || e)); });
};

window._updateMaintUI = function(){
  const pill = document.getElementById('maintStatusPill');
  const btn = document.getElementById('maintToggleBtn');
  const inp = document.getElementById('maintMsgInput');
  const active = !!(_maintState && _maintState.active);
  if (pill){
    pill.textContent = active ? 'Päällä' : 'Pois päältä';
    pill.style.background = active ? '#fee2e2' : '#dcfce7';
    pill.style.color = active ? '#b91c1c' : '#166534';
  }
  if (btn){
    btn.textContent = active ? '■ Lopeta huoltokatko' : '▶ Käynnistä huoltokatko';
    btn.className = 'btn small' + (active ? ' danger' : '');
  }
  if (inp && document.activeElement !== inp){
    inp.value = (_maintState.message && String(_maintState.message).trim()) ? _maintState.message : DEFAULT_MAINT_MSG;
  }
};

onSnapshot(MAINT_DOC, function(snap){
  _maintState = (snap && snap.exists()) ? (snap.data() || { active:false, message:"" }) : { active:false, message:"" };
  applyMaintenance();
  if (window._updateMaintUI) window._updateMaintUI();
}, function(err){ /* huoltokatko-kuuntelija: ohitetaan virheet */ });


// ============================
// YLEISVIESTI (broadcast)
// ============================
async function checkPendingBroadcast() {
  try {
    const snap = await getDoc(BROADCAST_DOC);
    if (!snap.exists()) return;
    const bc = snap.data();
    if (!bc.active || !bc.text) return;
    const seen = bc.seenBy || [];
    if (seen.includes(currentUser)) return;
    // Merkitään nähdyksi
    seen.push(currentUser);
    await setDoc(BROADCAST_DOC, { ...bc, seenBy: seen });
    setTimeout(() => showBroadcastOverlay(bc.text), 900);
  } catch(e) {}
}

function showBroadcastOverlay(text) {
  const overlay = document.createElement('div');
  overlay.className = 'alert-overlay';
  overlay.innerHTML = `
    <div class="alert-box" style="border:2px solid #7c3aed">
      <span class="alert-emoji">📢</span>
      <div class="alert-title" style="color:#7c3aed">Viesti Terolta</div>
      <div class="alert-text" style="font-size:16px;line-height:1.6">${text.replace(/</g,'&lt;')}</div>
      <button class="alert-btn" style="background:#7c3aed" onclick="this.closest('.alert-overlay').remove()">Selvä! 👍</button>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  spawnConfetti();
}

// Tarkista yksityisviestit pelaajalle (adminilta)
async function checkPendingDM() {
  if (!currentUser || currentUser === ADMIN) return;
  try {
    const dmDoc = doc(db, 'app', 'dm_' + currentUser);
    const snap = await getDoc(dmDoc);
    if (!snap.exists()) return;
    const dms = snap.data().messages || [];
    const lastSeen = parseInt(localStorage.getItem('tv_player_msg_last') || '0');
    const newMsgs = dms.filter(m => new Date(m.ts).getTime() > lastSeen);
    if (!newMsgs.length) return;
    // Näytä popup uusista viesteistä (ei merkitä heti luetuksi — badge päivittyy checkPlayerUnread kautta)
    newMsgs.forEach((m, i) => {
      setTimeout(() => {
        const overlay = document.createElement('div');
        overlay.className = 'alert-overlay';
        overlay.innerHTML = `
          <div class="alert-box" style="border:2px solid #0ea5e9">
            <span class="alert-emoji">👑</span>
            <div class="alert-title" style="color:#0ea5e9;font-size:18px">Yksityisviesti Terolta</div>
            <div class="alert-text" style="font-size:15px;line-height:1.6">${m.text.replace(/</g,'&lt;')}</div>
            <button class="alert-btn" style="background:#0ea5e9" onclick="this.closest('.alert-overlay').remove()">Selvä! 👍</button>
          </div>`;
        overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
        document.body.appendChild(overlay);
      }, 1000 + i * 500);
    });
    // Päivitä badge
    checkPlayerUnread();
  } catch(e) {}
}

const ALERT_TYPES = {
  petkuhuiputus: { emoji:'🕵️', title:'PETKUHUIPUTUS!', text:'Petkuhuiputusyritys on havaittu. Häpeä tekijälle! Rehti veikkaaminen on ainoa tie voittoon.' },
  lahjonta:      { emoji:'💸', title:'LAHJONTAYRITYS PALJASTUNUT!', text:'Joku on yrittänyt ostaa pisteitä. Pisteet eivät ole myytävänä — ei nyt, ei koskaan!' },
  huijari:       { emoji:'🚨', title:'HUIJARI PALJASTUNUT!', text:'Huijausyritys on havaittu ja kirjattu ylös. Admin on valppaana!' },
  varoitus:      { emoji:'⚠️', title:'VIRALLINEN VAROITUS', text:'Virallinen varoitus on annettu. Käytös korjattava välittömästi!' },
  haukku:        { emoji:'😤', title:'SOPIMATON KÄYTÖS', text:'Sopimatonta käytöstä on havaittu. Muistakaa — tämä on hauska veikkauspeli. Käyttäydytään sen mukaisesti!' },
};

// Näytetään alert jos sellainen on merkitty seenby:lle
async function checkPendingAlert() {
  try {
    const snap = await getDoc(ALERTS_DOC);
    if (!snap.exists()) return;
    const alert = snap.data();
    if (!alert.active) return;
    const seen = alert.seenBy || [];
    if (seen.includes(currentUser)) return;
    // Merkitään nähdyksi
    seen.push(currentUser);
    await setDoc(ALERTS_DOC, { ...alert, seenBy: seen });
    // Pieni viive jotta sivu ehtii renderöityä
    setTimeout(() => showAlertOverlay(alert.type), 800);
  } catch(e) {}
}

function showAlertOverlay(type) {
  const a = ALERT_TYPES[type]; if (!a) return;
  const overlay = document.createElement('div');
  overlay.className = 'alert-overlay';
  overlay.innerHTML = `
    <div class="alert-box">
      <span class="alert-emoji">${a.emoji}</span>
      <div class="alert-title">${a.title}</div>
      <div class="alert-text">${a.text}</div>
      <button class="alert-btn" onclick="this.closest('.alert-overlay').remove()">Selvä! 👍</button>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  spawnConfetti();
}

window._sendAlert = async function(type) {
  const a = ALERT_TYPES[type]; if (!a) return;
  if (!confirm(`Lähetetäänkö "${a.title}" -ilmoitus kaikille?`)) return;
  try {
    await setDoc(ALERTS_DOC, { type, active: true, seenBy: [ADMIN], ts: new Date().toISOString() });
    showStatus('✅ Ilmoitus lähetetty!', '#22c55e'); hideStatus();
  } catch(e) { showStatus('❌ Lähetys epäonnistui', '#dc2626'); }
};

function renderMessageCard() {
  const isAdmin = currentUser === ADMIN;
  const pa = document.getElementById('msgPlayerArea');
  const aa = document.getElementById('msgAdminArea');
  if (pa) pa.style.display = isAdmin ? 'none' : 'block';
  if (aa) aa.style.display = isAdmin ? 'block' : 'none';
  // Admin: badge päivitys taustalla
  if (isAdmin) checkUnreadMessages();
  checkPendingAlert();
  checkPendingBroadcast();
  if (!isAdmin) checkPendingDM();
}

window._sendMsg = async function() {
  const input = document.getElementById('msgInput');
  const status = document.getElementById('msgSendStatus');
  const text = (input.value || '').trim();
  if (!text) { status.textContent = 'Kirjoita viesti ensin.'; return; }
  if (text.length > 500) { status.textContent = 'Max 500 merkkiä.'; return; }
  const btn = document.querySelector('#msgPlayerArea button');
  btn.disabled = true; status.textContent = '💾 Lähetetään…';
  try {
    const snap = await getDoc(MESSAGES_DOC);
    const msgs = snap.exists() ? (snap.data().messages || []) : [];
    msgs.push({ from: currentUser, text, ts: new Date().toISOString() });
    await setDoc(MESSAGES_DOC, { messages: msgs });
    input.value = '';
    status.textContent = '✅ Viesti lähetetty Terolle!';
    setTimeout(() => { status.textContent = ''; }, 3000);
  } catch(e) { status.textContent = '❌ Lähetys epäonnistui.'; }
  btn.disabled = false;
};

// ============================
// PELLE-KORTTI 🤡
// ============================
window._openPelleCard = function() {
  const card = document.getElementById('pelleCard');
  const btn  = document.getElementById('pelleBtn');
  if (!card) return;
  // Näytä kortti ja varmista nappi näkyvillä
  btn.style.display = 'block';
  card.style.display = 'block';
  // Scroll korttiin
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Käynnistä ääni
  const audio = document.getElementById('pelleAudio');
  if (audio) { audio.currentTime = 0; audio.play().catch(()=>{}); }
};

window._pressPelle = async function() {
  const btn = document.getElementById('pelleBtn');
  const card = document.getElementById('pelleCard');

  // Efektit
  btn.style.animation = 'pelleShake 0.5s ease';
  setTimeout(() => { btn.style.animation = ''; }, 500);
  spawnConfetti();

  // Iso pelle-overlay
  const overlay = document.createElement('div');
  overlay.className = 'alert-overlay';
  overlay.innerHTML = `
    <div class="alert-box" style="border:3px solid var(--primary)">
      <span class="alert-emoji">🤡</span>
      <div class="alert-title" style="color:var(--primary)">TIMO ON PELLE!</div>
      <div class="alert-text">Tämä on nyt virallisesti vahvistettu. <br>Todisteet arkistoitu. 📁</div>
      <button class="alert-btn" onclick="this.closest('.alert-overlay').remove()">Selvä asia! 👍</button>
    </div>`;
  document.body.appendChild(overlay);

  // Pysäytä ääni
  const pelleAudio = document.getElementById('pelleAudio');
  if (pelleAudio) { pelleAudio.pause(); pelleAudio.currentTime = 0; }
  // Piilota koko kortti heti
  card.style.display = 'none';

  // Tallenna painallus Firebaseen
  try {
    const snap = await getDoc(PELLE_DOC);
    const d = snap.exists() ? snap.data() : {};
    const counts = d.counts || {};
    counts[currentUser] = (counts[currentUser] || 0) + 1;
    const total = (d.total || 0) + 1;
    const lastPressed = { player: currentUser, ts: new Date().toISOString() };
    await setDoc(PELLE_DOC, { counts, total, lastPressed });
  } catch(e) {}
};

// Admin: näytä pelle-tilastot käyttökerrat-osiossa
async function renderPelleStats(container) {
  try {
    const snap = await getDoc(PELLE_DOC);
    if (!snap.exists()) { container.innerHTML += '<p class="muted" style="font-size:12px;margin-top:8px">Ei pelle-painalluksia vielä.</p>'; return; }
    const d = snap.data();
    const counts = d.counts || {};
    const total = d.total || 0;
    const last = d.lastPressed;
    const lastStr = last ? `${last.player} — ${new Date(last.ts).toLocaleString('fi-FI',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})}` : '–';
    let html = `<div class="separator" style="margin:10px 0"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-weight:700;font-size:13px">🤡 TIMO ON PELLE -tilasto</div>
        <button class="btn small danger" onclick="window._resetPelleStats()">Nollaa</button>
      </div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:8px">Yhteensä: <strong style="color:var(--primary);font-size:16px">${total}</strong> painallusta — Viimeksi: ${lastStr}</div>
      <div style="display:grid;gap:4px">`;
    PLAYERS.forEach(p => {
      const c = counts[p] || 0;
      html += `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span>${p}</span><strong style="color:var(--primary)">${c} kertaa</strong></div>`;
    });
    html += '</div>';
    container.innerHTML += html;
  } catch(e) {}
}

window._resetPelleStats = async function() {
  if (!confirm('Nollataan TIMO ON PELLE -tilastot?')) return;
  try {
    await setDoc(PELLE_DOC, { counts: {}, total: 0, lastPressed: null });
    showStatus('✅ Pelle-tilastot nollattu', '#22c55e'); hideStatus();
    window._renderLoginStats();
    window._renderLoginStats2(); // päivitä myös modaali
  } catch(e) { showStatus('❌ Nollaus epäonnistui', '#dc2626'); }
};

// ============================
// 1. LATAUSPALKKI
// ============================
function loaderStart() {
  const b = document.getElementById('loader-bar');
  if (!b) return;
  b.style.width = '0%';
  b.style.opacity = '1';
  // Simuloi etenemistä
  let w = 0;
  const iv = setInterval(() => {
    w += Math.random() * 15;
    if (w > 85) { clearInterval(iv); w = 85; }
    b.style.width = w + '%';
  }, 200);
  b._iv = iv;
}
function loaderDone() {
  const b = document.getElementById('loader-bar');
  if (!b) return;
  if (b._iv) clearInterval(b._iv);
  b.style.width = '100%';
  setTimeout(() => { b.style.opacity = '0'; setTimeout(() => { b.style.width = '0%'; }, 400); }, 300);
}

// ============================
// 2. ELÄVÄ JÄÄTAUSTA
// ============================
function initIceCanvas() {
  const canvas = document.getElementById('ice-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, flakes;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeFlake() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 2.5 + 0.5,
      dx: (Math.random() - 0.5) * 0.3,
      dy: Math.random() * 0.4 + 0.1,
      o: Math.random() * 0.6 + 0.2
    };
  }

  resize();
  window.addEventListener('resize', resize);
  // Lumisateen asetukset (window._snowCfg). Oletukset vastaavat aiempaa ulkoasua.
  const snowCfg = () => Object.assign({ on:true, count:60, speed:1, size:1, opacity:0.18 }, window._snowCfg || {});
  let lastCount = 0;
  function ensureFlakes(n) {
    if (lastCount === n && flakes) return;
    lastCount = n;
    if (!flakes) flakes = [];
    while (flakes.length < n) flakes.push(makeFlake());
    if (flakes.length > n) flakes.length = n;
  }
  flakes = Array.from({ length: 60 }, makeFlake);
  window._snowRefresh = function(){ lastCount = -1; };

  function draw() {
    const c = snowCfg();
    canvas.style.opacity = c.on ? String(c.opacity) : '0';
    if (!c.on) { ctx.clearRect(0, 0, W, H); requestAnimationFrame(draw); return; }
    ensureFlakes(Math.max(0, Math.min(400, Math.round(c.count))));
    ctx.clearRect(0, 0, W, H);
    flakes.forEach(f => {
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * c.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(148,210,255,${f.o})`;
      ctx.fill();
      f.x += f.dx * c.speed; f.y += f.dy * c.speed;
      if (f.y > H) { f.y = -5; f.x = Math.random() * W; }
      if (f.x < 0 || f.x > W) f.dx *= -1;
    });
    requestAnimationFrame(draw);
  }
  draw();
}
initIceCanvas();

// ============================
// 3. YÖMOODI-BANNERI
// ============================
function checkNightMode() {
  const h = new Date().getHours();
  const banner = document.getElementById('night-banner');
  if (!banner) return;
  if (h >= 0 && h < 5) {
    banner.style.display = 'block';
    setTimeout(() => { banner.style.display = 'none'; }, 6000);
  }
}

// ============================
// 6. MOTIVAATIOVIESTI HÄVIÄJÄLLE
// ============================
const LOSER_MSGS = [
  { emoji:'💪', text:'Tänään pohja, huomenna huippu. Älä anna periksi!' },
  { emoji:'🎯', text:'Häviäminen on vain voittamista harjoittelua. Ensi kerralla paremmin!' },
  { emoji:'🧊', text:'Jääkiekossa pudotuspelit ovat vasta alku. Sinulle tulee uusi mahdollisuus!' },
  { emoji:'😅', text:'No nyt meni pieleen... mutta ainakin olet rehellinen veikkaaja!' },
  { emoji:'🏒', text:'Parhaat pelaajat häviävät ennen kuin voittavat. Jatka veikkaamista!' },
  { emoji:'🔥', text:'Viimeinen sija on vain väliaikainen asema. Nouse takaisin!' },
  { emoji:'🚀', text:'Pohjalta on vain yksi suunta: ylöspäin!' },
  { emoji:'🏆', text:'Jokainen mestari on joskus ollut viimeisenä. Sinun vuorosi tulee!' },
  { emoji:'💎', text:'Timantti syntyy paineen alla. Purista vielä!' },
  { emoji:'⛸️', text:'Vauhtia ei mitata sijoituksella vaan sydämellä. Jatka luistelua!' },
  { emoji:'🌟', text:'Tänään tähti himmenee, huomenna se loistaa kirkkaimmin.' },
  { emoji:'🔄', text:'Yksi huono kierros ei ratkaise koko turnausta. Käännä peli!' },
  { emoji:'💥', text:'Suurimmat paluut alkavat aina takamatkalta.' },
  { emoji:'🧱', text:'Rakennetaan voitto tiili kerrallaan — sinä olet vasta perustuksissa.' },
  { emoji:'🎢', text:'Veikkaaminen on vuoristorata. Nyt mennään alas, kohta noustaan!' },
  { emoji:'🦾', text:'Sisu ei lopu kesken. Tästä noustaan!' },
  { emoji:'🥅', text:'Maali syntyy vasta monen yrityksen jälkeen. Älä lopeta laukomista!' },
  { emoji:'🐺', text:'Susi ei luovuta saaliista. Älä sinäkään luovuta pisteistä!' },
  { emoji:'☀️', text:'Pimeimmän hetken jälkeen tulee aina aamu.' },
  { emoji:'🎯', text:'Tähtää korkealle — jopa viimeiseltä sijalta voi osua napakymppiin.' },
  { emoji:'🔋', text:'Lataa akut, peli on vasta puolivälissä!' },
  { emoji:'🧗', text:'Huipulle ei mennä hissillä. Kiipeä, niin pääset perille.' },
  { emoji:'🌱', text:'Pienestä siemenestä kasvaa mahtava puu. Anna sille aikaa.' },
  { emoji:'🏒', text:'Kiekko pomppii välillä väärin — niin käy parhaillekin pelaajille.' },
  { emoji:'🦅', text:'Korkeimmalle lentävät ne, jotka uskaltavat yrittää uudestaan.' },
  { emoji:'💪', text:'Lihakset kasvavat vastuksesta. Tämä tekee sinusta vahvemman veikkaajan.' },
  { emoji:'🎬', text:'Parhaat tarinat alkavat altavastaajasta. Tämä on sinun tarinasi alku.' },
  { emoji:'⏳', text:'Peli ei ole ohi ennen viimeistä vihellystä. Aikaa on vielä!' },
  { emoji:'🧠', text:'Viisas oppii tappiosta enemmän kuin voittaja voitosta.' },
  { emoji:'🔥', text:'Tuhkasta nousee feeniks. Sinun vuorosi nousta!' },
  { emoji:'🎲', text:'Onni vaihtelee, mutta sinnikkyys palkitaan aina lopulta.' },
  { emoji:'🛷', text:'Mäki on jyrkkä, mutta vauhti vie sinut taas ylös.' },
  { emoji:'🏁', text:'Tärkeintä ei ole missä aloitat vaan missä lopetat.' },
  { emoji:'😎', text:'Altavastaajalla on aina vähiten menetettävää ja eniten voitettavaa.' },
  { emoji:'🧊', text:'Jää on liukasta kaikille — pysy pystyssä ja jatka eteenpäin!' },
  { emoji:'🤝', text:'Hyvä häviäjä tänään, kova kilpailija huomenna. Peli jatkuu!' },
];

function checkLoserMessage() {
  if (!currentUser || currentUser === ADMIN) return;
  const t = getTournament();
  if (!t || !(t.matches||[]).length) return;
  // Tarkista onko tuloksia syötetty vähintään yhteen otteluun
  const hasResults = (t.matches||[]).some(m => {
    const ac = (t.actuals||{})[m.id]||{};
    return Object.values(ac).some(v => v && v !== '');
  });
  if (!hasResults) return;
  // Tarkista onko viimeisenä
  const totals = calcTotals(t);
  const sorted = sortedStandings(t);
  if (!sorted.length) return;
  const last = sorted[sorted.length - 1];
  if (last[0] !== currentUser) return;
  // Näytä vain kerran per sessio
  const key = 'tv_loser_shown_' + t.id;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  // Admin voi korvata viestit asetuksista (window._texts.loserMessages)
  const custom = (window._texts && Array.isArray(window._texts.loserMessages)) ? window._texts.loserMessages : null;
  const pool = (custom && custom.length) ? custom : LOSER_MSGS;
  if (window._feat && window._feat('haviajanViestit') === false) return;
  const msg = pool[Math.floor(Math.random() * pool.length)];
  setTimeout(() => showLoserMessage(msg), 1500);
}

function showLoserMessage(msg) {
  const overlay = document.createElement('div');
  overlay.className = 'alert-overlay';
  overlay.innerHTML = `
    <div class="alert-box" style="border:2px solid #6366f1">
      <span class="alert-emoji">${msg.emoji}</span>
      <div class="alert-title" style="color:#6366f1;font-size:18px">Hei ${currentUser}!</div>
      <div class="alert-text">${msg.text}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:16px">Olet tällä hetkellä viimeisenä — mutta peli ei ole vielä ohi! 💪</div>
      <button class="alert-btn" style="background:#6366f1" onclick="this.closest('.alert-overlay').remove()">Mennään! 🚀</button>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

window._toggleLoginStats = function() {
  const area = document.getElementById('loginStatsArea');
  const btn = event.target;
  const isHidden = area.style.display === 'none';
  area.style.display = isHidden ? 'block' : 'none';
  btn.textContent = isHidden ? 'Piilota' : 'Näytä';
  if (isHidden) window._renderLoginStats();
};

window._resetLoginStats = async function() {
  if (!confirm('Nollataan kaikkien käyttökerrat? Tätä ei voi peruuttaa.')) return;
  try {
    await setDoc(LOGINS_DOC, {});
    showStatus('✅ Käyttökerrat nollattu', '#22c55e'); hideStatus();
    window._renderLoginStats();
  } catch(e) {
    showStatus('❌ Nollaus epäonnistui', '#dc2626');
  }
};

window._renderLoginStats = async function() {
  const el = $('loginStatsArea'); if (!el) return;
  el.innerHTML = '<p class="muted" style="font-size:13px">Ladataan…</p>';
  try {
    const snap = await getDoc(LOGINS_DOC);
    if (!snap.exists()) { el.innerHTML = '<p class="muted" style="font-size:13px">Ei dataa vielä.</p>'; return; }
    const loginData = snap.data();
    const rows = PLAYERS.map(p => {
      const d = loginData[p] || { count: 0, lastSeen: null };
      const lastStr = d.lastSeen
        ? new Date(d.lastSeen).toLocaleString('fi-FI', {day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})
        : '–';
      // Aktiivisuusväri
      const daysSince = d.lastSeen ? (Date.now() - new Date(d.lastSeen)) / 86400000 : 999;
      const dot = daysSince < 1 ? '🟢' : daysSince < 3 ? '🟡' : '🔴';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);gap:8px">
        <div>
          <div style="font-weight:700;font-size:14px">${dot} ${p === ADMIN ? '👑 ' : ''}${p}</div>
          <div style="font-size:11px;color:var(--muted)">Viimeksi: ${lastStr}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:18px;font-weight:900;color:var(--primary)">${d.count || 0}</div>
          <div style="font-size:11px;color:var(--muted)">käyntiä</div>
        </div>
      </div>`;
    }).join('');
    el.innerHTML = rows + `<div style="margin-top:8px;font-size:11px;color:var(--muted)">🟢 alle 24h • 🟡 alle 3 vrk • 🔴 yli 3 vrk</div>`;
    // Lisää pelle-tilastot alle
    await renderPelleStats(el);
  } catch(e) {
    el.innerHTML = '<p class="muted" style="font-size:13px">Virhe ladattaessa.</p>';
  }
}

async function loadData(){
  loaderStart();
  showStatus('⏳ Ladataan…','#6366f1');
  try{
    // Ladataan rakenne + pinit + kaikkien pelaajien omat veikkaukset rinnakkain
    const predPromises = PLAYERS.map(p => getDoc(predDoc(p)));
    const [rakenne, pinSnap, ...predSnaps] = await Promise.all([
      lueRakenne(),
      getDoc(PINS_DOC),
      ...predPromises
    ]);
    if(rakenne){ data=rakenne; }
    if(pinSnap.exists()){ pins=pinSnap.data().pins||{}; }
    if(!data.tournaments) data.tournaments=[];
    // Yhdistetään pelaajien veikkaukset muistirakenteeseen
    predSnaps.forEach((predSnap, i)=>{
      const player=PLAYERS[i];
      if(!predSnap.exists()) return; // Ei vielä veikkausdokumenttia – OK
      try{
        const pd=JSON.parse(predSnap.data().json||'{}');
        const matchPreds=pd.matches||{};
        const topThree=pd.topThree||{};
        data.tournaments.forEach(t=>{
          // Otteluveikkaukset
          if(matchPreds[t.id]){
            t.predictions=t.predictions||{};
            Object.entries(matchPreds[t.id]).forEach(([matchId,fields])=>{
              t.predictions[matchId]=t.predictions[matchId]||{};
              t.predictions[matchId][player]=fields;
            });
          }
          // Kolmen kärki
          if(topThree[t.id]){
            t.topThreePrediction=t.topThreePrediction||{};
            t.topThreePrediction[player]=topThree[t.id];
          }
        });
      }catch(e2){}
    });
  }catch(e){
    const bkp=localStorage.getItem('tv_bkp');
    if(bkp) try{ data=JSON.parse(bkp); }catch(e2){}
    showStatus('⚠️ Yhteysvirhe – paikallinen data','#f59e0b');
  }
  if(!data.tournaments) data.tournaments=[];
  // Palauta valinnat datasta tai localStoragesta
  if(!tid) tid = data.selectedTournamentId||null;
  if(!mid) mid = data.selectedMatchId||null;
  restoreSelections();
  loaderDone();
  hideStatus();
  render();

  // Kuuntele rakennemuutoksia (turnaukset, ottelut, actuals)
  // Rakenteen käsittely on eriytetty, jotta sama logiikka toimii sekä vanhalla
  // (app/data) että uudella (tournaments/*) tallennusrakenteella.
  window._kasitteleRakenne = function(newData){
    const ae = document.activeElement;
    const userEditing = ae && (ae.tagName==='INPUT' || ae.tagName==='SELECT' || ae.tagName==='TEXTAREA');
    if(userEditing){
      if(newData && newData.tournaments) window._pendingSnapshotData=newData;
      return;
    }
    try{
      const prevTid=tid, prevMid=mid;
      if(!newData.tournaments) newData.tournaments=[];
      // Säilytetään muistissa olevat veikkaukset – ne tulevat predDoc-kuuntelijoilta
      newData.tournaments.forEach(t=>{
        const existing=(data.tournaments||[]).find(et=>String(et.id)===String(t.id));
        if(existing){
          t.predictions=existing.predictions||{};
          t.topThreePrediction=existing.topThreePrediction||{};
          t._predSavedAt=existing._predSavedAt||{};
        }
      });
      data=newData;
      if(!data.tournaments) data.tournaments=[];
      const tOk = prevTid && data.tournaments.find(t=>String(t.id)===String(prevTid));
      if(tOk){
        tid=prevTid;
        const tObj=data.tournaments.find(t=>String(t.id)===String(prevTid));
        const mOk = prevMid && (tObj.matches||[]).find(m=>String(m.id)===String(prevMid));
        mid = mOk ? prevMid : null;
      } else {
        tid=data.selectedTournamentId||null;
        mid=data.selectedMatchId||null;
      }
      render();
    }catch(e){}
  };

  onSnapshot(DATA_DOC, snap => {
    if(!snap.exists() || isSavingStructure) return;
    if(window._rakenneV2) return;   // uudessa rakenteessa vanhaa dokumenttia ei kuunnella
    try{ window._kasitteleRakenne(JSON.parse(snap.data().json)); }catch(e){}
  });
  seuraaRakennettaV2();

  // Kuuntele jokaisen pelaajan veikkauksia erikseen – race condition poistuu
  PLAYERS.forEach(player=>{
    onSnapshot(predDoc(player), snap=>{
      if(!snap.exists()) return;
      // Ei ylikirjoiteta omia veikkauksia kesken tallennuksen
      if(isSavingPred && player===currentUser) return;
      try{
        const pd=JSON.parse(snap.data().json||'{}');
        const matchPreds=pd.matches||{};
        const topThree=pd.topThree||{};
        (data.tournaments||[]).forEach(t=>{
          if(matchPreds[t.id]){
            t.predictions=t.predictions||{};
            Object.entries(matchPreds[t.id]).forEach(([matchId,fields])=>{
              t.predictions[matchId]=t.predictions[matchId]||{};
              t.predictions[matchId][player]=fields;
            });
          }
          if(topThree[t.id]){
            t.topThreePrediction=t.topThreePrediction||{};
            t.topThreePrediction[player]=topThree[t.id];
          }
          if(pd.savedAt && pd.savedAt[t.id]){
            t._predSavedAt=t._predSavedAt||{};
            t._predSavedAt[player]=t._predSavedAt[player]||{};
            Object.entries(pd.savedAt[t.id]).forEach(([mId,ts])=>{ t._predSavedAt[player][mId]=ts; });
          }
        });
        // Renderöidään vain jos käyttäjä ei ole muokkaamassa kenttää
        const ae=document.activeElement;
        const userEditing=ae&&(ae.tagName==='INPUT'||ae.tagName==='SELECT'||ae.tagName==='TEXTAREA');
        if(!userEditing) render();
      }catch(e){}
    });
  });
}

// ============================
// COUNTDOWN – ei ikuista silmukkaa
// ============================
function stopCountdown(){
  if(cdTimer){ clearInterval(cdTimer); cdTimer=null; }
  cdRunning=false;
  const el=$('countdown'); if(el) el.innerHTML='';
}

function startCountdown(match){
  stopCountdown();
  if(!match || !match.startTime) return;
  const target = new Date(match.startTime).getTime();
  if(Date.now() >= target) return;

  cdRunning=true;
  const el=$('countdown');
  let prevS=-1;

  const tick = () => {
    const diff = target - Date.now();
    if(diff <= 0){
      stopCountdown();
      renderMatchBanner(match);
      renderPredictions();
      return;
    }
    const totalS=Math.floor(diff/1000);
    const d=Math.floor(totalS/86400);
    const h=Math.floor((totalS%86400)/3600);
    const m=Math.floor((totalS%3600)/60);
    const s=totalS%60;

    // Animate seconds digit when it changes
    const sChanged = s !== prevS;
    prevS = s;

    const pad = n => String(n).padStart(2,'0');

    if(el){
      el.innerHTML =
        '<div class="countdown-box">'+
          '<div class="countdown-label">⏳ Veikkauksia voi muuttaa vielä</div>'+
          '<div class="countdown-timer">'+
            (d>0 ?
              '<div class="countdown-unit"><div class="countdown-num">'+d+'</div><div class="countdown-unit-label">päivää</div></div>'+
              '<div class="countdown-sep">:</div>'
            : '')+
            (d>0 || h>0 ?
              '<div class="countdown-unit"><div class="countdown-num">'+pad(h)+'</div><div class="countdown-unit-label">tuntia</div></div>'+
              '<div class="countdown-sep">:</div>'
            : '')+
            '<div class="countdown-unit"><div class="countdown-num">'+pad(m)+'</div><div class="countdown-unit-label">min</div></div>'+
            '<div class="countdown-sep">:</div>'+
            '<div class="countdown-unit"><div class="countdown-num'+(sChanged?' tick':'')+'">'+pad(s)+'</div><div class="countdown-unit-label">sek</div></div>'+
          '</div>'+
        '</div>';
    }
  };
  tick();
  cdTimer = setInterval(tick, 1000);
}

// ============================
// WIDGET (kenttä)
// ============================
function widget(key, value, dataset, disabled, isAct){
  const ds = isAct ? `data-act="${key}"` : `data-pred="${dataset}"`;
  const dis = disabled ? 'disabled' : '';
  if(key==='lopputulos'){
    const p=(value||'').split('-'), h=p[0]?p[0].trim():'', a=p[1]?p[1].trim():'';
    const hAttr = isAct ? 'data-act-home' : `data-pred-home="${dataset}"`;
    const aAttr = isAct ? 'data-act-away' : `data-pred-away="${dataset}"`;
    return `<div class="score-combo"><input type="number" inputmode="numeric" ${hAttr} value="${h}" placeholder="0" ${dis}/><span class="dash">-</span><input type="number" inputmode="numeric" ${aAttr} value="${a}" placeholder="0" ${dis}/></div>`;
  }
  if(key==='ekan_maali_aika'){
    const p=(value||'').split(':'), m=p[0]?p[0].trim():'', s=p[1]?p[1].trim():'';
    const mAttr = isAct ? 'data-act-min' : `data-pred-min="${dataset}"`;
    const sAttr = isAct ? 'data-act-sec' : `data-pred-sec="${dataset}"`;
    return `<div class="time-combo"><input type="number" inputmode="numeric" ${mAttr} value="${m}" placeholder="00" ${dis}/><span class="colon">:</span><input type="number" inputmode="numeric" ${sAttr} value="${s}" placeholder="00" ${dis}/></div>`;
  }
  const makeSelect = opts => `<select ${ds} ${dis}>${opts.map(o=>`<option value="${o}" ${o===value?'selected':''}>${o||'—'}</option>`).join('')}</select>`;
  // Segmenttipainikkeet: piilotettu natiivi <select> säilyttää tallennuslogiikan ennallaan,
  // painikkeet vain ohjaavat sitä (sama tallennettava arvo, eri syöttötapa).
  const makeSeg = opts => {
    const sel = `<select class="seg-native" ${ds} ${dis} tabindex="-1" aria-hidden="true">${opts.map(o=>`<option value="${o}" ${o===value?'selected':''}>${o||'—'}</option>`).join('')}</select>`;
    const btns = opts.filter(o=>o!=='').map(o=>`<button type="button" class="seg-btn${o===value?' active':''}" ${dis} onclick="window._segPick(this,'${o}')">${o}</button>`).join('');
    return `<div class="seg-group${disabled?' disabled':''}">${sel}${btns}</div>`;
  };
  if(key==='ekan_maalintekija') return makeSelect(scorerOptions(getTournament(), value));
  if(key==='voittomaalin_tekija') return makeSelect(scorerOptions(getTournament(), value));
  if(key==='ekan_jahyn_saaja') return makeSelect(penaltyTakerOptions(getTournament(), value));
  if(key==='ekan_jahyn_syy') return makeSelect(['', ...PENALTY_REASONS]);
  if(ONE_X_TWO.has(key)) return makeSeg(['','1','X','2']);
  if(YLI_ALLE.has(key)) return makeSeg(['','Yli','Alle']);
  if(KYLLA_EI.has(key)) return makeSeg(['','Kyllä','Ei']);
  if(NUMBER_K.has(key)) return `<input type="number" inputmode="numeric" ${ds} value="${value||''}" placeholder="0" ${dis}/>`;
  return `<input type="text" ${ds} value="${value||''}" placeholder="…" ${dis}/>`;
}

// ============================
// PRED CARD HTML
// ============================
function predCardHTML(t, match, player, showColors, forceEdit){
  const pred=((t.predictions||{})[match.id]||{})[player]||{};
  const actual=(t.actuals||{})[match.id]||{};
  const locked=isLocked(match);
  const canEdit = forceEdit || (player===currentUser && !locked);
  const pts = calcMatchPts(t, match.id, player) + (calcTimeProximityPts(t, match.id)[player]||0);
  const proxPts = calcTimeProximityPts(t, match.id);
  const rows = FIELDS.map((f,fi)=>{
    const v=pred[f.key]||'', av=actual[f.key]||'';
    let ok;
    if(f.key==='ekan_maali_aika'){
      const _parse = s => { const m=(s||'').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1]*60 + +m[2] : null; };
      const pp=_parse(v), ap=_parse(av);
      const exactMatch = pp!==null && ap!==null && pp===ap;
      const proximityPoint = !!(proxPts[player]);
      ok = showColors && av!=='' && (exactMatch || proximityPoint);
    } else {
      ok = showColors && av!=='' && fieldMatch(f.key,v,av);
    }
    const bad = showColors && av!=='' && v!=='' && !ok;
    const w = widget(f.key, v, player+':'+f.key, !canEdit, false);
    const delay = showColors && (ok||bad) ? `animation-delay:${fi*40}ms` : '';
    return `<div class="kv-row ${ok?'correct':''} ${bad?'incorrect':''}" style="${delay}">`+
           `<div class="kv-label">${f.label}${infoBtn(f.key)}</div>${w}</div>`;
  }).join('');
  return `<div class="person-card"><div class="card-head">`+
         `<div class="person-title">${player===ADMIN?'👑 ':''}${player}</div>`+
         `${showColors?`<div class="pts-badge">${pts} p</div>`:''}</div>`+
         `<div class="kv">${rows}</div></div>`;
}

// ============================
// ATTACH LISTENERS – veikkaukset
// ============================
function attachPredListeners(el, t, matchId, savePlayer){
  const playerToSave = savePlayer || currentUser;
  const handle = e => {
    if(e.target.dataset.predHome!==undefined || e.target.dataset.predAway!==undefined){
      const par=e.target.closest('.score-combo'); if(!par) return;
      const hi=par.querySelector('[data-pred-home]'), ai=par.querySelector('[data-pred-away]');
      if(!hi || hi.dataset.predHome===undefined) return;
      const pl=hi.dataset.predHome.split(':')[0];
      t.predictions[matchId]=t.predictions[matchId]||{};
      t.predictions[matchId][pl]=t.predictions[matchId][pl]||{};
      // Tallennetaan vain kun molemmat taytettyna; jos molemmat tyhjia nollataan;
      // muuten sailytetaan vanha arvo (kayttaja viela kirjoittaa toista kenttaa)
      if(hi.value && ai.value){
        t.predictions[matchId][pl]['lopputulos']=hi.value+'-'+ai.value;
      } else if(!hi.value && !ai.value){
        t.predictions[matchId][pl]['lopputulos']='';
      }
      return;
    }
    if(e.target.dataset.predMin!==undefined || e.target.dataset.predSec!==undefined){
      const par=e.target.closest('.time-combo'); if(!par) return;
      const mi=par.querySelector('[data-pred-min]'), si=par.querySelector('[data-pred-sec]');
      if(!mi || mi.dataset.predMin===undefined) return;
      const pl=mi.dataset.predMin.split(':')[0];
      t.predictions[matchId]=t.predictions[matchId]||{};
      t.predictions[matchId][pl]=t.predictions[matchId][pl]||{};
      // Sama logiikka: tallenna vain kun molemmat taytettyna
      if(mi.value && si.value){
        t.predictions[matchId][pl]['ekan_maali_aika']=mi.value+':'+si.value;
      } else if(!mi.value && !si.value){
        t.predictions[matchId][pl]['ekan_maali_aika']='';
      }
      return;
    }
    const ds=e.target.dataset.pred; if(!ds) return;
    const [pl,key]=ds.split(':');
    t.predictions[matchId]=t.predictions[matchId]||{};
    t.predictions[matchId][pl]=t.predictions[matchId][pl]||{};
    t.predictions[matchId][pl][key]=e.target.value;
  };

  // Blur-kasittelija: tallennetaan vain kun poistutaan koko combo-parista
  // (ei tallenneta heti kun siirrytaan kentasta toiseen saman comboen sisalla)
  const blurHandler = e => {
    setTimeout(function(){
      var nextFocus = document.activeElement;
      var par = e.target.closest('.score-combo, .time-combo');
      if(par && par.contains(nextFocus)) return;
      savePredictions(playerToSave); renderScoreboard();
    }, 0);
  };

  el.querySelectorAll('input[data-pred],input[data-pred-home],input[data-pred-away],input[data-pred-min],input[data-pred-sec]')
    .forEach(function(i){ i.addEventListener('input',handle); i.addEventListener('blur', blurHandler); });
  el.querySelectorAll('select[data-pred]')
    .forEach(function(s){ s.addEventListener('change',function(e){ handle(e); savePredictions(playerToSave); renderScoreboard(); }); });
}

// ============================
// ATTACH LISTENERS – faktat
// ============================
function attachActualListeners(el, t, matchId){
  const handle = e => {
    if(e.target.dataset.actHome!==undefined || e.target.dataset.actAway!==undefined){
      const par=e.target.closest('.score-combo'); if(!par) return;
      const hi=par.querySelector('[data-act-home]'), ai=par.querySelector('[data-act-away]');
      t.actuals[matchId]=t.actuals[matchId]||{};
      // Tallennetaan vain kun molemmat taytettyna; jos molemmat tyhjia nollataan
      if(hi.value && ai.value){
        t.actuals[matchId]['lopputulos']=hi.value+'-'+ai.value;
        renderScoreboard(); saveStructure();
      } else if(!hi.value && !ai.value){
        t.actuals[matchId]['lopputulos']='';
        renderScoreboard(); saveStructure();
      }
      // Jos vain toinen taytettyna, ei tallenneta viela
      return;
    }
    if(e.target.dataset.actMin!==undefined || e.target.dataset.actSec!==undefined){
      const par=e.target.closest('.time-combo'); if(!par) return;
      const mi=par.querySelector('[data-act-min]'), si=par.querySelector('[data-act-sec]');
      t.actuals[matchId]=t.actuals[matchId]||{};
      // Sama logiikka
      if(mi.value && si.value){
        t.actuals[matchId]['ekan_maali_aika']=mi.value+':'+si.value;
        renderScoreboard(); saveStructure();
      } else if(!mi.value && !si.value){
        t.actuals[matchId]['ekan_maali_aika']='';
        renderScoreboard(); saveStructure();
      }
      return;
    }
    const key=e.target.dataset.act; if(!key) return;
    t.actuals[matchId]=t.actuals[matchId]||{};
    t.actuals[matchId][key]=e.target.value;
    renderScoreboard(); saveStructure();
  };
  el.querySelectorAll('input[data-act],input[data-act-home],input[data-act-away],input[data-act-min],input[data-act-sec]')
    .forEach(function(i){ i.addEventListener('input',handle); });
  el.querySelectorAll('select[data-act]')
    .forEach(function(s){ s.addEventListener('change',handle); });
}

// ============================
// RENDER: BANNERI
// ============================
function renderMatchBanner(match){
  const el=$('matchLockBanner'); if(!el) return;
  if(!match){ el.innerHTML=''; return; }
  if(isLocked(match)){
    const isEditing = currentUser===ADMIN && adminEditMatchId===String(match.id);
    const adminBtn = currentUser===ADMIN
      ? (isEditing
          ? `<button class="btn small danger" style="margin-top:8px;width:100%" onclick="window._adminExitEdit()">🔒 Lopeta muokkaus ja lukitse</button>`
          : `<button class="btn small" style="margin-top:8px;width:100%;background:#7c3aed;color:#fff" onclick="window._adminStartEdit('${match.id}')">✏️ Avaa veikkausten muokkaus</button>`)
      : '';
    el.innerHTML=`<div class="lock-banner" style="display:flex;flex-direction:column;gap:4px">🔒 Peli alkanut – veikkaukset lukittu – tulokset näkyvissä${adminBtn}</div>`;
  } else {
    const ts=match.startTime?new Date(match.startTime).toLocaleString('fi-FI',{weekday:'short',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):'';
    el.innerHTML='<div class="open-banner">✅ Veikkaukset auki'+(ts?' – lukittuu '+ts:'')+'</div>';
  }
}

// ============================
// RENDER: VEIKKAUKSET
// ============================
function renderPredictions(){
  const el=$('predictionsArea'); if(!el) return;
  const t=getTournament(), match=getMatch();
  if(!t || !match){ el.innerHTML='<p class="muted">Valitse ottelu.</p>'; return; }

  const locked=isLocked(match);
  t.predictions=t.predictions||{};
  t.actuals=t.actuals||{};

  if(currentUser===ADMIN){
    const isEditing = adminEditMatchId === String(match.id);
    if(!locked){
      el.innerHTML=predCardHTML(t,match,ADMIN,false);
    } else if(isEditing){
      // ── ADMIN MUOKKAUSTILA ──
      const playerBtns = PLAYERS.map(p =>
        `<button onclick="window._adminSelectEditPlayer('${p}')"
          style="padding:8px 12px;font-size:13px;font-weight:700;border-radius:10px;cursor:pointer;border:2px solid ${adminEditPlayer===p?'#22c55e':'var(--border)'};background:${adminEditPlayer===p?'#22c55e':'var(--card)'};color:${adminEditPlayer===p?'#fff':'var(--text)'}">
          ${p===ADMIN?'👑 ':''}${p}
        </button>`
      ).join('');
      const editCard = adminEditPlayer
        ? predCardHTML(t, match, adminEditPlayer, false, true)
        : '<p class="muted" style="font-size:13px;margin-top:4px">Valitse pelaaja jonka veikkaukset haluat muokata.</p>';
      const saveArea = adminEditPlayer ? `
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">
          <button id="adminSavePredBtn" class="btn green" onclick="window._adminSavePred()" style="width:100%">
            💾 Tallenna ${adminEditPlayer}:n veikkaus
          </button>
          <div id="adminSavePredMsg" style="font-size:13px;font-weight:600;text-align:center;min-height:18px"></div>
        </div>` : '';
      el.innerHTML =
        `<div style="background:rgba(124,58,237,0.1);border:2px solid #7c3aed;border-radius:12px;padding:12px;margin-bottom:12px">
          <div style="font-weight:800;color:#7c3aed;font-size:15px;margin-bottom:6px">✏️ Admin-muokkaustila</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:10px">Valitse pelaaja jonka veikkauksia muokkaat:</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${playerBtns}</div>
        </div>
        ${editCard}${saveArea}`;
      if(adminEditPlayer) attachPredListeners(el, t, match.id, adminEditPlayer);
    } else {
      el.innerHTML=PLAYERS.map(p=>predCardHTML(t,match,p,true)).join('');
    }
  } else {
    if(locked){
      // Peli alkoi: näytä kaikkien veikkaukset kortteina
      // Oma kortti ensin, sitten muut
      const others = PLAYERS.filter(p=>p!==currentUser);
      const allPlayers = [currentUser, ...others];
      el.innerHTML =
        '<div class="locked-view-header">🔒 Kaikkien veikkaukset – tulokset näkyvissä</div>'+
        allPlayers.map(p=>{
          const isMe = p===currentUser;
          return '<div class="pred-card-wrapper'+(isMe?' pred-card-me':'')+'">'+
            (isMe ? '<div class="pred-card-you-label">⭐ Sinun veikkauksesi</div>' : '')+
            predCardHTML(t,match,p,true)+
          '</div>';
        }).join('');
    } else {
      // Peli ei alkanut: näytä vain oma kortti
      const best=getPersonalBest(currentUser);
      const bestHTML=best&&best.pts>0?
        '<div class="personal-best">'+
          '<div>'+
            '<div class="personal-best-label">⭐ Oma ennätys</div>'+
            '<div class="personal-best-match">'+best.tournamentName+' – '+best.matchName+'</div>'+
          '</div>'+
          '<div>'+
            '<div class="personal-best-value">'+best.pts+' p</div>'+
          '</div>'+
        '</div>':''
      ;
      // Muokkaushistoria (uusi: pelaajan oma aikaleima; vanha editHistory varalla)
      const hist=(((t._predSavedAt||{})[currentUser]||{})[match.id]) || ((t.editHistory||{})[match.id]||{})[currentUser];
      const histHTML=hist?
        '<div class="edit-history">Viimeksi muokattu: <span>'+
          new Date(hist).toLocaleString('fi-FI',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})+
        '</span></div>':'';
      // Tallenna-nappi kortin alle
      const pr=(t.predictions[match.id]||{})[currentUser]||{};
      const filled=FIELDS.filter(f=>pr[f.key]!=null&&pr[f.key]!=='').length;
      const total=FIELDS.length;
      const allFilled=filled===total;
      const saveBtn=
        '<div class="save-pred-wrap">'+
          '<button class="btn save-pred-btn" id="savePredBtn" onclick="window._savePredManual()">'+
            '💾 Tallenna veikkaus ('+filled+'/'+total+')'+
          '</button>'+
          '<div id="savePredMsg" class="save-pred-msg"></div>'+
        '</div>';
      el.innerHTML=bestHTML+predCardHTML(t,match,currentUser,false)+histHTML+saveBtn;
    }
  }
  attachPredListeners(el,t,match.id);

  // Manuaalinen tallennusnappi
  window._savePredManual = async function(){
    const t2=getTournament(), match2=getMatch();
    if(!t2||!match2) return;
    const pr2=(t2.predictions[match2.id]||{})[currentUser]||{};
    const missing=FIELDS.filter(f=>!pr2[f.key]||pr2[f.key]==='').map(f=>f.label);
    const msgEl=document.getElementById('savePredMsg');
    const btn=document.getElementById('savePredBtn');
    if(btn){ btn.disabled=true; btn.textContent='💾 Tallennetaan…'; }
    try{
      await savePredictions(currentUser);
      // Aikaleima tallennettu pelaajan omaan dokumenttiin (savePredictions) – ei kirjoiteta jaettua rakennetta.
      // Näytetään päivittynyt aika heti pistetaulussa:
      const tNow=getTournament(), mNow=getMatch();
      if(tNow && mNow){ tNow._predSavedAt=tNow._predSavedAt||{}; tNow._predSavedAt[currentUser]=tNow._predSavedAt[currentUser]||{}; tNow._predSavedAt[currentUser][mNow.id]=new Date().toISOString(); }
      renderScoreboard();
      window._showSaveConfirm();
      if(msgEl){
        if(missing.length===0){
          msgEl.textContent='';
        } else {
          msgEl.style.color='#f59e0b';
          msgEl.textContent='⚠️ Vielä täyttämättä: '+missing.join(', ');
          setTimeout(()=>{ if(msgEl) msgEl.textContent=''; },4000);
        }
      }
    }catch(e){
      if(msgEl){ msgEl.style.color='#dc2626'; msgEl.textContent='❌ Tallennus epäonnistui'; }
    }
    if(btn){
      const pr3=(getTournament()&&getMatch())
        ? ((getTournament().predictions[getMatch().id]||{})[currentUser]||{}) : {};
      const f2=FIELDS.filter(f=>pr3[f.key]!=null&&pr3[f.key]!=='').length;
      btn.disabled=false;
      btn.textContent='💾 Tallenna veikkaus ('+f2+'/'+FIELDS.length+')';
    }
  };
}

// ============================
// ADMIN MUOKKAUSTILA – funktiot
// ============================
window._adminStartEdit = function(matchId){
  adminEditMatchId = String(matchId);
  adminEditPlayer  = null;
  renderMatchBanner(getMatch());
  renderPredictions();
};

window._adminExitEdit = function(){
  adminEditMatchId = null;
  adminEditPlayer  = null;
  renderMatchBanner(getMatch());
  renderPredictions();
};

window._adminSelectEditPlayer = function(player){
  adminEditPlayer = player;
  renderPredictions();
};

window._adminSavePred = async function(){
  if(!adminEditPlayer) return;
  const btn = document.getElementById('adminSavePredBtn');
  const msg = document.getElementById('adminSavePredMsg');
  if(btn){ btn.disabled=true; btn.textContent='💾 Tallennetaan…'; }
  try{
    await savePredictions(adminEditPlayer);
    renderScoreboard();
    renderPlayerStatus();
    if(msg){
      const t=getTournament(), match=getMatch();
      const pr=t&&match?((t.predictions[match.id]||{})[adminEditPlayer]||{}):{};
      const filled=FIELDS.filter(f=>pr[f.key]!=null&&pr[f.key]!=='').length;
      msg.style.color='#22c55e';
      msg.textContent=`✅ ${adminEditPlayer}:n veikkaus tallennettu! (${filled}/${FIELDS.length} kenttää täytetty)`;
      setTimeout(()=>{ if(msg) msg.textContent=''; },4000);
    }
  }catch(e){
    if(msg){ msg.style.color='#dc2626'; msg.textContent='❌ Tallennus epäonnistui'; }
  }
  if(btn){ btn.disabled=false; btn.textContent=`💾 Tallenna ${adminEditPlayer}:n veikkaus`; }
};

// ============================
// RENDER: FAKTAT
// ============================
function renderActuals(){
  const el=$('actualsArea'); if(!el) return;
  const t=getTournament(), match=getMatch();
  if(!t || !match){ el.innerHTML='<p class="muted">Valitse ottelu.</p>'; return; }
  t.actuals=t.actuals||{};
  t.actuals[match.id]=t.actuals[match.id]||{};
  const act=t.actuals[match.id];
  const isAdmin=currentUser===ADMIN;
  const rows=FIELDS.map(f=>'<div class="kv-row"><div class="kv-label">'+f.label+infoBtn(f.key)+'</div>'+widget(f.key,act[f.key]||'',f.key,!isAdmin,true)+'</div>').join('');
  el.innerHTML='<div class="person-card actuals-card"><div class="card-head"><div class="person-title">Faktat</div>'+
    '<div class="pill">'+(isAdmin?'Muokattavissa':'Vain luku')+'</div></div><div class="kv">'+rows+'</div></div>';
  if(isAdmin) attachActualListeners(el,t,match.id);
}

// ============================
// RENDER: SCOREBOARD
// ============================

function getLastEditedTime(t, player) {
  // Etsi viimeisin muokkausaika kaikista otteluista
  let latest = null;
  Object.values(t.editHistory || {}).forEach(matchHist => {
    const ts = matchHist[player];
    if (ts && (!latest || new Date(ts) > new Date(latest))) latest = ts;
  });
  // Uusi tapa: pelaajan oma tallennusaika hänen veikkausdokumentistaan (ottelukohtainen)
  const ps = (t._predSavedAt || {})[player] || {};
  Object.values(ps).forEach(ts=>{ if (ts && (!latest || new Date(ts) > new Date(latest))) latest = ts; });
  return latest;
}

// Sijoitusmuutos: verrataan nykyistä järjestystä järjestykseen ILMAN viimeisintä
// tulokset saanutta ottelua. Pisteytystä ei muuteta – käytetään samoja funktioita.
function rankDeltas(t){
  try{
    const withRes=(t.matches||[]).filter(m=>{
      const ac=(t.actuals||{})[m.id]||{};
      return Object.values(ac).some(v=>v&&v!=='');
    });
    if(withRes.length<2) return null;           // ensimmäisen ottelun jälkeen ei vertailukohtaa
    withRes.sort((a,b)=>new Date(a.startTime||0)-new Date(b.startTime||0));
    const viimeisin=withRes[withRes.length-1].id;
    const kopio=Object.assign({},t);
    kopio.actuals=Object.assign({},t.actuals||{});
    delete kopio.actuals[viimeisin];
    const ennen=sortedStandings(kopio).map(e=>e[0]);
    const nyt=sortedStandings(t).map(e=>e[0]);
    const d={};
    nyt.forEach((p,i)=>{ const j=ennen.indexOf(p); d[p]=(j<0)?0:(j-i); });
    return d;
  }catch(e){ return null; }
}

function renderScoreboard(){
  const el=$('scoreboard'); if(!el) return;
  const t=getTournament();
  if(!t){ el.innerHTML='<p class="muted">Valitse turnaus.</p>'; return; }
  const sorted=sortedStandings(t);
  const nuolet=(window._feat && window._feat('sijoitusnuolet')===false) ? null : rankDeltas(t);
  const nuoli=(n)=>{
    if(!nuolet||!(n in nuolet)) return '';
    const d=nuolet[n];
    if(d>0) return `<span class="rank-delta up" title="Nousi ${d} sijaa">▲${d}</span>`;
    if(d<0) return `<span class="rank-delta down" title="Laski ${-d} sijaa">▼${-d}</span>`;
    return '<span class="rank-delta same" title="Sijoitus ennallaan">–</span>';
  };
  const icon=(rank)=>rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'💩';
  const lastIdx=sorted.length-1;
  const topPts=sorted.length?sorted[0][1]:0;
  el.innerHTML='<div class="score-grid">'+sorted.map(([n,pts],i)=>{
    const rank=i+1;
    const lastEdit=getLastEditedTime(t,n);
    const timeStr=lastEdit?new Date(lastEdit).toLocaleString('fi-FI',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):null;
    const isLast=i===lastIdx;
    const isFirst=i===0 && topPts>0;
    const isSecond=i===1 && pts>0;
    const isThird=i===2 && pts>0;
    return `<div class="score-card${isFirst?' score-card-first':''}${isSecond?' score-card-second':''}${isThird?' score-card-third':''}${isLast?' score-card-last':''}" style="cursor:${isLast?'pointer':'default'}" data-player="${n}" onclick="window._scoreCardClick(this,'${n}',${isLast})">
      <div class="name">${icon(rank)} ${n} ${nuoli(n)}</div>
      <div class="pts">${pts} p</div>
      ${timeStr?`<div style="font-size:10px;color:var(--muted);margin-top:3px">⏱ ${timeStr}</div>`:''}
    </div>`;
  }).join('')+'</div>';
  if(t.finished){
    el.innerHTML += '<button class="btn small" style="width:100%;margin-top:10px;background:linear-gradient(135deg,#8b5cf6,#ec4899);box-shadow:0 3px 12px rgba(139,92,246,0.3)" onclick="window._openWrapped()">🎬 Kauden kooste</button>';
  }
}

window._scoreCardClick = function(el, player, isLast) {
  showPlayerProfile(player);
};

// Segmenttipainikkeen klikkaus: asettaa piilo-selectin arvon ja laukaisee saman
// change-eventin kuin natiivi <select>. Toggle: aktiivisen painikkeen uudelleenpainallus
// nollaa arvon takaisin tyhjäksi (''). Tallennuslogiikkaa ei kosketa.
window._segPick = function(btn, val){
  const group = btn.closest('.seg-group');
  if(!group || group.classList.contains('disabled')) return;
  const sel = group.querySelector('select.seg-native');
  if(!sel || sel.disabled) return;
  const willClear = btn.classList.contains('active');
  sel.value = willClear ? '' : val;
  group.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('active', b===btn && !willClear));
  sel.dispatchEvent(new Event('change', { bubbles:true }));
};

// Kenttävihjeen popover: tap näyttää selityksen, tap uudestaan/muualle sulkee.
window._fieldInfo = function(ev, key){
  ev.stopPropagation();
  var txt = (typeof FIELD_INFO!=='undefined') ? FIELD_INFO[key] : null;
  if(!txt) return;
  var pop = document.getElementById('fieldInfoPop');
  if(!pop){ pop=document.createElement('div'); pop.id='fieldInfoPop'; pop.className='field-info-pop'; document.body.appendChild(pop); }
  if(pop.classList.contains('show') && pop.dataset.key===key){ pop.classList.remove('show'); return; }
  pop.textContent = txt; pop.dataset.key = key; pop.classList.add('show');
  var r = ev.currentTarget.getBoundingClientRect();
  pop.style.top = (r.bottom + 8) + 'px';
  var left = r.left + r.width/2 - 130;
  left = Math.max(8, Math.min(left, window.innerWidth - 268));
  pop.style.left = left + 'px';
};
document.addEventListener('click', function(e){
  var pop=document.getElementById('fieldInfoPop');
  if(pop && pop.classList.contains('show') && !e.target.closest('.info-btn')){ pop.classList.remove('show'); }
});

// Kenttävihjeiden näkyvyys (GLOBAALI: admin hallitsee kaikkien laitteita, synkka Firebasen kautta).
// enabled=true → vihjeet näkyvät kaikilla; enabled=false → piilossa kaikilta. Oletus: päällä.
// Ei kosketa pisteytykseen eikä veikkausdataan.
const FIELDINFO_DOC = doc(db, "app", "fieldinfo");
function _syncFieldInfoToggleBtn(){
  var b=document.getElementById('fieldInfoToggleBtn');
  if(b){ b.textContent = document.body.classList.contains('hide-field-info') ? 'Pois' : 'Päällä'; }
}
function _applyFieldInfo(enabled){
  document.body.classList.toggle('hide-field-info', enabled===false);
  _syncFieldInfoToggleBtn();
}
window._toggleFieldInfo = function(){
  if(currentUser !== ADMIN) return;
  var currentlyHidden = document.body.classList.contains('hide-field-info');
  var nextEnabled = currentlyHidden; // nyt piilossa → seuraavaksi päälle
  setDoc(FIELDINFO_DOC, { enabled: nextEnabled, ts: Date.now() })
    .catch(function(e){ alert('Kenttävihjeiden tilan tallennus epäonnistui: ' + (e && e.message || e)); });
  // UI päivittyy onSnapshotista kaikille (myös adminin oma nappi)
};
onSnapshot(FIELDINFO_DOC, function(snap){
  var enabled = true; // oletus: päällä jos dokumenttia ei vielä ole
  if(snap && snap.exists()){ var d=snap.data(); if(d && d.enabled===false) enabled=false; }
  _applyFieldInfo(enabled);
});

// Revontuli-taustan globaali asetus (admin säätää, näkyy kaikille reaaliajassa). Vain visuaalinen.
// ===== Ulkoasu / teema (admin säätää, näkyy kaikille) =====
var THEME_VARS={bg:'--bg',card:'--card',text:'--text',muted:'--muted',border:'--border',primary:'--primary',primaryHover:'--primary-hover'};
var THEME_PRESETS={
  'Yö':{bg:'#0b1020',card:'#111727',text:'#e5e7eb',muted:'#9aa3b2',border:'#243047',primary:'#fb8a3c',primaryHover:'#ec6f17'},
  'MM-sininen':{bg:'#0a1628',card:'#0f2138',text:'#e8f0fc',muted:'#8fa6c4',border:'#1e3a5f',primary:'#3b82f6',primaryHover:'#2563eb'},
  'Vaalea':{bg:'#f4f5f9',card:'#ffffff',text:'#111827',muted:'#6b7280',border:'#e5e7eb',primary:'#f97316',primaryHover:'#ea580c'},
  'Metsä':{bg:'#0a1410',card:'#10241a',text:'#e3f0e8',muted:'#8fb4a0',border:'#1e3a2c',primary:'#22c55e',primaryHover:'#16a34a'},
  'OLED-musta':{bg:'#000000',card:'#0a0d12',text:'#f1f4f8',muted:'#8b93a1',border:'#1c2128',primary:'#fb8a3c',primaryHover:'#ec6f17'}
};
var THEME_DEFAULT=THEME_PRESETS['Yö'];
var _currentTheme=Object.assign({}, THEME_DEFAULT);
function applyTheme(th){
  if(!th||typeof th!=='object') return;
  var r=document.documentElement.style;
  for(var k in THEME_VARS){ if(th[k]) r.setProperty(THEME_VARS[k], th[k]); }
}
function _syncThemeUI(th){
  _currentTheme=Object.assign({}, THEME_DEFAULT, th||{});
  if($('themePrimary')) $('themePrimary').value=_currentTheme.primary;
  if($('themeBg')) $('themeBg').value=_currentTheme.bg;
  if($('themeCard')) $('themeCard').value=_currentTheme.card;
  if($('themeText')) $('themeText').value=_currentTheme.text;
}
function _themeStatus(msg){ var e=$('themeStatus'); if(e) e.textContent=msg||''; }
window._applyThemePreset=function(name){
  var th=THEME_PRESETS[name]; if(!th) return;
  _currentTheme=Object.assign({}, th);
  applyTheme(_currentTheme); _syncThemeUI(_currentTheme); _saveThemeDoc(_currentTheme);
};
window._onThemeInput=function(){
  if($('themePrimary')){ _currentTheme.primary=$('themePrimary').value; _currentTheme.primaryHover=$('themePrimary').value; }
  if($('themeBg')) _currentTheme.bg=$('themeBg').value;
  if($('themeCard')) _currentTheme.card=$('themeCard').value;
  if($('themeText')) _currentTheme.text=$('themeText').value;
  applyTheme(_currentTheme);   // live-esikatselu (tallennus vasta napista)
};
window._saveTheme=function(){ _saveThemeDoc(_currentTheme); };
window._resetTheme=function(){ window._applyThemePreset('Yö'); };
function _saveThemeDoc(th){
  _themeStatus('Tallennetaan…');
  setDoc(THEME_DOC, Object.assign({}, th, {ts:Date.now()}))
    .then(function(){ _themeStatus('Tallennettu ✓ – näkyy kaikille'); })
    .catch(function(e){ _themeStatus('Virhe: '+(e&&e.message||e)); });
}
var THEME_DOC = doc(db, "app", "theme");
onSnapshot(THEME_DOC, function(snap){ if(snap.exists()){ var th=snap.data()||{}; applyTheme(th); _syncThemeUI(th); } });
const AURORA_DOC = doc(db, "app", "aurora");
const AURORA_DEF = { v:0, strength:1.8, amp:2.6, speed:3.2, pal:'klassinen' };
const AURORA_PCT = { strength:'auroraStrengthPct', amp:'auroraAmpPct', speed:'auroraSpeedPct' };
const AURORA_SLD = { strength:'auroraStrength', amp:'auroraAmp', speed:'auroraSpeed' };
function _syncAuroraUI(){
  var c = window._auroraCfg || AURORA_DEF;
  ['strength','amp','speed'].forEach(function(k){
    var pct=Math.round((c[k]||AURORA_DEF[k])*100);
    var sl=document.getElementById(AURORA_SLD[k]); if(sl) sl.value=pct;
    var pe=document.getElementById(AURORA_PCT[k]); if(pe) pe.textContent=pct+'%';
  });
  document.querySelectorAll('.aurora-v-btn').forEach(function(b){ b.classList.toggle('active', parseInt(b.dataset.v,10)===(c.v||0)); });
}
function _applyAurora(cfg){
  window._auroraCfg = { v:cfg.v, strength:cfg.strength, amp:cfg.amp, speed:cfg.speed, pal:cfg.pal||'klassinen' };
  if(window._auroraRedraw) window._auroraRedraw();
  _syncAuroraUI();
}
window._auroraPreview = function(key, val){
  var c = Object.assign({}, AURORA_DEF, window._auroraCfg||{});
  c[key] = val/100; window._auroraCfg = c;
  if(window._auroraRedraw) window._auroraRedraw();
  var pe=document.getElementById(AURORA_PCT[key]); if(pe) pe.textContent=val+'%';
};
window._auroraCommit = function(key, val){
  if(currentUser !== ADMIN) return;
  var c = Object.assign({}, AURORA_DEF, window._auroraCfg||{});
  c[key] = val/100;
  setDoc(AURORA_DOC, { v:c.v, strength:c.strength, amp:c.amp, speed:c.speed, pal:c.pal||'klassinen', ts:Date.now() })
    .catch(function(e){ alert('Revontuli-asetuksen tallennus epäonnistui: ' + (e && e.message || e)); });
};
window._auroraSetVariant = function(v){
  if(currentUser !== ADMIN) return;
  var c = Object.assign({}, AURORA_DEF, window._auroraCfg||{});
  c.v = v;
  setDoc(AURORA_DOC, { v:c.v, strength:c.strength, amp:c.amp, speed:c.speed, pal:c.pal||'klassinen', ts:Date.now() })
    .catch(function(e){ alert('Revontuli-asetuksen tallennus epäonnistui: ' + (e && e.message || e)); });
};
// ═══════════════════════════════════════════════════════════════
//  ASETUSDOKUMENTIT (ominaisuudet, tekstit, ilmoitukset, ulkoasu)
//  Nämä eivät vaikuta pisteytykseen eivätkä veikkausten tallennukseen.
//  js/lisaykset.js piirtää käyttöliittymän ja kutsuu _tallennaAsetus-apuria.
// ═══════════════════════════════════════════════════════════════
window._nykyinenKayttaja = function(){ return currentUser; };
window._onkoAdmin = function(){ return currentUser === ADMIN; };

// Puskuri: lisaykset.js käynnistyy vasta DOMContentLoadedissa, joten
// ensimmäiset snapshotit voivat saapua ennen sitä. Ne säilötään tänne.
window._asetusPuskuri = window._asetusPuskuri || {};
function ilmoitaAsetus(mika, data){
  window._asetusPuskuri[mika] = data;
  if (typeof window._asetuksetPaivittyi === 'function') {
    try { window._asetuksetPaivittyi(mika, data); } catch(e){ console.warn('asetus', mika, e); }
  }
}
window._ilmoitaAsetus = ilmoitaAsetus;

window._tallennaAsetus = function(nimi, data){
  var sallitut = ['features','texts','notifyPrefs','ui'];
  if (sallitut.indexOf(nimi) === -1) return Promise.reject(new Error('Tuntematon asetus: '+nimi));
  if ((nimi === 'features' || nimi === 'texts') && currentUser !== ADMIN) {
    return Promise.reject(new Error('Vain ylläpitäjä voi muuttaa tätä.'));
  }
  if (nimi === 'ui' && currentUser !== ADMIN) {
    return Promise.reject(new Error('Vain ylläpitäjä voi muuttaa tätä.'));
  }
  return setDoc(doc(db, 'app', nimi), Object.assign({}, data, { ts: Date.now() }));
};

window._tallennaAurora = function(c){
  if (currentUser !== ADMIN) return;
  setDoc(AURORA_DOC, { v:c.v, strength:c.strength, amp:c.amp, speed:c.speed, pal:c.pal||'klassinen', ts:Date.now() })
    .catch(function(e){ alert('Revontuli-asetuksen tallennus epäonnistui: ' + (e && e.message || e)); });
};

['features','texts','notifyPrefs','ui'].forEach(function(nimi){
  try {
    onSnapshot(doc(db, 'app', nimi), function(snap){
      var d = snap.exists() ? (snap.data()||{}) : {};
      delete d.ts;
      ilmoitaAsetus(nimi, d);
    });
  } catch(e) { console.warn('asetuskuuntelija', nimi, e); }
});

onSnapshot(AURORA_DOC, function(snap){
  if (window._ilmoitaAsetus) window._ilmoitaAsetus('aurora', snap.exists()?snap.data():{});
  var cfg = Object.assign({}, AURORA_DEF);
  if(snap && snap.exists()){ var d=snap.data()||{};
    if(d.v!=null) cfg.v=d.v; if(d.strength!=null) cfg.strength=d.strength;
    if(d.amp!=null) cfg.amp=d.amp; if(d.speed!=null) cfg.speed=d.speed; }
  _applyAurora(cfg);
});

// ===== PELAAJIEN AVATARIT (globaali; admin vaihtaa, näkyy kaikille). Vain visuaalinen. =====
const AVATAR_DOC = doc(db, "app", "avatars");
const DEFAULT_AVATARS = {'Roosa':'🌸','Timo':'😎','Tero':'👑','Tiina':'💁','Tepa':'🤘','Äiti':'👩','Iskä':'🧓'};
window._avatars = Object.assign({}, DEFAULT_AVATARS);
window._getAvatar = function(player){ return (window._avatars && window._avatars[player]) || DEFAULT_AVATARS[player] || '🏒'; };
function _renderAvatarAdmin(){
  var el=document.getElementById('avatarAdminList'); if(!el) return;
  el.innerHTML = PLAYERS.map(function(pl){
    var a=window._getAvatar(pl);
    return '<div class="avatar-row">'+
      '<span id="avatarPreview_'+pl+'" class="avatar-prev">'+a+'</span>'+
      '<span class="avatar-name">'+(pl===ADMIN?'👑 ':'')+pl+'</span>'+
      '<input id="avatarInput_'+pl+'" class="avatar-inp" value="'+a+'" maxlength="8">'+
      '<button class="btn small secondary" onclick="window._saveAvatar(\''+pl+'\')">Tallenna</button>'+
    '</div>';
  }).join('');
}
function _applyAvatars(av){
  window._avatars = Object.assign({}, DEFAULT_AVATARS, av||{});
  _renderAvatarAdmin();
  try{ if(typeof renderProfileHeader==='function') renderProfileHeader(); }catch(e){}
  try{ if(typeof render==='function') render(); }catch(e){}
}
window._saveAvatar = function(player){
  if(currentUser !== ADMIN) return;
  var inp=document.getElementById('avatarInput_'+player); if(!inp) return;
  var val=(inp.value||'').trim() || DEFAULT_AVATARS[player] || '🏒';
  var next=Object.assign({}, window._avatars); next[player]=val;
  setDoc(AVATAR_DOC, { avatars: next, ts: Date.now() })
    .then(function(){ showStatus('✅ '+player+':n avatar päivitetty','#22c55e'); if(typeof hideStatus==='function') hideStatus(); })
    .catch(function(e){ alert('Avatarin tallennus epäonnistui: '+(e&&e.message||e)); });
};
onSnapshot(AVATAR_DOC, function(snap){
  var av = {};
  if(snap && snap.exists()){ var d=snap.data()||{}; av = d.avatars||{}; }
  _applyAvatars(av);
});

// ============================================================
//  UUSI CHAT-JÄRJESTELMÄ (vaihe 2): ryhmächat + yksityisviestit
//  Keskustelupohjainen malli: conversations/{convId}
//  convId: 'ryhma' = ryhmächat | 'NimiA__NimiB' (aakkosjärj.) = yksityinen
//  Ei kosketa pisteytykseen/veikkauksiin – täysin erillinen data.
// ============================================================
const CHAT_GROUP_ID = 'ryhma';
function _chatConvId(a, b){ return [a, b].sort(function(x,y){ return x.localeCompare(y,'fi'); }).join('__'); }
function _chatRef(convId){ return doc(db, 'conversations', convId); }
function _chatEsc(t){ return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
var _chatUnsub = null;
var _chatCurrent = null;

window._openChat = function(){
  var ov=document.getElementById('chatOverlay'); if(!ov) return;
  ov.style.display='flex';
  _backToChatList();
  if(typeof _updateChatHeads==='function') _updateChatHeads();
};
window._closeChat = function(){
  var ov=document.getElementById('chatOverlay'); if(ov) ov.style.display='none';
  if(_chatUnsub){ _chatUnsub(); _chatUnsub=null; }
  _chatCurrent=null;
  if(typeof _updateChatHeads==='function') _updateChatHeads();
};
window._backToChatList = function(){
  if(_chatUnsub){ _chatUnsub(); _chatUnsub=null; }
  if(window._clearReply) window._clearReply();
  _chatCurrent=null;
  var cv=document.getElementById('chatConvView'); if(cv) cv.style.display='none';
  var lv=document.getElementById('chatListView'); if(lv) lv.style.display='block';
  var bb=document.getElementById('chatBackBtn'); if(bb) bb.style.display='none';
  var tt=document.getElementById('chatTitle'); if(tt) tt.textContent='💬 Viestit';
  _renderChatList();
};
// ===== Vaihe 6A: online-tila (presence) =====
var PRESENCE_DOC = doc(db, "app", "presence");
var _presence = {};
var _presenceUnsub = null;
var _presenceHeartbeat = null;
function _presenceBeat(){
  if(!currentUser) return;
  var o={}; o[currentUser]=Date.now();
  setDoc(PRESENCE_DOC, o, {merge:true}).catch(function(e){});
}
function _startPresence(){
  if(!currentUser) return;
  _presenceBeat();
  if(_presenceHeartbeat) clearInterval(_presenceHeartbeat);
  _presenceHeartbeat=setInterval(_presenceBeat, 60000);
  if(_presenceUnsub) _presenceUnsub();
  _presenceUnsub=onSnapshot(PRESENCE_DOC, function(snap){
    _presence = snap.exists()? (snap.data()||{}) : {};
    if(_chatOverlayOpen() && !_chatCurrent) _renderChatList();
  });
}
function _stopPresence(){
  if(_presenceHeartbeat){ clearInterval(_presenceHeartbeat); _presenceHeartbeat=null; }
  if(_presenceUnsub){ _presenceUnsub(); _presenceUnsub=null; }
  _presence={};
}
function _isOnline(pl){ return (Date.now()-(_presence[pl]||0)) < 90000; }
function _presenceLabel(pl){
  var ls=_presence[pl]||0;
  if(!ls) return 'ei vielä paikalla';
  var diff=Date.now()-ls;
  if(diff<90000) return 'Paikalla';
  var min=Math.floor(diff/60000);
  if(min<60) return 'viimeksi '+min+' min sitten';
  var h=Math.floor(min/60);
  if(h<24) return 'viimeksi '+h+' h sitten';
  var d=Math.floor(h/24);
  if(d<7) return 'viimeksi '+d+' pv sitten';
  try{ return 'viimeksi '+new Date(ls).toLocaleDateString('fi-FI',{day:'numeric',month:'numeric'}); }catch(e){ return 'kauan sitten'; }
}
document.addEventListener('visibilitychange', function(){ if(!document.hidden) _presenceBeat(); });
// ===== Vaihe 6B: viestien 2 viikon vanheneminen =====
var CHAT_MAX_AGE = 14*24*60*60*1000;
var _chatRenderFp = {};   // convId -> viimeisin piirretty sormenjälki (estää turhat re-renderit)
// ===== Push-ilmoitukset (pelaaja sallii, admin/workflow lähettää) =====
var VAPID_PUBLIC = 'BJT9UY4dzKe-gEIUq3xKifDG3Y2QlMoOUJSzM23SdtUawoHtV_LQf5TSheeKuqN0BeBj9Kkz9zrmErgl5mzDoR0';
function _urlB64ToUint8Array(b64){
  var pad='='.repeat((4 - b64.length % 4) % 4);
  var base64=(b64+pad).replace(/-/g,'+').replace(/_/g,'/');
  var raw=atob(base64); var arr=new Uint8Array(raw.length);
  for(var i=0;i<raw.length;i++){ arr[i]=raw.charCodeAt(i); }
  return arr;
}
window._openNotifyPanel=function(){ var ov=document.getElementById('notifyPanel'); if(ov) ov.style.display='flex'; _syncNotifyUI(); _renderNotifyAdmin(); };
window._closeNotifyPanel=function(){ var ov=document.getElementById('notifyPanel'); if(ov) ov.style.display='none'; };
async function _syncNotifyUI(){
  var btn=document.getElementById('notifyToggleBtn'), st=document.getElementById('notifyStatus');
  if(!btn) return;
  var supported=('serviceWorker' in navigator)&&('PushManager' in window)&&('Notification' in window);
  if(!supported){ btn.style.display='none'; if(st) st.textContent='Selaimesi ei valitettavasti tue ilmoituksia.'; return; }
  btn.style.display='';
  var on=false;
  try{ var reg=await navigator.serviceWorker.ready; var sub=await reg.pushManager.getSubscription(); on=!!sub && Notification.permission==='granted'; }catch(e){}
  if(on){ btn.textContent='🔕 Poista ilmoitukset käytöstä'; btn.className='btn small danger'; if(st) st.textContent='Ilmoitukset ovat käytössä tällä laitteella. ✓'; }
  else { btn.textContent='🔔 Salli ilmoitukset'; btn.className='btn small'; if(st) st.textContent='Ilmoitukset eivät ole käytössä tällä laitteella.'; }
}
window._toggleNotify=async function(){
  if(!currentUser){ alert('Kirjaudu ensin sisään.'); return; }
  var reg, sub;
  try{ reg=await navigator.serviceWorker.ready; sub=await reg.pushManager.getSubscription(); }catch(e){}
  if(sub && Notification.permission==='granted'){
    try{ await sub.unsubscribe(); }catch(e){}
    try{ var o={}; o[currentUser]=null; await setDoc(doc(db,'app','pushSubs'), o, {merge:true}); }catch(e){}
    _syncNotifyUI(); return;
  }
  try{
    var perm=await Notification.requestPermission();
    if(perm!=='granted'){ alert('Ilmoituslupa ei ole myönnetty. Voit sallia ilmoitukset selaimen asetuksista.'); _syncNotifyUI(); return; }
    reg=await navigator.serviceWorker.ready;
    sub=await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:_urlB64ToUint8Array(VAPID_PUBLIC) });
    var o2={}; o2[currentUser]=sub.toJSON(); await setDoc(doc(db,'app','pushSubs'), o2, {merge:true});
    _syncNotifyUI();
  }catch(e){ alert('Ilmoitusten käyttöönotto epäonnistui: '+(e&&e.message||e)+'\n\niPhonessa sovellus pitää ensin lisätä kotinäytölle.'); _syncNotifyUI(); }
};
// ===== Admin: omien ilmoitusten lähetys / ajastus =====
var _notifRecipients = new Set();
var PUSH_OUTBOX = doc(db,'app','pushOutbox');
function _notifEsc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function _fmtWhen(ts){ try{ return new Intl.DateTimeFormat('fi-FI',{timeZone:'Europe/Helsinki',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(ts)); }catch(e){ return ''; } }
function _renderRecipientChips(){
  var box=document.getElementById('adminNotifRecipients'); if(!box) return;
  box.innerHTML='';
  PLAYERS.forEach(function(pl){
    var b=document.createElement('button'); b.type='button'; b.textContent=pl;
    b.className='notif-chip'+(_notifRecipients.has(pl)?' on':'');
    b.onclick=function(){ if(_notifRecipients.has(pl)) _notifRecipients.delete(pl); else _notifRecipients.add(pl); _renderRecipientChips(); };
    box.appendChild(b);
  });
}
window._toggleAllRecipients=function(){
  if(_notifRecipients.size===PLAYERS.length) _notifRecipients.clear();
  else PLAYERS.forEach(function(pl){ _notifRecipients.add(pl); });
  _renderRecipientChips();
};
window._toggleNotifSchedule=function(){
  var on=document.getElementById('adminNotifSchedule').checked;
  document.getElementById('adminNotifWhen').style.display=on?'block':'none';
};
window._sendAdminNotif=async function(){
  var title=(document.getElementById('adminNotifTitle').value||'').trim();
  var body=(document.getElementById('adminNotifBody').value||'').trim();
  if(!title && !body){ alert('Kirjoita otsikko tai viesti.'); return; }
  if(!_notifRecipients.size){ alert('Valitse vähintään yksi vastaanottaja.'); return; }
  var sendAt=null;
  if(document.getElementById('adminNotifSchedule').checked){
    var w=document.getElementById('adminNotifWhen').value;
    if(!w){ alert('Aseta ajastusaika.'); return; }
    sendAt=new Date(w).getTime();
    if(isNaN(sendAt) || sendAt < Date.now()-60000){ alert('Ajastusaika on menneisyydessä.'); return; }
  }
  var item={ id:Date.now().toString(), title:title||'KULJU CUP', body:body, recipients:Array.from(_notifRecipients), sendAt:sendAt, sent:false, created:Date.now(), by:currentUser };
  try{
    var snap=await getDoc(PUSH_OUTBOX);
    var items=(snap.exists()&&snap.data().items)||[];
    items.push(item);
    await setDoc(PUSH_OUTBOX,{items:items});
    document.getElementById('adminNotifTitle').value='';
    document.getElementById('adminNotifBody').value='';
    document.getElementById('adminNotifSchedule').checked=false;
    document.getElementById('adminNotifWhen').value=''; document.getElementById('adminNotifWhen').style.display='none';
    _notifRecipients.clear(); _renderRecipientChips();
    alert(sendAt ? ('Ilmoitus ajastettu ('+_fmtWhen(sendAt)+').') : 'Ilmoitus lähetetään muutaman minuutin sisällä.');
    _renderNotifQueue();
  }catch(e){ alert('Tallennus epäonnistui: '+(e&&e.message||e)); }
};
window._cancelOutbox=async function(id){
  try{
    var snap=await getDoc(PUSH_OUTBOX);
    var items=(snap.exists()&&snap.data().items)||[];
    items=items.filter(function(it){ return String(it.id)!==String(id); });
    await setDoc(PUSH_OUTBOX,{items:items});
    _renderNotifQueue();
  }catch(e){}
};
async function _renderNotifQueue(){
  var box=document.getElementById('adminNotifQueue'); if(!box) return;
  try{
    var snap=await getDoc(PUSH_OUTBOX);
    var items=(snap.exists()&&snap.data().items)||[];
    items=items.slice().sort(function(a,b){ return (b.created||0)-(a.created||0); }).slice(0,8);
    if(!items.length){ box.innerHTML=''; return; }
    var html='<div style="font-size:12px;color:var(--muted);margin:4px 0 2px">Viimeisimmät ilmoitukset:</div>';
    items.forEach(function(it){
      var status= it.sent ? '\u2713 lähetetty' : (it.sendAt? '\u23f0 ajastettu '+_fmtWhen(it.sendAt) : '\u23f3 lähtee pian');
      var who= (it.recipients&&it.recipients.length===PLAYERS.length) ? 'kaikille' : (it.recipients||[]).join(', ');
      html+='<div class="notif-queue-item"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">'+_notifEsc(it.title||'')+'</div><div style="font-size:11px;color:var(--muted)">'+status+' \u00b7 '+_notifEsc(who)+'</div></div>';
      if(!it.sent){ html+='<button class="btn small danger" style="flex:0 0 auto" onclick="window._cancelOutbox(\''+it.id+'\')">Peru</button>'; }
      html+='</div>';
    });
    box.innerHTML=html;
  }catch(e){ box.innerHTML=''; }
}
function _renderNotifyAdmin(){
  var sec=document.getElementById('notifyAdminSection'); if(!sec) return;
  if(currentUser===ADMIN){ sec.style.display='block'; _renderRecipientChips(); _renderNotifQueue(); }
  else sec.style.display='none';
}
async function _pruneOldMessages(convId, msgs){
  if(!msgs || !msgs.length) return;
  var cut=Date.now()-CHAT_MAX_AGE;
  if(!msgs.some(function(m){ return (m.ts||0)<cut; })) return;
  var kept=msgs.filter(function(m){ return (m.ts||0)>=cut; });
  try{ await setDoc(_chatRef(convId), { messages:kept, updated:Date.now() }, {merge:true}); }catch(e){}
}
function _renderChatList(){
  var el=document.getElementById('chatListView'); if(!el) return;
  var others = PLAYERS.filter(function(pl){ return pl!==currentUser; });
  function badge(cid){ var n=_chatUnread[cid]||0; return n>0 ? '<span class="chat-unread">'+(n>99?'99+':n)+'</span>' : ''; }
  var html = '<button class="chat-conv-item" onclick="window._openConversation(\''+CHAT_GROUP_ID+'\',\'Ryhmächat\',\'💬\',true)">'+
    '<span class="chat-ava">💬</span><span class="chat-conv-name">Ryhmächat</span><span class="chat-conv-sub">koko porukka</span>'+badge(CHAT_GROUP_ID)+'</button>';
  html += '<div class="chat-list-label">Yksityisviestit</div>';
  html += others.map(function(pl){
    var a=window._getAvatar(pl);
    var cid=_chatConvId(currentUser, pl);
    var online=_isOnline(pl);
    var dot='<span class="presence-dot '+(online?'online':'offline')+'"></span>';
    var sub='<span class="chat-conv-sub'+(online?' online':'')+'">'+_chatEsc(_presenceLabel(pl))+'</span>';
    return '<button class="chat-conv-item" onclick="window._openConversation(\''+cid+'\',\''+pl+'\',\''+a+'\',false)">'+
      '<span class="chat-ava-wrap"><span class="chat-ava">'+a+'</span>'+dot+'</span><span class="chat-conv-name">'+pl+'</span>'+sub+badge(cid)+'</button>';
  }).join('');
  el.innerHTML = html;
}
window._openConversation = function(convId, title, avatar, isGroup){
  _chatCurrent = { convId:convId, title:title, avatar:avatar, isGroup:isGroup };
  _typingLastSent=0; if(window._clearReply) window._clearReply();
  var lv=document.getElementById('chatListView'); if(lv) lv.style.display='none';
  var cv=document.getElementById('chatConvView'); if(cv) cv.style.display='flex';
  var bb=document.getElementById('chatBackBtn'); if(bb) bb.style.display='block';
  var tt=document.getElementById('chatTitle'); if(tt) tt.textContent=(isGroup?'💬 ':avatar+' ')+title;
  var data=_chatData[convId];
  if(convId) _chatRenderFp[convId]=null;
  if(data){ _renderChatMessages(data.messages); _markRead(convId); _pruneOldMessages(convId, data.messages); }
  else { var box=document.getElementById('chatMessages'); if(box) box.innerHTML='<p class="chat-empty">Ladataan…</p>'; }
  setTimeout(function(){ var inp=document.getElementById('chatInput'); if(inp) inp.focus(); }, 120);
};
function _chatDayLabel(ts){
  try{
    var d=new Date(ts), now=new Date();
    var dd=new Date(d.getFullYear(),d.getMonth(),d.getDate());
    var nn=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    var diff=Math.round((nn-dd)/86400000);
    if(diff===0) return 'Tänään';
    if(diff===1) return 'Eilen';
    return d.toLocaleDateString('fi-FI',{weekday:'short',day:'numeric',month:'numeric'});
  }catch(e){ return ''; }
}
function _renderReactions(m){
  if(!m.reactions) return '';
  var parts=[];
  Object.keys(m.reactions).forEach(function(e){
    var arr=m.reactions[e]||[];
    if(arr.length) parts.push('<span class="chat-react'+(arr.indexOf(currentUser)>=0?' me':'')+'" title="'+_chatEsc(arr.join(', '))+'">'+e+' '+arr.length+'</span>');
  });
  return parts.length ? '<div class="chat-reacts">'+parts.join('')+'</div>' : '';
}
function _renderChatMessages(msgs){
  var box=document.getElementById('chatMessages'); if(!box) return;
  var _cut=Date.now()-CHAT_MAX_AGE; msgs=(msgs||[]).filter(function(m){ return (m.ts||0)>=_cut; });
  var isGroup = _chatCurrent && _chatCurrent.isGroup;
  var convId = _chatCurrent && _chatCurrent.convId;
  var reads = (convId && _chatData[convId] && _chatData[convId].reads) || {};
  // Tahmeus-korjaus: piirrä uudelleen vain kun viestit tai MUIDEN lukutilat muuttuivat (oma luku ei laukaise)
  var _otherReads={}; Object.keys(reads).forEach(function(k){ if(k!==currentUser) _otherReads[k]=reads[k]; });
  var _fp = msgs.length+'|'+JSON.stringify(msgs)+'|'+JSON.stringify(_otherReads);
  if(convId && _chatRenderFp[convId]===_fp) return;
  if(convId) _chatRenderFp[convId]=_fp;
  if(!msgs.length){ box.innerHTML='<p class="chat-empty">Ei viestejä vielä. Aloita keskustelu! 👋</p>'; return; }
  var myMsgs = msgs.filter(function(m){ return m.from===currentUser && !m.system; });
  var lastMineTs = myMsgs.length ? (myMsgs[myMsgs.length-1].ts||0) : 0;
  var seenBy = [];
  if(lastMineTs){ Object.keys(reads).forEach(function(pl){ if(pl!==currentUser && (reads[pl]||0)>=lastMineTs) seenBy.push(pl); }); }
  var html=''; var lastDay=null;
  msgs.forEach(function(m){
    var day=_chatDayLabel(m.ts);
    if(day && day!==lastDay){ html+='<div class="chat-day">'+day+'</div>'; lastDay=day; }
    if(m.system){ html+='<div class="chat-sys">'+_chatEsc(m.text)+'</div>'; return; }
    var mine=(m.from===currentUser);
    var av=window._getAvatar(m.from);
    var time=''; try{ time=new Date(m.ts).toLocaleString('fi-FI',{hour:'2-digit',minute:'2-digit'}); }catch(e){}
    var replyHtml='';
    if(m.replyTo){ replyHtml='<div class="chat-reply-quote"><span class="chat-reply-from">'+_chatEsc(m.replyTo.from)+'</span>'+_chatEsc((m.replyTo.text||'').slice(0,80))+'</div>'; }
    var textHtml = m.deleted ? '<div class="chat-text chat-deleted">Viesti poistettu</div>' : '<div class="chat-text">'+_chatEsc(m.text)+'</div>';
    var reactHtml = m.deleted ? '' : _renderReactions(m);
    var tap = m.deleted ? '' : ' onclick="window._openMsgMenu(\''+m.id+'\')"';
    if(mine){
      html+='<div class="chat-msg mine"><div class="chat-bubble mine"'+tap+'>'+replyHtml+textHtml+'<div class="chat-time">'+time+'</div></div>'+reactHtml+'</div>';
    } else {
      html+='<div class="chat-msg"><span class="chat-msg-ava">'+av+'</span><div class="chat-bubble"'+tap+'>'+(isGroup?'<div class="chat-from">'+_chatEsc(m.from)+'</div>':'')+replyHtml+textHtml+'<div class="chat-time">'+time+'</div></div>'+reactHtml+'</div>';
    }
  });
  if(seenBy.length){
    var seenTxt = isGroup ? ('Nähnyt: '+seenBy.join(', ')) : 'Nähty ✓✓';
    html += '<div class="chat-seen">'+_chatEsc(seenTxt)+'</div>';
  }
  var _prevScroll = box.scrollTop;
  var _nearBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 80;
  var _lastMine = msgs.length && msgs[msgs.length-1].from===currentUser;
  box.innerHTML = html;
  if(_nearBottom || _lastMine) box.scrollTop = box.scrollHeight;
  else box.scrollTop = _prevScroll;
}
window._sendChat = async function(){
  var inp=document.getElementById('chatInput'); if(!inp || !_chatCurrent) return;
  var text=(inp.value||'').trim(); if(!text) return;
  inp.value='';
  var msg = { id: Date.now()+'_'+Math.random().toString(36).slice(2,7), from: currentUser, text: text, ts: Date.now() };
  if(_replyTo){ msg.replyTo = _replyTo; }
  window._clearReply();
  try{
    var ref=_chatRef(_chatCurrent.convId);
    var snap=await getDoc(ref);
    var msgs = (snap.exists() ? (snap.data().messages||[]) : []);
    var _cut=Date.now()-CHAT_MAX_AGE; msgs=msgs.filter(function(m){ return (m.ts||0)>=_cut; });
    msgs.push(msg);
    await setDoc(ref, { messages: msgs, updated: Date.now(), typing:_chatMakeObj(currentUser,0) }, { merge:true });
  }catch(e){ alert('Viestin lähetys epäonnistui: '+(e&&e.message||e)); inp.value=text; }
};
// ===== Vaihe 4A: viestivalikko, reaktiot, vastaa, poisto =====
var _msgMenuId=null;
var _replyTo=null;
window._openMsgMenu=function(msgId){
  if(!_chatCurrent) return;
  _msgMenuId=msgId;
  var conv=_chatData[_chatCurrent.convId];
  var m=conv && (conv.messages||[]).filter(function(x){return x.id===msgId;})[0];
  var del=document.getElementById('msgMenuDelete');
  if(del) del.style.display=(m && (m.from===currentUser || currentUser===ADMIN))?'block':'none';
  var ov=document.getElementById('msgMenu'); if(ov) ov.style.display='flex';
};
window._closeMsgMenu=function(ev){
  if(ev && ev.target && ev.target.id!=='msgMenu') return;
  var ov=document.getElementById('msgMenu'); if(ov) ov.style.display='none';
  _msgMenuId=null;
};
async function _chatMutateMsg(convId, msgId, fn){
  try{
    var ref=_chatRef(convId); var snap=await getDoc(ref);
    var msgs=(snap.exists()?(snap.data().messages||[]):[]);
    var m=msgs.filter(function(x){return x.id===msgId;})[0]; if(!m) return;
    fn(m, msgs);
    await setDoc(ref,{messages:msgs,updated:Date.now()},{merge:true});
  }catch(e){}
}
window._reactMsg=function(emoji){
  var id=_msgMenuId, conv=_chatCurrent&&_chatCurrent.convId; window._closeMsgMenu();
  if(!id||!conv) return;
  _chatMutateMsg(conv, id, function(m){
    m.reactions=m.reactions||{};
    var arr=m.reactions[emoji]||[]; var i=arr.indexOf(currentUser);
    if(i>=0) arr.splice(i,1); else arr.push(currentUser);
    if(arr.length) m.reactions[emoji]=arr; else delete m.reactions[emoji];
  });
};
window._deleteMsg=function(){
  var id=_msgMenuId, conv=_chatCurrent&&_chatCurrent.convId; window._closeMsgMenu();
  if(!id||!conv) return;
  _chatMutateMsg(conv, id, function(m){
    if(m.from!==currentUser && currentUser!==ADMIN) return;
    m.deleted=true; m.text=''; m.reactions={}; m.replyTo=null;
  });
};
window._replyMsg=function(){
  var id=_msgMenuId, conv=_chatCurrent&&_chatData[_chatCurrent.convId]; window._closeMsgMenu();
  if(!id||!conv) return;
  var m=(conv.messages||[]).filter(function(x){return x.id===id;})[0]; if(!m||m.deleted) return;
  _replyTo={ from:m.from, text:(m.text||'').slice(0,120) };
  var banner=document.getElementById('chatReplyBanner');
  var txt=document.getElementById('chatReplyText');
  if(txt) txt.textContent='↩️ '+m.from+': '+(m.text||'').slice(0,50);
  if(banner) banner.style.display='flex';
  var inp=document.getElementById('chatInput'); if(inp) inp.focus();
};
window._clearReply=function(){
  _replyTo=null;
  var banner=document.getElementById('chatReplyBanner'); if(banner) banner.style.display='none';
};
// ===== Vaihe 4B: "kirjoittaa…" + järjestelmäviestit =====
var _typingLastSent=0;
window._chatTyping=function(){
  if(!_chatCurrent) return;
  var now=Date.now();
  if(now-_typingLastSent < 3000) return;
  _typingLastSent=now;
  setDoc(_chatRef(_chatCurrent.convId), { typing:_chatMakeObj(currentUser, now) }, {merge:true}).catch(function(e){});
};
function _renderTyping(typing){
  var el=document.getElementById('chatTyping'); if(!el) return;
  typing=typing||{}; var now=Date.now();
  var who=Object.keys(typing).filter(function(pl){ return pl!==currentUser && (now-(typing[pl]||0))<6000; });
  if(who.length){ el.textContent = who.length===1 ? (who[0]+' kirjoittaa…') : (who.join(', ')+' kirjoittavat…'); el.style.display='block'; }
  else { el.style.display='none'; }
}
setInterval(function(){
  if(_chatCurrent && _chatOverlayOpen()){
    var d=_chatData[_chatCurrent.convId];
    if(d) _renderTyping(d.typing);
  }
}, 2500);
window._sendSystemMessage=async function(text){
  try{
    var ref=_chatRef(CHAT_GROUP_ID); var snap=await getDoc(ref);
    var msgs=(snap.exists()?(snap.data().messages||[]):[]);
    msgs.push({ id:Date.now()+'_sys', from:'__system__', text:text, ts:Date.now(), system:true });
    await setDoc(ref,{messages:msgs,updated:Date.now()},{merge:true});
  }catch(e){}
};
function _maybeSysMsg(){
  try{
    var last=parseInt(localStorage.getItem('sysMsgLast')||'0',10), now=Date.now();
    if(now-last < 300000) return;
    localStorage.setItem('sysMsgLast', String(now));
    window._sendSystemMessage('🏒 '+currentUser+' päivitti tuloksia');
  }catch(e){}
}
window._chatInputKey = function(ev){ if(ev && ev.key==='Enter' && !ev.shiftKey){ ev.preventDefault(); window._sendChat(); } };

// ===== VAIHE 3: lukutila, kuplat, lukukuittaukset =====
var _chatGlobalUnsubs = [];
var _chatUnread = {};
var _chatData = {};          // convId -> {messages, reads}
var _chatFirstSnap = {};
function _chatOverlayOpen(){ var ov=document.getElementById('chatOverlay'); return !!(ov && ov.style.display==='flex'); }
function _chatMakeObj(k,v){ var o={}; o[k]=v; return o; }
function _chatAllConvs(){
  var list=[{id:CHAT_GROUP_ID, title:'Ryhmächat', avatar:'💬', isGroup:true}];
  PLAYERS.filter(function(pl){ return pl!==currentUser; }).forEach(function(pl){
    list.push({id:_chatConvId(currentUser,pl), title:pl, avatar:window._getAvatar(pl), isGroup:false});
  });
  return list;
}
// ===== Vaihe 5A: admin-valvonta (kaikki keskustelut, luku) =====
function _chatAdminConvs(){
  // Vain keskustelut joissa admin EI ole osapuoli (ryhmä + omat näkyvät jo normaalissa chatissa)
  var others=PLAYERS.filter(function(p){ return p!==ADMIN; });
  var list=[];
  for(var i=0;i<others.length;i++){
    for(var j=i+1;j<others.length;j++){
      list.push({ id:_chatConvId(others[i],others[j]), title:others[i]+' ↔ '+others[j], a:others[i], b:others[j], isGroup:false });
    }
  }
  return list;
}
function _monitorSeen(){ try{ return JSON.parse(localStorage.getItem('monitorSeen')||'{}'); }catch(e){ return {}; } }
function _saveMonitorSeen(o){ try{ localStorage.setItem('monitorSeen', JSON.stringify(o)); }catch(e){} }
window._openChatMonitor=function(){
  if(currentUser!==ADMIN) return;
  var ov=document.getElementById('chatMonitor'); if(ov) ov.style.display='flex';
  window._backToMonitorList();
};
window._closeChatMonitor=function(){
  var ov=document.getElementById('chatMonitor'); if(ov) ov.style.display='none';
};
var _monitorCurrentConv=null;
window._clearMonitorConv=async function(){
  if(!_monitorCurrentConv) return;
  if(!confirm('Tyhjennetäänkö tämä keskustelu kokonaan? Tätä ei voi perua.')) return;
  try{
    await setDoc(_chatRef(_monitorCurrentConv), { messages:[], updated:Date.now() }, {merge:true});
    var conv=document.getElementById('monitorConv'); if(conv) conv.innerHTML='<p class="chat-empty">Keskustelu tyhjennetty.</p>';
  }catch(e){ alert('Tyhjennys epäonnistui.'); }
};
window._backToMonitorList=function(){
  var c=document.getElementById('monitorConv'); if(c) c.style.display='none';
  var cl=document.getElementById('monitorClear'); if(cl) cl.style.display='none';
  var l=document.getElementById('monitorList'); if(l) l.style.display='block';
  var b=document.getElementById('monitorBack'); if(b) b.style.display='none';
  var t=document.getElementById('monitorTitle'); if(t) t.textContent='📋 Kaikkien viestit';
  _renderMonitorList();
};
async function _renderMonitorList(){
  var box=document.getElementById('monitorList'); if(!box) return;
  box.innerHTML='<p class="chat-empty">Ladataan keskusteluja…</p>';
  var convs=_chatAdminConvs(); var seen=_monitorSeen();
  var rows=await Promise.all(convs.map(function(c){
    return getDoc(_chatRef(c.id)).then(function(snap){
      var msgs=(snap.exists()?(snap.data().messages||[]):[]);
      var last=msgs.length?(msgs[msgs.length-1].ts||0):0;
      var unread=msgs.filter(function(m){ return !m.system && (m.ts||0)>(seen[c.id]||0); }).length;
      return { c:c, last:last, unread:unread };
    }).catch(function(){ return { c:c, last:0, unread:0 }; });
  }));
  rows.sort(function(a,b){ return (b.unread>0?1:0)-(a.unread>0?1:0) || b.last-a.last; });
  box.innerHTML=rows.map(function(r){
    var c=r.c;
    var av=window._getAvatar(c.a)+window._getAvatar(c.b);
    var badge=r.unread>0 ? '<span class="chat-monitor-badge">'+(r.unread>99?'99+':r.unread)+'</span>' : '';
    return '<button class="chat-monitor-item" onclick="window._openMonitorConv(\''+c.id+'\',\''+_chatEsc(c.title)+'\','+(c.isGroup?'true':'false')+')"><span class="chat-monitor-ava">'+av+'</span><span class="chat-monitor-name">'+_chatEsc(c.title)+'</span>'+badge+'<span class="chat-monitor-arrow">›</span></button>';
  }).join('');
}
window._openMonitorConv=async function(convId, title, isGroup){
  _monitorCurrentConv=convId;
  var l=document.getElementById('monitorList'); if(l) l.style.display='none';
  var conv=document.getElementById('monitorConv'); if(!conv) return;
  conv.style.display='block';
  var b=document.getElementById('monitorBack'); if(b) b.style.display='block';
  var cl=document.getElementById('monitorClear'); if(cl) cl.style.display='block';
  var t=document.getElementById('monitorTitle'); if(t) t.textContent=title;
  conv.innerHTML='<p class="chat-empty">Ladataan…</p>';
  try{
    var snap=await getDoc(_chatRef(convId));
    var msgs=(snap.exists()?(snap.data().messages||[]):[]);
    var seen=_monitorSeen();
    var last=msgs.length?(msgs[msgs.length-1].ts||0):0;
    seen[convId]=Math.max(seen[convId]||0, last); _saveMonitorSeen(seen);
    _renderMonitorMessages(conv, msgs, isGroup);
  }catch(e){ conv.innerHTML='<p class="chat-empty">Lataus epäonnistui.</p>'; }
};
function _renderMonitorMessages(box, msgs, isGroup){
  if(!msgs.length){ box.innerHTML='<p class="chat-empty">Ei viestejä tässä keskustelussa.</p>'; return; }
  var html=''; var lastDay=null;
  msgs.forEach(function(m){
    var day=_chatDayLabel(m.ts);
    if(day && day!==lastDay){ html+='<div class="chat-day">'+day+'</div>'; lastDay=day; }
    if(m.system){ html+='<div class="chat-sys">'+_chatEsc(m.text)+'</div>'; return; }
    var av=window._getAvatar(m.from);
    var time=''; try{ time=new Date(m.ts).toLocaleString('fi-FI',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch(e){}
    var replyHtml = m.replyTo ? '<div class="chat-reply-quote"><span class="chat-reply-from">'+_chatEsc(m.replyTo.from)+'</span>'+_chatEsc((m.replyTo.text||'').slice(0,80))+'</div>' : '';
    var textHtml = m.deleted ? '<div class="chat-text chat-deleted">Viesti poistettu</div>' : '<div class="chat-text">'+_chatEsc(m.text)+'</div>';
    var reactHtml = m.deleted ? '' : _renderReactions(m);
    html+='<div class="chat-msg"><span class="chat-msg-ava">'+av+'</span><div class="chat-bubble"><div class="chat-from">'+_chatEsc(m.from)+'</div>'+replyHtml+textHtml+'<div class="chat-time">'+time+'</div></div>'+reactHtml+'</div>';
  });
  box.innerHTML=html;
}
function _updateChatBadge(){
  var total=0; for(var k in _chatUnread){ total+=(_chatUnread[k]||0); }
  var b=document.getElementById('chatUnreadBadge');
  if(b){ if(total>0){ b.textContent=total>99?'99+':String(total); b.style.display='flex'; } else b.style.display='none'; }
  if(typeof _updateChatHeads==='function') _updateChatHeads();
}
function _markRead(convId){
  if(!currentUser) return;
  var data=_chatData[convId]; if(!data) return;
  var msgs=data.messages||[]; if(!msgs.length){ _chatUnread[convId]=0; _updateChatBadge(); return; }
  var latestTs = msgs[msgs.length-1].ts || Date.now();
  var cur = (data.reads||{})[currentUser]||0;
  _chatUnread[convId]=0; _updateChatBadge();
  if(latestTs<=cur) return;
  data.reads = data.reads||{}; data.reads[currentUser]=latestTs;
  setDoc(_chatRef(convId), { reads: _chatMakeObj(currentUser, latestTs) }, { merge:true }).catch(function(e){});
}
// ===== Messenger-tyyliset kelluvat chat headit (useita, per keskustelu) =====
var _chatHeads = {};   // convId -> { el, pos:{x,y}, meta }
function _chatHeadXEl(){ return document.getElementById('chatHeadX'); }
function _chatHeadOverX(cx, cy){
  var x=_chatHeadXEl(); if(!x) return false;
  var r=x.getBoundingClientRect();
  return cx>r.left-40 && cx<r.right+40 && cy>r.top-40;
}
function _chatHeadDefaultPos(){
  var n=Object.keys(_chatHeads).length;
  return { x: window.innerWidth - 60 - 12, y: 96 + n*70 };
}
function _addChatHead(convId, meta){
  if(_chatOverlayOpen() && _chatCurrent && _chatCurrent.convId===convId) return;
  if(!currentUser) return;
  if(_chatHeads[convId]){ _chatHeads[convId].meta=meta; _updateChatHeadBadge(convId); return; }
  var el=document.createElement('div');
  el.className='chat-head';
  el.innerHTML='<span class="chat-head-ava">'+(meta.avatar||'💬')+'</span><span class="chat-head-badge" style="display:none">0</span>';
  document.body.appendChild(el);
  var pos=_chatHeadDefaultPos();
  el.style.left=pos.x+'px'; el.style.top=pos.y+'px'; el.style.right='auto'; el.style.display='flex';
  _chatHeads[convId]={ el:el, pos:pos, meta:meta };
  _makeChatHeadDraggable(el, convId);
  _updateChatHeadBadge(convId);
  try{ if(navigator.vibrate) navigator.vibrate(40); }catch(e){}
}
function _removeChatHead(convId){
  var h=_chatHeads[convId]; if(!h) return;
  if(h.el && h.el.parentNode) h.el.parentNode.removeChild(h.el);
  delete _chatHeads[convId];
}
function _updateChatHeadBadge(convId){
  var h=_chatHeads[convId]; if(!h) return;
  var n=_chatUnread[convId]||0;
  var b=h.el.querySelector('.chat-head-badge');
  if(b){ if(n>0){ b.textContent=n>99?'99+':String(n); b.style.display='flex'; } else b.style.display='none'; }
  var a=h.el.querySelector('.chat-head-ava'); if(a && h.meta) a.textContent=h.meta.avatar||'💬';
}
function _updateChatHeads(){
  var hide=_chatOverlayOpen();
  Object.keys(_chatHeads).forEach(function(convId){
    var h=_chatHeads[convId]; if(!h||!h.el) return;
    h.el.style.display = hide ? 'none' : 'flex';
    _updateChatHeadBadge(convId);
  });
}
function _openChatHead(convId){
  var h=_chatHeads[convId]; var meta=h?h.meta:null;
  window._openChat();
  if(meta){ window._openConversation(convId, meta.title, meta.avatar, meta.isGroup); }
  // kupla EI poistu (jää pysyväksi pikakuvakkeeksi)
}
function _makeChatHeadDraggable(el, convId){
  var startX=0,startY=0,origX=0,origY=0,dragging=false,moved=false;
  el.addEventListener('pointerdown', function(e){
    dragging=true; moved=false;
    var r=el.getBoundingClientRect(); origX=r.left; origY=r.top;
    startX=e.clientX; startY=e.clientY;
    try{ el.setPointerCapture(e.pointerId); }catch(err){}
    el.style.transition='none'; el.style.zIndex='100002';
  });
  el.addEventListener('pointermove', function(e){
    if(!dragging) return;
    var dx=e.clientX-startX, dy=e.clientY-startY;
    if(Math.abs(dx)>6||Math.abs(dy)>6){ if(!moved){ moved=true; var x=_chatHeadXEl(); if(x) x.style.display='flex'; } }
    el.style.left=(origX+dx)+'px'; el.style.top=(origY+dy)+'px'; el.style.right='auto';
    var x2=_chatHeadXEl(); if(x2) x2.classList.toggle('over', _chatHeadOverX(e.clientX,e.clientY));
  });
  function endDrag(e){
    if(!dragging) return; dragging=false;
    el.style.transition=''; el.style.zIndex='';
    // Tarkista X-osuma ENNEN kuin X piilotetaan (piilotetun rect on 0,0)
    var overX = moved && _chatHeadOverX(e.clientX, e.clientY);
    var x=_chatHeadXEl(); if(x){ x.style.display='none'; x.classList.remove('over'); }
    if(!moved) return;                       // tap hoidetaan click-tapahtumassa (estää haamuklikkauksen)
    if(overX){ _removeChatHead(convId); return; }
    var r=el.getBoundingClientRect(), vw=window.innerWidth, vh=window.innerHeight;
    var snapLeft=(r.left+r.width/2)<vw/2;
    var nx=snapLeft?12:(vw-r.width-12);
    var ny=Math.max(70, Math.min(vh-r.height-96, r.top));
    el.style.left=nx+'px'; el.style.top=ny+'px'; el.style.right='auto';
    if(_chatHeads[convId]) _chatHeads[convId].pos={x:nx,y:ny};
  }
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  // Avaus click-tapahtumassa: klikkaus kohdistuu kuplaan eikä vuoda juuri auenneeseen chattiin
  el.addEventListener('click', function(e){
    e.preventDefault(); e.stopPropagation();
    if(moved){ moved=false; return; }        // raahaus, ei avausta
    _openChatHead(convId);
  });
}
function _startChatListeners(){
  _stopChatListeners();
  if(!currentUser) return;
  _chatAllConvs().forEach(function(c){
    var unsub = onSnapshot(_chatRef(c.id), function(snap){
      var data = snap.exists()? snap.data() : {};
      _chatData[c.id] = { messages: data.messages||[], reads: data.reads||{}, typing: data.typing||{} };
      var msgs = _chatData[c.id].messages;
      var myRead = (_chatData[c.id].reads[currentUser])||0;
      var unread = msgs.filter(function(m){ return m.from!==currentUser && (m.ts||0)>myRead; });
      _chatUnread[c.id] = unread.length;
      _updateChatBadge();
      var openHere = _chatCurrent && _chatCurrent.convId===c.id && _chatOverlayOpen();
      if(openHere){ _renderChatMessages(msgs); _markRead(c.id); _renderTyping(_chatData[c.id].typing); }
      else if(_chatOverlayOpen() && !_chatCurrent){ _renderChatList(); }
      if(!_chatFirstSnap[c.id]){ _chatFirstSnap[c.id]=true; return; }   // ensisnapshot: ei kuplaa
      if(!openHere && unread.length){
        var _meta = { convId:c.id, title:c.title, avatar:(c.isGroup ? '💬' : c.avatar), isGroup:c.isGroup };
        _addChatHead(c.id, _meta);
      }
    }, function(err){});
    _chatGlobalUnsubs.push(unsub);
  });
}
function _stopChatListeners(){
  _chatGlobalUnsubs.forEach(function(u){ try{u();}catch(e){} });
  _chatGlobalUnsubs=[]; _chatUnread={}; _chatData={}; _chatFirstSnap={}; _chatRenderFp={};
  _updateChatBadge();
}

// ============================
// RENDER: PLAYER STATUS (admin)
// ============================
function renderPlayerStatus(){
  const el=$('playerStatusArea'); if(!el) return;
  const t=getTournament(), match=getMatch();
  if(!t || !match || currentUser!==ADMIN){ el.innerHTML=''; return; }
  const preds=(t.predictions||{})[match.id]||{};
  const locked=isLocked(match);
  const hist=(t.editHistory||{})[match.id]||{};
  el.innerHTML='<div class="player-status-grid">'+PLAYERS.map(p=>{
    const pr=preds[p]||{};
    const total=FIELDS.length;
    const filled=FIELDS.filter(f=>pr[f.key]!=null && pr[f.key]!=='').length;
    const complete=filled===total;
    const cls=complete?'voted':(filled>0?'partial':'not-voted');
    const icon=complete?'✅':(filled>0?'🟡':'❌');
    const ph=(((t._predSavedAt||{})[p]||{})[match.id]) || hist[p];
    const lastEdit=ph?new Date(ph).toLocaleString('fi-FI',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):'';
    return '<div class="player-status-card '+cls+'">'+(locked?'🔒 ':'')+icon+' '+p+
      '<div class="veik-count">'+filled+'/'+total+'</div>'+
      (lastEdit?'<div style="font-size:10px;opacity:0.7;margin-top:2px">'+lastEdit+'</div>':'')+
    '</div>';
  }).join('')+'</div>';
}

// ============================
// RENDER: KOLMEN KÄRKI
// ============================
function isTop3Locked(t){
  if(!t||!(t.matches||[]).length) return false;
  const first=[...t.matches].sort((a,b)=>new Date(a.startTime||0)-new Date(b.startTime||0))[0];
  return isLocked(first);
}

function renderTopThree(){
  const wrap=$('topThreeArea'), t=getTournament();
  if(!t){ wrap.innerHTML='<p class="muted">Luo ensin turnaus.</p>'; return; }
  t.topThreePrediction=t.topThreePrediction||{}; t.actualTopThree=t.actualTopThree||['','',''];
  const TEAMS=['KANADA','SUOMI','USA','RUOTSI','TSEKKI','RANSKA','SVEITSI','ITALIA','SLOVAKIA','TANSKA','SAKSA','LATVIA','NORJA','ISO-BRITANNIA','KAZAKSTAN','ITÄVALTA','SLOVENIA','PUOLA','UKRAINA','VIRO','LIETTUA'];
  const tOpts='<option value=""></option>'+TEAMS.map(tm=>`<option value="${tm}">${tm}</option>`).join('');
  const isAdmin=currentUser===ADMIN;
  const locked=isTop3Locked(t);
  const showResults=t.finished;
  const uPred=t.topThreePrediction[currentUser]||['','',''];
  const aT3=t.actualTopThree||[];

  let banner='';
  if(!(t.matches||[]).length){
    banner='<p class="muted" style="margin-bottom:8px">Veikkaus avautuu kun ensimmäinen ottelu luodaan.</p>';
  } else if(locked && !showResults){
    banner='<div class="lock-banner" style="margin-bottom:8px">🔒 Kolmen kärki lukittu – tulokset näkyvät turnauksen jälkeen</div>';
  } else if(!locked){
    const first=[...t.matches].sort((a,b)=>new Date(a.startTime||0)-new Date(b.startTime||0))[0];
    const ts=first.startTime?new Date(first.startTime).toLocaleString('fi-FI',{weekday:'short',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):'';
    banner='<div class="open-banner" style="margin-bottom:8px">✅ Veikkaukset auki'+(ts?' – lukittuu '+ts:'')+'</div>';
  }

  let adminStatus='';
  if(isAdmin){
    adminStatus='<div style="margin-bottom:10px"><div style="font-weight:700;font-size:13px;margin-bottom:6px">👥 Kuka on veikannut?</div><div class="player-status-grid">'+
    PLAYERS.map(p=>{
      const arr=t.topThreePrediction[p]||[];
      const total=3;
      const filled=[0,1,2].filter(i=>arr[i]!=null && arr[i]!=='').length;
      const complete=filled===total;
      const cls=complete?'voted':(filled>0?'partial':'not-voted');
      const icon=complete?'✅':(filled>0?'🟡':'❌');
      return `<div class="player-status-card ${cls}">${locked?'🔒 ':''}${icon} ${p}<div class="veik-count">${filled}/${total}</div></div>`;
    }).join('')+'</div></div>';
  }

  let html=banner+adminStatus+'<div class="t3-grid">';
  if(isAdmin && locked){
    html+='<div class="t3-card"><div class="t3-title">✅ Lisää todellinen järjestys</div>'+
      [0,1,2].map(i=>'<div class="t3-row"><label style="font-size:12px;color:var(--muted);margin-bottom:2px">'+(i+1)+'. sija</label><select data-t3a="'+i+'">'+tOpts+'</select></div>').join('')+'</div>';
  }

  if((t.matches||[]).length){
    if(showResults){
      PLAYERS.forEach(p=>{
        const pPred=t.topThreePrediction[p]||['','',''];
        const rows=[0,1,2].map(i=>{
          const v=pPred[i]||'', av=aT3[i]||'';
          const ok=av&&ciEq(v,av), bad=av&&v&&!ok;
          return '<div class="kv-row '+(ok?'correct':bad?'incorrect':'')+'"><div class="kv-label">'+(i+1)+'. sija</div><div style="padding:8px;font-weight:600">'+(v||'—')+'</div></div>';
        }).join('');
        html+='<div class="t3-card"><div class="t3-title">'+(p===ADMIN?'👑 ':'')+p+'</div>'+rows+'</div>';
      });
    } else if(locked){
      html+='<div class="t3-card"><div class="t3-title">Oma veikkaus 🔒</div><p class="muted" style="font-size:13px">Veikkauksesi on tallennettu. Tulokset näkyvät turnauksen jälkeen.</p></div>';
    } else {
      html+='<div class="t3-card"><div class="t3-title">Oma veikkaus</div>'+
        [0,1,2].map(i=>'<div class="t3-row"><label style="font-size:12px;color:var(--muted);margin-bottom:2px">'+(i+1)+'. sija</label><select data-t3m="'+i+'">'+tOpts+'</select></div>').join('')+'</div>';
    }
  }
  html+='</div>';
  wrap.innerHTML=html;

  if(isAdmin && locked){
    [0,1,2].forEach(i=>{ const s=wrap.querySelector('[data-t3a="'+i+'"]'); if(s&&aT3[i]) s.value=aT3[i]; });
    wrap.querySelectorAll('[data-t3a]').forEach(inp=>inp.addEventListener('change',e=>{
      t.actualTopThree[+e.target.dataset.t3a]=e.target.value; renderScoreboard(); saveStructure();
    }));
  }
  if(!locked){
    [0,1,2].forEach(i=>{ const s=wrap.querySelector('[data-t3m="'+i+'"]'); if(s&&uPred[i]) s.value=uPred[i]; });
    wrap.querySelectorAll('[data-t3m]').forEach(inp=>inp.addEventListener('change',e=>{
      const idx=+e.target.dataset.t3m;
      t.topThreePrediction[currentUser]=t.topThreePrediction[currentUser]||['','',''];
      t.topThreePrediction[currentUser][idx]=e.target.value;
      renderScoreboard(); savePredictions(currentUser);
    }));
  }
}

// ============================
// RENDER: TURNAUKSEN STATUS
// ============================
function renderTournamentStatus(){
  const t=getTournament();
  const fa=$('finishTournamentArea'), badge=$('tournamentFinishedBadge'), del=$('deleteTournamentArea'), sc=$('statsCard');
  if(!t || currentUser!==ADMIN){
    if(fa) fa.style.display='none';
    if(badge) badge.style.display='none';
    if(del) del.style.display='none';
    if(sc) sc.style.display='none';
    return;
  }
  if(del) del.style.display='';
  if(t.finished){
    if(fa) fa.style.display='none';
    if(badge) badge.style.display='';
    if(sc) sc.style.display='';
    renderStats();
  } else {
    if(fa) fa.style.display='';
    if(badge) badge.style.display='none';
    if(sc) sc.style.display='none';
  }
}

// ============================
// RENDER: STATS
// ============================
function renderStats(){
  const t=getTournament(); if(!t) return;
  const el=$('statsArea'); if(!el) return;
  const sorted=sortedStandings(t);
  const medals=['🥇','🥈','🥉'];
  let best=null;
  (t.matches||[]).forEach(m=>PLAYERS.forEach(p=>{ const pts=calcMatchPts(t,m.id,p)+(calcTimeProximityPts(t,m.id)[p]||0); if(!best||pts>best.pts) best={player:p,matchName:m.name,pts}; }));
  const mW=(t.matches||[]).map(m=>{
    let b=null;
    PLAYERS.forEach(p=>{ const pts=calcMatchPts(t,m.id,p)+(calcTimeProximityPts(t,m.id)[p]||0); if(!b||pts>b.pts) b={player:p,pts}; else if(pts===b.pts) b.player+=' & '+p; });
    return {matchName:m.name,...b};
  });
  let html='<div style="margin-bottom:14px"><div style="font-weight:700;margin-bottom:8px">🥇 Lopputulokset</div><div class="score-grid">'+
    sorted.map(([n,pts],i)=>'<div class="score-card"><div class="name">'+(medals[i]||'')+ ' '+n+'</div><div class="pts">'+pts+' p</div></div>').join('')+'</div></div><div class="separator"></div>';
  if(best) html+='<div style="margin-bottom:14px"><div style="font-weight:700;margin-bottom:6px">⭐ Paras suoritus</div><div style="background:var(--card);border:2px solid var(--primary);border-radius:10px;padding:10px"><div style="font-size:18px;font-weight:800">'+best.player+'</div><div style="color:var(--muted);font-size:14px">'+best.matchName+'</div><div style="font-size:24px;font-weight:800;color:var(--primary)">'+best.pts+' p</div></div></div><div class="separator"></div>';
  html+='<div><div style="font-weight:700;margin-bottom:8px">🏅 Otteluvoittajat</div><div style="display:grid;gap:6px">'+
    mW.map(w=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:8px"><div style="font-size:13px;color:var(--muted)">'+w.matchName+'</div><div><span style="font-weight:700">'+w.player+'</span> <span class="pts-badge">'+w.pts+' p</span></div></div>').join('')+'</div></div>';
  el.innerHTML=html;
}

// ============================
// RENDER: PIN HALLINTA
// ============================
function renderPinManage(){
  const el=$('pinManageArea'); if(!el) return;
  el.innerHTML=PLAYERS.map(p=>{
    const hasPin=pins[p]?'✅ PIN asetettu':'❌ Ei PINiä';
    const col=pins[p]?'#166534':'#991b1b';
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);gap:8px">'+
      '<div><div style="font-weight:700">'+(p===ADMIN?'👑 ':'')+p+'</div><div style="font-size:12px;color:'+col+'">'+hasPin+'</div></div>'+
      '<div style="display:flex;gap:6px;align-items:center">'+
      '<input type="password" inputmode="numeric" maxlength="4" placeholder="1234" id="pin_'+p+'" style="width:80px;padding:8px;font-size:16px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text)" />'+
      '<button class="btn small" data-pin-player="' + p + '">Tallenna</button></div></div>';
  }).join('');
}

// PIN save via event delegation (called from renderPinManage)
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-pin-player]');
  if(!btn) return;
  window._savePin(btn.dataset.pinPlayer);
});

window._savePin = async function(player){
  const input=$('pin_'+player); if(!input) return;
  const val=input.value.trim();
  if(!/^\d{4}$/.test(val)){ alert('PIN-koodin pitää olla 4 numeroa!'); return; }
  pins[player]=val;
  try{ await setDoc(PINS_DOC,{pins}); input.value=''; renderPinManage(); showStatus('✅ '+player+':n PIN tallennettu','#22c55e'); hideStatus(); }
  catch(e){ alert('Tallennus epäonnistui: '+e.message); }
};

// ============================
// RENDER: KAIKKI KERRALLA
// ============================
function render(){
  renderTournamentSelects();
  renderTopThree();
  renderScoreboard();
  renderMatchArea();
  renderTournamentStatus();
  if(currentUser===ADMIN) renderPinManage();
  renderMessageCard();
  buildTicker();
  checkNightMode();
  checkLoserMessage();
  if(currentUser===ADMIN) checkUnreadMessages();
  else checkPlayerUnread();
}

// ============================
// UUTISPALKKI (news ticker)
// ============================
var _TK_FLAGS = {
  'suomi':'🇫🇮','finland':'🇫🇮',
  'ruotsi':'🇸🇪','sweden':'🇸🇪',
  'kanada':'🇨🇦','canada':'🇨🇦',
  'usa':'🇺🇸','yhdysvallat':'🇺🇸','amerikka':'🇺🇸',
  'venaja':'🇷🇺','russia':'🇷🇺','oar':'🇷🇺',
  'tsekki':'🇨🇿','czechia':'🇨🇿','tsekinmaa':'🇨🇿','tshekki':'🇨🇿',
  'sveitsi':'🇨🇭','switzerland':'🇨🇭',
  'saksa':'🇩🇪','germany':'🇩🇪',
  'slovakia':'🇸🇰',
  'norja':'🇳🇴','norway':'🇳🇴',
  'latvia':'🇱🇻',
  'tanska':'🇩🇰','denmark':'🇩🇰',
  'itavalta':'🇦🇹','austria':'🇦🇹',
  'ranska':'🇫🇷','france':'🇫🇷',
  'kazakstan':'🇰🇿','kazakhstan':'🇰🇿',
  'slovenia':'🇸🇮',
  'iso-britannia':'🇬🇧','britannia':'🇬🇧','englanti':'🇬🇧','uk':'🇬🇧',
  'unkari':'🇭🇺','hungary':'🇭🇺',
  'puola':'🇵🇱','poland':'🇵🇱',
  'italia':'🇮🇹','italy':'🇮🇹',
  'valko-venaja':'🇧🇾','valkovenaja':'🇧🇾','belarus':'🇧🇾',
  'japani':'🇯🇵','japan':'🇯🇵',
  'korea':'🇰🇷','etela-korea':'🇰🇷',
  'ukraina':'🇺🇦','ukraine':'🇺🇦'
};
function _tkStripDia(s){
  return String(s||'').replace(/\u00e4/g,'a').replace(/\u00f6/g,'o').replace(/\u00e5/g,'a')
    .replace(/\u0161/g,'s').replace(/\u00e9/g,'e').replace(/\u00fc/g,'u').replace(/\u00e8/g,'e');
}
function _tkFlag(name){
  var k = String(name||'').trim().toLowerCase();
  if(_TK_FLAGS[k]) return _TK_FLAGS[k];
  var k2 = _tkStripDia(k);
  return _TK_FLAGS[k2] || null;
}
function _tkTitle(s){
  return String(s||'').toLowerCase().split(/([ \-])/).map(function(w){
    return (w && w.length) ? (w.charAt(0).toUpperCase()+w.slice(1)) : w;
  }).join('');
}
function _tkTeam(name){ return _tkFlag(name) || _tkTitle(name); }
function _tkEsc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
  });
}
function _tkActual(t,mid){ return (t.actuals||{})[mid]||{}; }
function _tkPred(t,mid,p){ return ((t.predictions||{})[mid]||{})[p]||{}; }
function _tkHasLop(t,mid){ var a=_tkActual(t,mid); return a.lopputulos!=null && a.lopputulos!==''; }
function _tkScore(s){ var m=String(s||'').match(/(\d+)\s*[-\u2013:]\s*(\d+)/); return m?[+m[1],+m[2]]:null; }
function _tkOpp(name){
  if(!name) return '';
  var parts=String(name).split(/\s+vs\s+/i);
  if(parts.length<2) parts=String(name).split(/\s*[-\u2013]\s*/);
  for(var i=0;i<parts.length;i++){ if(!/^\s*suomi\s*$/i.test(parts[i])) return parts[i].trim(); }
  return parts[parts.length-1].trim();
}
function _tkPredicted(t,mid,p){
  var pr=_tkPred(t,mid,p);
  return Object.keys(pr).some(function(k){ return pr[k]!=null && String(pr[k]).trim()!==''; });
}
function _tkResultOk(t,mid,p){
  var a=_tkActual(t,mid), pr=_tkPred(t,mid,p);
  return !!(a.lopputulos && ciEq(pr.lopputulos||'', a.lopputulos));
}
function _tkNames(arr){
  if(arr.length===1) return arr[0];
  return arr.slice(0,-1).join(', ')+' & '+arr[arr.length-1];
}
function _tkRemain(startTime){
  var diff=new Date(startTime).getTime()-Date.now();
  if(diff<=0) return 'pian';
  var totalMin=Math.floor(diff/60000);
  var d=Math.floor(totalMin/1440), h=Math.floor((totalMin%1440)/60), mn=totalMin%60;
  if(d>0) return d+' vrk '+h+' t paasta'.replace('paasta','p\u00e4\u00e4st\u00e4');
  if(h>0) return h+' t '+mn+' min p\u00e4\u00e4st\u00e4';
  if(mn>0) return mn+' min p\u00e4\u00e4st\u00e4';
  return 'alle minuutti';
}
function _tkWinner(t){
  var tot=calcTotals(t); var best=null,bp=-1;
  PLAYERS.forEach(function(p){ if(tot[p]>bp){bp=tot[p];best=p;} });
  return bp>0?{player:best,pts:bp}:null;
}

function _tkRankChanges(t, ranked, items){
  var key='tv_ticker_ranks_'+t.id;
  var WINDOW=36*3600*1000;
  var cache=null;
  try{ cache=JSON.parse(localStorage.getItem(key)||'null'); }catch(e){}
  var curSig=ranked.join('|');
  var now=Date.now();
  var deltas=[];
  if(cache && cache.order){
    if(cache.order.join('|')!==curSig){
      PLAYERS.forEach(function(p){
        var op=cache.order.indexOf(p), np=ranked.indexOf(p);
        if(op>=0 && np>=0 && np<op){ deltas.push('📈 '+p+' nousi '+(np+1)+'. sijalle (+'+(op-np)+')'); }
      });
      var lastNow=ranked[ranked.length-1], lastPrev=cache.order[cache.order.length-1];
      if(lastNow && lastNow!==lastPrev){ deltas.push('📉 '+lastNow+' putosi jumboksi'); }
      try{ localStorage.setItem(key, JSON.stringify({order:ranked, deltas:deltas, ts:now})); }catch(e){}
    } else {
      if(cache.deltas && cache.deltas.length && (now-(cache.ts||0))<WINDOW){ deltas=cache.deltas; }
    }
  } else {
    try{ localStorage.setItem(key, JSON.stringify({order:ranked, deltas:[], ts:now})); }catch(e){}
  }
  deltas.forEach(function(d){ items.push(d); });
}

function _tkLive(t, items){
  var matches=(t.matches||[]).slice().sort(function(a,b){ return new Date(a.startTime||0)-new Date(b.startTime||0); });
  var withRes=matches.filter(function(m){ return _tkHasLop(t,m.id); })
                     .sort(function(a,b){ return new Date(b.startTime||0)-new Date(a.startTime||0); });
  var anyResults=withRes.length>0;

  withRes.slice(0,3).forEach(function(m,idx){
    var sc=_tkScore(_tkActual(t,m.id).lopputulos); var opp=_tkOpp(m.name);
    if(sc){ items.push(_tkTeam('Suomi')+' '+sc[0]+' \u2013 '+_tkTeam(opp)+' '+sc[1]); }
    var hit=PLAYERS.filter(function(p){ return _tkResultOk(t,m.id,p); });
    if(hit.length){ items.push('\u2705 '+_tkNames(hit)+' veikkasi'+(hit.length>1?'vat':'')+' tuloksen oikein'); }
    if(idx===0){
      var a=_tkActual(t,m.id);
      if(a.ekan_maalintekija && !/^\s*ei maalia\s*$/i.test(a.ekan_maalintekija)){
        items.push('Ekan maalin teki '+a.ekan_maalintekija+(a.ekan_maali_aika?(' ('+a.ekan_maali_aika+')'):''));
      }
    }
  });

  var upcoming=matches.filter(function(m){ return !isLocked(m); })
                      .sort(function(a,b){ return new Date(a.startTime||0)-new Date(b.startTime||0); });
  var next=upcoming[0];
  if(next){
    var opp2=_tkOpp(next.name);
    items.push('\u23F3 Seuraavaksi '+_tkTeam('Suomi')+' vs '+_tkTeam(opp2)+' \u00b7 veikkaukset lukittuu '+_tkRemain(next.startTime));
    var missing=PLAYERS.filter(function(p){ return !_tkPredicted(t,next.id,p); });
    if(missing.length && missing.length<PLAYERS.length){ items.push('📝 Puuttuu viel\u00e4: '+missing.join(', ')); }
    else if(missing.length===PLAYERS.length){ items.push('📝 Kukaan ei ole viel\u00e4 veikannut seuraavaa ottelua'); }
  }

  if(anyResults){
    var tot=calcTotals(t);
    var ranked=PLAYERS.slice().sort(function(a,b){ return tot[b]-tot[a]; });
    var gap=tot[ranked[0]]-tot[ranked[1]];
    items.push('🏆 '+ranked[0]+(gap>0?(' johtaa '+gap+' pisteell\u00e4'):' johtaa (tasapeli)'));
    if(PLAYERS.indexOf(currentUser)>=0){
      var mi=ranked.indexOf(currentUser);
      if(mi===0){ items.push('👑 Sin\u00e4 johdat \u2013 '+tot[currentUser]+' p'); }
      else { items.push('Olet '+(mi+1)+'. \u00b7 '+(tot[ranked[0]]-tot[currentUser])+' p johtajasta'); }
    }
    _tkRankChanges(t, ranked, items);
    var best={pts:0,p:null,m:null};
    matches.forEach(function(m){ PLAYERS.forEach(function(p){ var s=calcMatchPts(t,m.id,p); if(s>best.pts){ best={pts:s,p:p,m:m}; } }); });
    if(best.p && best.pts>=4){ items.push('🔥 Paras suoritus: '+best.p+' '+best.pts+' p ('+_tkTeam('Suomi')+' vs '+_tkTeam(_tkOpp(best.m.name))+')'); }
  }
}

function _tkNostalgia(tours, items){
  var real=tours.filter(function(t){
    return (t.matches||[]).some(function(m){
      var a=(t.actuals||{})[m.id]||{};
      return Object.keys(a).some(function(k){ return a[k]!=null && String(a[k]).trim()!==''; });
    }) || (t.topThreePrediction && (t.actualTopThree||[]).length);
  });
  if(!real.length) return;

  var titles={}; PLAYERS.forEach(function(p){ titles[p]=0; });
  var lastWin=null;
  var byNew=real.slice().sort(function(a,b){ return (parseInt(b.id,10)||0)-(parseInt(a.id,10)||0); });
  byNew.forEach(function(t){ var w=_tkWinner(t); if(w){ titles[w.player]++; if(!lastWin) lastWin={t:t, w:w}; } });

  var champ=null,cp=0; PLAYERS.forEach(function(p){ if(titles[p]>cp){ cp=titles[p]; champ=p; } });
  if(champ && cp>0){ items.push('🏆 Eniten voittoja: '+champ+' ('+cp+' turnaus'+(cp>1?'ta':'')+')'); }
  if(lastWin){ items.push('Viimeksi voitti '+lastWin.w.player+' \u2013 '+(lastWin.t.name||'turnaus')); }

  var best={pts:0,p:null,name:null};
  real.forEach(function(t){ (t.matches||[]).forEach(function(m){ PLAYERS.forEach(function(p){ var s=calcMatchPts(t,m.id,p); if(s>best.pts){ best={pts:s,p:p,name:t.name}; } }); }); });
  if(best.p && best.pts>0){ items.push('💥 Paras yksitt\u00e4inen ottelu: '+best.p+' '+best.pts+' p ('+(best.name||'')+')'); }

  var acc={}; PLAYERS.forEach(function(p){ acc[p]={c:0,s:0}; });
  real.forEach(function(t){ (t.matches||[]).forEach(function(m){
    var a=(t.actuals||{})[m.id]||{};
    PLAYERS.forEach(function(p){
      var pr=((t.predictions||{})[m.id]||{})[p]||{};
      FIELDS.forEach(function(f){
        if(a[f.key]==null||a[f.key]==='') return;
        acc[p].s++;
        var ok;
        if(f.key==='ekan_maali_aika'){ ok=timeMatch(pr[f.key]||'', a[f.key]); }
        else { ok=fieldMatch(f.key, pr[f.key]||'', a[f.key]); }
        if(ok) acc[p].c++;
      });
    });
  }); });
  var sharp=null,sr=-1; PLAYERS.forEach(function(p){ if(acc[p].s>=10){ var r=acc[p].c/acc[p].s; if(r>sr){ sr=r; sharp=p; } } });
  if(sharp){ items.push('🎯 Tarkin koskaan: '+sharp+' '+Math.round(sr*100)+' % osumat'); }

  var act={}; PLAYERS.forEach(function(p){ act[p]=0; });
  real.forEach(function(t){ (t.matches||[]).forEach(function(m){ PLAYERS.forEach(function(p){ if(_tkPredicted(t,m.id,p)) act[p]++; }); }); });
  var busy=null,bn=0; PLAYERS.forEach(function(p){ if(act[p]>bn){ bn=act[p]; busy=p; } });
  if(busy && bn>0){ items.push('\u23F1\uFE0F Ahkerin veikkaaja: '+busy+' ('+bn+' ottelua)'); }

  items.push('📚 Pelattu '+real.length+' turnausta');
  items.push('Ei turnausta k\u00e4ynniss\u00e4 \u2013 '+ADMIN+' odottaa jo seuraavaa 👀');
}

function _tkRenderTrack(track, items, bar){
  var sig=items.join('||');
  if(track.getAttribute('data-sig')===sig){ bar.style.display='flex'; return; }
  track.setAttribute('data-sig', sig);
  var sep='<span class="news-ticker-sep">\u25C6</span>';
  var seq=items.map(function(x){ return '<span class="news-ticker-item">'+_tkEsc(x)+'</span>'; }).join(sep)+sep;
  track.innerHTML='<span class="news-ticker-seq">'+seq+'</span><span class="news-ticker-seq" aria-hidden="true">'+seq+'</span>';
  bar.style.display='flex';
  var chars=items.join(' ').length;
  var dur=Math.max(20, Math.min(160, Math.round(chars*0.42)));
  track.style.animationDuration=dur+'s';
}

function buildTicker(){
  var bar=$('newsTicker'), track=$('newsTickerTrack'), tag=$('newsTickerTag');
  if(!bar||!track||!tag) return;
  if(!currentUser){ bar.style.display='none'; return; }
  if(!window._tkTimer){ window._tkTimer=setInterval(function(){ try{ buildTicker(); }catch(e){} }, 60000); }
  var items=[];
  var tours=(data.tournaments||[]);
  var sel=getTournament();
  var running=function(t){ return !!(t && !t.finished && !t.historical); };
  var live = running(sel) ? sel : (tours.filter(running).sort(function(a,b){ return (parseInt(b.id,10)||0)-(parseInt(a.id,10)||0); })[0] || null);
  var label='KULJU';
  try{
    if(live){ label='LIVE'; _tkLive(live, items); }
    else { label='KULJU'; _tkNostalgia(tours, items); }
  }catch(e){ bar.style.display='none'; return; }
  if(!items.length){ bar.style.display='none'; return; }
  tag.textContent=label;
  _tkRenderTrack(track, items, bar);
}

function renderTournamentSelects(){
  // Turnausvalinta
  const tSel=$('tournamentSelect');
  if(tSel){
    tSel.innerHTML='<option value="">Valitse turnaus…</option>'+
      (data.tournaments||[]).filter(t=>!t.historical).map(t=>'<option value="'+t.id+'" '+(String(t.id)===String(tid)?'selected':'')+'>'+t.name+(t.finished?' ✅':'')+'</option>').join('');
    tSel.onchange=e=>{ tid=e.target.value||null; mid=null; saveSelections(); saveStructure(); render(); };
  }
  renderRosterAdmin();
  // Otteluvalinta
  const mSel=$('matchSelect'), t=getTournament();
  if(!mSel) return;
  if(!t){ mSel.innerHTML='<option value="">—</option>'; mSel.disabled=true; mid=null; return; }
  mSel.disabled=false;
  // Auto-valitse jos vain yksi ottelu
  if(!mid && (t.matches||[]).length===1) mid=String(t.matches[0].id);
  mSel.innerHTML='<option value="">Valitse ottelu…</option>'+
    (t.matches||[]).map(m=>{
      const lk=isLocked(m)?'🔒 ':'';
      const ts=m.startTime?' ('+new Date(m.startTime).toLocaleString('fi-FI',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})+')':'';
      return '<option value="'+m.id+'" '+(String(m.id)===String(mid)?'selected':'')+'>'+lk+m.name+ts+'</option>';
    }).join('');
  mSel.onchange=e=>{ mid=e.target.value||null; saveSelections(); renderMatchArea(); };
  // Poista ottelu -nappi
  const da=$('deleteMatchArea');
  if(da) da.style.display=(currentUser===ADMIN&&mid)?'':'none';
}

function renderMatchArea(){
  const t=getTournament(), match=getMatch();
  renderMatchBanner(match);
  renderPlayerStatus();
  renderPredictions();
  renderActuals();
  // Countdown vain jos ei lukittu
  if(match && !isLocked(match)){
    startCountdown(match);
  } else {
    stopCountdown();
  }
}

var rosterCollapsed = true; // pelaajalista oletuksena piilossa
function roleOf(name){ var m=/\(([^)]+)\)\s*$/.exec(name||''); return m ? m[1].trim().toUpperCase() : ''; }
var ROSTER_GROUPS=[{role:'MV',label:'Maalivahdit'},{role:'P',label:'Puolustajat'},{role:'H',label:'Hyökkääjät'}];
function groupRoster(roster){
  var groups=ROSTER_GROUPS.map(function(g){ return {role:g.role,label:g.label,items:[]}; });
  var muut={role:'',label:'Muut',items:[]};
  roster.forEach(function(name,idx){
    var r=roleOf(name), g=null;
    for(var i=0;i<groups.length;i++){ if(groups[i].role===r){ g=groups[i]; break; } }
    (g||muut).items.push({name:name,idx:idx});
  });
  if(muut.items.length) groups.push(muut);
  return groups;
}
function swapRosterPlayers(i,j){
  var t=getTournament(); if(!t) return;
  var roster=ensureRoster(t);
  if(i<0||j<0||i>=roster.length||j>=roster.length) return;
  var tmp=roster[i]; roster[i]=roster[j]; roster[j]=tmp;
  saveStructure(); renderRosterAdmin(); renderMatchArea();
}
function renderRosterAdmin(){
  var area=$('rosterAdminArea'); if(!area) return;
  var t=getTournament();
  if(!t || currentUser!==ADMIN){ area.style.display='none'; return; }
  area.style.display='';
  var roster=getRoster(t);
  var body=$('rosterBody'), hint=$('rosterToggleHint');
  if(body) body.style.display = rosterCollapsed ? 'none' : '';
  if(hint) hint.textContent = rosterCollapsed ? ('Näytä ('+roster.length+')') : 'Piilota';
  if(rosterCollapsed) return;
  var list=$('rosterList'); if(!list) return;
  if(!roster.length){ list.innerHTML='<div class="muted" style="font-size:13px">Ei pelaajia. Lisää pelaajia alta.</div>'; return; }
  var esc=function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
  var groups=groupRoster(roster);
  var html='';
  groups.forEach(function(g){
    if(!g.items.length) return;
    html += '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:10px 0 4px">'+esc(g.label)+' ('+g.items.length+')</div>';
    g.items.forEach(function(it,k){
      var upIdx = k>0 ? g.items[k-1].idx : -1;
      var downIdx = k<g.items.length-1 ? g.items[k+1].idx : -1;
      html += '<div style="display:flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:8px;padding:6px 8px;background:var(--card);margin-bottom:4px">'
        + '<span style="flex:1;min-width:0;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(it.name)+'</span>'
        + '<button type="button" class="btn small secondary" data-swap-a="'+it.idx+'" data-swap-b="'+upIdx+'" style="padding:4px 9px;flex:0 0 auto"'+(upIdx<0?' disabled':'')+' title="Siirrä ylös">↑</button>'
        + '<button type="button" class="btn small secondary" data-swap-a="'+it.idx+'" data-swap-b="'+downIdx+'" style="padding:4px 9px;flex:0 0 auto"'+(downIdx<0?' disabled':'')+' title="Siirrä alas">↓</button>'
        + '<button type="button" class="btn small danger" data-roster-del="'+it.idx+'" style="padding:4px 9px;flex:0 0 auto" title="Poista pelaaja">✕</button>'
        + '</div>';
    });
  });
  list.innerHTML=html;
  list.querySelectorAll('[data-roster-del]').forEach(function(btn){ btn.addEventListener('click',function(){ removeRosterPlayer(+btn.dataset.rosterDel); }); });
  list.querySelectorAll('[data-swap-b]').forEach(function(btn){ if(btn.disabled) return; btn.addEventListener('click',function(){ swapRosterPlayers(+btn.dataset.swapA, +btn.dataset.swapB); }); });
}
function removeRosterPlayer(idx){
  var t=getTournament(); if(!t) return;
  var roster=ensureRoster(t);
  if(idx<0 || idx>=roster.length) return;
  var name=roster[idx];
  if(!confirm('Poistetaanko pelaaja "'+name+'" t\u00e4m\u00e4n turnauksen listalta?')) return;
  roster.splice(idx,1);
  saveStructure();
  renderRosterAdmin();
  renderMatchArea();
  var st=$('rosterStatus'); if(st){ st.textContent='Poistettu: '+name; setTimeout(function(){ if(st) st.textContent=''; },2500); }
}
function addRosterPlayer(){
  var t=getTournament();
  var st=$('rosterStatus');
  if(!t){ if(st) st.textContent='Valitse ensin turnaus.'; return; }
  var nameInput=$('newPlayerName'), roleSel=$('newPlayerRole');
  var raw=((nameInput&&nameInput.value)||'').trim().replace(/\s+/g,' ');
  if(!raw){ if(st) st.textContent='Anna pelaajan nimi.'; if(nameInput) nameInput.focus(); return; }
  var role=(roleSel&&roleSel.value)||'H';
  var full=raw+' ('+role+')';
  var roster=ensureRoster(t);
  if(roster.some(function(p){ return p.trim().toLowerCase()===full.trim().toLowerCase(); })){
    if(st) st.textContent='Pelaaja on jo listalla.';
    return;
  }
  roster.push(full);
  if(nameInput) nameInput.value='';
  saveStructure();
  renderRosterAdmin();
  renderMatchArea();
  if(st){ st.textContent='Lis\u00e4tty: '+full; setTimeout(function(){ if(st) st.textContent=''; },2500); }
}

// ============================
// KIRJAUTUMINEN + PIN
// ============================
let pinBuffer='', pendingName='';

function buildLogin(){
  const grid=$('playerGrid'); if(!grid) return;
  grid.innerHTML=PLAYERS.map(p=>'<button class="player-btn '+(p===ADMIN?'admin':'')+'" data-login-name="'+p+'">'+( p===ADMIN?'👑 ':'')+p+'</button>').join('');
  grid.querySelectorAll('[data-login-name]').forEach(btn=>btn.addEventListener('click',()=>window._selectName(btn.dataset.loginName)));
}

window._selectName=function(name){
  pendingName=name; pinBuffer='';
  $('loginStep1').style.display='none'; $('loginStep2').style.display='';
  $('loginName').textContent=name; $('pinError').textContent='';
  renderPinDots();
};
window._backToNames=function(){
  pendingName=''; pinBuffer='';
  $('loginStep1').style.display=''; $('loginStep2').style.display='none';
};

function renderPinDots(){
  const el=$('pinDots'); if(!el) return;
  el.innerHTML=[0,1,2,3].map(i=>'<div class="pin-dot '+(i<pinBuffer.length?'filled':'')+'"></div>').join('');
}

function handlePinKey(v){
  if(v==='clear'){ pinBuffer=''; renderPinDots(); $('pinError').textContent=''; return; }
  if(v==='back'){ pinBuffer=pinBuffer.slice(0,-1); renderPinDots(); $('pinError').textContent=''; return; }
  if(pinBuffer.length>=4) return;
  pinBuffer+=v; renderPinDots();
  if(pinBuffer.length===4) checkPin();
}

async function checkPin(){
  const name=pendingName;
  try{ const snap=await getDoc(PINS_DOC); if(snap.exists()) pins=snap.data().pins||{}; }catch(e){}
  const stored=pins[name];
  if(!stored){
    if(name===ADMIN){ doLogin(name); }
    else{ $('pinError').textContent='PIN-koodia ei ole asetettu. Pyydä adminia.'; pinBuffer=''; renderPinDots(); }
    return;
  }
  if(pinBuffer===stored){ doLogin(name); }
  else{ $('pinError').textContent='Väärä PIN-koodi.'; pinBuffer=''; renderPinDots(); }
}

function doLogin(name){
  currentUser=name;
  localStorage.setItem('tv_user',name);
  $('loginScreen').style.display='none'; $('appScreen').style.display='';
  $('currentUserBadge').textContent=(name===ADMIN?'👑 ':'')+name;
  const isAdmin=name===ADMIN;
  // Turnaus/ottelu/status-työkalut vain adminille
  ['adminTournamentTools','adminMatchTools','adminStatusCard','tiebreakerBtnWrap','tournamentAdminCard','dataCard'].forEach(id=>{
    const el=$(id); if(el) el.style.display=isAdmin?'':'none';
  });
  // Asetukset-nappi (Lisää-näkymä) vain adminille
  // Asetukset näkyy kaikille, mutta pelaaja näkee vain omat ilmoitusasetuksensa.
  // Ylläpitäjän välilehdet piilotetaan js/lisaykset.js:ssä.
  const moreSet=$('moreSettingsBtn');
  if(moreSet){
    moreSet.style.display='';
    const lbl=moreSet.querySelector('span');
    if(lbl) lbl.textContent = isAdmin ? 'Asetukset' : 'Ilmoitusasetukset';
  }
  const moreMon=$('moreMonitorBtn'); if(moreMon) moreMon.style.display=isAdmin?'':'none';
  // PIN-koodit ja Käyttökerrat piilotetaan aina — ne ovat Asetukset-modaalissa
  ['adminPinTools','adminLoginStats'].forEach(id=>{
    const el=$(id); if(el) el.style.display='none';
  });
  // Vie/Tuo JSON piilotetaan aina — ne ovat Asetukset-modaalissa
  const ib=$('importBtn'); if(ib) ib.style.display='none';

  // "Päivitä & tarkasta" vain adminille (hän päivittää faktat); muut käyttävät Tallenna-nappia
  const rc=$('refreshCheck'); if(rc) rc.style.display=isAdmin?'':'none';

  // Admin-painikkeet yläpalkissa
  const msgBtn=$('adminMsgBtn'); if(msgBtn) msgBtn.style.display=isAdmin?'':'none';
  const setBtn=$('adminSettingsBtn'); if(setBtn) setBtn.style.display=isAdmin?'':'none';
  // Pelaajan viesti-nappi yläpalkissa
  const pMsgBtn=$('playerMsgBtn'); if(pMsgBtn) pMsgBtn.style.display=!isAdmin?'':'none';
  const cOpenBtn=$('chatOpenBtn'); if(cOpenBtn) cOpenBtn.style.display=currentUser?'':'none';
  if(currentUser && !_chatGlobalUnsubs.length){ try{ _startChatListeners(); }catch(e){} }
  if(currentUser){ try{ _startPresence(); }catch(e){} }

  // Viesti Terolle -kortti: piilotetaan adminilta
  const msgCard=$('messageCard'); if(msgCard) msgCard.style.display=isAdmin?'none':'';

  // Data-osio (Kuva + PDF): piilotetaan muilta käyttäjiltä, admilnille näkyy
  const ds=$('dataSection'); if(ds) ds.style.display=isAdmin?'':'none';
  const dSep=$('dataSeparator'); if(dSep) dSep.style.display=isAdmin?'':'none';

  if (window._ilmoitaAsetus) window._ilmoitaAsetus('kirjautui', name);

  // Tallenna käyttökerta
  trackLoginEvent(name);
  loadData();
  applyMaintenance();

  // Näkymät: alusta välilehti hashista (oletus veikkaa) + käynnistä globaali countdown
  if(window._initViews) window._initViews();
}

window._logout=function(){
  try{ _stopChatListeners(); _stopPresence(); if(window._closeChat) window._closeChat(); }catch(e){}
  currentUser=null; localStorage.removeItem('tv_user');
  pinBuffer=''; pendingName='';
  stopCountdown();
  $('loginScreen').style.display=''; $('appScreen').style.display='none';
  $('loginStep1').style.display=''; $('loginStep2').style.display='none';
};

// ============================
// PERSONAL BEST helper
// ============================
function getPersonalBest(player){
  const allMatches = [];
  (data.tournaments||[]).forEach(t=>{
    (t.matches||[]).forEach(m=>{
      const pts = calcMatchPts(t, m.id, player) + (calcTimeProximityPts(t, m.id)[player]||0);
      allMatches.push({pts, matchName:m.name, tournamentName:t.name});
    });
  });
  if(!allMatches.length) return null;
  return allMatches.reduce((best,cur)=>cur.pts>best.pts?cur:best);
}

// ============================
// HALL OF FAME – uran tilastot
// ============================
function _hofParseTime(s){ const m=(s||'').match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1])*60 + (+m[2]) : null; }

// Yhden turnauksen tulos: pisteet, sijajärjestys (paras ensin), valmis?
function hofTournamentResult(t){
  if(t.historical){
    const pts={}; PLAYERS.forEach(p=>{ pts[p]=(t.finalPoints && t.finalPoints[p]!=null) ? (Number(t.finalPoints[p])||0) : 0; });
    const order=PLAYERS.slice().sort((a,b)=>pts[b]-pts[a]);
    return { points:pts, order:order, finished:true };
  }
  const totals=calcTotals(t);
  const order=sortedStandings(t).map(e=>e[0]);
  return { points:totals, order:order, finished:!!t.finished };
}

// Turnauksen tyyppi nimen perusteella: 'mm', 'oly' tai 'other'
function _hofCategory(name){
  const n=(name||'').toLowerCase();
  if(n.indexOf('olympia')!==-1) return 'oly';
  if(n.indexOf('mm')!==-1) return 'mm';
  return 'other';
}

// Uran tilastot kaikkien turnausten yli
function calcCareerStats(){
  const stats={}; PLAYERS.forEach(p=>stats[p]={points:0,golds:0,silvers:0,bronzes:0,mm:{g:0,s:0,b:0},oly:{g:0,s:0,b:0},other:{g:0,s:0,b:0},played:0,best:0,correct:0,scorable:0,accuracy:null});
  (data.tournaments||[]).forEach(t=>{
    const r=hofTournamentResult(t);
    const hasResults = t.historical || t.finished || PLAYERS.some(p=>(r.points[p]||0)>0);
    PLAYERS.forEach(p=>{
      const pts=r.points[p]||0;
      stats[p].points += pts;          // uran pisteet: kaikki turnaukset
      if(hasResults) stats[p].played++;
      if(pts>stats[p].best) stats[p].best=pts;
    });
    if(r.finished){                    // mitalit: vain valmiit turnaukset
      const cat=_hofCategory(t.name);
      if(r.order[0]){ stats[r.order[0]].golds++;   stats[r.order[0]][cat].g++; }
      if(r.order[1]){ stats[r.order[1]].silvers++; stats[r.order[1]][cat].s++; }
      if(r.order[2]){ stats[r.order[2]].bronzes++; stats[r.order[2]][cat].b++; }
    }
    // Osumaprosentti – vain oikeista turnauksista (joissa on kohdetietoa)
    if(!t.historical){
      (t.matches||[]).forEach(m=>{
        const ac=(t.actuals||{})[m.id]||{};
        FIELDS.forEach(f=>{
          if(ac[f.key]==null || ac[f.key]==='') return; // ei tulosta → ei arvosteltava
          PLAYERS.forEach(p=>{
            const pr=((t.predictions||{})[m.id]||{})[p]||{};
            stats[p].scorable++;
            let ok;
            if(f.key==='ekan_maali_aika'){
              const pp=_hofParseTime(pr[f.key]||''), ap=_hofParseTime(ac[f.key]);
              ok = pp!==null && ap!==null && pp===ap;
            } else {
              ok = fieldMatch(f.key, pr[f.key]||'', ac[f.key]);
            }
            if(ok) stats[p].correct++;
          });
        });
      });
      if(t.topThreePrediction && t.actualTopThree){
        (t.actualTopThree||[]).forEach((slot,i)=>{
          if(!slot) return;
          PLAYERS.forEach(p=>{
            stats[p].scorable++;
            const arr=t.topThreePrediction[p]||[];
            if(arr[i] && ciEq(arr[i],slot)) stats[p].correct++;
          });
        });
      }
    }
  });
  PLAYERS.forEach(p=>{ stats[p].accuracy = stats[p].scorable>0 ? Math.round(stats[p].correct/stats[p].scorable*100) : null; });
  return stats;
}

window._openHallOfFame=function(){
  document.getElementById('hofModal').style.display='flex';
  renderHallOfFame();
};

function renderHallOfFame(){
  const area=document.getElementById('hofArea'); if(!area) return;
  const stats=calcCareerStats();
  const order=PLAYERS.slice().sort((a,b)=>{
    if(stats[b].golds!==stats[a].golds) return stats[b].golds-stats[a].golds;
    if(stats[b].silvers!==stats[a].silvers) return stats[b].silvers-stats[a].silvers;
    if(stats[b].bronzes!==stats[a].bronzes) return stats[b].bronzes-stats[a].bronzes;
    if(stats[b].points!==stats[a].points) return stats[b].points-stats[a].points;
    return (stats[b].accuracy||0)-(stats[a].accuracy||0);
  });
  if(!(data.tournaments||[]).length){
    area.innerHTML='<p class="muted" style="font-size:13px">Ei vielä turnauksia.</p>';
  } else {
    let html='';
    order.forEach((p,i)=>{
      const s=stats[p];
      const lead = i===0 ? '🏆 ' : (i+1)+'. ';
      const accStr = s.accuracy==null ? '–' : s.accuracy+'%';
      const medal3 = m => '🥇 '+m.g+' · 🥈 '+m.s+' · 🥉 '+m.b;
      let catLines = '<div style="grid-column:1/3">🏆 MM-kisat: <strong>'+medal3(s.mm)+'</strong></div>'
                   + '<div style="grid-column:1/3">🎽 Olympialaiset: <strong>'+medal3(s.oly)+'</strong></div>';
      if(s.other.g||s.other.s||s.other.b) catLines += '<div style="grid-column:1/3">🎖️ Muut: <strong>'+medal3(s.other)+'</strong></div>';
      html += '<div style="background:'+(i===0?'rgba(249,115,22,0.08)':'rgba(255,255,255,0.03)')+';border:1px solid '+(i===0?'rgba(249,115,22,0.35)':'var(--border)')+';border-radius:12px;padding:12px;margin-bottom:8px">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px">'
          + '<div style="font-weight:800;font-size:16px">'+lead+(p===ADMIN?'👑 ':'')+p+'</div>'
          + '<div style="font-weight:800;font-size:14px;white-space:nowrap">🥇 '+s.golds+' &nbsp;🥈 '+s.silvers+' &nbsp;🥉 '+s.bronzes+'</div>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-size:13px">'
          + catLines
          + '<div>⭐ Uran pisteet: <strong>'+s.points+'</strong></div>'
          + '<div>🎯 Osuma: <strong>'+accStr+'</strong></div>'
          + '<div>📅 Turnaukset: <strong>'+s.played+'</strong></div>'
          + '<div>🔝 Paras turnaus: <strong>'+s.best+' p</strong></div>'
        + '</div>'
      + '</div>';
    });
    area.innerHTML=html;
  }
  // Admin: menneiden turnausten lisäys
  const adm=document.getElementById('hofAdminArea'); if(!adm) return;
  if(currentUser!==ADMIN){ adm.innerHTML=''; return; }
  let inputs='';
  PLAYERS.forEach((p,idx)=>{
    inputs+='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">'
      +'<span style="font-size:14px">'+(p===ADMIN?'👑 ':'')+p+'</span>'
      +'<input id="hofPts'+idx+'" type="number" inputmode="numeric" placeholder="0" style="width:90px" />'
    +'</div>';
  });
  const hist=(data.tournaments||[]).filter(t=>t.historical);
  let histList='';
  if(hist.length){
    histList='<div style="margin-top:12px"><div style="font-size:12px;color:var(--muted);margin-bottom:6px">Lisätyt menneet turnaukset:</div>';
    hist.forEach(t=>{
      histList+='<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border:1px solid var(--border);border-radius:8px;margin-bottom:4px;font-size:13px">'
        +'<span>'+t.name+'</span>'
        +'<button onclick="window._deleteHistorical(\''+t.id+'\')" style="background:transparent;border:none;color:#dc2626;font-size:16px;cursor:pointer;padding:0 4px">✕</button>'
      +'</div>';
    });
    histList+='</div>';
  }
  adm.innerHTML='<div class="separator" style="margin:16px 0"></div>'
    +'<h2 style="margin:0 0 4px;font-size:16px">➕ Lisää mennyt turnaus</h2>'
    +'<p class="muted" style="font-size:12px;margin:0 0 10px">Syötä turnauksen nimi ja kunkin pelaajan loppupisteet — voittaja päätellään pisteistä. Et tarvitse otteluita.</p>'
    +'<input id="hofHistName" type="text" placeholder="Esim. MM 2024 · Tšekki" style="margin-bottom:10px" />'
    +inputs
    +'<button class="btn small" style="width:100%;margin-top:6px" onclick="window._addHistoricalTournament()">Lisää Hall of Fameen</button>'
    +'<div id="hofHistMsg" style="font-size:13px;text-align:center;min-height:18px;margin-top:6px"></div>'
    +histList;
}

window._addHistoricalTournament=function(){
  const nameEl=document.getElementById('hofHistName');
  const name=((nameEl&&nameEl.value)||'').trim();
  const msg=document.getElementById('hofHistMsg');
  if(!name){ if(msg){ msg.style.color='#dc2626'; msg.textContent='Anna turnauksen nimi'; } return; }
  const finalPoints={};
  PLAYERS.forEach((p,idx)=>{ const el=document.getElementById('hofPts'+idx); finalPoints[p]= el ? (parseInt(el.value,10)||0) : 0; });
  if(!data.tournaments) data.tournaments=[];
  data.tournaments.push({ id:'hist_'+Date.now(), name:name, historical:true, finished:true, finalPoints:finalPoints, matches:[], predictions:{}, actuals:{}, topThreePrediction:{}, actualTopThree:[] });
  saveStructure();
  if(msg){ msg.style.color='#22c55e'; msg.textContent='✅ Lisätty!'; setTimeout(function(){ if(msg) msg.textContent=''; },3000); }
  renderHallOfFame();
};

window._deleteHistorical=function(id){
  if(!confirm('Poistetaanko tämä mennyt turnaus Hall of Famesta?')) return;
  data.tournaments=(data.tournaments||[]).filter(t=>String(t.id)!==String(id));
  saveStructure();
  renderHallOfFame();
};

// ============================
// KAUDEN KOOSTE (Wrapped)
// ============================
function computeWrapped(t, player){
  const sorted=sortedStandings(t);
  const order=sorted.map(e=>e[0]);
  const rank=order.indexOf(player)+1;
  const total=sorted.length;
  const totals=calcTotals(t);
  const pts=totals[player]||0;
  let correct=0, scorable=0;
  const fieldStat={}; FIELDS.forEach(f=>fieldStat[f.key]={c:0,s:0,label:f.label});
  let bestMatch={pts:-1,name:''};
  (t.matches||[]).forEach(m=>{
    const ac=(t.actuals||{})[m.id]||{};
    const pr=((t.predictions||{})[m.id]||{})[player]||{};
    FIELDS.forEach(f=>{
      if(ac[f.key]==null||ac[f.key]==='') return;
      scorable++; fieldStat[f.key].s++;
      let ok;
      if(f.key==='ekan_maali_aika'){ const pp=_hofParseTime(pr[f.key]||''), ap=_hofParseTime(ac[f.key]); ok=pp!==null&&ap!==null&&pp===ap; }
      else ok=fieldMatch(f.key, pr[f.key]||'', ac[f.key]);
      if(ok){ correct++; fieldStat[f.key].c++; }
    });
    const mp=calcMatchPts(t,m.id,player)+(calcTimeProximityPts(t,m.id)[player]||0);
    if(mp>bestMatch.pts){ bestMatch={pts:mp,name:(m.name||'Ottelu')}; }
  });
  if(t.topThreePrediction && t.actualTopThree){
    (t.actualTopThree||[]).forEach((slot,i)=>{ if(!slot) return; scorable++; const arr=t.topThreePrediction[player]||[]; if(arr[i]&&ciEq(arr[i],slot)) correct++; });
  }
  const accuracy = scorable>0 ? Math.round(correct/scorable*100) : null;
  let strongest=null, weakest=null;
  Object.keys(fieldStat).forEach(k=>{
    const fs=fieldStat[k]; if(fs.s<1) return;
    const ratio=fs.c/fs.s;
    if(!strongest || ratio>strongest.ratio || (ratio===strongest.ratio && fs.s>strongest.s)) strongest={label:fs.label,c:fs.c,s:fs.s,ratio:ratio};
    if(ratio<1){ if(!weakest || ratio<weakest.ratio || (ratio===weakest.ratio && fs.s>weakest.s)) weakest={label:fs.label,c:fs.c,s:fs.s,ratio:ratio}; }
  });
  const above = rank>1 ? order[rank-2] : null;
  const abovePts = above!=null ? (totals[above]||0) : null;

  // ── Kuka veikkasi samoin kuin sinä (KAIKKI kohteet) ──
  const others=PLAYERS.filter(p=>p!==player);
  const agreeTotal={}; others.forEach(o=>agreeTotal[o]=0);
  const fieldAgree={}; FIELDS.forEach(f=>{ fieldAgree[f.key]={}; others.forEach(o=>fieldAgree[f.key][o]=0); });
  (t.matches||[]).forEach(m=>{
    const mine=((t.predictions||{})[m.id]||{})[player]||{};
    FIELDS.forEach(f=>{
      const myV=mine[f.key]||''; if(!myV) return;
      others.forEach(o=>{
        const ov=(((t.predictions||{})[m.id]||{})[o]||{})[f.key]||'';
        if(ov && ciEq(ov,myV)){ agreeTotal[o]++; fieldAgree[f.key][o]++; }
      });
    });
  });
  if(t.topThreePrediction){ // kolmen kärki mukaan kokonaislaskuun
    const mine=t.topThreePrediction[player]||[];
    others.forEach(o=>{ const ot=t.topThreePrediction[o]||[]; mine.forEach((v,i)=>{ if(v && ot[i] && ciEq(v,ot[i])) agreeTotal[o]++; }); });
  }
  let soulmate=null; others.forEach(o=>{ if(agreeTotal[o]>0 && (!soulmate || agreeTotal[o]>soulmate.count)) soulmate={player:o,count:agreeTotal[o]}; });
  const agreeRanking=others.map(o=>({player:o,count:agreeTotal[o]})).sort((a,b)=>b.count-a.count);
  const fieldTop={};
  FIELDS.forEach(f=>{ let top=null; others.forEach(o=>{ const c=fieldAgree[f.key][o]; if(c>0 && (!top || c>top.count)) top={player:o,count:c}; }); if(top) fieldTop[f.key]={label:f.label,player:top.player,count:top.count}; });

  // ── Turnausinfot ──
  let predMade=0;
  (t.matches||[]).forEach(m=>{ const pr=((t.predictions||{})[m.id]||{})[player]||{}; FIELDS.forEach(f=>{ if(pr[f.key]!=null && pr[f.key]!=='') predMade++; }); });
  if(t.topThreePrediction){ (t.topThreePrediction[player]||[]).forEach(v=>{ if(v) predMade++; }); }
  let familyTotal=0; PLAYERS.forEach(p=>familyTotal+=(totals[p]||0));
  let matchesPlayed=0; (t.matches||[]).forEach(m=>{ const ac=(t.actuals||{})[m.id]||{}; if(Object.keys(ac).some(k=>ac[k]!=null&&ac[k]!=='')) matchesPlayed++; });
  const winner=order[0]; const winnerPts=winner!=null?(totals[winner]||0):0;
  const gap = (sorted.length>=2) ? (sorted[0][1]-sorted[1][1]) : null;
  const second = sorted.length>=2 ? sorted[1][0] : null;

  // ── Turnaustason faktat (samat kaikille) ──
  const _tp=(s)=>{ const m=String(s||'').match(/(\d+)\s*[-–:]\s*(\d+)/); return m?[(+m[1]),(+m[2])]:null; };
  let easiest=null, hardest=null, surprise=null, mostGoals=null, totalGoals=0;
  let bestSingle={pts:-1,player:null,name:''};
  (t.matches||[]).forEach(m=>{
    const ac=(t.actuals||{})[m.id]||{};
    if(!Object.keys(ac).some(k=>ac[k]!=null&&ac[k]!=='')) return;
    let mc=0, ms=0, lopC=0, lopN=0;
    PLAYERS.forEach(p=>{
      const pr=((t.predictions||{})[m.id]||{})[p]||{};
      FIELDS.forEach(f=>{
        if(ac[f.key]==null||ac[f.key]==='') return;
        ms++;
        let ok; if(f.key==='ekan_maali_aika'){const pp=_hofParseTime(pr[f.key]||''),ap=_hofParseTime(ac[f.key]);ok=pp!==null&&ap!==null&&pp===ap;} else ok=fieldMatch(f.key,pr[f.key]||'',ac[f.key]);
        if(ok) mc++;
      });
      if(ac.lopputulos){ lopN++; if(fieldMatch('lopputulos',pr.lopputulos||'',ac.lopputulos)) lopC++; }
      const sp=calcMatchPts(t,m.id,p)+(calcTimeProximityPts(t,m.id)[p]||0);
      if(sp>bestSingle.pts) bestSingle={pts:sp,player:p,name:(m.name||'Ottelu')};
    });
    if(ms>0){ const r=mc/ms; if(!easiest||r>easiest.ratio) easiest={name:(m.name||'Ottelu'),ratio:r}; if(!hardest||r<hardest.ratio) hardest={name:(m.name||'Ottelu'),ratio:r}; }
    if(ac.lopputulos && lopN>0){ const lr=lopC/lopN; if(!surprise||lr<surprise.ratio) surprise={name:(m.name||'Ottelu'),correct:lopC,players:lopN}; }
    const gg=_tp(ac.lopputulos); if(gg){ const g=gg[0]+gg[1]; totalGoals+=g; if(!mostGoals||g>mostGoals.goals) mostGoals={name:(m.name||'Ottelu'),goals:g}; }
  });

  // perheen tarkin/vaikein kohde
  const famField={}; FIELDS.forEach(f=>famField[f.key]={c:0,s:0,label:f.label});
  (t.matches||[]).forEach(m=>{ const ac=(t.actuals||{})[m.id]||{}; PLAYERS.forEach(p=>{ const pr=((t.predictions||{})[m.id]||{})[p]||{}; FIELDS.forEach(f=>{ if(ac[f.key]==null||ac[f.key]==='') return; famField[f.key].s++; let ok; if(f.key==='ekan_maali_aika'){const pp=_hofParseTime(pr[f.key]||''),ap=_hofParseTime(ac[f.key]);ok=pp!==null&&ap!==null&&pp===ap;} else ok=fieldMatch(f.key,pr[f.key]||'',ac[f.key]); if(ok) famField[f.key].c++; }); }); });
  let famBest=null, famWorst=null;
  Object.values(famField).forEach(fs=>{ if(fs.s<1) return; const r=fs.c/fs.s; if(!famBest||r>famBest.ratio) famBest={label:fs.label,ratio:r}; if(!famWorst||r<famWorst.ratio) famWorst={label:fs.label,ratio:r}; });

  // yksimielisin veikkaus
  let consensus=null;
  (t.matches||[]).forEach(m=>{ FIELDS.forEach(f=>{ const cnt={},org={}; PLAYERS.forEach(p=>{ let v=(((t.predictions||{})[m.id]||{})[p]||{})[f.key]; if(v!=null&&String(v).trim()!==''){ const k=String(v).trim().toLowerCase(); cnt[k]=(cnt[k]||0)+1; if(!org[k]) org[k]=String(v).trim(); } }); Object.keys(cnt).forEach(k=>{ if(cnt[k]>=2 && (!consensus||cnt[k]>consensus.count)) consensus={count:cnt[k],field:f.label,match:(m.name||'Ottelu'),value:org[k]}; }); }); });

  // ── Arvonimi (persona) – perheen vertailu ──
  const famAcc={}, famPred={}, famAgree={};
  PLAYERS.forEach(p=>{ let c=0,s=0,pm=0; (t.matches||[]).forEach(m=>{ const ac=(t.actuals||{})[m.id]||{}; const pr=((t.predictions||{})[m.id]||{})[p]||{}; FIELDS.forEach(f=>{ if(pr[f.key]!=null&&pr[f.key]!=='') pm++; if(ac[f.key]==null||ac[f.key]==='') return; s++; let ok; if(f.key==='ekan_maali_aika'){const pp=_hofParseTime(pr[f.key]||''),ap=_hofParseTime(ac[f.key]);ok=pp!==null&&ap!==null&&pp===ap;} else ok=fieldMatch(f.key,pr[f.key]||'',ac[f.key]); if(ok)c++; }); }); famAcc[p]=s>0?c/s:0; famPred[p]=pm; });
  PLAYERS.forEach(p=>{ let same=0,comp=0; (t.matches||[]).forEach(m=>{ FIELDS.forEach(f=>{ const v=(((t.predictions||{})[m.id]||{})[p]||{})[f.key]; if(v==null||v==='')return; PLAYERS.forEach(o=>{ if(o===p)return; const ov=(((t.predictions||{})[m.id]||{})[o]||{})[f.key]; if(ov!=null&&ov!==''){ comp++; if(ciEq(v,ov)) same++; } }); }); }); famAgree[p]=comp>0?same/comp:0; });
  const accSorted=PLAYERS.slice().sort((a,b)=>famAcc[b]-famAcc[a]);
  const predSorted=PLAYERS.slice().sort((a,b)=>famPred[b]-famPred[a]);
  const lowAgree=PLAYERS.slice().sort((a,b)=>famAgree[a]-famAgree[b]);
  const highAgree=PLAYERS.slice().sort((a,b)=>famAgree[b]-famAgree[a]);
  let persona;
  if(order[0]===player && accSorted[0]!==player) persona={emoji:'🍀',title:'Tuurin suosikki',sub:'Voitit kauden — eikä edes tarkimmilla veikkauksilla!'};
  else if(order[0]===player) persona={emoji:'👑',title:'Mestari',sub:'Kauden ykkönen, ansaitusti.'};
  else if(accSorted[0]===player) persona={emoji:'🎯',title:'Tarkka-ampuja',sub:'Perheen paras osumatarkkuus.'};
  else if(lowAgree[0]===player) persona={emoji:'🎲',title:'Uskalikko',sub:'Veikkasit rohkeimmin omalla tavallasi.'};
  else if(highAgree[0]===player) persona={emoji:'🛡️',title:'Varman päälle -pelaaja',sub:'Pysyit lähimpänä perheen yhteistä linjaa.'};
  else if(predSorted[0]===player) persona={emoji:'🐝',title:'Ahkerin veikkaaja',sub:'Teit eniten veikkauksia.'};
  else persona={emoji:'🏒',title:'Vakaa konkari',sub:'Tasainen, vahva kausi takana.'};

  return {player:player, name:t.name, rank:rank, total:total, pts:pts, accuracy:accuracy, correct:correct, scorable:scorable,
    bestMatch:(bestMatch.pts>=0?bestMatch:null), strongest:strongest, weakest:weakest, above:above, abovePts:abovePts, isWinner:(order[0]===player),
    soulmate:soulmate, agreeRanking:agreeRanking, fieldTop:fieldTop, predMade:predMade, familyTotal:familyTotal, matchesPlayed:matchesPlayed, winner:winner, winnerPts:winnerPts,
    gap:gap, second:second, easiest:easiest, hardest:hardest, surprise:surprise, mostGoals:mostGoals, totalGoals:totalGoals, bestSingle:(bestSingle.pts>=0?bestSingle:null),
    famBest:famBest, famWorst:famWorst, consensus:consensus, persona:persona};
}

function buildWrappedCards(d){
  const cards=[];
  const medal = d.rank===1?'🥇':d.rank===2?'🥈':d.rank===3?'🥉':'';
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const pct=r=>Math.round((r||0)*100)+'%';
  const commentary = d.rank===1?'Murskaava kausi! 🏆' : (d.rank<=3?'Loistava suoritus!' : (d.rank===d.total?'Ei hätää — ensi kausi on sinun!':'Hyvä kausi takana!'));
  cards.push({dur:4500, html:'<div class="wr-label">Kauden kooste</div><div class="wr-emoji">🏒</div><div class="wr-headline">'+esc(d.name)+'</div><div class="wr-sub">Sinun koosteesi, '+esc(d.player)+'</div>'});
  cards.push({dur:5800, html:'<div class="wr-label">Sijoituksesi</div><div class="wr-emoji">'+(medal||'🎯')+'</div><div class="wr-big">'+d.rank+'.</div><div class="wr-sub">'+d.total+' veikkaajasta<br>'+commentary+'</div>'});
  cards.push({dur:6000, html:'<div class="wr-label">Pisteet</div><div class="wr-big wr-count" data-target="'+d.pts+'">0</div><div class="wr-sub">pistettä kerätty</div>'});
  cards.push({dur:5500, html:'<div class="wr-label">Ahkeruus</div><div class="wr-emoji">✍️</div><div class="wr-big wr-count" data-target="'+d.predMade+'">0</div><div class="wr-sub">veikkausta tehty kauden aikana</div>'});
  if(d.accuracy!=null) cards.push({dur:6000, html:'<div class="wr-label">Osumatarkkuus</div><div class="wr-emoji">🎯</div><div class="wr-big wr-count" data-target="'+d.accuracy+'" data-suffix="%">0%</div><div class="wr-sub">kohteista oikein ('+d.correct+'/'+d.scorable+')</div>'});
  if(d.bestMatch && d.bestMatch.pts>0) cards.push({dur:5500, html:'<div class="wr-label">Paras ottelusi</div><div class="wr-emoji">🔥</div><div class="wr-headline">'+esc(d.bestMatch.name)+'</div><div class="wr-sub">'+d.bestMatch.pts+' pistettä yhdestä ottelusta</div>'});
  if(d.strongest){
    let h='<div class="wr-label">Vahvuutesi</div><div class="wr-emoji">💪</div><div class="wr-headline">'+esc(d.strongest.label)+'</div><div class="wr-sub">osuit '+pct(d.strongest.ratio)+' ('+d.strongest.c+'/'+d.strongest.s+')';
    if(d.weakest && d.weakest.label!==d.strongest.label) h+='<br>Heikoin laji: '+esc(d.weakest.label)+' '+pct(d.weakest.ratio);
    h+='</div>';
    cards.push({dur:6500, html:h});
  }
  // Arvonimi
  if(d.persona) cards.push({dur:6000, html:'<div class="wr-label">Arvonimesi</div><div class="wr-emoji">'+d.persona.emoji+'</div><div class="wr-headline">'+esc(d.persona.title)+'</div><div class="wr-sub">'+esc(d.persona.sub)+'</div>'});
  // Sielunkumppani
  if(d.soulmate) cards.push({dur:6000, html:'<div class="wr-label">Veikkaussielunkumppani</div><div class="wr-emoji">🤝</div><div class="wr-headline">'+esc(d.soulmate.player)+'</div><div class="wr-sub">Veikkasitte samoin '+d.soulmate.count+' kertaa — kaikki kohteet mukana</div>'});
  if(d.agreeRanking && d.agreeRanking.length){
    const lines=d.agreeRanking.map(r=>'<div style="margin:6px 0;display:flex;justify-content:space-between;gap:12px"><span>'+esc(r.player)+'</span><strong>'+r.count+'×</strong></div>').join('');
    cards.push({dur:7500, html:'<div class="wr-label">Kenen kanssa veikkasit samoin</div><div class="wr-emoji">👯</div><div class="wr-sub" style="text-align:left;line-height:1.4;font-size:clamp(15px,4.6vw,20px);max-width:300px;margin:0 auto">'+lines+'</div><div style="font-size:11px;opacity:0.6;margin-top:12px">samoja veikkauksia kaikkien kohteiden yli</div>'});
  }
  const keyFields=['lopputulos','ekan_maalintekija','ekan_jahyn_saaja','ekan_jahyn_syy'];
  const fLines=keyFields.filter(k=>d.fieldTop&&d.fieldTop[k]).map(k=>{ const ft=d.fieldTop[k]; return '<div style="margin:7px 0">'+esc(ft.label)+': <strong>'+esc(ft.player)+'</strong> · '+ft.count+'×</div>'; }).join('');
  if(fLines) cards.push({dur:7000, html:'<div class="wr-label">Kohteittain samimmat</div><div class="wr-emoji">🎯</div><div class="wr-sub" style="line-height:1.4;font-size:clamp(15px,4.6vw,20px)">'+fLines+'</div>'});
  // ── Turnaustason faktat ──
  cards.push({dur:6000, html:'<div class="wr-label">Turnaus pähkinänkuoressa</div><div class="wr-emoji">🏟️</div><div class="wr-headline">'+d.matchesPlayed+' ottelua</div><div class="wr-sub">Koko perhe keräsi yhteensä '+d.familyTotal+' pistettä</div>'});
  if(d.easiest && d.hardest) cards.push({dur:6500, html:'<div class="wr-label">Helpoin & vaikein ottelu</div><div class="wr-emoji">⚖️</div><div class="wr-sub" style="line-height:1.6;font-size:clamp(15px,4.6vw,20px)">😄 Helpoin: <strong>'+esc(d.easiest.name)+'</strong> ('+pct(d.easiest.ratio)+')<br>😵 Vaikein: <strong>'+esc(d.hardest.name)+'</strong> ('+pct(d.hardest.ratio)+')</div>'});
  if(d.surprise && d.surprise.players>0) cards.push({dur:6000, html:'<div class="wr-label">Yllätysottelu</div><div class="wr-emoji">😱</div><div class="wr-headline">'+esc(d.surprise.name)+'</div><div class="wr-sub">Vain '+d.surprise.correct+'/'+d.surprise.players+' osui lopputulokseen</div>'});
  if(d.famBest && d.famWorst) cards.push({dur:6500, html:'<div class="wr-label">Perheen kohteet</div><div class="wr-emoji">🧠</div><div class="wr-sub" style="line-height:1.6;font-size:clamp(15px,4.6vw,20px)">✅ Tarkin: <strong>'+esc(d.famBest.label)+'</strong> ('+pct(d.famBest.ratio)+')<br>❌ Vaikein: <strong>'+esc(d.famWorst.label)+'</strong> ('+pct(d.famWorst.ratio)+')</div>'});
  if(d.bestSingle && d.bestSingle.pts>0) cards.push({dur:6000, html:'<div class="wr-label">Kovin yksittäissuoritus</div><div class="wr-emoji">⚡</div><div class="wr-headline">'+esc(d.bestSingle.player)+'</div><div class="wr-sub">'+d.bestSingle.pts+' pistettä ottelusta '+esc(d.bestSingle.name)+'</div>'});
  if(d.totalGoals>0) cards.push({dur:6000, html:'<div class="wr-label">Maalit</div><div class="wr-emoji">🚨</div><div class="wr-big wr-count" data-target="'+d.totalGoals+'">0</div><div class="wr-sub">maalia koko turnauksessa'+(d.mostGoals?'<br>Maalikkain: '+esc(d.mostGoals.name)+' ('+d.mostGoals.goals+')':'')+'</div>'});
  if(d.gap!=null && d.second) cards.push({dur:6000, html:'<div class="wr-label">Kärjen tiukkuus</div><div class="wr-emoji">🏁</div><div class="wr-headline">'+(d.gap===0?'Tasapeli kärjessä!':d.gap+' pisteen ero')+'</div><div class="wr-sub">'+esc(d.winner)+' vs. '+esc(d.second)+'</div>'});
  if(d.consensus) cards.push({dur:6000, html:'<div class="wr-label">Yksimielisin veikkaus</div><div class="wr-emoji">🧩</div><div class="wr-headline">'+d.consensus.count+' veikkasi saman</div><div class="wr-sub">'+esc(d.consensus.field)+' · '+esc(d.consensus.match)+'<br>"'+esc(d.consensus.value)+'"</div>'});
  // Mestari / voittaja (konfetti)
  if(d.isWinner) cards.push({dur:6000, confetti:true, bg:'linear-gradient(160deg,#b45309,#d97706,#f59e0b)', html:'<div class="wr-label">Mestari</div><div class="wr-emoji">👑</div><div class="wr-headline">Sinä hallitsit kauden!</div><div class="wr-sub">Kukaan ei yltänyt ohitsesi.</div>'});
  else {
    let h='<div class="wr-label">Turnauksen voittaja</div><div class="wr-emoji">👑</div><div class="wr-headline">'+esc(d.winner)+'</div><div class="wr-sub">'+d.winnerPts+' pistettä';
    if(d.above && d.above!==d.winner) h+='<br>Sinua juuri edellä: '+esc(d.above)+' ('+d.abovePts+' p)';
    h+='</div>';
    cards.push({dur:6000, confetti:true, bg:'linear-gradient(160deg,#b45309,#d97706,#f59e0b)', html:h});
  }
  cards.push({dur:99999999, html:'<div class="wr-emoji">🏆</div><div class="wr-headline">Nähdään ensi kaudella!</div><div class="wr-sub">'+esc(d.name)+'</div><button class="wr-share" onclick="event.stopPropagation(); window._wrappedShare()">📤 Jaa kooste</button>'});
  // Vaihtuvat värilliset taustat
  const BG=['linear-gradient(160deg,#1e1b4b,#831843,#7c2d12)','linear-gradient(160deg,#0f766e,#155e75,#1e3a8a)','linear-gradient(160deg,#4c1d95,#6d28d9,#be185d)','linear-gradient(160deg,#064e3b,#065f46,#0f766e)','linear-gradient(160deg,#831843,#9d174d,#be123c)','linear-gradient(160deg,#1e3a8a,#3730a3,#5b21b6)','linear-gradient(160deg,#7c2d12,#9a3412,#b45309)'];
  cards.forEach((c,i)=>{ if(!c.bg) c.bg=BG[i%BG.length]; });
  return cards;
}

let _wrCards=[], _wrIdx=0, _wrTimer=null, _wrData=null;
window._openWrapped=function(){
  const t=getTournament(); if(!t || !t.finished) return;
  _wrData=computeWrapped(t, currentUser);
  _wrCards=buildWrappedCards(_wrData);
  const bars=document.getElementById('wrBars');
  bars.innerHTML=_wrCards.map(function(){return '<div class="wr-bar"><div class="wr-bar-fill"></div></div>';}).join('');
  document.getElementById('wrappedOverlay').classList.add('show');
  const a=document.getElementById('wrappedAudio'); if(a){ try{ a.currentTime=0; a.volume=0.55; a.loop=true; const pp=a.play(); if(pp&&pp.catch) pp.catch(function(){}); }catch(e){} }
  _wrShow(0);
};
window._closeWrapped=function(){ clearTimeout(_wrTimer); document.getElementById('wrappedOverlay').classList.remove('show'); const a=document.getElementById('wrappedAudio'); if(a){ try{ a.pause(); a.currentTime=0; }catch(e){} } };
window._wrappedNext=function(){ _wrShow(_wrIdx+1); };
window._wrappedPrev=function(){ _wrShow(_wrIdx-1); };
window._wrappedTap=function(e){ const w=window.innerWidth||document.documentElement.clientWidth; if(e.clientX < w*0.32) window._wrappedPrev(); else window._wrappedNext(); };
function _wrShow(i){
  if(i<0) i=0;
  if(i>=_wrCards.length){ window._closeWrapped(); return; }
  _wrIdx=i;
  clearTimeout(_wrTimer);
  const card=document.getElementById('wrCard');
  card.innerHTML=_wrCards[i].html;
  const ov=document.getElementById('wrappedOverlay');
  if(ov && _wrCards[i].bg) ov.style.background=_wrCards[i].bg;
  card.style.animation='none'; void card.offsetWidth; card.style.animation='wrIn 0.5s ease';
  const fills=document.querySelectorAll('#wrBars .wr-bar-fill');
  fills.forEach(function(f,idx){ f.style.transition='none'; f.style.width = idx<i ? '100%' : '0%'; });
  const cur=fills[i]; const dur=_wrCards[i].dur;
  if(cur){
    if(dur<60000){ void cur.offsetWidth; cur.style.transition='width '+dur+'ms linear'; cur.style.width='100%'; }
    else { cur.style.width='35%'; }
  }
  const cnt=card.querySelector('.wr-count'); if(cnt) _wrCountUp(cnt);
  if(_wrCards[i].confetti && typeof spawnConfetti==='function'){ try{ spawnConfetti(); }catch(e){} }
  if(dur<60000){ _wrTimer=setTimeout(function(){ _wrShow(i+1); }, dur); }
}
function _wrCountUp(el){
  const target=parseInt(el.dataset.target,10)||0; const suffix=el.dataset.suffix||'';
  const start=performance.now(), dur=1100;
  function step(now){ const p=Math.min(1,(now-start)/dur); const v=Math.round(target*(1-Math.pow(1-p,3))); el.textContent=v+suffix; if(p<1) requestAnimationFrame(step); }
  requestAnimationFrame(step);
}
window._wrappedShare=async function(){
  const d=_wrData; if(!d) return;
  try{
    const c=document.createElement('canvas'); c.width=1080; c.height=1920; const x=c.getContext('2d');
    const g=x.createLinearGradient(0,0,1080,1920); g.addColorStop(0,'#1e1b4b'); g.addColorStop(0.5,'#831843'); g.addColorStop(1,'#7c2d12');
    x.fillStyle=g; x.fillRect(0,0,1080,1920);
    x.textAlign='center'; x.fillStyle='#fff';
    x.font='bold 46px system-ui'; x.fillText('🏒 KAUDEN KOOSTE', 540, 250);
    x.font='bold 64px system-ui'; x.fillText(d.name, 540, 360);
    x.font='bold 84px system-ui'; x.fillText(d.player, 540, 600);
    const medal=d.rank===1?'🥇':d.rank===2?'🥈':d.rank===3?'🥉':'';
    x.font='900 240px system-ui'; x.fillText(d.rank+'.', 540, 940);
    x.font='bold 46px system-ui'; x.fillText('sija '+d.total+' veikkaajasta '+medal, 540, 1040);
    x.font='900 150px system-ui'; x.fillText(d.pts+' p', 540, 1300);
    if(d.accuracy!=null){ x.font='bold 54px system-ui'; x.fillText('🎯 '+d.accuracy+'% osumatarkkuus', 540, 1440); }
    if(d.persona){ x.font='bold 52px system-ui'; x.fillStyle='#fff'; x.fillText(d.persona.emoji+' '+d.persona.title, 540, 1580); }
    x.font='40px system-ui'; x.fillStyle='rgba(255,255,255,0.7)'; x.fillText('KULJU CUP', 540, 1820);
    c.toBlob(async function(blob){
      if(!blob){ return; }
      const file=new File([blob],'kooste.png',{type:'image/png'});
      if(navigator.canShare && navigator.canShare({files:[file]})){
        try{ await navigator.share({files:[file], title:'Kauden kooste'}); return; }catch(e){ if(e && e.name==='AbortError') return; }
      }
      const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='kooste.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(url);},2000);
    },'image/png');
  }catch(e){ alert('Jakaminen ei onnistunut tällä laitteella.'); }
};

// ============================
// EXPOSE TO WINDOW (PDF-skripti tarvitsee)
// ============================
window.getTournament = getTournament;
window.calcTotals = calcTotals;
window.calcMatchPts = calcMatchPts;
window.calcTimeProximityPts = calcTimeProximityPts;
window.fieldMatch = fieldMatch;
window.PLAYERS = PLAYERS;
window._getPelleData = async function() {
  try { const snap = await getDoc(PELLE_DOC); return snap.exists() ? snap.data() : {}; } catch(e){ return {}; }
};

// ============================
// INIT
// ============================
// ASETUKSET-PANEELI (admin)
// ============================
function renderPinManage2() {
  const area = $('pinManageArea2');
  if (!area) return;
  area.innerHTML = PLAYERS.map(p => {
    const hasPin = pins[p] ? '✅ PIN asetettu' : '❌ Ei PINiä';
    const col = pins[p] ? '#22c55e' : '#dc2626';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div><div style="font-weight:700">${p === ADMIN ? '👑 ' : ''}${p}</div><div style="font-size:12px;color:${col}">${hasPin}</div></div>
      <input type="text" maxlength="6" placeholder="Uusi PIN" style="width:90px;padding:8px;font-size:15px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text)"
        onchange="window._setPin2('${p}', this.value.trim()); this.value=''" />
    </div>`;
  }).join('');
}

window._openSettingsPanel = function() {
  $('settingsModal').style.display = 'flex';
  renderPinManage2();
  const area2 = $('pinManageArea2');
  if (area2) area2.style.display = 'none';
  const btn2 = $('togglePins2');
  if (btn2) btn2.textContent = 'Näytä';
  if (btn2 && !btn2._hooked) {
    btn2._hooked = true;
    let pinManageVisible2 = false;
    btn2.onclick = function() {
      pinManageVisible2 = !pinManageVisible2;
      const area = $('pinManageArea2');
      if (area) area.style.display = pinManageVisible2 ? '' : 'none';
      this.textContent = pinManageVisible2 ? 'Piilota' : 'Näytä';
      if (pinManageVisible2) renderPinManage2();
    };
  }
};

window._setPin2 = async function(player, pin) {
  if (!pin) return;
  pins[player] = pin;
  try { await setDoc(PINS_DOC, {pins}); showStatus('✅ PIN tallennettu', '#22c55e'); hideStatus(); } catch(e) {}
  renderPinManage2();
};

window._renderLoginStats2 = async function() {
  const el = $('loginStatsArea2'); if (!el) return;
  el.style.display = 'block';
  el.innerHTML = '<p class="muted" style="font-size:13px">Ladataan…</p>';
  try {
    const snap = await getDoc(LOGINS_DOC);
    if (!snap.exists()) { el.innerHTML = '<p class="muted" style="font-size:13px">Ei dataa vielä.</p>'; return; }
    const loginData = snap.data();
    const rows = PLAYERS.map(p => {
      const d = loginData[p] || { count: 0, lastSeen: null };
      const lastStr = d.lastSeen ? new Date(d.lastSeen).toLocaleString('fi-FI',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}) : '–';
      const daysSince = d.lastSeen ? (Date.now() - new Date(d.lastSeen)) / 86400000 : 999;
      const dot = daysSince < 1 ? '🟢' : daysSince < 3 ? '🟡' : '🔴';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);gap:8px">
        <div><div style="font-weight:700;font-size:14px">${dot} ${p === ADMIN ? '👑 ' : ''}${p}</div><div style="font-size:11px;color:var(--muted)">Viimeksi: ${lastStr}</div></div>
        <div style="text-align:right"><div style="font-size:18px;font-weight:900;color:var(--primary)">${d.count || 0}</div><div style="font-size:11px;color:var(--muted)">käyntiä</div></div>
      </div>`;
    }).join('');
    el.innerHTML = rows || '<p class="muted">Ei dataa.</p>';
    // Lisää myös TIMO ON PELLE -tilastot
    await renderPelleStats(el);
  } catch(e) { el.innerHTML = '<p class="muted">Virhe.</p>'; }
};

window._resetLoginStats2 = async function() {
  if (!confirm('Nollataan kaikkien käyttökerrat? Tätä ei voi peruuttaa.')) return;
  try {
    await setDoc(LOGINS_DOC, {});
    showStatus('✅ Käyttökerrat nollattu', '#22c55e'); hideStatus();
    window._renderLoginStats2();
  } catch(e) { showStatus('❌ Nollaus epäonnistui', '#dc2626'); }
};

window._toggleLoginStats2 = function() {
  const area = $('loginStatsArea2'); if (!area) return;
  const hidden = area.style.display === 'none' || area.style.display === '';
  area.style.display = hidden ? 'block' : 'none';
  if (hidden) window._renderLoginStats2();
};

// Import/export from settings modal
$('exportBtn2') && ($('exportBtn2').onclick = () => { window._doExport && window._doExport(); });
$('importBtn2') && ($('importBtn2').onclick = () => $('importFile2') && $('importFile2').click());
$('importFile2') && ($('importFile2').onchange = async function() {
  const file = this.files[0]; if (!file) return;
  this.value = '';
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      data = JSON.parse(e.target.result);
      tid = data.selectedTournamentId||null; mid = null;
      showStatus('💾 Tallennetaan rakennetta…','#f97316');
      await saveStructure();
      // Tallennetaan jokaisen pelaajan veikkaukset peräkkäin – ei rinnakkain
      // (rinnakkain queue-mekanismi ei toimi oikein)
      for(const p of PLAYERS){
        showStatus('💾 Tallennetaan: '+p+'…','#f97316');
        await savePredictions(p);
      }
      render();
      showStatus('✅ Tuonti onnistui! Kaikki '+PLAYERS.length+' pelaajaa tallennettu.','#22c55e');
      hideStatus();
    } catch(err) { showStatus('❌ Virheellinen JSON: '+err.message,'#dc2626'); }
  };
  reader.readAsText(file);
});

// ============================
// VIESTIT-PANEELI (admin)
// ============================
window._openMsgPanel = async function() {
  $('msgPanel').style.display = 'flex';
  await refreshBroadcastAdminUI2();
};

// Broadcast-toiminnot modaalille
async function refreshBroadcastAdminUI2() {
  const blocked = $('broadcastBlockedNote2');
  const sendArea = $('broadcastSendArea2');
  const readStatus = $('broadcastReadStatus2');
  const readList = $('broadcastReadList2');
  if (!blocked || !sendArea || !readStatus) return;
  try {
    const snap = await getDoc(BROADCAST_DOC);
    if (!snap.exists() || !snap.data().active) {
      blocked.style.display = 'none';
      sendArea.style.display = 'block';
      readStatus.style.display = 'none';
      return;
    }
    const bc = snap.data();
    const seen = bc.seenBy || [];
    const others = PLAYERS.filter(p => p !== ADMIN);
    const allRead = others.every(p => seen.includes(p));
    if (allRead) {
      blocked.style.display = 'none';
      sendArea.style.display = 'block';
      readStatus.style.display = 'none';
    } else {
      blocked.style.display = 'block';
      sendArea.style.display = 'none';
      readStatus.style.display = 'block';
      if (readList) readList.innerHTML = others.map(p => {
        const hasRead = seen.includes(p);
        return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px"><span>${p}</span><span>${hasRead ? '✅ Luettu' : '⏳ Lukematta'}</span></div>`;
      }).join('');
    }
  } catch(e) {}
}

window._setBroadcast2 = function(text) {
  const inp = $('broadcastInput2');
  if (inp) { inp.value = text; inp.focus(); }
};

window._sendBroadcast2 = async function() {
  const inp = $('broadcastInput2');
  const text = (inp?.value || '').trim();
  if (!text) { showStatus('Kirjoita viesti ensin!', '#f97316'); return; }
  if (!confirm('Lähetetäänkö viesti kaikille pelaajille?')) return;
  try {
    await setDoc(BROADCAST_DOC, { active: true, text, seenBy: [ADMIN], ts: new Date().toISOString() });
    inp.value = '';
    showStatus('✅ Viesti lähetetty!', '#22c55e'); hideStatus();
    refreshBroadcastAdminUI2();
  } catch(e) { showStatus('❌ Lähetys epäonnistui', '#dc2626'); }
};

window._clearBroadcast2 = async function() {
  if (!confirm('Poistetaanko viesti?')) return;
  await setDoc(BROADCAST_DOC, { active: false, text: '', seenBy: [] });
  showStatus('✅ Viesti poistettu', '#22c55e'); hideStatus();
  refreshBroadcastAdminUI2();
};

// Badge: laske lukemattomat viestit adminille
function updateMsgBadge(count) {
  const badge = $('msgBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

async function checkUnreadMessages() {
  if (currentUser !== ADMIN) return;
  try {
    const snap = await getDoc(MESSAGES_DOC);
    const msgs = snap.exists() ? (snap.data().messages || []) : [];
    // Laske kuinka monta on tullut viimeisen tarkistuksen jälkeen
    const lastCheck = parseInt(localStorage.getItem('tv_msg_last') || '0');
    const unread = msgs.filter(m => new Date(m.ts).getTime() > lastCheck).length;
    updateMsgBadge(unread);
  } catch(e) {}
}

// Tarkista lukemattomat viestit kun paneeli avataan (nollaa badge)
const origOpenMsgPanel = window._openMsgPanel;
window._openMsgPanel = async function() {
  localStorage.setItem('tv_msg_last', Date.now().toString());
  updateMsgBadge(0);
  await origOpenMsgPanel();
};

// ============================
// PELAAJAN VIESTIT-PANEELI
// ============================
window._openPlayerMsgPanel = async function() {
  localStorage.setItem('tv_player_msg_last', Date.now().toString());
  updatePlayerMsgBadge(0);
  const panel = document.getElementById('playerMsgPanel');
  if (panel) panel.style.display = 'flex';
  await _loadPlayerMsgPanel();
};

async function _loadPlayerMsgPanel() {
  // Broadcast
  try {
    const snap = await getDoc(BROADCAST_DOC);
    const bcEl = document.getElementById('playerBroadcastContent');
    if (bcEl) {
      if (snap.exists() && snap.data().active && snap.data().text) {
        const bc = snap.data();
        const ts = bc.ts ? new Date(bc.ts).toLocaleString('fi-FI',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
        bcEl.innerHTML = `<div style="border:1px solid #7c3aed33;border-radius:10px;padding:10px;background:var(--bg)">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px">
            <span style="font-weight:700;font-size:13px;color:#7c3aed">📢 Tero</span>
            <span style="font-size:11px;color:var(--muted)">${ts}</span>
          </div>
          <div style="font-size:14px;line-height:1.5">${bc.text.replace(/</g,'&lt;')}</div>
        </div>`;
      } else {
        bcEl.innerHTML = '<p class="muted" style="font-size:13px">Ei aktiivista yleisviestiä.</p>';
      }
    }
  } catch(e) {}

  // Yksityisviestit adminilta — pelaaja voi poistaa
  try {
    const dmDoc = doc(db, 'app', 'dm_' + currentUser);
    const snap = await getDoc(dmDoc);
    const dmEl = document.getElementById('playerDMList');
    if (dmEl) {
      const dms = snap.exists() ? (snap.data().messages || []) : [];
      if (!dms.length) {
        dmEl.innerHTML = '<p class="muted" style="font-size:13px">Ei yksityisviestejä.</p>';
      } else {
        dmEl.innerHTML = [...dms].reverse().map((m, i, arr) => {
          const origIdx = dms.length - 1 - i;
          return `<div style="border:1px solid #0ea5e933;border-radius:10px;padding:10px;margin-bottom:8px;background:var(--bg)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
              <span style="font-weight:700;font-size:13px;color:#0ea5e9">👑 Tero</span>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:11px;color:var(--muted)">${new Date(m.ts).toLocaleString('fi-FI',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
                <button onclick="window._deletePlayerDM(${origIdx})" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--muted);padding:0;line-height:1" title="Poista">🗑️</button>
              </div>
            </div>
            <div style="font-size:14px;line-height:1.5">${m.text.replace(/</g,'&lt;')}</div>
          </div>`;
        }).join('');
      }
    }
  } catch(e) {}

  // Omat lähetetyt viestit
  try {
    const snap = await getDoc(MESSAGES_DOC);
    const msgs = snap.exists() ? (snap.data().messages || []) : [];
    const myMsgs = msgs.filter(m => m.from === currentUser);
    const sentEl = document.getElementById('playerSentList');
    if (sentEl) {
      if (!myMsgs.length) {
        sentEl.innerHTML = '<p class="muted" style="font-size:13px">Et ole lähettänyt viestejä.</p>';
      } else {
        sentEl.innerHTML = [...myMsgs].reverse().map(m => `
          <div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;background:var(--bg)">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px">
              <span style="font-weight:700;font-size:13px">${m.from}</span>
              <span style="font-size:11px;color:var(--muted)">${new Date(m.ts).toLocaleString('fi-FI',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
            </div>
            <div style="font-size:14px;line-height:1.5">${m.text.replace(/</g,'&lt;')}</div>
          </div>`).join('');
      }
    }
  } catch(e) {}
};

// Pelaaja poistaa adminilta tulleen yksityisviestin
window._deletePlayerDM = async function(idx) {
  if (!confirm('Poistetaanko viesti?')) return;
  try {
    const dmDoc = doc(db, 'app', 'dm_' + currentUser);
    const snap = await getDoc(dmDoc);
    if (!snap.exists()) return;
    const dms = snap.data().messages || [];
    dms.splice(idx, 1);
    await setDoc(dmDoc, { messages: dms });
    await _loadPlayerMsgPanel();
  } catch(e) { showStatus('❌ Poisto epäonnistui', '#dc2626'); }
};

function updatePlayerMsgBadge(count) {
  const badge = document.getElementById('playerMsgBadge');
  if (!badge) return;
  if (count > 0) { badge.textContent = count; badge.style.display = 'inline-block'; }
  else { badge.style.display = 'none'; }
}

async function checkPlayerUnread() {
  if (!currentUser || currentUser === ADMIN) return;
  const lastSeen = parseInt(localStorage.getItem('tv_player_msg_last') || '0');
  let unread = 0;
  try {
    // Tarkista yleisviesti
    const bcSnap = await getDoc(BROADCAST_DOC);
    if (bcSnap.exists() && bcSnap.data().active && bcSnap.data().ts) {
      if (new Date(bcSnap.data().ts).getTime() > lastSeen) unread++;
    }
    // Tarkista yksityisviestit
    const dmDoc = doc(db, 'app', 'dm_' + currentUser);
    const dmSnap = await getDoc(dmDoc);
    if (dmSnap.exists()) {
      const dms = dmSnap.data().messages || [];
      unread += dms.filter(m => new Date(m.ts).getTime() > lastSeen).length;
    }
  } catch(e) {}
  updatePlayerMsgBadge(unread);
}

buildLogin();
document.querySelectorAll('.pin-key').forEach(btn=>btn.addEventListener('click',()=>handlePinKey(btn.dataset.v)));

// Globaali blur-kuuntelija: jos onSnapshot-paivitys on odottamassa (kayttaja oli
// kentassa kun snapshot saapui), renderoidaan se kun kayttaja poistuu kentasta
document.addEventListener('blur', function() {
  setTimeout(function() {
    const ae = document.activeElement;
    const stillEditing = ae && (ae.tagName==='INPUT' || ae.tagName==='SELECT' || ae.tagName==='TEXTAREA');
    if(!stillEditing && window._pendingSnapshotData) {
      var pending = window._pendingSnapshotData;
      window._pendingSnapshotData = null;
      if(!isSaving) {
        try {
          var prevTid=tid, prevMid=mid;
          data = pending;
          if(!data.tournaments) data.tournaments=[];
          var tOk = prevTid && data.tournaments.find(function(t){ return String(t.id)===String(prevTid); });
          if(tOk){
            tid=prevTid;
            var tObj=data.tournaments.find(function(t){ return String(t.id)===String(prevTid); });
            var mOk = prevMid && (tObj.matches||[]).find(function(m){ return String(m.id)===String(prevMid); });
            mid = mOk ? prevMid : null;
          } else {
            tid=data.selectedTournamentId||null;
            mid=data.selectedMatchId||null;
          }
          render();
        }catch(e){}
      }
    }
  }, 100);
}, true); // capture-vaiheessa jotta toimii myos select-elementeilla

const savedUser=localStorage.getItem('tv_user');
if(savedUser && PLAYERS.includes(savedUser)) doLogin(savedUser);

// ============================
// NÄKYMÄT: alapalkki + hash-reititys + globaali countdown
// ============================
const _TABS = ['veikkaa','tulokset','kolmenkarki','lisaa'];

function _applyTab(tab){
  if(!_TABS.includes(tab)) tab = 'veikkaa';
  var prev = document.body.dataset.tab;
  var dir = 0;
  if(prev && prev!==tab){ dir = _TABS.indexOf(tab) > _TABS.indexOf(prev) ? 1 : -1; }
  document.body.dataset.tab = tab;
  document.querySelectorAll('.bottomnav-item').forEach(b=>{
    b.classList.toggle('active', b.dataset.tab===tab);
  });
  window.scrollTo(0,0);
  if(dir!==0) _animateViewSlide(dir);
}
var _vslideT = null;
function _animateViewSlide(dir){
  var b = document.body;
  b.classList.remove('vslide-r','vslide-l');
  void b.offsetWidth;              // pakota reflow → animaatio re-triggeröityy joka vaihdolla
  b.classList.add(dir>0 ? 'vslide-r' : 'vslide-l');
  clearTimeout(_vslideT);
  _vslideT = setTimeout(function(){ b.classList.remove('vslide-r','vslide-l'); }, 600);
}

// Navigointi napista: muuttaa hashia → syntyy historiamerkintä → selaimen takaisin-nappi toimii
window._setTab = function(tab){
  if(!_TABS.includes(tab)) tab = 'veikkaa';
  if(location.hash !== '#'+tab){ location.hash = tab; }  // laukaisee hashchange → _applyTab
  else { _applyTab(tab); }
};

function _handleHash(){
  const h = (location.hash||'').replace('#','').trim();
  _applyTab(_TABS.includes(h) ? h : 'veikkaa');
}
window.addEventListener('hashchange', _handleHash);

// ----- GLOBAALI COUNTDOWN: seuraava lukittuva ottelu -----
let _gcdTimer = null;
function _nextLockingMatch(){
  const t = getTournament(); if(!t) return null;
  const now = Date.now();
  const future = (t.matches||[])
    .filter(m=>m.startTime && new Date(m.startTime).getTime() > now)
    .sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
  return future[0]||null;
}
function _updateGlobalCountdown(){
  const box = document.getElementById('globalCountdown');
  if(!box) return;
  const m = _nextLockingMatch();
  if(!m){ box.style.display='none'; box.innerHTML=''; return; }
  const diff = new Date(m.startTime).getTime() - Date.now();
  if(diff <= 0){ box.style.display='none'; box.innerHTML=''; return; }
  const totalS = Math.floor(diff/1000);
  const d = Math.floor(totalS/86400);
  const h = Math.floor((totalS%86400)/3600);
  const mi = Math.floor((totalS%3600)/60);
  const s = totalS%60;
  const pad = n=>String(n).padStart(2,'0');
  let time;
  if(d>0)       time = d+'pv '+pad(h)+':'+pad(mi)+':'+pad(s);
  else if(h>0)  time = pad(h)+':'+pad(mi)+':'+pad(s);
  else          time = pad(mi)+':'+pad(s);
  const name = (m.name||'').toString();
  box.style.display='flex';
  box.innerHTML =
    '<span class="gcd-label">⏳ Seuraava lukitus</span>'+
    '<span class="gcd-match">'+ (name? ('SUOMI–'+name) : 'Ottelu') +'</span>'+
    '<span class="gcd-time">'+ time +'</span>';
}
window._startGlobalCountdown = function(){
  if(_gcdTimer) clearInterval(_gcdTimer);
  _updateGlobalCountdown();
  _gcdTimer = setInterval(_updateGlobalCountdown, 1000);
};

window._initViews = function(){
  _handleHash();              // aseta välilehti hashista (oletus veikkaa)
  window._startGlobalCountdown();
};

// Jos käyttäjä oli jo kirjautuneena (sessio), varmista välilehti
if(document.getElementById('appScreen') && document.getElementById('appScreen').style.display !== 'none'){
  window._initViews();
}

// ============================
// NAPIT
// ============================
$('createTournament').onclick=()=>{
  const name=$('newTournamentName').value.trim(); if(!name){alert('Anna nimi');return;}
  const id=Date.now().toString();
  data.tournaments.push({id,name,matches:[],predictions:{},actuals:{},topThreePrediction:{},actualTopThree:[],players:DEFAULT_ROSTER.slice()});
  tid=id; mid=null; saveSelections(); saveStructure(); render(); $('newTournamentName').value='';
};
$('finishTournament').onclick=()=>{
  const t=getTournament(); if(!t) return;
  if(!confirm('Päätä turnaus "'+t.name+'"?')) return;
  t.finished=true; saveStructure(); render();
};
$('deleteTournament').onclick=()=>{
  const t=getTournament(); if(!t) return;
  if(!confirm('Poistetaanko turnaus "'+t.name+'" ja kaikki sen data? Tätä ei voi peruuttaa!')) return;
  data.tournaments=data.tournaments.filter(x=>String(x.id)!==String(tid));
  tid=null; mid=null; saveSelections(); saveStructure(); render();
};
var _addPlayerBtn=$('addPlayerBtn'); if(_addPlayerBtn) _addPlayerBtn.onclick=addRosterPlayer;
var _newPlayerName=$('newPlayerName'); if(_newPlayerName) _newPlayerName.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); addRosterPlayer(); } });
var _rosterToggle=$('rosterToggle'); if(_rosterToggle) _rosterToggle.onclick=function(){ rosterCollapsed=!rosterCollapsed; renderRosterAdmin(); };
$('createMatch').onclick=()=>{
  const t=getTournament(); if(!t){alert('Luo ensin turnaus');return;}
  const rawName=$('newMatchName').value.trim().toUpperCase(); if(!rawName){alert('Anna vastustajan nimi');return;}
  const name='SUOMI vs '+rawName;
  const tv=$('newMatchTime').value; if(!tv){alert('Aseta pelin alkuaika');return;}
  const id=Date.now().toString();
  t.matches.push({id,name,startTime:new Date(tv).toISOString()});
  t.predictions=t.predictions||{}; t.actuals=t.actuals||{};
  mid=id; saveSelections(); saveStructure(); render(); $('newMatchName').value=''; $('newMatchTime').value='';
};
$('deleteMatch').onclick=()=>{
  const t=getTournament(); if(!t||!mid) return;
  const match=getMatch(); if(!match) return;
  if(!confirm('Poistetaanko ottelu "'+match.name+'"? Tätä ei voi peruuttaa!')) return;
  t.matches=t.matches.filter(m=>String(m.id)!==String(mid));
  delete (t.predictions||{})[mid]; delete (t.actuals||{})[mid];
  mid=null; saveSelections(); saveStructure(); render();
};
$('refreshCheck').onclick=()=>{ saveStructure(); savePredictions(currentUser); renderScoreboard(); renderPredictions(); };
$('saveTopThree').onclick=()=>{ saveStructure(); savePredictions(currentUser); };
// Export-funktio (käytetään myös asetusmodaalista)
window._doExport = function() {
  const b=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download='turnausveikkaus_data.json';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
};
$('exportBtn').onclick = window._doExport;
$('exportBtn2') && ($('exportBtn2').onclick = window._doExport);

function doImportFile(file) {
  if (!file) return;
  const r=new FileReader();
  r.onload=async()=>{
    try{
      const obj=JSON.parse(r.result);
      data=obj; tid=data.selectedTournamentId||null; mid=null;
      showStatus('💾 Tallennetaan rakennetta…','#f97316');
      await saveStructure();
      for(const p of PLAYERS){
        showStatus('💾 Tallennetaan: '+p+'…','#f97316');
        await savePredictions(p);
      }
      render();
      showStatus('✅ Tuonti onnistui! Kaikki '+PLAYERS.length+' pelaajaa tallennettu.','#22c55e');
      hideStatus();
    }
    catch(er){ showStatus('❌ Virhe: '+er.message,'#dc2626'); }
  };
  r.readAsText(file,'utf-8');
}
$('importBtn').onclick=()=>$('importFile').click();
$('importFile').addEventListener('change',e=>{ doImportFile(e.target.files[0]); });
// Asetusmodaalin import – käyttää samaa doImportFile-funktiota
// HUOM: importFile2:lla on jo onchange-kuuntelija ylempänä – ei lisätä toista

let t3v=localStorage.getItem('tv_top3')!=='0';
function applyT3(){ $('topThreeArea').style.display=t3v?'':'none'; $('saveTop3Row').style.display=t3v?'':'none'; $('toggleTop3').textContent=t3v?'Piilota':'Näytä'; }
$('toggleTop3').onclick=()=>{ t3v=!t3v; localStorage.setItem('tv_top3',t3v?'1':'0'); applyT3(); }; applyT3();

let pinsVisible=localStorage.getItem('tv_pins')!=='0';
function applyPinsToggle(){ const a=$('pinManageArea'),b=$('togglePins'); if(!a||!b) return; a.style.display=pinsVisible?'':'none'; b.textContent=pinsVisible?'Piilota':'Näytä'; }
const tpBtn=$('togglePins'); if(tpBtn) tpBtn.addEventListener('click',()=>{ pinsVisible=!pinsVisible; localStorage.setItem('tv_pins',pinsVisible?'1':'0'); applyPinsToggle(); }); applyPinsToggle();

