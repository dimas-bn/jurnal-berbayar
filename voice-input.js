// voice-input.js -- Isi materi jurnal dengan suara (Web Speech API)
// Taruh file ini sejajar dengan dashboard.html.
// Tambahkan <script src="voice-input.js"></script> di dashboard.html,
// SEBELUM tag </body> (boleh sejajar dengan offline-draft.js kalau ada).
//
// Cara kerja: menambahkan tombol "Rekam" di sebelah tombol Salin/Perbesar
// pada field "Materi / hal yang perlu dicatat". Suara diproses oleh mesin
// speech-to-text bawaan Chrome -- gratis, tidak menyentuh server JMO sama
// sekali. Hanya berfungsi di Chrome (Android & desktop); browser lain akan
// diberi tahu lewat pesan singkat saat tombol ditekan.

(function () {
  const textarea = document.getElementById('materi');
  const grupTombol = document.getElementById('btnPerbesarMateri')?.parentElement;
  if (!textarea || !grupTombol) return; // halaman/versi dashboard tidak cocok, jangan lanjut

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

  // Tombol status kecil untuk pesan error (tanpa bergantung ke toast internal dashboard.html)
  const statusEl = document.createElement('div');
  statusEl.style.cssText =
    'font-size:11px; color:#A63D3D; margin-top:4px; display:none;';
  textarea.insertAdjacentElement('afterend', statusEl);

  function tampilkanStatus(pesan) {
    statusEl.textContent = pesan;
    statusEl.style.display = 'block';
    clearTimeout(tampilkanStatus._timer);
    tampilkanStatus._timer = setTimeout(() => {
      statusEl.style.display = 'none';
    }, 5000);
  }

  const btnMic = document.createElement('button');
  btnMic.type = 'button';
  btnMic.id = 'btnRekamMateri';
  btnMic.className = 'entry-btn';
  btnMic.style.cssText = 'font-size:11.5px; padding:4px 9px;';
  btnMic.textContent = '🎙️ Rekam';
  grupTombol.insertBefore(btnMic, grupTombol.firstChild);

  if (!SpeechRecognitionCtor) {
    btnMic.addEventListener('click', () => {
      tampilkanStatus('Fitur rekam suara belum didukung di browser ini -- coba buka pakai Chrome.');
    });
    return;
  }

  let recognition = null;
  let sedangMerekam = false;

  function buatRecognition() {
    const r = new SpeechRecognitionCtor();
    r.lang = 'id-ID';
    r.continuous = true;
    r.interimResults = false;

    r.onresult = (event) => {
      let teksBaru = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          teksBaru += event.results[i][0].transcript;
        }
      }
      teksBaru = teksBaru.trim();
      if (teksBaru) {
        const perluSpasi =
          textarea.value && !/[\s\n]$/.test(textarea.value) ? ' ' : '';
        textarea.value += perluSpasi + teksBaru + '. ';
        // Beri tahu dashboard.html (kalau ada listener lain yang perlu tahu isi berubah)
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };

    r.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        tampilkanStatus('Izin mikrofon ditolak. Aktifkan izin mikrofon untuk situs ini di pengaturan browser.');
        hentikanRekam();
      } else if (event.error === 'no-speech') {
        // Wajar terjadi saat hening -- continuous mode akan otomatis lanjut lewat onend, tidak perlu ditindak.
      } else if (event.error === 'network') {
        tampilkanStatus('Koneksi bermasalah, rekam suara butuh internet aktif.');
      } else {
        console.warn('[VoiceInput] error:', event.error);
      }
    };

    r.onend = () => {
      // Chrome kadang menghentikan sesi otomatis walau continuous=true --
      // selama tombol masih dalam status "merekam", sambung lagi otomatis.
      if (sedangMerekam) {
        try {
          r.start();
        } catch (e) {
          // Kalau gagal restart (mis. tab tidak aktif), hentikan status resmi
          hentikanRekam();
        }
      }
    };

    return r;
  }

  function mulaiRekam() {
    recognition = buatRecognition();
    try {
      recognition.start();
      sedangMerekam = true;
      btnMic.textContent = '⏺️ Berhenti';
      btnMic.style.background = '#A6493C';
      btnMic.style.color = '#fff';
    } catch (e) {
      tampilkanStatus('Tidak bisa memulai rekam suara, coba lagi.');
    }
  }

  function hentikanRekam() {
    sedangMerekam = false;
    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {}
    }
    btnMic.textContent = '🎙️ Rekam';
    btnMic.style.background = '';
    btnMic.style.color = '';
  }

  btnMic.addEventListener('click', () => {
    if (sedangMerekam) hentikanRekam();
    else mulaiRekam();
  });
})();
