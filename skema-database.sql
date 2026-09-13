-- ============================================================
-- SKEMA DATABASE - Jurnal Mengajar Online (JMO)
-- Project Supabase: Jurnal-Online-Berbayar (eziszpzxszxurvqcsikj)
-- Digenerate ulang dari introspeksi database ASLI pada 10 Sep 2026
-- (bukan rekonstruksi manual dari file migrasi lama -- jadi ini
-- mencerminkan kondisi database yang SEBENARNYA berjalan sekarang)
--
-- CATATAN: file ini adalah DOKUMENTASI referensi struktur database.
-- Tidak dimaksudkan untuk dijalankan ulang begitu saja (beberapa
-- objek seperti extension gen_random_uuid() diasumsikan sudah ada).
-- ============================================================


-- ============================================================
-- TABEL INTI: Profil Guru
-- ============================================================
create table profil_guru (
  id uuid not null,
  nama_lengkap text not null,
  email text not null,
  paket text not null default 'trial'::text,
  status_aktif boolean not null default true,
  tanggal_mulai timestamp with time zone default now(),
  tanggal_berakhir timestamp with time zone,
  dibuat_pada timestamp with time zone default now(),
  batas_jeblok numeric not null default 50,
  nilai_kkm numeric not null default 75,
  batas_istimewa numeric not null default 90,
  sudah_onboarding boolean default false,
  setuju_promosi boolean default false,
  constraint profil_guru_pkey primary key (id),
  constraint profil_guru_id_fkey foreign key (id) references auth.users(id),
  constraint profil_guru_paket_check check (paket = any (array['trial','bulanan','semester','tahunan','lifetime']))
);
-- RLS: "Guru akses profil sendiri" -- ALL -- USING (auth.uid() = id)


-- ============================================================
-- TAHUN AJARAN & SEMESTER
-- ============================================================
create table tahun_ajaran (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  nama text not null,
  aktif boolean default true,
  dibuat_pada timestamp with time zone default now(),
  constraint tahun_ajaran_pkey primary key (id),
  constraint tahun_ajaran_guru_id_fkey foreign key (guru_id) references profil_guru(id)
);
-- RLS: "Guru akses tahun ajaran sendiri" -- ALL -- USING (auth.uid() = guru_id)

create table semester (
  id uuid not null default gen_random_uuid(),
  tahun_ajaran_id uuid not null,
  nama text not null,
  aktif boolean default true,
  dibuat_pada timestamp with time zone default now(),
  constraint semester_pkey primary key (id),
  constraint semester_tahun_ajaran_id_fkey foreign key (tahun_ajaran_id) references tahun_ajaran(id)
);
-- RLS: "Guru akses semester lewat tahun ajaran sendiri" -- ALL --
--      USING (EXISTS (SELECT 1 FROM tahun_ajaran WHERE tahun_ajaran.id = semester.tahun_ajaran_id AND tahun_ajaran.guru_id = auth.uid()))


-- ============================================================
-- KELAS, SISWA, JADWAL (struktur -- ikut tahun ajaran)
-- ============================================================
create table kelas (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  nama_kelas text not null,
  mata_pelajaran text not null,
  dibuat_pada timestamp with time zone default now(),
  token_publik text default (gen_random_uuid())::text,
  tahun_ajaran_id uuid,
  constraint kelas_pkey primary key (id),
  constraint kelas_guru_id_fkey foreign key (guru_id) references profil_guru(id),
  constraint kelas_tahun_ajaran_id_fkey foreign key (tahun_ajaran_id) references tahun_ajaran(id),
  constraint kelas_token_publik_key unique (token_publik)
);
-- RLS: "Guru akses kelas sendiri" -- ALL -- USING (auth.uid() = guru_id)

create table siswa (
  id uuid not null default gen_random_uuid(),
  kelas_id uuid not null,
  nama_siswa text not null,
  nomor_presensi integer,
  dibuat_pada timestamp with time zone default now(),
  constraint siswa_pkey primary key (id),
  constraint siswa_kelas_id_fkey foreign key (kelas_id) references kelas(id)
);
-- RLS: "Guru akses siswa sendiri" -- ALL --
--      USING (kelas_id IN (SELECT kelas.id FROM kelas WHERE kelas.guru_id = auth.uid()))

create table jadwal (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  hari text not null,
  jam_ke text not null,
  dibuat_pada timestamp with time zone default now(),
  constraint jadwal_pkey primary key (id),
  constraint jadwal_guru_id_fkey foreign key (guru_id) references profil_guru(id),
  constraint jadwal_kelas_id_fkey foreign key (kelas_id) references kelas(id),
  constraint jadwal_hari_check check (hari = any (array['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu']))
);
-- RLS: "Guru akses jadwal sendiri" -- ALL -- USING (auth.uid() = guru_id)


-- ============================================================
-- JURNAL, ABSENSI, NILAI, CATATAN PERSIAPAN (konten -- ikut semester)
-- ============================================================
create table jurnal (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  tanggal date not null default CURRENT_DATE,
  hari text not null,
  jam_ke text not null,
  materi text,
  catatan text,
  dibuat_pada timestamp with time zone default now(),
  mapel text,
  dihapus_pada timestamp with time zone,
  semester_id uuid,
  constraint jurnal_pkey primary key (id),
  constraint jurnal_guru_id_fkey foreign key (guru_id) references profil_guru(id),
  constraint jurnal_kelas_id_fkey foreign key (kelas_id) references kelas(id),
  constraint jurnal_semester_id_fkey foreign key (semester_id) references semester(id)
);
-- RLS: "Guru akses jurnal sendiri" -- ALL -- USING (auth.uid() = guru_id)
-- Trigger: isi_semester_otomatis (BEFORE INSERT) -- isi semester_id otomatis
--          dari semester aktif guru yang bersangkutan kalau kosong

create table absensi (
  id uuid not null default gen_random_uuid(),
  jurnal_id uuid not null,
  siswa_id uuid not null,
  status text not null,
  dibuat_pada timestamp with time zone default now(),
  keterangan text,
  poin integer not null default 3,
  constraint absensi_pkey primary key (id),
  constraint absensi_jurnal_id_fkey foreign key (jurnal_id) references jurnal(id),
  constraint absensi_siswa_id_fkey foreign key (siswa_id) references siswa(id),
  constraint absensi_status_check check (status = any (array['Hadir','Izin','Sakit','Alpa','Dispensasi'])),
  constraint absensi_poin_check check (poin >= 0 and poin <= 7)
);
-- RLS: "Guru akses absensi sendiri" -- ALL --
--      USING (jurnal_id IN (SELECT jurnal.id FROM jurnal WHERE jurnal.guru_id = auth.uid()))

create table nilai (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  siswa_id uuid not null,
  jenis text not null default 'ulangan'::text,
  nama_penilaian text not null,
  nilai numeric not null,
  tanggal date not null,
  catatan text,
  created_at timestamp with time zone not null default now(),
  semester_id uuid,
  constraint nilai_pkey primary key (id),
  constraint nilai_guru_id_fkey foreign key (guru_id) references profil_guru(id),
  constraint nilai_kelas_id_fkey foreign key (kelas_id) references kelas(id),
  constraint nilai_siswa_id_fkey foreign key (siswa_id) references siswa(id),
  constraint nilai_semester_id_fkey foreign key (semester_id) references semester(id),
  constraint nilai_jenis_check check (jenis = any (array['ulangan','tugas','bebas','akhir_semester'])),
  constraint nilai_nilai_check check (nilai >= 0 and nilai <= 100)
);
-- RLS: "Guru kelola nilai miliknya sendiri" -- ALL -- USING & WITH CHECK (auth.uid() = guru_id)
-- Trigger: isi_semester_otomatis (BEFORE INSERT) -- sama seperti jurnal

create table catatan_persiapan (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  tanggal date not null,
  teks text not null default ''::text,
  diperbarui_pada timestamp with time zone default now(),
  semester_id uuid,
  constraint catatan_persiapan_pkey primary key (id),
  constraint catatan_persiapan_guru_id_fkey foreign key (guru_id) references profil_guru(id),
  constraint catatan_persiapan_kelas_id_fkey foreign key (kelas_id) references kelas(id),
  constraint catatan_persiapan_semester_id_fkey foreign key (semester_id) references semester(id),
  constraint catatan_persiapan_guru_id_kelas_id_tanggal_key unique (guru_id, kelas_id, tanggal)
);
-- RLS: "Guru akses catatan sendiri" -- ALL -- USING (auth.uid() = guru_id)
-- Trigger: isi_semester_otomatis (BEFORE INSERT) -- sama seperti jurnal

create table formula_nilai (
  kelas_id uuid not null,
  guru_id uuid not null,
  rumus text not null default ''::text,
  diperbarui_pada timestamp with time zone not null default now(),
  constraint formula_nilai_pkey primary key (kelas_id),
  constraint formula_nilai_kelas_id_fkey foreign key (kelas_id) references kelas(id)
  -- formula_nilai_guru_id_fkey terdeteksi tapi tabel referensi tidak
  -- tertangkap introspeksi (kemungkinan mengarah ke profil_guru/auth.users)
);
-- RLS: "guru kelola formula miliknya sendiri" -- ALL -- USING & WITH CHECK (auth.uid() = guru_id)


-- ============================================================
-- ARSIP (hasil "Mulai Semester Baru" / "Mulai Tahun Ajaran Baru")
-- Struktur identik tabel aktifnya + kolom kadaluarsa_pada
-- ============================================================
create table arsip_jurnal (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  tanggal date not null default CURRENT_DATE,
  hari text not null,
  jam_ke text not null,
  materi text,
  catatan text,
  dibuat_pada timestamp with time zone default now(),
  mapel text,
  dihapus_pada timestamp with time zone,
  semester_id uuid,
  kadaluarsa_pada timestamp with time zone,
  constraint arsip_jurnal_pkey primary key (id)
);
-- RLS: "Guru akses arsip jurnal sendiri" -- ALL -- USING (auth.uid() = guru_id)

create table arsip_absensi (
  id uuid not null default gen_random_uuid(),
  jurnal_id uuid not null,
  siswa_id uuid not null,
  status text not null,
  dibuat_pada timestamp with time zone default now(),
  keterangan text,
  poin integer not null default 3,
  kadaluarsa_pada timestamp with time zone,
  constraint arsip_absensi_pkey primary key (id),
  constraint absensi_status_check check (status = any (array['Hadir','Izin','Sakit','Alpa','Dispensasi'])),
  constraint absensi_poin_check check (poin >= 0 and poin <= 7)
);
-- RLS: "Guru akses arsip absensi lewat jurnal sendiri" -- ALL --
--      USING (EXISTS (SELECT 1 FROM arsip_jurnal WHERE arsip_jurnal.id = arsip_absensi.jurnal_id AND arsip_jurnal.guru_id = auth.uid()))

create table arsip_nilai (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  siswa_id uuid not null,
  jenis text not null default 'ulangan'::text,
  nama_penilaian text not null,
  nilai numeric not null,
  tanggal date not null,
  catatan text,
  created_at timestamp with time zone not null default now(),
  kadaluarsa_pada timestamp with time zone,
  semester_id uuid,
  constraint arsip_nilai_pkey primary key (id),
  constraint nilai_jenis_check check (jenis = any (array['ulangan','tugas','bebas','akhir_semester'])),
  constraint nilai_nilai_check check (nilai >= 0 and nilai <= 100)
);
-- RLS: "Guru akses arsip nilai lewat kelas sendiri" -- ALL --
--      USING (EXISTS (SELECT 1 FROM arsip_kelas WHERE arsip_kelas.id = arsip_nilai.kelas_id AND arsip_kelas.guru_id = auth.uid()))

create table arsip_catatan_persiapan (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  tanggal date not null,
  teks text not null default ''::text,
  diperbarui_pada timestamp with time zone default now(),
  semester_id uuid,
  kadaluarsa_pada timestamp with time zone,
  constraint arsip_catatan_persiapan_pkey primary key (id),
  constraint arsip_catatan_persiapan_guru_id_kelas_id_tanggal_key unique (guru_id, kelas_id, tanggal)
);
-- RLS: "Guru akses arsip catatan sendiri" -- ALL -- USING (auth.uid() = guru_id)

create table arsip_kelas (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  nama_kelas text not null,
  mata_pelajaran text not null,
  dibuat_pada timestamp with time zone default now(),
  token_publik text default (gen_random_uuid())::text,
  tahun_ajaran_id uuid,
  kadaluarsa_pada timestamp with time zone,
  constraint arsip_kelas_pkey primary key (id),
  constraint arsip_kelas_token_publik_key unique (token_publik)
);
-- RLS: "Guru akses arsip kelas sendiri" -- ALL -- USING (auth.uid() = guru_id)

create table arsip_siswa (
  id uuid not null default gen_random_uuid(),
  kelas_id uuid not null,
  nama_siswa text not null,
  nomor_presensi integer,
  dibuat_pada timestamp with time zone default now(),
  kadaluarsa_pada timestamp with time zone,
  constraint arsip_siswa_pkey primary key (id)
);
-- RLS: "Guru akses arsip siswa lewat kelas sendiri" -- ALL --
--      USING (EXISTS (SELECT 1 FROM arsip_kelas WHERE arsip_kelas.id = arsip_siswa.kelas_id AND arsip_kelas.guru_id = auth.uid()))

create table arsip_jadwal (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  hari text not null,
  jam_ke text not null,
  dibuat_pada timestamp with time zone default now(),
  kadaluarsa_pada timestamp with time zone,
  constraint arsip_jadwal_pkey primary key (id),
  constraint jadwal_hari_check check (hari = any (array['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu']))
);
-- RLS: "Guru akses arsip jadwal sendiri" -- ALL -- USING (auth.uid() = guru_id)


-- ============================================================
-- REMINDER & LOG (Edge Functions terjadwal)
-- ============================================================
create table reminder_log (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  kelas_id uuid not null,
  tanggal date not null,
  jam_ke text not null,
  dikirim_pada timestamp with time zone default now(),
  constraint reminder_log_pkey primary key (id),
  constraint reminder_log_guru_id_fkey foreign key (guru_id) references profil_guru(id),
  constraint reminder_log_kelas_id_fkey foreign key (kelas_id) references kelas(id),
  constraint reminder_log_guru_id_kelas_id_tanggal_jam_ke_key unique (guru_id, kelas_id, tanggal, jam_ke)
);
-- Dipakai oleh Edge Function reminder-jurnal (cron harian) supaya tidak kirim reminder dobel

create table arsip_reminder_log (
  id uuid not null default gen_random_uuid(),
  guru_id uuid,
  kadaluarsa_pada timestamp with time zone,
  tipe text,
  dikirim_pada timestamp with time zone default now(),
  constraint arsip_reminder_log_pkey primary key (id),
  constraint arsip_reminder_log_guru_id_fkey foreign key (guru_id) references profil_guru(id)
);
-- Dipakai oleh Edge Function hapus-arsip-kadaluarsa untuk log reminder H-7/H-1
-- sebelum arsip dihapus permanen (tipe: 'H-7' atau 'H-1')


-- ============================================================
-- TRANSAKSI, MASUKAN, & TESTIMONI
-- ============================================================
create table log_transaksi_mayar (
  id uuid not null default gen_random_uuid(),
  event_type text not null,
  email_pembayar text not null,
  nama_pembayar text,
  nama_produk text,
  paket_terdeteksi text,
  status text not null default 'menunggu_diproses'::text,
  guru_id uuid,
  payload_mentah jsonb,
  catatan_admin text,
  diterima_pada timestamp with time zone not null default now(),
  diproses_pada timestamp with time zone,
  constraint log_transaksi_mayar_pkey primary key (id),
  constraint log_transaksi_mayar_guru_id_fkey foreign key (guru_id) references profil_guru(id),
  constraint log_transaksi_mayar_status_check check (status = any (array[
    'berhasil','butuh_review_manual','ruang_tunggu_pendaftaran','gagal_lainnya','notifikasi_nonaktif'
  ]))
);
-- Tidak ada RLS eksplisit ditemukan -- akses murni lewat function admin
-- (get_log_transaksi_admin, selesaikan_log_transaksi_admin, hapus_log_berhasil_admin)
-- Trigger: auto_match_transaksi_mayar (di tabel auth.users, AFTER INSERT) --
--          cocokkan transaksi Mayar yang mendarat duluan (status
--          'ruang_tunggu_pendaftaran') dengan guru yang baru daftar
--          berdasarkan email, aktifkan paket otomatis

create table masukan_pengguna (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  kategori text not null,
  pesan text not null,
  dibuat_pada timestamp with time zone not null default now(),
  balasan_admin text,
  dibalas_pada timestamp with time zone,
  constraint masukan_pengguna_pkey primary key (id),
  constraint masukan_pengguna_guru_id_fkey foreign key (guru_id) references profil_guru(id),
  constraint masukan_pengguna_kategori_check check (kategori = any (array['masukan','kritik','saran','bug','lainnya']))
);
-- RLS: 3 policy terpisah per operasi --
--   SELECT: "guru lihat masukan sendiri" -- USING (auth.uid() = guru_id)
--   INSERT: "guru insert masukan sendiri" -- WITH CHECK (auth.uid() = guru_id)
--   DELETE: "guru hapus masukan sendiri" -- USING (auth.uid() = guru_id)
--   (balas_admin hanya lewat function balas_masukan_admin, khusus email admin)

create table testimoni (
  id uuid not null default gen_random_uuid(),
  guru_id uuid not null,
  nama_tampilan text not null,
  rating integer not null,
  teks text not null,
  status text not null default 'pending'::text,
  dibuat_pada timestamp with time zone not null default now(),
  diproses_pada timestamp with time zone,
  constraint testimoni_pkey primary key (id),
  constraint testimoni_guru_id_fkey foreign key (guru_id) references profil_guru(id),
  constraint testimoni_rating_check check (rating >= 1 and rating <= 5),
  constraint testimoni_status_check check (status = any (array['pending','approved','rejected']))
);
-- RLS: 3 policy terpisah per operasi (sama pola dengan masukan_pengguna)
-- Trigger: cek_batas_testimoni (BEFORE INSERT) -- tolak kalau testimoni
--          sebelumnya masih 'pending' ATAU sudah kirim dalam 30 hari terakhir


-- ============================================================
-- FUNCTION / RPC (Postgres, dipanggil dari dashboard.html via supabase.rpc())
-- ============================================================
-- arsipkan_semester(nama_semester_baru text)
--   Pindahkan jurnal/absensi/nilai/catatan_persiapan semester aktif guru
--   ke tabel arsip_* (kadaluarsa 7 hari), nonaktifkan semester lama,
--   buat semester baru aktif.
--
-- arsipkan_tahun_ajaran(nama_tahun_ajaran_baru text, nama_semester_baru text)
--   Panggil arsipkan_semester() dulu, lalu arsipkan Kelas/Siswa/Jadwal
--   ke arsip_kelas/arsip_siswa/arsip_jadwal (kadaluarsa 7 hari), hapus
--   dari tabel aktif, nonaktifkan tahun ajaran lama, buat tahun ajaran
--   + semester baru.
--
-- get_papan_poin_publik(p_token text) -- RETURNS TABLE
--   Diakses publik (tanpa login) lewat token_publik kelas, untuk
--   halaman papan-poin.html. Menolak jika tanggal_berakhir guru sudah lewat.
--
-- get_nama_kelas_publik(p_token text) -- RETURNS text
--   Pendukung get_papan_poin_publik, ambil nama kelas dari token publik.
--
-- Function khusus admin (semua mengecek auth.email() = 'dimasmansaba@gmail.com'):
--   get_statistik_pengguna_admin() -- rekap jumlah jurnal & tanggal
--     terakhir aktif per guru, untuk panel admin.
--   get_log_transaksi_admin(), selesaikan_log_transaksi_admin(p_id, p_catatan),
--     hapus_log_berhasil_admin() -- kelola log_transaksi_mayar.
--   get_semua_masukan_admin(), balas_masukan_admin(p_id, p_balasan) --
--     kelola masukan_pengguna.
--   get_semua_testimoni_admin(), proses_testimoni_admin(p_id, p_status) --
--     kelola testimoni (approve/reject).
--
-- get_testimoni_approved() -- RETURNS TABLE
--   Publik, ambil testimoni yang sudah di-approve (untuk landing page).


-- ============================================================
-- TRIGGER (terpasang di tabel auth.users atau tabel konten)
-- ============================================================
-- buat_profil_guru_otomatis  (AFTER INSERT ON auth.users)
--   Insert baris profil_guru otomatis saat user baru daftar. Ambil nama
--   dari raw_user_meta_data, coalesce urutan: nama_lengkap -> full_name
--   (Google OAuth) -> name -> default 'Guru Baru'. Paket awal = 'trial',
--   aktif 7 hari.
--
-- buat_periode_awal_guru_baru  (AFTER INSERT ON auth.users, atau setelah
--   profil_guru dibuat)
--   Buat tahun_ajaran '2026/2027' + semester 'Ganjil' awal untuk guru baru.
--
-- auto_match_transaksi_mayar  (AFTER INSERT ON auth.users)
--   Cocokkan transaksi Mayar yang mendarat sebelum guru sempat daftar
--   (status 'ruang_tunggu_pendaftaran', dicocokkan lewat email) --
--   otomatis aktifkan paket & set tanggal_berakhir sesuai paket terdeteksi.
--
-- isi_semester_otomatis  (BEFORE INSERT ON jurnal, nilai, catatan_persiapan)
--   Isi semester_id otomatis dari semester aktif guru kalau kosong saat insert.
--
-- cek_batas_testimoni  (BEFORE INSERT ON testimoni)
--   Tolak insert kalau testimoni sebelumnya masih 'pending' atau sudah
--   kirim dalam 30 hari terakhir.


-- ============================================================
-- EDGE FUNCTIONS (Deno, di folder supabase/functions/)
-- ============================================================
-- reminder-jurnal            -- cron harian 15:30 WIB (Sen-Sab), kirim
--                               email (Resend) ke guru yang jadwal hari
--                               itu belum diisi jurnalnya. Log ke reminder_log.
-- backup-rekap-bulanan       -- kirim email rekap bulanan (statistik +
--                               lampiran Excel jurnal & nilai) ke tiap guru.
-- hapus-arsip-kadaluarsa     -- cron harian 08:00 WIB, hapus permanen baris
--                               arsip_* yang kadaluarsa_pada sudah lewat +
--                               kirim reminder email H-7/H-1 (log ke
--                               arsip_reminder_log).
