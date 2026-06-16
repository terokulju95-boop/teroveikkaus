// ── KULJU CUP – Service Worker ───────────────────────────────────────────────
// Strategia:
//   • HTML / navigaatio  → network-first  (käyttäjä saa AINA uusimman index.html:n
//                          kun on verkossa; offline-tilassa fallback välimuistiin)
//   • Muut staattiset     → cache-first   (ikonit, manifest – nopea lataus)
//   • Vanhat välimuistit siivotaan aktivoinnissa.
//
// HUOM: index.html:n voi nyt päivittää GitHubissa ILMAN että tähän tiedostoon
// tarvitsee koskea. Kasvata VERSIONia vain jos haluat pakottaa kaiken
// uudelleenlatauksen (esim. ikonit tai tiedostolista muuttuivat).

const VERSION = 'v18';
const CACHE   = 'kulju-' + VERSION;

// Suhteelliset polut – toimivat sekä juuressa että alipolussa (GitHub Pages).
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Vain oman originin pyynnöt; Firebase, Google-fontit yms. menevät suoraan verkkoon.
  if (url.origin !== self.location.origin) return;

  const isHTML =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // NETWORK-FIRST: hae verkosta, päivitä välimuisti, fallback offline-tilassa.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // CACHE-FIRST muille staattisille tiedostoille.
  e.respondWith(
    caches.match(req).then((r) =>
      r ||
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
    )
  );
});
