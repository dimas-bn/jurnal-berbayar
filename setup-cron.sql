-- ============================================================
-- SETUP CRON: Panggil Edge Function reminder-jurnal otomatis
-- Jalankan di Supabase Dashboard > SQL Editor
-- Prasyarat: extension pg_cron dan pg_net sudah aktif
-- (Dashboard > Database > Extensions > cari "pg_cron" & "pg_net" > Enable)
-- ============================================================

select
  cron.schedule(
    'reminder-jurnal-harian',       -- nama job, bebas tapi harus unik
    '30 8 * * 1-6',                 -- 08:30 UTC = 15:30 WIB, Senin-Sabtu
    $$
    select
      net.http_post(
        url := 'https://eziszpzxszxurvqcsikj.supabase.co/functions/v1/reminder-jurnal',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6aXN6cHp4c3p4dXJ2cWNzaWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNjMzNTYsImV4cCI6MjEwMTgzOTM1Nn0.q9YdOK9ph_WqDYhPfNVTqTVdKuMPLPFLicLBsOg5ivQ'
        ),
        body := '{}'::jsonb
      );
    $$
  );

-- Catatan:
-- - PROJECT_REF sudah diisi (eziszpzxszxurvqcsikj), tidak perlu diganti.
-- - Ganti <TEMPEL_ANON_KEY_DI_SINI> dengan anon key dari
--   Project Settings > API > Project API keys > anon public.
--   (function sendiri sudah pakai SERVICE_ROLE_KEY secara internal
--   untuk akses data, jadi header Authorization di sini cukup pakai
--   anon key, karena sudah terbukti berhasil dipakai saat uji coba manual).
-- - Untuk cek/hapus/lihat jadwal cron yang sudah dibuat:
--     select * from cron.job;
--     select cron.unschedule('reminder-jurnal-harian');
