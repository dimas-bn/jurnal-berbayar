-- ============================================================
-- SETUP CRON: Panggil Edge Function update-streak-jurnal otomatis
-- Jalankan di Supabase Dashboard > SQL Editor setelah function
-- di-deploy. Prasyarat: pg_cron & pg_net sudah aktif (sudah aktif
-- sejak setup reminder-jurnal sebelumnya, tidak perlu diaktifkan ulang).
-- ============================================================

select
  cron.schedule(
    'update-streak-jurnal-harian',
    '0 14 * * *',        -- 14:00 UTC = 21:00 WIB, setiap hari
    $$
    select
      net.http_post(
        url := 'https://eziszpzxszxurvqcsikj.supabase.co/functions/v1/update-streak-jurnal',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6aXN6cHp4c3p4dXJ2cWNzaWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNjMzNTYsImV4cCI6MjEwMTgzOTM1Nn0.q9YdOK9ph_WqDYhPfNVTqTVdKuMPLPFLicLBsOg5ivQ'
        ),
        body := '{}'::jsonb
      );
    $$
  );

-- Catatan: pakai anon key yang sama seperti dipakai di setup-cron.sql
-- (reminder-jurnal) sebelumnya -- tinggal disalin dari sana kalau masih
-- tersimpan, atau ambil ulang dari Project Settings > API > anon public.
--
-- Cek/hapus jadwal kalau perlu:
--   select * from cron.job;
--   select cron.unschedule('update-streak-jurnal-harian');
