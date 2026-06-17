// KULJU CUP – push-ilmoitusten lähetin (GitHub Actions ajaa 15 min välein)
// Lukee otteluajat + tilaukset Firestoresta ja lähettää:
//   • Aamukooste klo 9 (vain jos päivänä on tulevia otteluita)
//   • Muistutus tunti ennen ottelua
//   • Ilmoitus kun veikkaukset lukittuvat (ottelu alkaa)
// Deduplikointi: app/pushSent estää saman ilmoituksen lähetyksen kahdesti.

const admin = require('firebase-admin');
const webpush = require('web-push');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

const now = Date.now();
const MIN = 60 * 1000;

// Suomen ajan osat (kellonaika + päivämäärä) annetulle hetkelle
function fi(d) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const p = {}; f.formatToParts(d).forEach(x => p[x.type] = x.value);
  return { hour: +p.hour, minute: +p.minute, date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}.${p.minute}` };
}

(async () => {
  // 1) Otteludata
  const dataSnap = await db.collection('app').doc('data').get();
  if (!dataSnap.exists) { console.log('Ei dataa.'); return; }
  let parsed;
  try { parsed = JSON.parse(dataSnap.data().json || '{}'); } catch (e) { console.log('JSON-virhe.'); return; }
  const tournaments = parsed.tournaments || [];
  const activeId = parsed.selectedTournamentId;
  const tournament = tournaments.find(t => String(t.id) === String(activeId)) || tournaments.find(t => !t.finished && !t.historical);
  if (!tournament) { console.log('Ei aktiivista turnausta.'); return; }
  const matches = (tournament.matches || []).filter(m => m && m.startTime);

  // 2) Tilaukset
  const subsSnap = await db.collection('app').doc('pushSubs').get();
  const subsRaw = subsSnap.exists ? (subsSnap.data() || {}) : {};
  const subs = Object.entries(subsRaw).filter(([, s]) => s && s.endpoint);
  if (!subs.length) { console.log('Ei tilaajia.'); return; }

  // 3) Jo lähetetyt
  const sentSnap = await db.collection('app').doc('pushSent').get();
  const sent = sentSnap.exists ? (sentSnap.data() || {}) : {};

  const toSend = [];   // { key, title, body }

  // --- Aamukooste klo 9 (Suomen aika 9:00–9:29) ---
  const nowFi = fi(new Date(now));
  if (nowFi.hour === 9 && nowFi.minute < 30) {
    const todays = matches
      .filter(m => fi(new Date(m.startTime)).date === nowFi.date && new Date(m.startTime).getTime() > now)
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    if (todays.length) {
      const key = 'morning_' + nowFi.date;
      if (!sent[key]) {
        const lines = todays.map(m => `${m.name} klo ${fi(new Date(m.startTime)).hhmm}`).join('\n');
        toSend.push({ key, title: '🏒 Tänään pelataan!', body: lines + '\nMuista veikata ajoissa.' });
      }
    }
  }

  // --- Tunti ennen & lukitus (per ottelu) ---
  for (const m of matches) {
    const st = new Date(m.startTime).getTime();
    const diff = st - now; // ms ottelun alkuun

    // Tunti ennen: 50–75 min ennen alkua
    if (diff <= 75 * MIN && diff >= 50 * MIN) {
      const key = 'hour_' + m.id;
      if (!sent[key]) toSend.push({ key, title: '⏰ Tunti aikaa veikata!', body: `${m.name} alkaa klo ${fi(new Date(st)).hhmm}. Muista veikata.` });
    }
    // Lukitus: alkamishetki (-15…+5 min)
    if (diff <= 5 * MIN && diff >= -15 * MIN) {
      const key = 'lock_' + m.id;
      if (!sent[key]) toSend.push({ key, title: '🔒 Veikkaukset lukittu', body: `${m.name} alkoi – veikkaukset on nyt lukittu.` });
    }
  }

  if (!toSend.length) { console.log('Ei lähetettävää.', nowFi.hhmm); return; }

  // 4) Lähetä
  const deadSubs = [];
  for (const msg of toSend) {
    const payload = JSON.stringify({ title: msg.title, body: msg.body, url: './' });
    for (const [player, sub] of subs) {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) deadSubs.push(player); // vanhentunut tilaus
      }
    }
    sent[msg.key] = now;
    console.log('Lähetetty:', msg.key, '→', msg.title);
  }

  // 5) Merkitse lähetetyt + siivoa yli 3 vrk vanhat avaimet
  const cutoff = now - 3 * 24 * 60 * MIN;
  for (const k of Object.keys(sent)) { if (sent[k] < cutoff) delete sent[k]; }
  await db.collection('app').doc('pushSent').set(sent);

  // 6) Poista vanhentuneet tilaukset
  if (deadSubs.length) {
    const upd = {};
    deadSubs.forEach(p => { upd[p] = admin.firestore.FieldValue.delete(); });
    await db.collection('app').doc('pushSubs').set(upd, { merge: true });
    console.log('Poistettu vanhentuneet tilaukset:', deadSubs.join(', '));
  }
})().catch(e => { console.error('Virhe:', e); process.exit(1); });
