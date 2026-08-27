-- ============================================================
-- TRIGGER: Auto-buat profil_guru saat ada pendaftaran baru
-- Cara pakai: paste ke Supabase SQL Editor > New Query > Run
-- (jalankan SETELAH skema-database.sql)
-- ============================================================

create or replace function public.buat_profil_guru_otomatis()
returns trigger as $$
begin
  insert into public.profil_guru (id, nama_lengkap, email, paket, status_aktif, tanggal_berakhir)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nama_lengkap', 'Guru Baru'),
    new.email,
    'trial',
    true,
    now() + interval '7 days' -- masa trial 7 hari sebelum diminta pilih paket
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger saat_ada_pendaftaran_baru
  after insert on auth.users
  for each row execute function public.buat_profil_guru_otomatis();
