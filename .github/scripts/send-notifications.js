// KULJU CUP – push-ilmoitusten lähetin (GitHub Actions ajaa 5 min välein)
// Lähettää: aamukooste klo 9, muistutus tunti ennen, lukitus ottelun alkaessa
// + admin-ilmoitukset (app/pushOutbox: heti tai ajastettuna, valituille pelaajille)
// Deduplikointi: app/pushSent estää saman otteluilmoituksen kahdesti.

const admin = require('firebase-admin');
const webpush = require('web-push');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

const now = Date.now();
const MIN = 60 * 1000;

function fi(d) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const p = {}; f.formatToParts(d).forEach(x => p[x.type] = x.value);
  return { hour: +p.hour, minute: +p.minute, date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}.${p.minute}` };
}

async function sendTo(player, subsRaw, payload, deadSubs) {
  const sub = subsRaw[player];
  if (!sub || !sub.endpoint) return;
  try { await webpush.sendNotification(sub, payload); }
  catch (err) { if (err.statusCode === 404 || err.statusCode === 410) deadSubs.push(player); }
}

(async () => {
  // Tilaukset
  const subsSnap = await db.collection('app').doc('pushSubs').get();
  const subsRaw = subsSnap.exists ? (subsSnap.data() || {}) : {};
  const players = Object.keys(subsRaw).filter(p => subsRaw[p] && subsRaw[p].endpoint);
  const deadSubs = [];

  // ===== 1) Admin-ilmoitukset (pushOutbox) =====
  const obSnap = await db.collection('app').doc('pushOutbox').get();
  let outbox = obSnap.exists ? (obSnap.data().items || []) : [];
  let obChanged = false;
  for (const it of outbox) {
    if (it.sent) continue;
    if (it.sendAt && it.sendAt > now) continue;  // ajastettu, ei vielä
    const payload = JSON.stringify({ title: it.title || 'KULJU CUP', body: it.body || '', url: './' });
    for (const player of (it.recipients || [])) await sendTo(player, subsRaw, payload, deadSubs);
    it.sent = true; it.sentAt = now; obChanged = true;
    console.log('Admin-ilmoitus lähetetty:', it.title, '→', (it.recipients || []).join(', '));
  }
  // siivoa yli 7 vrk vanhat lähetetyt
  const obCut = now - 7 * 24 * 60 * MIN;
  const obClean = outbox.filter(it => !(it.sent && (it.sentAt || it.created || 0) < obCut));
  if (obClean.length !== outbox.length) obChanged = true;
  if (obChanged) await db.collection('app').doc('pushOutbox').set({ items: obClean });

  // ===== 2) Automaattiset otteluilmoitukset =====
  const dataSnap = await db.collection('app').doc('data').get();
  let toSend = [];
  let sent = {};
  if (dataSnap.exists) {
    let parsed = {};
    try { parsed = JSON.parse(dataSnap.data().json || '{}'); } catch (e) {}
    const tournaments = parsed.tournaments || [];
    const activeId = parsed.selectedTournamentId;
    const tournament = tournaments.find(t => String(t.id) === String(activeId)) || tournaments.find(t => !t.finished && !t.historical);
    const matches = tournament ? (tournament.matches || []).filter(m => m && m.startTime) : [];

    const sentSnap = await db.collection('app').doc('pushSent').get();
    sent = sentSnap.exists ? (sentSnap.data() || {}) : {};

    // Aamukooste klo 9 (Suomen aika 9:00–9:29)
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
    // Tunti ennen & lukitus
    for (const m of matches) {
      const st = new Date(m.startTime).getTime();
      const diff = st - now;
      if (diff <= 75 * MIN && diff >= 50 * MIN) {
        const key = 'hour_' + m.id;
        if (!sent[key]) toSend.push({ key, title: '⏰ Tunti aikaa veikata!', body: `${m.name} alkaa klo ${fi(new Date(st)).hhmm}. Muista veikata.` });
      }
      if (diff <= 5 * MIN && diff >= -15 * MIN) {
        const key = 'lock_' + m.id;
        if (!sent[key]) toSend.push({ key, title: '🔒 Veikkaukset lukittu', body: `${m.name} alkoi – veikkaukset on nyt lukittu.` });
      }
    }
  }

  // Lähetä otteluilmoitukset kaikille tilaajille
  for (const msg of toSend) {
    const payload = JSON.stringify({ title: msg.title, body: msg.body, url: './' });
    for (const player of players) await sendTo(player, subsRaw, payload, deadSubs);
    sent[msg.key] = now;
    console.log('Lähetetty:', msg.key, '→', msg.title);
  }
  if (toSend.length) {
    const cutoff = now - 3 * 24 * 60 * MIN;
    for (const k of Object.keys(sent)) { if (sent[k] < cutoff) delete sent[k]; }
    await db.collection('app').doc('pushSent').set(sent);
  }

  // Poista vanhentuneet tilaukset
  if (deadSubs.length) {
    const upd = {};
    [...new Set(deadSubs)].forEach(p => { upd[p] = admin.firestore.FieldValue.delete(); });
    await db.collection('app').doc('pushSubs').set(upd, { merge: true });
    console.log('Poistettu vanhentuneet tilaukset:', [...new Set(deadSubs)].join(', '));
  }

  if (!toSend.length && !obChanged) console.log('Ei lähetettävää.', fi(new Date(now)).hhmm);
})().catch(e => { console.error('Virhe:', e); process.exit(1); });
