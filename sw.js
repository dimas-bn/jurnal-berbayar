// sw.js -- Service Worker untuk JMO (versi 2, sudah diperbaiki)
// Taruh file ini di ROOT folder deploy Cloudflare Pages
// (sejajar dengan index.html, dashboard.html, manifest.json)
//
// PERBAIKAN dari versi 1:
// - Caching app shell sekarang per-file (bukan all-or-nothing),
//   supaya 1 file gagal di-download tidak menggagalkan semuanya.
// - Fetch handler sekarang SELALU mengembalikan Response yang valid,
//   tidak pernah "undefined" -- itu penyebab error ERR_FAILED
//   yang muncul di sinyal lemah/flaky.

const CACHE_NAME = 'jmo-shell-v2'; // dinaikkan ke v2 supaya cache lama dibuang

const APP_SHELL = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/papan-poin.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// Halaman fallback sederhana kalau BENAR-BENAR tidak ada apa pun
// yang bisa ditampilkan (belum pernah online sama sekali di alat ini).
const OFFLINE_FALLBACK_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>JMO - Offline</title></head>
<body style="font-family:sans-serif;padding:24px;text-align:center;">
<h2>Sedang offline</h2>
<p>Halaman ini belum pernah dibuka sebelumnya di perangkat ini,
sehingga belum tersimpan untuk mode offline. Coba buka kembali
saat ada koneksi internet.</p>
</body></html>`;

// ==== INSTALL: simpan app shell ke cache, PER FILE (tidak all-or-nothing) ====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        APP_SHELL.map((path) =>
          cache.add(path).catch((err) => {
            // Kalau satu file gagal (misal sinyal lemah saat itu),
            // catat di console tapi JANGAN gagalkan file lainnya.
            console.warn('[SW] Gagal cache saat install:', path, err);
          }),
        ),
      );
    }),
  );
  self.skipWaiting();
});

// ==== ACTIVATE: bersihkan cache versi lama ====
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

// ==== FETCH ====
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Request ke Supabase TIDAK diintersep sama sekali -- biarkan
  // browser tangani apa adanya, supaya data selalu yang terbaru
  // dan tidak pernah "nyasar" ke logika cache di bawah.
  if (url.hostname.endsWith('.supabase.co')) {
    return;
  }

  // Hanya tangani GET -- request POST/PUT dsb dibiarkan lewat SW
  // (jarang dipakai untuk asset, dan lebih aman tidak diintersep).
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    (async () => {
      // 1. Coba dari cache dulu
      const cached = await caches.match(event.request);
      if (cached) return cached;

      // 2. Coba dari network
      try {
        const fresh = await fetch(event.request);
        // Simpan salinan ke cache untuk dipakai lagi nanti offline
        // (hanya untuk file app shell, supaya cache tidak membengkak
        // dengan request Supabase/aset lain yang tidak relevan).
        if (APP_SHELL.includes(url.pathname) || url.pathname === '/') {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (err) {
        // 3. Network gagal (offline / sinyal putus) DAN tidak ada di cache.
        //    Untuk navigasi halaman, tampilkan fallback dashboard.html
        //    kalau ada, atau halaman "sedang offline" sederhana.
        if (event.request.mode === 'navigate') {
          const fallbackDashboard = await caches.match('/dashboard.html');
          if (fallbackDashboard) return fallbackDashboard;
          return new Response(OFFLINE_FALLBACK_HTML, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        // Untuk request non-navigasi (gambar, dsb) yang gagal total,
        // kembalikan respons error yang VALID (bukan undefined),
        // supaya tidak muncul ERR_FAILED.
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })(),
  );
});
