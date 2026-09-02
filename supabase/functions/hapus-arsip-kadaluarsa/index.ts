// Supabase Edge Function: hapus-arsip-kadaluarsa
//
// Cara deploy:
//   supabase functions deploy hapus-arsip-kadaluarsa
//
// Cara jadwalkan (Supabase Dashboard > Database > Cron Jobs):
//   Jalankan 1x sehari, pagi hari (misal 08:00 WIB / 01:00 UTC)
//
// Environment variables (sama seperti reminder-jurnal):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, REMINDER_FROM_EMAIL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TABEL_ARSIP = ["arsip_jurnal", "arsip_absensi", "arsip_nilai", "arsip_catatan_persiapan", "arsip_kelas", "arsip_siswa", "arsip_jadwal"];
const TABEL_SUMBER_GRUP = ["arsip_jurnal", "arsip_nilai", "arsip_catatan_persiapan", "arsip_kelas"]; // cukup ini untuk temukan semua guru+kadaluarsa unik

Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
    const fromEmail = Deno.env.get("REMINDER_FROM_EMAIL")!;
    const sekarang = new Date();

    // 1. Kumpulkan semua kombinasi unik (guru_id, kadaluarsa_pada) dari semua tabel arsip
    const grup = new Map<string, { guru_id: string; kadaluarsa: string }>();
    for (const tabel of TABEL_SUMBER_GRUP) {
      const { data } = await supabase.from(tabel).select("guru_id, kadaluarsa_pada").not("kadaluarsa_pada", "is", null);
      for (const row of data ?? []) {
        const key = `${row.guru_id}|${row.kadaluarsa_pada}`;
        if (!grup.has(key)) grup.set(key, { guru_id: row.guru_id, kadaluarsa: row.kadaluarsa_pada });
      }
    }

    if (grup.size === 0) {
      return new Response(JSON.stringify({ message: "Tidak ada arsip berkadaluarsa." }), { status: 200 });
    }

    // 2. Ambil data guru (nama & email) untuk semua guru yang terlibat
    const guruIds = Array.from(new Set(Array.from(grup.values()).map((g) => g.guru_id)));
    const { data: paraGuru } = await supabase.from("profil_guru").select("id, nama_lengkap, email").in("id", guruIds);
    const petaGuru = new Map((paraGuru ?? []).map((g) => [g.id, g]));

    const hasilHapus: string[] = [];
    const hasilReminder: string[] = [];

    for (const { guru_id, kadaluarsa } of grup.values()) {
      const guru = petaGuru.get(guru_id);
      if (!guru?.email) continue;

      const tglKadaluarsa = new Date(kadaluarsa);
      const sisaHari = Math.ceil((tglKadaluarsa.getTime() - sekarang.getTime()) / (1000 * 60 * 60 * 24));

      if (sisaHari <= 0) {
        // 3a. SUDAH KADALUARSA — hapus permanen dari semua tabel arsip
        for (const tabel of TABEL_ARSIP) {
          await supabase.from(tabel).delete().eq("guru_id", guru_id).eq("kadaluarsa_pada", kadaluarsa);
        }
        await supabase.from("arsip_reminder_log").delete().eq("guru_id", guru_id).eq("kadaluarsa_pada", kadaluarsa);
        hasilHapus.push(guru_id);
        continue;
      }

      // 3b. BELUM KADALUARSA — cek apakah perlu kirim reminder H-7 atau H-1
      let tipeReminder: string | null = null;
      if (sisaHari === 7) tipeReminder = "H-7";
      else if (sisaHari === 1) tipeReminder = "H-1";
      if (!tipeReminder) continue;

      const { data: sudahAda } = await supabase.from("arsip_reminder_log")
        .select("id").eq("guru_id", guru_id).eq("kadaluarsa_pada", kadaluarsa).eq("tipe", tipeReminder).maybeSingle();
      if (sudahAda) continue;

      const tglFormat = tglKadaluarsa.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromEmail,
          to: guru.email,
          subject: `${tipeReminder === "H-7" ? "Pengingat" : "PENTING"}: Arsip JMO akan dihapus permanen ${tipeReminder === "H-7" ? "dalam 7 hari" : "besok"}`,
          text:
            `Halo, Bapak/Ibu ${guru.nama_lengkap}.\n\n` +
            `Arsip data JMO Anda (jurnal, absensi, nilai, catatan persiapan${tipeReminder ? ", dan mungkin kelas/siswa/jadwal jika ini arsip tahun ajaran" : ""}) ` +
            `akan dihapus permanen pada ${tglFormat}.\n\n` +
            `Jika masih ada data yang ingin disimpan, segera login dan buka tab Riwayat > pilih semester arsip terkait > Export Semua Data (Excel).\n\n` +
            `Setelah tanggal tersebut, data TIDAK BISA dipulihkan lagi.\n\n` +
            `Terima kasih,\nJurnal Mengajar Online (JMO)`,
        }),
      });

      if (emailRes.ok) {
        await supabase.from("arsip_reminder_log").insert({ guru_id, kadaluarsa_pada: kadaluarsa, tipe: tipeReminder });
        hasilReminder.push(`${guru_id} (${tipeReminder})`);
      }
    }

    return new Response(
      JSON.stringify({ message: "Selesai.", dihapus: hasilHapus, reminder_terkirim: hasilReminder }),
      { status: 200 },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});