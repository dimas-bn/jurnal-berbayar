-- ============================================================
-- SKEMA DATABASE: Jurnal Mengajar Online (Versi Berbayar)
-- Cara pakai: copy semua isi file ini, paste ke Supabase
-- Dashboard > SQL Editor > New Query > paste > klik Run
-- ============================================================

-- 1. PROFIL GURU
-- Menyimpan data guru & status langganannya.
-- Terhubung otomatis ke sistem login Supabase (auth.users).
create table profil_guru (
  id uuid primary key references auth.users(id) on delete cascade,
  nama_lengkap text not null,
  email text not null,
  paket text not null default 'trial' check (paket in ('trial', 'bulanan', 'tahunan', 'lifetime')),
  status_aktif boolean not null default true,
  tanggal_mulai timestamp with time zone default now(),
  tanggal_berakhir timestamp with time zone, -- kosong (null) untuk paket lifetime
  dibuat_pada timestamp with time zone default now()
);

-- 2. KELAS
-- Daftar kelas yang diampu tiap guru.
create table kelas (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  nama_kelas text not null,
  mata_pelajaran text not null,
  dibuat_pada timestamp with time zone default now()
);

-- 3. SISWA
-- Daftar siswa di tiap kelas.
create table siswa (
  id uuid primary key default gen_random_uuid(),
  kelas_id uuid not null references kelas(id) on delete cascade,
  nama_siswa text not null,
  nomor_presensi integer,
  dibuat_pada timestamp with time zone default now()
);

-- 4. JADWAL
-- Jadwal mengajar tetap tiap guru.
create table jadwal (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  kelas_id uuid not null references kelas(id) on delete cascade,
  hari text not null check (hari in ('Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu')),
  jam_ke text not null, -- disimpan sebagai teks, misal "1-3" atau "7"
  dibuat_pada timestamp with time zone default now()
);

-- 5. JURNAL
-- Catatan jurnal mengajar harian.
create table jurnal (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  kelas_id uuid not null references kelas(id) on delete cascade,
  tanggal date not null default current_date,
  hari text not null,
  jam_ke text not null,
  materi text,
  catatan text,
  dibuat_pada timestamp with time zone default now()
);

-- 6. ABSENSI
-- Status kehadiran tiap siswa untuk satu entri jurnal.
create table absensi (
  id uuid primary key default gen_random_uuid(),
  jurnal_id uuid not null references jurnal(id) on delete cascade,
  siswa_id uuid not null references siswa(id) on delete cascade,
  status text not null check (status in ('Hadir','Izin','Sakit','Alpha','Dispensasi')),
  dibuat_pada timestamp with time zone default now()
);

-- 7. POIN
-- Poin partisipasi siswa untuk satu entri jurnal.
create table poin (
  id uuid primary key default gen_random_uuid(),
  jurnal_id uuid not null references jurnal(id) on delete cascade,
  siswa_id uuid not null references siswa(id) on delete cascade,
  jumlah_poin integer not null default 0,
  keterangan text,
  dibuat_pada timestamp with time zone default now()
);

-- ============================================================
-- KEAMANAN: Row Level Security (RLS)
-- Supaya guru A tidak bisa lihat/ubah data guru B.
-- ============================================================

alter table profil_guru enable row level security;
alter table kelas enable row level security;
alter table siswa enable row level security;
alter table jadwal enable row level security;
alter table jurnal enable row level security;
alter table absensi enable row level security;
alter table poin enable row level security;

-- Guru hanya bisa akses profilnya sendiri
create policy "Guru akses profil sendiri" on profil_guru
  for all using (auth.uid() = id);

-- Guru hanya bisa akses kelas miliknya sendiri
create policy "Guru akses kelas sendiri" on kelas
  for all using (auth.uid() = guru_id);

-- Guru hanya bisa akses siswa dari kelas miliknya sendiri
create policy "Guru akses siswa sendiri" on siswa
  for all using (
    kelas_id in (select id from kelas where guru_id = auth.uid())
  );

-- Guru hanya bisa akses jadwal miliknya sendiri
create policy "Guru akses jadwal sendiri" on jadwal
  for all using (auth.uid() = guru_id);

-- Guru hanya bisa akses jurnal miliknya sendiri
create policy "Guru akses jurnal sendiri" on jurnal
  for all using (auth.uid() = guru_id);

-- Guru hanya bisa akses absensi dari jurnal miliknya sendiri
create policy "Guru akses absensi sendiri" on absensi
  for all using (
    jurnal_id in (select id from jurnal where guru_id = auth.uid())
  );

-- Guru hanya bisa akses poin dari jurnal miliknya sendiri
create policy "Guru akses poin sendiri" on poin
  for all using (
    jurnal_id in (select id from jurnal where guru_id = auth.uid())
  );
