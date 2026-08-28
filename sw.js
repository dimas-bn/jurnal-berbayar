// sw.js — Service Worker untuk JMO
// Taruh file ini di ROOT folder deploy Cloudflare Pages
// (sejajar dengan index.html, dashboard.html, manifest.json)

const CACHE_NAME = 'jmo-shell-v1';

// File-file "kerangka" aplikasi yang perlu bisa dibuka walau offline.
// Sesuaikan daftar ini kalau ada file HTML lain yang ingin didukung offline.
const APP_SHELL = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/papan-poin.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ==== INSTALL: simpan app shell ke cache ====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
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

// ==== FETCH: strategi beda untuk halaman vs API ====
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Request ke Supabase (data guru, jurnal, dll) SELALU lewat network,
  // tidak pernah di-cache — supaya data yang ditampilkan selalu yang terbaru
  // saat online. Kalau offline, request ini akan gagal secara wajar,
  // dan ditangani oleh logika draft di sisi aplikasi (bukan oleh service worker).
  if (url.hostname.endsWith('.supabase.co')) {
    return; // biarkan browser tangani apa adanya (tidak diintersep)
  }

  // Untuk file app shell (HTML/JSON/PNG di atas): coba cache dulu,
  // baru fallback ke network kalau belum ada di cache.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        // Kalau benar-benar offline dan belum pernah dibuka sebelumnya,
        // fallback ke dashboard.html supaya tidak muncul halaman putih kosong.
        if (event.request.mode === 'navigate') {
          return caches.match('/dashboard.html');
        }
      });
    }),
  );
});
