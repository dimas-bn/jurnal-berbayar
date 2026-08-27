-- ================================================================
-- MIGRASI: Fitur Nilai Siswa (Tahap 1 - Ulangan/Ujian)
-- Jalankan seluruh isi file ini sekali di Supabase > SQL Editor
-- ================================================================

-- 1. Kolom pengaturan ambang batas warna KKM di profil_guru
--    (default masuk akal kalau guru belum atur sendiri lewat aplikasi)
alter table profil_guru
  add column if not exists batas_jeblok numeric not null default 50,
  add column if not exists nilai_kkm numeric not null default 75,
  add column if not exists batas_istimewa numeric not null default 90;

-- 2. Tabel nilai (menampung semua jenis penilaian, dibedakan kolom `jenis`)
create table if not exists nilai (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  kelas_id uuid not null references kelas(id) on delete cascade,
  siswa_id uuid not null references siswa(id) on delete cascade,
  jenis text not null default 'ulangan' check (jenis in ('ulangan','tugas','bebas','akhir_semester')),
  nama_penilaian text not null,
  nilai numeric not null check (nilai >= 0 and nilai <= 100),
  tanggal date not null,
  catatan text,
  created_at timestamptz not null default now()
);

-- Index untuk query yang sering dipakai (filter per guru+kelas, riwayat per batch)
create index if not exists idx_nilai_guru_kelas on nilai (guru_id, kelas_id);
create index if not exists idx_nilai_batch on nilai (guru_id, kelas_id, nama_penilaian, tanggal);

-- 3. Row Level Security (pola sama seperti tabel lain: scoped ke guru_id)
alter table nilai enable row level security;

create policy "Guru kelola nilai miliknya sendiri"
  on nilai
  for all
  using (auth.uid() = guru_id)
  with check (auth.uid() = guru_id);

-- ================================================================
-- SELESAI. Setelah dijalankan, kolom batas_jeblok/nilai_kkm/batas_istimewa
-- otomatis terisi default 50/75/90 untuk semua guru yang sudah ada,
-- dan bisa diubah masing-masing lewat tab "Nilai" di aplikasi.
-- ================================================================
