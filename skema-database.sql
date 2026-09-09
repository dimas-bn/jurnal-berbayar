-- ============================================================
-- SKEMA DATABASE: Jurnal Mengajar Online (Versi Berbayar)
-- Update terakhir: mencerminkan struktur database production
-- per September 2026 (hasil ekspor langsung dari information_schema
-- & pg_policies, BUKAN ditulis dari ingatan).
--
-- File ini untuk REFERENSI/DOKUMENTASI. Karena semua tabel sudah
-- ada di production, JANGAN jalankan file ini langsung di SQL
-- Editor kecuali untuk setup project baru dari nol.
-- ============================================================

-- ============================================================
-- BAGIAN 1: AKUN & PERIODE
-- ============================================================

-- 1. PROFIL GURU
-- Menyimpan data guru, status langganan, dan preferensi penilaian.
-- Terhubung otomatis ke sistem login Supabase (auth.users).
create table profil_guru (
  id uuid primary key references auth.users(id) on delete cascade,
  nama_lengkap text not null,
  email text not null,
  paket text not null default 'trial' check (paket in ('trial', 'bulanan', 'semester', 'tahunan', 'lifetime')),
  status_aktif boolean not null default true,
  tanggal_mulai timestamp with time zone default now(),
  tanggal_berakhir timestamp with time zone, -- kosong (null) untuk paket lifetime
  dibuat_pada timestamp with time zone default now(),
  batas_jeblok numeric not null default 50,     -- ambang nilai "jeblok" (di bawah ini)
  nilai_kkm numeric not null default 75,        -- KKM default guru ini
  batas_istimewa numeric not null default 90,   -- ambang nilai "istimewa" (di atas ini)
  sudah_onboarding boolean default false,       -- sudah lewat modal "Selamat Datang"?
  setuju_promosi boolean default false          -- setuju dihubungi untuk promosi/testimoni
);

-- 2. TAHUN AJARAN
-- Tahun ajaran aktif/lama milik tiap guru (misal 2026/2027).
create table tahun_ajaran (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  nama text not null,
  aktif boolean default true,
  dibuat_pada timestamp with time zone default now()
);

-- 3. SEMESTER
-- Semester di dalam satu tahun ajaran (misal Ganjil/Genap).
create table semester (
  id uuid primary key default gen_random_uuid(),
  tahun_ajaran_id uuid not null references tahun_ajaran(id) on delete cascade,
  nama text not null,
  aktif boolean default true,
  dibuat_pada timestamp with time zone default now()
);

-- ============================================================
-- BAGIAN 2: STRUKTUR (KELAS, SISWA, JADWAL)
-- Tidak ikut diarsipkan/reset saat ganti semester, hanya saat
-- ganti tahun ajaran.
-- ============================================================

-- 4. KELAS
-- Daftar kelas yang diampu tiap guru.
create table kelas (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  nama_kelas text not null,
  mata_pelajaran text not null,
  dibuat_pada timestamp with time zone default now(),
  token_publik text default (gen_random_uuid())::text, -- untuk halaman papan-poin publik
  tahun_ajaran_id uuid references tahun_ajaran(id) on delete set null
);

-- 5. SISWA
-- Daftar siswa di tiap kelas.
create table siswa (
  id uuid primary key default gen_random_uuid(),
  kelas_id uuid not null references kelas(id) on delete cascade,
  nama_siswa text not null,
  nomor_presensi integer,
  dibuat_pada timestamp with time zone default now()
);

-- 6. JADWAL
-- Jadwal mengajar tetap tiap guru.
create table jadwal (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  kelas_id uuid not null references kelas(id) on delete cascade,
  hari text not null check (hari in ('Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu')),
  jam_ke text not null, -- disimpan sebagai teks, misal "1-3" atau "7"
  dibuat_pada timestamp with time zone default now()
);

-- ============================================================
-- BAGIAN 3: KONTEN AKTIF (JURNAL, ABSENSI, NILAI, CATATAN)
-- Terikat ke semester_id, diarsipkan & dikosongkan tiap ganti
-- semester lewat fungsi arsipkan_semester().
-- ============================================================

-- 7. JURNAL
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
  dibuat_pada timestamp with time zone default now(),
  mapel text,                      -- nama mapel saat jurnal dibuat (arsip histori, terpisah dari kelas.mata_pelajaran)
  dihapus_pada timestamp with time zone, -- soft-delete, belum termanfaatkan penuh
  semester_id uuid references semester(id) on delete set null
);

-- 8. ABSENSI
-- Status kehadiran + poin partisipasi tiap siswa untuk satu entri jurnal.
-- (Tabel "poin" versi lama sudah dilebur ke sini sebagai kolom poin & keterangan.)
create table absensi (
  id uuid primary key default gen_random_uuid(),
  jurnal_id uuid not null references jurnal(id) on delete cascade,
  siswa_id uuid not null references siswa(id) on delete cascade,
  status text not null check (status in ('Hadir','Izin','Sakit','Alpha','Dispensasi')),
  dibuat_pada timestamp with time zone default now(),
  keterangan text,
  poin integer not null default 3
);

-- 9. CATATAN PERSIAPAN
-- Catatan rencana mengajar guru per kelas per tanggal.
create table catatan_persiapan (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  kelas_id uuid not null references kelas(id) on delete cascade,
  tanggal date not null,
  teks text not null default '',
  diperbarui_pada timestamp with time zone default now(),
  semester_id uuid references semester(id) on delete set null
);

-- 10. NILAI
-- Nilai penilaian bebas (jenis & nama_penilaian ditentukan guru sendiri).
create table nilai (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  kelas_id uuid not null references kelas(id) on delete cascade,
  siswa_id uuid not null references siswa(id) on delete cascade,
  jenis text not null default 'ulangan',
  nama_penilaian text not null,
  nilai numeric not null,
  tanggal date not null,
  catatan text,
  created_at timestamp with time zone not null default now(),
  semester_id uuid references semester(id) on delete set null
);

-- 11. FORMULA NILAI
-- Rumus Nilai Rapor per kelas, 1 rumus berlaku untuk semua siswa di kelas itu.
-- Rumus mereferensikan nama_penilaian, dievaluasi pakai library expr-eval di frontend.
create table formula_nilai (
  kelas_id uuid primary key references kelas(id) on delete cascade,
  guru_id uuid not null references profil_guru(id) on delete cascade,
  rumus text not null default '',
  diperbarui_pada timestamp with time zone not null default now()
);

-- ============================================================
-- BAGIAN 4: ARSIP
-- Struktur tabel identik dengan versi aktifnya, ditambah kolom
-- kadaluarsa_pada (7 hari sejak diarsipkan). Dihapus permanen
-- otomatis oleh Edge Function hapus-arsip-kadaluarsa (cron harian).
-- ============================================================

-- 12. ARSIP KELAS
create table arsip_kelas (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null,
  nama_kelas text not null,
  mata_pelajaran text not null,
  dibuat_pada timestamp with time zone default now(),
  token_publik text default (gen_random_uuid())::text,
  tahun_ajaran_id uuid,
  kadaluarsa_pada timestamp with time zone
);

-- 13. ARSIP SISWA
create table arsip_siswa (
  id uuid primary key default gen_random_uuid(),
  kelas_id uuid not null,
  nama_siswa text not null,
  nomor_presensi integer,
  dibuat_pada timestamp with time zone default now(),
  kadaluarsa_pada timestamp with time zone
);

-- 14. ARSIP JADWAL
create table arsip_jadwal (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  hari text not null,
  jam_ke text not null,
  dibuat_pada timestamp with time zone default now(),
  kadaluarsa_pada timestamp with time zone
);

-- 15. ARSIP JURNAL
create table arsip_jurnal (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  tanggal date not null default current_date,
  hari text not null,
  jam_ke text not null,
  materi text,
  catatan text,
  dibuat_pada timestamp with time zone default now(),
  mapel text,
  dihapus_pada timestamp with time zone,
  semester_id uuid,
  kadaluarsa_pada timestamp with time zone
);

-- 16. ARSIP ABSENSI
create table arsip_absensi (
  id uuid primary key default gen_random_uuid(),
  jurnal_id uuid not null,
  siswa_id uuid not null,
  status text not null,
  dibuat_pada timestamp with time zone default now(),
  keterangan text,
  poin integer not null default 3,
  kadaluarsa_pada timestamp with time zone
);

-- 17. ARSIP CATATAN PERSIAPAN
create table arsip_catatan_persiapan (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  tanggal date not null,
  teks text not null default '',
  diperbarui_pada timestamp with time zone default now(),
  semester_id uuid,
  kadaluarsa_pada timestamp with time zone
);

-- 18. ARSIP NILAI
create table arsip_nilai (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  siswa_id uuid not null,
  jenis text not null default 'ulangan',
  nama_penilaian text not null,
  nilai numeric not null,
  tanggal date not null,
  catatan text,
  created_at timestamp with time zone not null default now(),
  kadaluarsa_pada timestamp with time zone,
  semester_id uuid
);

-- 19. ARSIP REMINDER LOG
-- Mencatat reminder H-7/H-1 mana yang sudah terkirim, biar cron
-- hapus-arsip-kadaluarsa tidak kirim dobel.
create table arsip_reminder_log (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid,
  kadaluarsa_pada timestamp with time zone,
  tipe text, -- 'H-7' atau 'H-1'
  dikirim_pada timestamp with time zone default now()
);

-- ============================================================
-- BAGIAN 5: LAIN-LAIN
-- ============================================================

-- 20. REMINDER LOG
-- Mencatat reminder harian "jurnal belum diisi" mana yang sudah
-- terkirim, biar cron reminder-jurnal-harian tidak kirim dobel.
create table reminder_log (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  kelas_id uuid not null references kelas(id) on delete cascade,
  tanggal date not null,
  jam_ke text not null,
  dikirim_pada timestamp with time zone default now()
);

-- 21. LOG TRANSAKSI MAYAR
-- Log mentah webhook Mayar (aktivasi paket berbayar), diisi oleh
-- Cloudflare Worker, dibaca manual/admin panel untuk audit.
create table log_transaksi_mayar (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  email_pembayar text not null,
  nama_pembayar text,
  nama_produk text,
  paket_terdeteksi text,
  status text not null default 'menunggu_diproses',
  guru_id uuid,
  payload_mentah jsonb,
  catatan_admin text,
  diterima_pada timestamp with time zone not null default now(),
  diproses_pada timestamp with time zone
);

-- 22. MASUKAN PENGGUNA
-- Kritik/saran/masukan dari guru lewat tab "Info & Masukan".
create table masukan_pengguna (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  kategori text not null,
  pesan text not null,
  dibuat_pada timestamp with time zone not null default now(),
  balasan_admin text,
  dibalas_pada timestamp with time zone
);

-- 23. TESTIMONI
-- Testimoni guru (perlu approval admin sebelum tampil di landing page).
create table testimoni (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid not null references profil_guru(id) on delete cascade,
  nama_tampilan text not null,
  rating integer not null,
  teks text not null,
  status text not null default 'pending',
  dibuat_pada timestamp with time zone not null default now(),
  diproses_pada timestamp with time zone
);

-- ============================================================
-- KEAMANAN: Row Level Security (RLS)
-- Supaya guru A tidak bisa lihat/ubah data guru B.
--
-- CATATAN: arsip_reminder_log, log_transaksi_mayar, dan
-- reminder_log TIDAK punya policy RLS guru (hasil pengecekan
-- pg_policies) — akses ke 3 tabel ini hanya lewat Edge Function
-- pakai service_role_key (otomatis bypass RLS), bukan lewat
-- Supabase client browser guru. Ini sengaja, bukan celah keamanan,
-- SELAMA tidak ada kode frontend yang mengakses tabel ini
-- langsung pakai anon key.
-- ============================================================

alter table profil_guru enable row level security;
alter table tahun_ajaran enable row level security;
alter table semester enable row level security;
alter table kelas enable row level security;
alter table siswa enable row level security;
alter table jadwal enable row level security;
alter table jurnal enable row level security;
alter table absensi enable row level security;
alter table catatan_persiapan enable row level security;
alter table nilai enable row level security;
alter table formula_nilai enable row level security;
alter table arsip_kelas enable row level security;
alter table arsip_siswa enable row level security;
alter table arsip_jadwal enable row level security;
alter table arsip_jurnal enable row level security;
alter table arsip_absensi enable row level security;
alter table arsip_catatan_persiapan enable row level security;
alter table arsip_nilai enable row level security;
alter table masukan_pengguna enable row level security;
alter table testimoni enable row level security;

-- Guru hanya bisa akses profilnya sendiri
create policy "Guru akses profil sendiri" on profil_guru
  for all using (auth.uid() = id);

-- Guru hanya bisa akses tahun ajaran miliknya sendiri
create policy "Guru akses tahun ajaran sendiri" on tahun_ajaran
  for all using (auth.uid() = guru_id);

-- Guru hanya bisa akses semester lewat tahun ajaran miliknya sendiri
create policy "Guru akses semester lewat tahun ajaran sendiri" on semester
  for all using (
    exists (select 1 from tahun_ajaran where tahun_ajaran.id = semester.tahun_ajaran_id and tahun_ajaran.guru_id = auth.uid())
  );

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

-- Guru hanya bisa akses catatan persiapan miliknya sendiri
create policy "Guru akses catatan sendiri" on catatan_persiapan
  for all using (auth.uid() = guru_id);

-- Guru kelola nilai miliknya sendiri (butuh with_check karena ada INSERT)
create policy "Guru kelola nilai miliknya sendiri" on nilai
  for all using (auth.uid() = guru_id) with check (auth.uid() = guru_id);

-- Guru kelola formula miliknya sendiri (butuh with_check karena ada INSERT)
create policy "guru kelola formula miliknya sendiri" on formula_nilai
  for all using (auth.uid() = guru_id) with check (auth.uid() = guru_id);

-- Guru hanya bisa akses arsip kelas miliknya sendiri
create policy "Guru akses arsip kelas sendiri" on arsip_kelas
  for all using (auth.uid() = guru_id);

-- Guru hanya bisa akses arsip siswa lewat arsip kelas miliknya sendiri
create policy "Guru akses arsip siswa lewat kelas sendiri" on arsip_siswa
  for all using (
    exists (select 1 from arsip_kelas where arsip_kelas.id = arsip_siswa.kelas_id and arsip_kelas.guru_id = auth.uid())
  );

-- Guru hanya bisa akses arsip jadwal miliknya sendiri
create policy "Guru akses arsip jadwal sendiri" on arsip_jadwal
  for all using (auth.uid() = guru_id);

-- Guru hanya bisa akses arsip jurnal miliknya sendiri
create policy "Guru akses arsip jurnal sendiri" on arsip_jurnal
  for all using (auth.uid() = guru_id);

-- Guru hanya bisa akses arsip absensi lewat arsip jurnal miliknya sendiri
create policy "Guru akses arsip absensi lewat jurnal sendiri" on arsip_absensi
  for all using (
    exists (select 1 from arsip_jurnal where arsip_jurnal.id = arsip_absensi.jurnal_id and arsip_jurnal.guru_id = auth.uid())
  );

-- Guru hanya bisa akses arsip catatan miliknya sendiri
create policy "Guru akses arsip catatan sendiri" on arsip_catatan_persiapan
  for all using (auth.uid() = guru_id);

-- Guru hanya bisa akses arsip nilai lewat arsip kelas miliknya sendiri
create policy "Guru akses arsip nilai lewat kelas sendiri" on arsip_nilai
  for all using (
    exists (select 1 from arsip_kelas where arsip_kelas.id = arsip_nilai.kelas_id and arsip_kelas.guru_id = auth.uid())
  );

-- Masukan pengguna: guru cuma bisa insert & lihat & hapus masukan sendiri
-- (TIDAK ADA policy UPDATE — guru tidak bisa edit masukan setelah kirim,
-- balasan_admin diisi lewat admin panel pakai service_role_key)
create policy "guru insert masukan sendiri" on masukan_pengguna
  for insert with check (auth.uid() = guru_id);
create policy "guru lihat masukan sendiri" on masukan_pengguna
  for select using (auth.uid() = guru_id);
create policy "guru hapus masukan sendiri" on masukan_pengguna
  for delete using (auth.uid() = guru_id);

-- Testimoni: guru cuma bisa insert & lihat & hapus testimoni sendiri
-- (TIDAK ADA policy UPDATE — status approval diubah admin lewat service_role_key)
create policy "guru insert testimoni sendiri" on testimoni
  for insert with check (auth.uid() = guru_id);
create policy "guru lihat testimoni sendiri" on testimoni
  for select using (auth.uid() = guru_id);
create policy "guru hapus testimoni sendiri" on testimoni
  for delete using (auth.uid() = guru_id);
