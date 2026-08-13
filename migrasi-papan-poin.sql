-- ============================================================
-- MIGRASI: Papan Poin Online (halaman publik per kelas)
-- Cara pakai: paste ke Supabase SQL Editor > New Query > Run
-- ============================================================

-- 1. Tiap kelas dapat "token" unik acak untuk link publik papan poinnya
alter table kelas add column if not exists token_publik text unique default gen_random_uuid()::text;

-- 2. Fungsi publik: ambil nama kelas dari token (aman, tidak mengekspos data guru)
create or replace function get_nama_kelas_publik(p_token text)
returns text
language sql
security definer
set search_path = public
as $$
  select nama_kelas from kelas where token_publik = p_token;
$$;

-- 3. Fungsi publik: ambil ranking poin siswa dari token
--    (rata-rata poin akumulasi sejak awal, sama seperti logika versi gratis)
create or replace function get_papan_poin_publik(p_token text)
returns table(nama_siswa text, nomor_presensi integer, rata_poin numeric, total_pertemuan integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kelas_id uuid;
  v_total_pertemuan integer;
begin
  select id into v_kelas_id from kelas where token_publik = p_token;
  if v_kelas_id is null then
    raise exception 'Link papan poin tidak ditemukan.';
  end if;

  select count(*) into v_total_pertemuan from jurnal j where j.kelas_id = v_kelas_id and j.dihapus_pada is null;

  return query
  select s.nama_siswa, s.nomor_presensi,
    coalesce(round(ag.rata_poin, 1), 3) as rata_poin,
    v_total_pertemuan as total_pertemuan
  from siswa s
  left join (
    select a.siswa_id, avg(a.poin) as rata_poin
    from absensi a
    join jurnal j on j.id = a.jurnal_id
    where j.kelas_id = v_kelas_id and j.dihapus_pada is null
    group by a.siswa_id
  ) ag on ag.siswa_id = s.id
  where s.kelas_id = v_kelas_id
  order by coalesce(ag.rata_poin, 3) desc, s.nomor_presensi;
end;
$$;

-- 4. Izinkan diakses publik (tanpa login) — hanya lewat fungsi di atas, bukan akses tabel langsung
grant execute on function get_nama_kelas_publik(text) to anon;
grant execute on function get_papan_poin_publik(text) to anon;
