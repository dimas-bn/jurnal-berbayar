-- ============================================================
-- PERBAIKAN BUG: aturan validasi status di tabel absensi salah ketik
-- ("Alpha" seharusnya "Alpa", sesuai istilah yang dipakai di aplikasi)
-- Cara pakai: paste ke Supabase SQL Editor > New Query > Run
-- ============================================================

alter table absensi drop constraint if exists absensi_status_check;
alter table absensi add constraint absensi_status_check
  check (status in ('Hadir','Izin','Sakit','Alpa','Dispensasi'));
