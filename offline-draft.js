// offline-draft.js — Penyimpanan draft jurnal saat offline + auto-sync
// Taruh file ini sejajar dengan dashboard.html, lalu tambahkan
//   <script src="offline-draft.js"></script>
// SEBELUM tag <script> utama dashboard.html (yang berisi fungsi simpan()).

const DRAFT_KEY = 'jmo_draft_jurnal_pending';

// Ambil semua draft yang masih menunggu dikirim
function ambilDraftPending() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]');
  } catch {
    return [];
  }
}

// Simpan satu draft baru ke antrian lokal
function simpanDraftLokal(payload) {
  const semua = ambilDraftPending();
  semua.push({
    id: 'draft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    dibuatPada: new Date().toISOString(),
    payload,
  });
  localStorage.setItem(DRAFT_KEY, JSON.stringify(semua));
  return semua;
}

// Hapus satu draft dari antrian (setelah berhasil dikirim)
function hapusDraftLokal(draftId) {
  const semua = ambilDraftPending().filter((d) => d.id !== draftId);
  localStorage.setItem(DRAFT_KEY, JSON.stringify(semua));
}

// Tampilkan indikator jumlah draft yang masih tertunda.
// Menyisipkan sebuah badge kecil di pojok kanan atas halaman;
// silakan sesuaikan style-nya dengan tema JMO kalau perlu.
function tampilkanIndikatorDraft() {
  const jumlah = ambilDraftPending().length;
  let badge = document.getElementById('draftPendingBadge');

  if (jumlah === 0) {
    if (badge) badge.remove();
    return;
  }

  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'draftPendingBadge';
    badge.style.cssText =
      'position:fixed;top:12px;right:12px;z-index:9999;background:#b45309;' +
      'color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer;';
    badge.title = 'Klik untuk coba kirim ulang sekarang';
    badge.addEventListener('click', () => sinkronkanDraftPending(true));
    document.body.appendChild(badge);
  }
  badge.textContent = `📥 ${jumlah} jurnal draft belum tersinkron`;
}

// Coba kirim semua draft yang tertunda ke Supabase.
// Dipanggil otomatis saat koneksi kembali online, dan bisa dipanggil
// manual lewat klik badge di atas.
async function sinkronkanDraftPending(manual = false) {
  const semua = ambilDraftPending();
  if (!semua.length) return;
  if (!navigator.onLine) {
    if (manual) showToast?.('err', 'Masih offline, coba lagi nanti.');
    return;
  }

  for (const draft of semua) {
    try {
      const { guru_id, kelas_id, tanggal, hari, jam_ke, mapel, materi, siswaPayload } =
        draft.payload;

      const { data: baru, error } = await db
        .from('jurnal')
        .insert({ guru_id, kelas_id, tanggal, hari, jam_ke, mapel, materi })
        .select()
        .single();
      if (error) throw error;

      if (siswaPayload?.length) {
        const rows = siswaPayload.map((s) => ({
          jurnal_id: baru.id,
          siswa_id: s.siswa_id,
          status: s.status,
          keterangan: s.keterangan,
          poin: s.poin,
        }));
        const { error: errAbsen } = await db.from('absensi').insert(rows);
        if (errAbsen) throw errAbsen;
      }

      hapusDraftLokal(draft.id);
    } catch (err) {
      // Kalau salah satu draft gagal (misal koneksi putus lagi di tengah jalan),
      // hentikan loop — sisanya dicoba lagi nanti, tidak dihapus dari antrian.
      console.warn('Sinkronisasi draft gagal, akan dicoba lagi nanti:', err);
      break;
    }
  }

  tampilkanIndikatorDraft();
  if (manual && !ambilDraftPending().length) {
    showToast?.('ok', 'Semua draft berhasil disinkronkan.');
  }
}

// Jalankan otomatis saat koneksi kembali online
window.addEventListener('online', () => sinkronkanDraftPending(false));

// Cek & tampilkan indikator saat halaman pertama kali dibuka
window.addEventListener('DOMContentLoaded', () => {
  tampilkanIndikatorDraft();
  if (navigator.onLine) sinkronkanDraftPending(false);
});
