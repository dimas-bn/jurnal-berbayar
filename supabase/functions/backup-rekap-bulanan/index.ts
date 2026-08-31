// Supabase Edge Function: backup-rekap-bulanan
//
// Cara deploy:
//   supabase functions deploy backup-rekap-bulanan
//
// Cara jadwalkan (Supabase Dashboard > Database > Cron Jobs):
//   Jalankan 1x tiap tanggal 1, pagi hari (misal 07:00 WIB / 00:00 UTC)
//
// Environment variables (sama seperti reminder-jurnal):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, REMINDER_FROM_EMAIL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NAMA_BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const HARI_ID = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];

function rentangBulan(offsetBulan: number, wib: Date) {
  // offsetBulan: 0 = bulan lalu, 1 = 2 bulan lalu (buat pembanding)
  const awal = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth() - 1 - offsetBulan, 1));
  const akhir = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth() - offsetBulan, 1));
  return { awal, akhir, tglAwal: awal.toISOString().slice(0, 10), tglAkhir: akhir.toISOString().slice(0, 10) };
}

Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
    const fromEmail = Deno.env.get("REMINDER_FROM_EMAIL")!;

    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);

    const bulanIni = rentangBulan(0, wib);       // bulan yang direkap
    const bulanSebelum = rentangBulan(1, wib);   // buat pembanding

    const namaBulanLalu = NAMA_BULAN[bulanIni.awal.getUTCMonth()];
    const tahunLalu = bulanIni.awal.getUTCFullYear();

    // 0. Peta nama kelas (dipakai berkali-kali di bawah)
    const { data: semuaKelas } = await supabase.from("kelas").select("id, nama_kelas");
    const namaKelas = new Map<string, string>((semuaKelas ?? []).map((k) => [k.id, k.nama_kelas]));

    // 1. Jurnal bulan yang direkap
    const { data: jurnalBulanLalu, error: errJurnal } = await supabase
      .from("jurnal")
      .select(`id, guru_id, kelas_id, tanggal, guru:guru_id ( nama_lengkap, email )`)
      .gte("tanggal", bulanIni.tglAwal)
      .lt("tanggal", bulanIni.tglAkhir);

    if (errJurnal) throw errJurnal;
    if (!jurnalBulanLalu || jurnalBulanLalu.length === 0) {
      return new Response(JSON.stringify({ message: "Tidak ada jurnal bulan lalu." }), { status: 200 });
    }

    type InfoGuru = {
      nama: string; email: string; totalJurnal: number;
      perHari: Record<string, number>;
      status: Record<string, number>; totalPoin: number; jumlahPoin: number;
      perKelas: Map<string, { hadir: number; total: number; poin: number }>;
      perSiswaPoin: Map<string, { nama: string; kelasId: string; poin: number }>;
      perSiswaAlpa: Map<string, { nama: string; kelasId: string; jumlah: number }>;
      catatanPersiapan: number;
    };

    const jurnalInfo = new Map<string, { guru_id: string; kelas_id: string }>();
    const perGuru = new Map<string, InfoGuru>();
    const kosongkanStatus = () => ({ Hadir: 0, Izin: 0, Sakit: 0, Dispensasi: 0, Alpa: 0 });

    for (const j of jurnalBulanLalu) {
      const guru = Array.isArray(j.guru) ? j.guru[0] : j.guru;
      if (!guru?.email) continue;
      jurnalInfo.set(j.id, { guru_id: j.guru_id, kelas_id: j.kelas_id });

      if (!perGuru.has(j.guru_id)) {
        perGuru.set(j.guru_id, {
          nama: guru.nama_lengkap, email: guru.email, totalJurnal: 0,
          perHari: {}, status: kosongkanStatus(), totalPoin: 0, jumlahPoin: 0,
          perKelas: new Map(), perSiswaPoin: new Map(), perSiswaAlpa: new Map(),
          catatanPersiapan: 0,
        });
      }
      const info = perGuru.get(j.guru_id)!;
      info.totalJurnal += 1;

      const hari = HARI_ID[new Date(j.tanggal + "T00:00:00Z").getUTCDay()];
      info.perHari[hari] = (info.perHari[hari] ?? 0) + 1;
    }

    // 2. Absensi bulan yang direkap
    const idJurnalList = Array.from(jurnalInfo.keys());
    const { data: absensiBulanLalu, error: errAbsensi } = await supabase
      .from("absensi")
      .select("jurnal_id, siswa_id, status, poin, siswa:siswa_id ( nama_siswa )")
      .in("jurnal_id", idJurnalList);

    if (errAbsensi) throw errAbsensi;

    for (const a of absensiBulanLalu ?? []) {
      const info2 = jurnalInfo.get(a.jurnal_id);
      if (!info2 || !perGuru.has(info2.guru_id)) continue;
      const info = perGuru.get(info2.guru_id)!;
      const siswa = Array.isArray(a.siswa) ? a.siswa[0] : a.siswa;
      const kelasId = info2.kelas_id;

      if (a.status in info.status) info.status[a.status] += 1;
      if (typeof a.poin === "number") { info.totalPoin += a.poin; info.jumlahPoin += 1; }

      if (!info.perKelas.has(kelasId)) info.perKelas.set(kelasId, { hadir: 0, total: 0, poin: 0 });
      const k = info.perKelas.get(kelasId)!;
      k.total += 1;
      if (a.status === "Hadir") k.hadir += 1;
      if (typeof a.poin === "number") k.poin += a.poin;

      if (siswa?.nama_siswa && typeof a.poin === "number") {
        if (!info.perSiswaPoin.has(a.siswa_id)) info.perSiswaPoin.set(a.siswa_id, { nama: siswa.nama_siswa, kelasId, poin: 0 });
        info.perSiswaPoin.get(a.siswa_id)!.poin += a.poin;
      }
      if (siswa?.nama_siswa && a.status === "Alpa") {
        if (!info.perSiswaAlpa.has(a.siswa_id)) info.perSiswaAlpa.set(a.siswa_id, { nama: siswa.nama_siswa, kelasId, jumlah: 0 });
        info.perSiswaAlpa.get(a.siswa_id)!.jumlah += 1;
      }
    }

    // 3. Catatan persiapan bulan yang direkap
    const { data: catatanBulanLalu } = await supabase
      .from("catatan_persiapan")
      .select("guru_id")
      .gte("tanggal", bulanIni.tglAwal)
      .lt("tanggal", bulanIni.tglAkhir);

    for (const c of catatanBulanLalu ?? []) {
      if (perGuru.has(c.guru_id)) perGuru.get(c.guru_id)!.catatanPersiapan += 1;
    }

    // 4. Data bulan sebelumnya (ringan, cuma buat pembanding)
    const { data: jurnalSebelum } = await supabase
      .from("jurnal")
      .select("id, guru_id")
      .gte("tanggal", bulanSebelum.tglAwal)
      .lt("tanggal", bulanSebelum.tglAkhir);

    const jurnalIdSebelumToGuru = new Map<string, string>();
    const totalJurnalSebelum = new Map<string, number>();
    for (const j of jurnalSebelum ?? []) {
      jurnalIdSebelumToGuru.set(j.id, j.guru_id);
      totalJurnalSebelum.set(j.guru_id, (totalJurnalSebelum.get(j.guru_id) ?? 0) + 1);
    }

    const idJurnalSebelumList = Array.from(jurnalIdSebelumToGuru.keys());
    const kehadiranSebelum = new Map<string, { hadir: number; total: number }>();
    if (idJurnalSebelumList.length > 0) {
      const { data: absensiSebelum } = await supabase
        .from("absensi").select("jurnal_id, status").in("jurnal_id", idJurnalSebelumList);
      for (const a of absensiSebelum ?? []) {
        const guruId = jurnalIdSebelumToGuru.get(a.jurnal_id);
        if (!guruId) continue;
        if (!kehadiranSebelum.has(guruId)) kehadiranSebelum.set(guruId, { hadir: 0, total: 0 });
        const kk = kehadiranSebelum.get(guruId)!;
        kk.total += 1;
        if (a.status === "Hadir") kk.hadir += 1;
      }
    }

    // 5. Susun & kirim email per guru
    const jumlahHariBulan = Math.round((bulanIni.akhir.getTime() - bulanIni.awal.getTime()) / 86400000);
    const jumlahMinggu = jumlahHariBulan / 7;
    const hasilKirim: { guru_id: string; status: string }[] = [];

    for (const [guruId, info] of perGuru) {
      const rataPoin = info.jumlahPoin > 0 ? (info.totalPoin / info.jumlahPoin).toFixed(1) : "-";
      const rincianKehadiran = Object.entries(info.status).map(([s, jml]) => `- ${s}: ${jml}`).join("\n");

      const totalAbsensi = Object.values(info.status).reduce((a, b) => a + b, 0);
      const persenHadir = totalAbsensi > 0 ? ((info.status.Hadir / totalAbsensi) * 100).toFixed(1) : "-";

      let hariTeraktif = "-";
      let maxHari = -1;
      for (const [h, jml] of Object.entries(info.perHari)) if (jml > maxHari) { maxHari = jml; hariTeraktif = h; }

      const rataPerMinggu = (info.totalJurnal / jumlahMinggu).toFixed(1);

      const kelasArr = Array.from(info.perKelas.entries()).map(([kid, v]) => ({
        nama: namaKelas.get(kid) ?? "-",
        persen: v.total > 0 ? (v.hadir / v.total) * 100 : 0,
        poin: v.poin,
      }));
      kelasArr.sort((a, b) => b.persen - a.persen);
      const kelasTertinggi = kelasArr[0];
      const kelasTerendah = kelasArr[kelasArr.length - 1];
      const daftarPoinKelas = kelasArr.map((k) => `- ${k.nama}: ${k.poin} poin`).join("\n");

      const top3Poin = Array.from(info.perSiswaPoin.values())
        .sort((a, b) => b.poin - a.poin).slice(0, 3)
        .map((s, i) => `${i + 1}. ${s.nama} (${namaKelas.get(s.kelasId) ?? "-"}) — ${s.poin} poin`).join("\n") || "-";

      const top3Alpa = Array.from(info.perSiswaAlpa.values())
        .sort((a, b) => b.jumlah - a.jumlah).slice(0, 3)
        .map((s, i) => `${i + 1}. ${s.nama} (${namaKelas.get(s.kelasId) ?? "-"}) — ${s.jumlah}x Alpa`).join("\n") || "-";

      const jurnalDulu = totalJurnalSebelum.get(guruId) ?? 0;
      const selisihJurnal = info.totalJurnal - jurnalDulu;
      const tandaJurnal = selisihJurnal > 0 ? `naik ${selisihJurnal}` : selisihJurnal < 0 ? `turun ${Math.abs(selisihJurnal)}` : "sama";

      const kehDulu = kehadiranSebelum.get(guruId);
      const persenDulu = kehDulu && kehDulu.total > 0 ? (kehDulu.hadir / kehDulu.total) * 100 : null;
      const persenSekarang = totalAbsensi > 0 ? (info.status.Hadir / totalAbsensi) * 100 : null;
      let tandaKehadiran = "tidak ada data bulan sebelumnya";
      if (persenDulu !== null && persenSekarang !== null) {
        const selisih = (persenSekarang - persenDulu).toFixed(1);
        tandaKehadiran = persenSekarang >= persenDulu ? `naik ${selisih}%` : `turun ${Math.abs(Number(selisih))}%`;
      }

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
            `Total jurnal terisi: ${info.totalJurnal} (${tandaJurnal} dibanding bulan sebelumnya)\n` +
            `Hari paling aktif mengisi jurnal: ${hariTeraktif}\n` +
            `Rata-rata jurnal per minggu: ${rataPerMinggu}\n\n` +
            `Rekap kehadiran siswa:\n${rincianKehadiran}\n` +
            `Persentase kehadiran: ${persenHadir}% (${tandaKehadiran} dibanding bulan sebelumnya)\n\n` +
            `Kelas kehadiran tertinggi: ${kelasTertinggi ? `${kelasTertinggi.nama} (${kelasTertinggi.persen.toFixed(1)}%)` : "-"}\n` +
            `Kelas kehadiran terendah: ${kelasTerendah ? `${kelasTerendah.nama} (${kelasTerendah.persen.toFixed(1)}%)` : "-"}\n\n` +
            `Total poin terkumpul per kelas:\n${daftarPoinKelas || "-"}\n\n` +
            `Rata-rata poin siswa: ${rataPoin}\n\n` +
            `Siswa dengan poin tertinggi:\n${top3Poin}\n\n` +
            `Siswa dengan Alpa terbanyak:\n${top3Alpa}\n\n` +
            `Catatan persiapan mengajar dibuat: ${info.catatanPersiapan}\n\n` +
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