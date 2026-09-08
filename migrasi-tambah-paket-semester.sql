-- Migrasi: menambahkan 'semester' ke constraint kolom paket (sudah dieksekusi manual di SQL Editor Supabase, 07-08 Sep 2026)
alter table profil_guru drop constraint profil_guru_paket_check;
alter table profil_guru add constraint profil_guru_paket_check check (paket in ('trial', 'bulanan', 'semester', 'tahunan', 'lifetime'));
