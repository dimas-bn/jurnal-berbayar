-- ============================================================
-- MIGRASI: Streak Jurnal (hari berturut-turut jurnal lengkap terisi)
-- Jalankan di Supabase Dashboard > SQL Editor > New Query > Run
-- ============================================================

alter table profil_guru
  add column streak_jurnal integer not null default 0,
  add column streak_terakhir_update date;

-- streak_jurnal: jumlah hari berturut-turut jurnal terisi lengkap
-- streak_terakhir_update: tanggal terakhir streak dievaluasi (penjaga
--   supaya function tidak menghitung dobel kalau terpanggil >1x di hari sama)
