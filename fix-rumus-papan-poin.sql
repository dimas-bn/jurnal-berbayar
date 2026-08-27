-- ============================================================
-- PERBAIKAN BUG: rumus get_papan_poin_publik salah hitung rata-rata
-- (sebelumnya cuma rata-rata dari baris yang tercatat, tidak
-- memperhitungkan pertemuan dengan poin default yang tidak tersimpan)
-- Cara pakai: paste ke Supabase SQL Editor > New Query > Run
-- ============================================================

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
  select
    s.nama_siswa,
    s.nomor_presensi,
    case
      when v_total_pertemuan = 0 then 3::numeric
      else round(
        (coalesce(ag.total_poin_tercatat, 0) + (v_total_pertemuan - coalesce(ag.jumlah_tercatat, 0)) * 3.0)
        / v_total_pertemuan
      , 1)
    end as rata_poin,
    v_total_pertemuan as total_pertemuan
  from siswa s
  left join (
    select a.siswa_id, sum(a.poin) as total_poin_tercatat, count(*) as jumlah_tercatat
    from absensi a
    join jurnal j on j.id = a.jurnal_id
    where j.kelas_id = v_kelas_id and j.dihapus_pada is null
    group by a.siswa_id
  ) ag on ag.siswa_id = s.id
  where s.kelas_id = v_kelas_id
  order by rata_poin desc, s.nomor_presensi;
end;
$$;
