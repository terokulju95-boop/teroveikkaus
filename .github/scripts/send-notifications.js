// KULJU CUP – push-ilmoitusten lähetin (cron-job.org laukaisee n. 5 min välein)
// Lähettää: aamukooste klo 9, muistutus tunti ennen (55–65 min),
//           admin-ilmoitukset (pushOutbox), sekä uudet lukemattomat chat-viestit.
// Deduplikointi: pushSent (ottelut), pushOutbox.sent (admin), msgNotified (viestit).

const admin = require('firebase-admin');
const webpush = require('web-push');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

const now = Date.now();
const MIN = 60 * 1000;
const PLAYERS = ['Roosa', 'Timo', 'Tero', 'Tiina', 'Tepa', 'Äiti', 'Iskä'];

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
    if (it.sendAt && it.sendAt > now) continue;
    const payload = JSON.stringify({ title: it.title || 'KULJU CUP', body: it.body || '', url: './' });
    for (const player of (it.recipients || [])) await sendTo(player, subsRaw, payload, deadSubs);
    it.sent = true; it.sentAt = now; obChanged = true;
    console.log('Admin-ilmoitus lähetetty:', it.title, '→', (it.recipients || []).join(', '));
  }
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

    const nowFi = fi(new Date(now));
    if (nowFi.hour === 9) {
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
    for (const m of matches) {
      const st = new Date(m.startTime).getTime();
      const diff = st - now;
      if (diff >= 55 * MIN && diff <= 65 * MIN) {
        const key = 'hour_' + m.id;
        if (!sent[key]) toSend.push({ key, title: '⏰ Tunti aikaa veikata!', body: `${m.name} alkaa klo ${fi(new Date(st)).hhmm}. Muista veikata.` });
      }
    }
  }

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

  // ===== 3) Viesti-ilmoitukset (uudet lukemattomat chat-viestit) =====
  const FRESH = 15 * MIN;
  const msgCut = now - FRESH;
  const perPlayer = {};   // player -> Set lähettäjiä
  let notified = {};
  let notifiedChanged = false;

  // presence: älä ilmoita jos pelaaja juuri nyt sovelluksessa (aktiivinen < 2 min)
  let presence = {};
  try { const pSnap = await db.collection('app').doc('presence').get(); presence = pSnap.exists ? (pSnap.data() || {}) : {}; } catch (e) {}
  const isOnline = (p) => (presence[p] || 0) > now - 2 * MIN;

  try { const nSnap = await db.collection('app').doc('msgNotified').get(); notified = nSnap.exists ? (nSnap.data() || {}) : {}; } catch (e) {}

  try {
    // vain keskustelut joissa on tuoretta aktiviteettia -> säästää lukuja
    const convSnap = await db.collection('conversations').where('updated', '>', msgCut).get();
    convSnap.forEach(docSnap => {
      const convId = docSnap.id;
      const d = docSnap.data() || {};
      const messages = d.messages || [];
      const reads = d.reads || {};
      const participants = convId === 'ryhma' ? PLAYERS : convId.split('__');
      for (const P of participants) {
        const sub = subsRaw[P];
        if (!sub || !sub.endpoint) continue;
        if (isOnline(P)) continue;
        const key = convId + '||' + P;
        const lastNotif = notified[key] || 0;
        const lastRead = reads[P] || 0;
        let maxTs = 0; const senders = [];
        for (const m of messages) {
          if (!m || m.system || m.deleted || m.from === P) continue;
          const ts = m.ts || 0;
          if (ts <= lastRead || ts <= lastNotif || ts < msgCut) continue;
          if (ts > maxTs) maxTs = ts;
          if (senders.indexOf(m.from) === -1) senders.push(m.from);
        }
        if (maxTs > 0) {
          if (!perPlayer[P]) perPlayer[P] = new Set();
          senders.forEach(s => perPlayer[P].add(s));
          notified[key] = maxTs;
          notifiedChanged = true;
        }
      }
    });
  } catch (e) { console.error('Viesti-ilmoitus virhe:', e.message); }

  for (const P of Object.keys(perPlayer)) {
    const senders = [...perPlayer[P]];
    let title, body;
    if (senders.length === 1) { title = '💬 Uusi viesti'; body = senders[0] + ' lähetti sinulle viestin.'; }
    else { title = '💬 Uusia viestejä'; body = 'Lähettäjät: ' + senders.join(', ') + '.'; }
    await sendTo(P, subsRaw, JSON.stringify({ title, body, url: './' }), deadSubs);
    console.log('Viesti-ilmoitus:', P, '←', senders.join(', '));
  }
  if (notifiedChanged) {
    const nCut = now - 7 * 24 * 60 * MIN;
    for (const k of Object.keys(notified)) { if (notified[k] < nCut) delete notified[k]; }
    await db.collection('app').doc('msgNotified').set(notified);
  }

  // ===== Vanhentuneet tilaukset =====
  if (deadSubs.length) {
    const upd = {};
    [...new Set(deadSubs)].forEach(p => { upd[p] = admin.firestore.FieldValue.delete(); });
    await db.collection('app').doc('pushSubs').set(upd, { merge: true });
    console.log('Poistettu vanhentuneet tilaukset:', [...new Set(deadSubs)].join(', '));
  }

  if (!toSend.length && !obChanged && !Object.keys(perPlayer).length) console.log('Ei lähetettävää.', fi(new Date(now)).hhmm);
})().catch(e => { console.error('Virhe:', e); process.exit(1); });
