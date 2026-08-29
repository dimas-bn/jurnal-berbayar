// sw.js -- Service Worker untuk JMO (versi 4, fix: halaman selalu ambil versi terbaru)
// Taruh file ini di ROOT folder deploy Cloudflare Pages
//
// PERBAIKAN dari versi 3:
// - Versi 3 memakai strategi CACHE-FIRST untuk semua permintaan, termasuk
//   halaman /dashboard itu sendiri. Akibatnya, begitu /dashboard tersimpan
//   di cache HP, browser TIDAK PERNAH cek ke server lagi untuk halaman itu
//   -- update dashboard.html tidak pernah sampai ke HP walau sudah di-deploy,
//   kecuali sw.js ini sendiri ikut berubah (memicu browser re-download SW).
// - Versi 4 mengubah strategi untuk halaman (app shell yang dinavigasi:
//   "/", "/dashboard", "/papan-poin") menjadi NETWORK-FIRST: setiap dibuka
//   saat online, selalu ambil versi terbaru dari server dan perbarui cache.
//   Kalau sedang offline, baru jatuh ke versi cache terakhir yang tersimpan.
//   Aset statis (manifest, ikon) tetap CACHE-FIRST seperti sebelumnya,
//   karena jarang berubah dan tidak masalah disajikan dari cache.

const CACHE_NAME = 'jmo-shell-v4'; // dinaikkan dari v3 -> v4 supaya browser
                                     // sadar ada versi SW baru & langsung
                                     // membuang cache v3 yang lama/basi.

const APP_SHELL = [
  '/',
  '/dashboard',
  '/papan-poin',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// Path yang HARUS selalu network-first (halaman yang sering di-update)
const HALAMAN_NETWORK_FIRST = ['/', '/dashboard', '/papan-poin'];

const OFFLINE_FALLBACK_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>JMO - Offline</title></head>
<body style="font-family:sans-serif;padding:24px;text-align:center;">
<h2>Sedang offline</h2>
<p>Halaman ini belum pernah dibuka sebelumnya di perangkat ini,
sehingga belum tersimpan untuk mode offline. Coba buka kembali
saat ada koneksi internet.</p>
</body></html>`;

// Bangun ulang Response dari awal supaya flag "redirected" hilang.
async function stripRedirectFlag(response) {
  if (!response || !response.redirected) return response;
  const body = await response.clone().blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        APP_SHELL.map(async (path) => {
          try {
            const res = await fetch(path);
            const clean = await stripRedirectFlag(res);
            await cache.put(path, clean);
          } catch (err) {
            console.warn('[SW] Gagal cache saat install:', path, err);
          }
        }),
      );
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.hostname.endsWith('.supabase.co')) return;
  if (event.request.method !== 'GET') return;

  const isHalamanUtama =
    event.request.mode === 'navigate' || HALAMAN_NETWORK_FIRST.includes(url.pathname);

  // ===== HALAMAN APP SHELL: NETWORK-FIRST =====
  if (isHalamanUtama) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(event.request);
          const clean = await stripRedirectFlag(fresh);
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, clean.clone()).catch(() => {});
          return clean;
        } catch (err) {
          // Offline / gagal fetch -> pakai cache terakhir yang tersimpan
          const cached =
            (await caches.match(event.request)) || (await caches.match('/dashboard'));
          if (cached) return cached;
          return new Response(OFFLINE_FALLBACK_HTML, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
      })(),
    );
    return;
  }

  // ===== ASET STATIS LAIN (ikon, manifest, dll): CACHE-FIRST seperti semula =====
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      try {
        const fresh = await fetch(event.request);
        const clean = await stripRedirectFlag(fresh);
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, clean.clone()).catch(() => {});
        return clean;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })(),
  );
});
