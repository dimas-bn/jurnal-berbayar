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
import * as XLSX from "npm:xlsx@0.18.5";

const BATAS_LAMPIRAN_PER_PANGGILAN = 50; // pengaman skala: maksimal 50 backup di-generate per eksekusi

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

    // Urutkan: yang paling dekat kadaluarsa diproses duluan, supaya kalau batas
    // BATAS_LAMPIRAN_PER_PANGGILAN tercapai, yang paling mendesak tetap terjamin terkirim.
    const grupTerurut = Array.from(grup.values()).sort(
      (a, b) => new Date(a.kadaluarsa).getTime() - new Date(b.kadaluarsa).getTime(),
    );
    let jumlahLampiranDibuat = 0;

    // 2. Ambil data guru (nama & email) untuk semua guru yang terlibat
    const guruIds = Array.from(new Set(Array.from(grup.values()).map((g) => g.guru_id)));
    const { data: paraGuru } = await supabase.from("profil_guru").select("id, nama_lengkap, email").in("id", guruIds);
    const petaGuru = new Map((paraGuru ?? []).map((g) => [g.id, g]));

    const hasilHapus: string[] = [];
    const hasilReminder: string[] = [];

    async function buatLampiranBackup(guru_id: string, kadaluarsa: string) {
      const { data: jurnalArsip } = await supabase.from("arsip_jurnal")
        .select("id, tanggal, hari, jam_ke, mapel, materi, kelas_id")
        .eq("guru_id", guru_id).eq("kadaluarsa_pada", kadaluarsa);
      const idJurnal = (jurnalArsip ?? []).map((j) => j.id);

      const { data: absensiArsip } = idJurnal.length
        ? await supabase.from("arsip_absensi").select("jurnal_id, status, keterangan, poin, siswa_id").in("jurnal_id", idJurnal)
        : { data: [] };

      const { data: siswaArsip } = await supabase.from("arsip_siswa").select("id, nama_siswa").eq("guru_id", guru_id).eq("kadaluarsa_pada", kadaluarsa);
      const { data: kelasArsip } = await supabase.from("arsip_kelas").select("id, nama_kelas").eq("guru_id", guru_id).eq("kadaluarsa_pada", kadaluarsa);
      const petaSiswa = new Map((siswaArsip ?? []).map((s) => [s.id, s.nama_siswa]));
      const petaKelas = new Map((kelasArsip ?? []).map((k) => [k.id, k.nama_kelas]));

      const barisJurnal = [["Tanggal", "Hari", "Jam Ke", "Kelas", "Mapel", "Materi", "Nama Siswa", "Status", "Keterangan", "Poin"]];
      (jurnalArsip ?? []).forEach((j) => {
        const absensiJ = (absensiArsip ?? []).filter((a) => a.jurnal_id === j.id);
        if (!absensiJ.length) {
          barisJurnal.push([j.tanggal, j.hari, j.jam_ke, petaKelas.get(j.kelas_id) ?? "", j.mapel ?? "", j.materi ?? "", "", "", "", ""]);
        }
        absensiJ.forEach((a) => {
          barisJurnal.push([j.tanggal, j.hari, j.jam_ke, petaKelas.get(j.kelas_id) ?? "", j.mapel ?? "", j.materi ?? "", petaSiswa.get(a.siswa_id) ?? "", a.status, a.keterangan ?? "", a.poin]);
        });
      });

      const { data: nilaiArsip } = await supabase.from("arsip_nilai")
        .select("tanggal, jenis, nama_penilaian, nilai, catatan, kelas_id, siswa_id")
        .eq("guru_id", guru_id).eq("kadaluarsa_pada", kadaluarsa);
      const barisNilai = [["Tanggal", "Kelas", "Nama Siswa", "Jenis", "Nama Penilaian", "Nilai", "Catatan"]];
      (nilaiArsip ?? []).forEach((n) => {
        barisNilai.push([n.tanggal, petaKelas.get(n.kelas_id) ?? "", petaSiswa.get(n.siswa_id) ?? "", n.jenis, n.nama_penilaian, n.nilai, n.catatan ?? ""]);
      });

      const { data: catatanArsip } = await supabase.from("arsip_catatan_persiapan")
        .select("tanggal, teks, kelas_id")
        .eq("guru_id", guru_id).eq("kadaluarsa_pada", kadaluarsa);
      const barisCatatan = [["Tanggal", "Kelas", "Catatan Persiapan"]];
      (catatanArsip ?? []).forEach((c) => {
        barisCatatan.push([c.tanggal, petaKelas.get(c.kelas_id) ?? "", c.teks]);
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(barisJurnal), "Jurnal & Absensi");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(barisNilai), "Nilai");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(barisCatatan), "Catatan Persiapan");
      const buffer = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
      return buffer;
    }

    for (const { guru_id, kadaluarsa } of grupTerurut) {
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

      // Pengaman skala: kalau sudah mencapai batas per panggilan, lewati
      // pembuatan lampiran (email tetap terkirim TANPA lampiran, plus
      // instruksi manual) -- kesempatan berikutnya (cron berjalan lagi)
      // akan coba generate lampirannya.
      let lampiranBase64: string | null = null;
      if (jumlahLampiranDibuat < BATAS_LAMPIRAN_PER_PANGGILAN) {
        try {
          lampiranBase64 = await buatLampiranBackup(guru_id, kadaluarsa);
          jumlahLampiranDibuat++;
        } catch (e) {
          console.warn("[Backup] Gagal generate lampiran untuk", guru_id, e);
        }
      }

      const emailPayload: Record<string, unknown> = {
        from: fromEmail,
        to: guru.email,
        subject: `${tipeReminder === "H-7" ? "Pengingat" : "PENTING"}: Arsip JMO akan dihapus permanen ${tipeReminder === "H-7" ? "dalam 7 hari" : "besok"}`,
        text:
          `Halo, Bapak/Ibu ${guru.nama_lengkap}.\n\n` +
          `Arsip data JMO Anda (jurnal, absensi, nilai, catatan persiapan${tipeReminder ? ", dan mungkin kelas/siswa/jadwal jika ini arsip tahun ajaran" : ""}) ` +
          `akan dihapus permanen pada ${tglFormat}.\n\n` +
          (lampiranBase64
            ? `Sebagai jaga-jaga, kami lampirkan salinan data tersebut (Excel) di email ini.\n\n`
            : `Jika masih ada data yang ingin disimpan, segera login dan buka tab Riwayat > pilih semester arsip terkait > Export Semua Data (Excel).\n\n`) +
          `Setelah tanggal tersebut, data TIDAK BISA dipulihkan lagi.\n\n` +
          `Terima kasih,\nJurnal Mengajar Online (JMO)`,
      };
      if (lampiranBase64) {
        emailPayload.attachments = [{ filename: `Backup-Arsip-JMO-${kadaluarsa}.xlsx`, content: lampiranBase64 }];
      }

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(emailPayload),
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