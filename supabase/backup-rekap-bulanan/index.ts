// Supabase Edge Function: backup-rekap-bulanan
//
// Cara deploy:
//   supabase functions deploy backup-rekap-bulanan
//
// Cara jadwalkan (Supabase Dashboard > Database > Cron Jobs):
//   Jalankan 1x tiap tanggal 1, pagi hari (misal 07:00 WIB / 00:00 UTC)
//   — merekap bulan yang baru saja selesai.
//
// Environment variables (sama seperti reminder-jurnal):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, REMINDER_FROM_EMAIL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NAMA_BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
    const fromEmail = Deno.env.get("REMINDER_FROM_EMAIL")!;

    // 1. Tentukan rentang bulan LALU (berdasarkan waktu WIB)
    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const awalBulanIni = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), 1));
    const awalBulanLalu = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth() - 1, 1));
    const namaBulanLalu = NAMA_BULAN[awalBulanLalu.getUTCMonth()];
    const tahunLalu = awalBulanLalu.getUTCFullYear();
    const tglAwal = awalBulanLalu.toISOString().slice(0, 10);
    const tglAkhir = awalBulanIni.toISOString().slice(0, 10); // eksklusif

    // 2. Ambil semua jurnal bulan lalu + data guru
    const { data: jurnalBulanLalu, error: errJurnal } = await supabase
      .from("jurnal")
      .select(`id, guru_id, tanggal, guru:guru_id ( nama_lengkap, email )`)
      .gte("tanggal", tglAwal)
      .lt("tanggal", tglAkhir);

    if (errJurnal) throw errJurnal;
    if (!jurnalBulanLalu || jurnalBulanLalu.length === 0) {
      return new Response(JSON.stringify({ message: "Tidak ada jurnal bulan lalu." }), { status: 200 });
    }

    const jurnalIdKeGuru = new Map<string, string>();
    const perGuru = new Map<string, { nama: string; email: string; totalJurnal: number; status: Record<string, number>; totalPoin: number; jumlahPoin: number }>();

    const kosongkanStatus = () => ({ Hadir: 0, Izin: 0, Sakit: 0, Dispensasi: 0, Alpa: 0 });

    for (const j of jurnalBulanLalu) {
      const guru = Array.isArray(j.guru) ? j.guru[0] : j.guru;
      if (!guru?.email) continue;
      jurnalIdKeGuru.set(j.id, j.guru_id);
      if (!perGuru.has(j.guru_id)) {
        perGuru.set(j.guru_id, { nama: guru.nama_lengkap, email: guru.email, totalJurnal: 0, status: kosongkanStatus(), totalPoin: 0, jumlahPoin: 0 });
      }
      perGuru.get(j.guru_id)!.totalJurnal += 1;
    }

    // 3. Ambil semua absensi yang jurnal_id-nya termasuk jurnal bulan lalu
    const idJurnalList = Array.from(jurnalIdKeGuru.keys());
    const { data: absensiBulanLalu, error: errAbsensi } = await supabase
      .from("absensi")
      .select("jurnal_id, status, poin")
      .in("jurnal_id", idJurnalList);

    if (errAbsensi) throw errAbsensi;

    for (const a of absensiBulanLalu ?? []) {
      const guruId = jurnalIdKeGuru.get(a.jurnal_id);
      if (!guruId || !perGuru.has(guruId)) continue;
      const info = perGuru.get(guruId)!;
      if (a.status in info.status) info.status[a.status] += 1;
      if (typeof a.poin === "number") { info.totalPoin += a.poin; info.jumlahPoin += 1; }
    }

    // 4. Kirim email rekap per guru
    const hasilKirim: { guru_id: string; status: string }[] = [];

    for (const [guruId, info] of perGuru) {
      const rataPoin = info.jumlahPoin > 0 ? (info.totalPoin / info.jumlahPoin).toFixed(1) : "-";
      const rincianKehadiran = Object.entries(info.status).map(([s, jml]) => `- ${s}: ${jml}`).join("\n");

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromEmail,
          to: info.email,
          subject: `Rekap Bulan ${namaBulanLalu} ${tahunLalu} — JMO`,
          text:
            `Halo, Bapak/Ibu ${info.nama}.\n\n` +
            `Berikut ringkasan aktivitas mengajar Anda bulan ${namaBulanLalu} ${tahunLalu}:\n\n` +
            `Total jurnal terisi: ${info.totalJurnal}\n\n` +
            `Rekap kehadiran siswa:\n${rincianKehadiran}\n\n` +
            `Rata-rata poin siswa: ${rataPoin}\n\n` +
            `Lihat rekap lengkap & detail per hari di dashboard:\n` +
            `https://member.jurnalmengajar.web.id/dashboard#rekap\n\n` +
            `Terima kasih,\nJurnal Mengajar Online (JMO)`,
        }),
      });

      hasilKirim.push({ guru_id: guruId, status: emailRes.ok ? "terkirim" : `gagal (${emailRes.status})` });
    }

    return new Response(
      JSON.stringify({ message: `Rekap bulanan diproses untuk ${perGuru.size} guru.`, detail: hasilKirim }),
      { status: 200 },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
