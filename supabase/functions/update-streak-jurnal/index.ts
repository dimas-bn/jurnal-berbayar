// Supabase Edge Function: update-streak-jurnal
//
// Cara deploy:
//   supabase functions deploy update-streak-jurnal
//
// Jalan otomatis 1x sehari jam 21:00 WIB (lewat pg_cron, lihat
// setup-cron-streak.sql). Logika:
//   1. Ambil semua guru yang punya jadwal HARI INI.
//   2. Untuk tiap guru: cek apakah SEMUA slot jadwal hari ini sudah
//      ada jurnalnya.
//      - Kalau lengkap  -> streak_jurnal + 1
//      - Kalau ada yang bolong -> streak_jurnal = 0
//   3. Guru yang TIDAK punya jadwal hari ini -> dilewati, streak
//      tidak disentuh sama sekali (hari libur/tidak mengajar tidak
//      memutus ataupun menambah streak).
//   4. Dijaga idempotent lewat kolom streak_terakhir_update -- kalau
//      sudah dievaluasi hari ini, tidak dihitung ulang.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

Deno.serve(async (req) => {
  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const tanggalHariIni = wib.toISOString().slice(0, 10);
    const hariIni = HARI_ID[wib.getUTCDay()];

    // 1. Jadwal hari ini, per guru
    const { data: jadwalHariIni, error: errJadwal } = await supabase
      .from("jadwal")
      .select("guru_id, kelas_id, jam_ke")
      .eq("hari", hariIni);
    if (errJadwal) throw errJadwal;

    if (!jadwalHariIni || jadwalHariIni.length === 0) {
      return new Response(JSON.stringify({ message: "Tidak ada jadwal hari ini, streak tidak ada yang dievaluasi." }), { status: 200 });
    }

    // Kelompokkan jadwal per guru
    const jadwalPerGuru = new Map<string, { kelas_id: string; jam_ke: string }[]>();
    for (const j of jadwalHariIni) {
      if (!jadwalPerGuru.has(j.guru_id)) jadwalPerGuru.set(j.guru_id, []);
      jadwalPerGuru.get(j.guru_id)!.push({ kelas_id: j.kelas_id, jam_ke: j.jam_ke });
    }

    // 2. Cek guru mana yang sudah dievaluasi hari ini (jaga idempotent)
    const guruIds = [...jadwalPerGuru.keys()];
    const { data: profilList, error: errProfil } = await supabase
      .from("profil_guru")
      .select("id, streak_jurnal, streak_terakhir_update")
      .in("id", guruIds);
    if (errProfil) throw errProfil;

    const profilMap = new Map((profilList ?? []).map((p) => [p.id, p]));

    // 3. Jurnal yang sudah diisi hari ini
    const { data: jurnalHariIni, error: errJurnal } = await supabase
      .from("jurnal")
      .select("guru_id, kelas_id, jam_ke")
      .eq("tanggal", tanggalHariIni);
    if (errJurnal) throw errJurnal;

    const sudahDiisi = new Set(
      (jurnalHariIni ?? []).map((j) => `${j.guru_id}@${j.kelas_id}@${j.jam_ke}`),
    );

    // 4. Evaluasi tiap guru
    const hasil: { guru_id: string; status: string; streak_baru?: number }[] = [];

    for (const [guruId, slots] of jadwalPerGuru) {
      const profil = profilMap.get(guruId);
      if (!profil) continue; // guru tidak ditemukan (jarang terjadi), lewati

      // Sudah dievaluasi hari ini -> jangan dihitung dobel
      if (profil.streak_terakhir_update === tanggalHariIni) {
        hasil.push({ guru_id: guruId, status: "sudah_dievaluasi_hari_ini" });
        continue;
      }

      const semuaLengkap = slots.every((s) =>
        sudahDiisi.has(`${guruId}@${s.kelas_id}@${s.jam_ke}`),
      );

      const streakBaru = semuaLengkap ? (profil.streak_jurnal ?? 0) + 1 : 0;

      const { error: errUpdate } = await supabase
        .from("profil_guru")
        .update({ streak_jurnal: streakBaru, streak_terakhir_update: tanggalHariIni })
        .eq("id", guruId);

      if (errUpdate) {
        hasil.push({ guru_id: guruId, status: `gagal_update: ${errUpdate.message}` });
        continue;
      }

      hasil.push({
        guru_id: guruId,
        status: semuaLengkap ? "streak_lanjut" : "streak_reset",
        streak_baru: streakBaru,
      });
    }

    return new Response(JSON.stringify({ message: `Streak dievaluasi untuk ${hasil.length} guru.`, detail: hasil }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
