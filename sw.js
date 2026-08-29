// sw.js -- Service Worker untuk JMO (versi 3, perbaikan redirect Cloudflare Pages)
// Taruh file ini di ROOT folder deploy Cloudflare Pages
//
// PERBAIKAN dari versi 2:
// - Path app shell diubah TANPA ".html" (mis. "/dashboard" bukan
//   "/dashboard.html"), karena Cloudflare Pages otomatis me-redirect
//   permintaan *.html ke versi tanpa ekstensi. Meminta langsung path
//   tanpa ekstensi menghindari redirect itu sama sekali.
// - Ditambahkan pengaman "stripRedirect": kalau SUATU SAAT tetap ada
//   respons yang berstatus redirected (misal karena alur login/auth
//   nanti), responsnya dibangun ulang dari awal sebelum dikembalikan
//   ke browser -- supaya tidak pernah lagi muncul error
//   "a redirected response was used for a request whose redirect
//   mode is not follow".

const CACHE_NAME = 'jmo-shell-v3';

const APP_SHELL = [
  '/',
  '/dashboard',
  '/papan-poin',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

const OFFLINE_FALLBACK_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>JMO - Offline</title></head>
<body style="font-family:sans-serif;padding:24px;text-align:center;">
<h2>Sedang offline</h2>
<p>Halaman ini belum pernah dibuka sebelumnya di perangkat ini,
sehingga belum tersimpan untuk mode offline. Coba buka kembali
saat ada koneksi internet.</p>
</body></html>`;

// Bangun ulang Response dari awal supaya flag "redirected" hilang.
// Ini WAJIB dilakukan sebelum respondWith() untuk request navigasi,
// kalau tidak, browser akan menolak dengan ERR_FAILED.
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

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      try {
        const fresh = await fetch(event.request);
        const clean = await stripRedirectFlag(fresh);

        if (APP_SHELL.includes(url.pathname) || url.pathname === '/') {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, clean.clone()).catch(() => {});
        }
        return clean;
      } catch (err) {
        if (event.request.mode === 'navigate') {
          const fallbackDashboard = await caches.match('/dashboard');
          if (fallbackDashboard) return fallbackDashboard;
          return new Response(OFFLINE_FALLBACK_HTML, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })(),
  );
});
