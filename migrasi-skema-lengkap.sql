-- ============================================================
-- MIGRASI SKEMA: Menyesuaikan dengan fitur lengkap versi gratis
-- Cara pakai: paste ke Supabase SQL Editor > New Query > Run
-- (jalankan SETELAH skema-database.sql dan trigger-auto-profil.sql)
-- ============================================================

-- 1. Gabungkan Poin ke dalam Absensi (satu baris = status + keterangan + poin per siswa per jurnal)
alter table absensi add column if not exists keterangan text;
alter table absensi add column if not exists poin integer not null default 3 check (poin between 0 and 7);

-- Tabel poin lama sudah tidak dipakai lagi
drop table if exists poin;

-- 2. Tambah kolom di Jurnal: mata pelajaran (tersimpan per entri, bukan cuma ikut kelas) + kotak sampah (soft delete)
alter table jurnal add column if not exists mapel text;
alter table jurnal add column if not exists dihapus_pada timestamp with time zone;

-- 3. Tabel baru: Catatan Persiapan (per guru + kelas + tanggal)
create table if not exists catatan_persiapan (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  kelas_id uuid not null references kelas(id) on delete cascade,
  tanggal date not null,
  teks text not null default '',
  diperbarui_pada timestamp with time zone default now(),
  unique (guru_id, kelas_id, tanggal)
);

alter table catatan_persiapan enable row level security;
create policy "Guru akses catatan sendiri" on catatan_persiapan
  for all using (auth.uid() = guru_id);
