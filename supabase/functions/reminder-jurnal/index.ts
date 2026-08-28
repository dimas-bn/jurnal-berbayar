// Supabase Edge Function: reminder-jurnal
//
// Cara deploy:
//   supabase functions deploy reminder-jurnal
//
// Cara jadwalkan (via Supabase Dashboard > Database > Cron Jobs,
// atau lewat SQL memakai extension pg_cron + pg_net):
//   Jalankan 1x sehari, sore hari (misal 15:30 WIB / 08:30 UTC),
//   dari Senin-Sabtu, supaya seluruh jadwal hari itu sudah lewat.
//
// Environment variables yang dibutuhkan (set lewat
// `supabase secrets set`):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (bukan anon key — perlu akses lintas guru)
//   RESEND_API_KEY
//   REMINDER_FROM_EMAIL         (misal: "JMO <reminder@jurnalmengajar.web.id>")

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
    const fromEmail = Deno.env.get("REMINDER_FROM_EMAIL")!;

    // Tanggal & hari "hari ini" berdasarkan zona waktu Jakarta (WIB, UTC+7)
    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const tanggalHariIni = wib.toISOString().slice(0, 10); // format YYYY-MM-DD
    const hariIni = HARI_ID[wib.getUTCDay()];

    // 1. Ambil semua jadwal hari ini, lengkap dengan data guru & kelas
    const { data: jadwalHariIni, error: errJadwal } = await supabase
      .from("jadwal")
      .select(`
        id, jam_ke, guru_id, kelas_id,
        guru:guru_id ( nama_lengkap, email ),
        kelas:kelas_id ( nama_kelas, mata_pelajaran )
      `)
      .eq("hari", hariIni);

    if (errJadwal) throw errJadwal;
    if (!jadwalHariIni || jadwalHariIni.length === 0) {
      return new Response(JSON.stringify({ message: "Tidak ada jadwal hari ini." }), { status: 200 });
    }

    // 2. Ambil semua jurnal yang SUDAH diisi hari ini
    const { data: jurnalHariIni, error: errJurnal } = await supabase
      .from("jurnal")
      .select("guru_id, kelas_id, jam_ke")
      .eq("tanggal", tanggalHariIni);

    if (errJurnal) throw errJurnal;

    const sudahDiisi = new Set(
      (jurnalHariIni ?? []).map((j) => `${j.guru_id}@${j.kelas_id}@${j.jam_ke}`),
    );

    // 3. Cari slot jadwal yang belum ada jurnalnya
    const belumDiisi = jadwalHariIni.filter(
      (j) => !sudahDiisi.has(`${j.guru_id}@${j.kelas_id}@${j.jam_ke}`),
    );

    if (belumDiisi.length === 0) {
      return new Response(JSON.stringify({ message: "Semua jurnal hari ini sudah diisi." }), { status: 200 });
    }

    // 4. Cek reminder_log — buang slot yang reminder-nya sudah pernah dikirim
    //    (supaya function ini aman dipanggil berkali-kali / idempotent)
    const { data: sudahDireminder, error: errLog } = await supabase
      .from("reminder_log")
      .select("guru_id, kelas_id, jam_ke")
      .eq("tanggal", tanggalHariIni);

    if (errLog) throw errLog;

    const sudahDireminderSet = new Set(
      (sudahDireminder ?? []).map((r) => `${r.guru_id}@${r.kelas_id}@${r.jam_ke}`),
    );

    const perluDireminder = belumDiisi.filter(
      (j) => !sudahDireminderSet.has(`${j.guru_id}@${j.kelas_id}@${j.jam_ke}`),
    );

    if (perluDireminder.length === 0) {
      return new Response(JSON.stringify({ message: "Semua reminder untuk hari ini sudah pernah dikirim." }), { status: 200 });
    }

    // 5. Kelompokkan per guru (1 guru bisa punya beberapa kelas yang belum diisi)
    const perGuru = new Map<string, { nama: string; email: string; kelasList: string[] }>();

    for (const item of perluDireminder) {
      const guru = Array.isArray(item.guru) ? item.guru[0] : item.guru;
      const kelas = Array.isArray(item.kelas) ? item.kelas[0] : item.kelas;
      if (!guru?.email) continue;

      if (!perGuru.has(item.guru_id)) {
        perGuru.set(item.guru_id, { nama: guru.nama_lengkap, email: guru.email, kelasList: [] });
      }
      perGuru.get(item.guru_id)!.kelasList.push(
        `${kelas?.nama_kelas ?? "-"} (${kelas?.mata_pelajaran ?? "-"}) — jam ke ${item.jam_ke}`,
      );
    }

    // 6. Kirim email lewat Resend, satu email per guru
    const hasilKirim: { guru_id: string; status: string }[] = [];

    for (const [guruId, info] of perGuru) {
      const daftarKelas = info.kelasList.map((k) => `- ${k}`).join("\n");

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: info.email,
          subject: "Pengingat: Ada jurnal mengajar hari ini yang belum diisi",
          text:
            `Halo, Bapak/Ibu ${info.nama}.\n\n` +
            `Berdasarkan jadwal hari ini (${hariIni}, ${tanggalHariIni}), ` +
            `masih ada kelas yang jurnalnya belum diisi:\n\n${daftarKelas}\n\n` +
            `Silakan login ke JMO untuk melengkapi jurnal hari ini.\n\n` +
            `Terima kasih,\nJurnal Mengajar Online (JMO)`,
        }),
      });

      const status = emailRes.ok ? "terkirim" : `gagal (${emailRes.status})`;
      hasilKirim.push({ guru_id: guruId, status });
    }

    // 7. Catat semua slot yang baru saja diproses ke reminder_log,
    //    terlepas dari apakah emailnya sukses atau gagal —
    //    supaya tidak dicoba berulang-ulang tiap hari yang sama.
    //    (Kalau mau retry otomatis saat gagal, baris ini bisa disesuaikan
    //    supaya hanya insert yang statusnya "terkirim".)
    const logRows = perluDireminder.map((j) => ({
      guru_id: j.guru_id,
      kelas_id: j.kelas_id,
      tanggal: tanggalHariIni,
      jam_ke: j.jam_ke,
    }));

    const { error: errInsertLog } = await supabase.from("reminder_log").insert(logRows);
    if (errInsertLog) throw errInsertLog;

    return new Response(
      JSON.stringify({
        message: `Reminder diproses untuk ${perGuru.size} guru.`,
        detail: hasilKirim,
      }),
      { status: 200 },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
