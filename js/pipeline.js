/*
 * Node.js işlem hattı (CEP nodejs açık olmalı).
 * ffmpeg ile ses hazırlar, Whisper ile yazıya döker (opsiyonel konuşmacı ayırma),
 * kısa cue nesneleri üretir {start,end,text,speaker,cumleId}.
 * Cue başına kelime tavanını ÇAĞIRAN belirler (opts.maxWords); config.json yalnızca yedektir.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const sozluk = require(path.join(__dirname, "sozluk.js"));   // karakter isimleri sözlüğü

// Çalışan ffmpeg/whisper süreçleri (İptal için)
const _procs = [];
/* İPTAL SAYACI — kullanıcı "İptal"e her bastığında 1 artar. Uzun süren bir iş başlarken
   sayacın o anki değerini not eder (iptalDamgasi), hata yakaladığında damga değişmişse
   hatanın sebebi kullanıcının İPTALİDİR. Bu bilgi olmadan transcribe, öldürülen motoru
   "eski sürüm --hotwords'ü tanımadı" sanıp BAŞTAN bir kez daha çalıştırıyordu; iptale
   basan kullanıcı 25-30 dakika daha GPU'nun boşuna dönmesini bekliyordu. */
let _iptalSayaci = 0;
function iptalDamgasi() { return _iptalSayaci; }
function iptalEdildiMi(damga) { return _iptalSayaci !== damga; }

function cancelAll() {
  const n = _procs.length;
  _iptalSayaci++;
  for (let i = 0; i < _procs.length; i++) {
    const p = _procs[i];
    /* Windows'ta motor (PyInstaller paketi) kendi ALT sürecini açıyor; sadece üstteki süreci
       öldürmek GPU'yu asıl meşgul eden çocuğu hayatta bırakıyor. taskkill /T tüm ağacı kapatır.
       "error" dinleyicisi ŞART: taskkill spawn edilemezse yakalanmayan olay paneli düşürür. */
    try { p._iptalEdildi = true; } catch (e) {}   // run(): "çıkış kodu 1" değil "İptal edildi" desin
    try {
      if (process.platform === "win32" && p.pid) {
        /* SIRA ÖNEMLİ: p.kill() anında öldürüyor, taskkill.exe ~30 ms sonra başlıyor. Üst süreç
           o ana kadar ölürse taskkill "process not found" deyip AĞACA hiç dokunmuyor (ölçüldü),
           motorun alt süreci GPU'yu tutmaya devam ediyor. Bu yüzden üst süreci taskkill
           bittikten sonra öldürüyoruz; taskkill hiç çalışamazsa da (error) yine öldürüyoruz. */
        const tk = spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        tk.on("error", function () { try { p.kill(); } catch (e2) {} });
        tk.on("close", function () { try { p.kill(); } catch (e2) {} });
      } else { try { p.kill(); } catch (e2) {} }
    } catch (e) { try { p.kill(); } catch (e2) {} }
  }
  _procs.length = 0;
  return n;
}

// config.json'u okur ve TAŞINABİLİR yollar üretir.
// Yollarda %ENGINE% / %USERPROFILE% / ~ jetonları kullanılır; burada gerçek yola çevrilir.
// %ENGINE% = kurulumda yazılan engine-root.txt (varsa), yoksa %USERPROFILE%\YusufwrlEngine.
// Böylece config.json her makinede aynı kalır; kullanıcı adı ne olursa olsun çalışır
// ve oto-güncelleme config'i ezse bile bozulmaz.
function loadConfig(extRoot) {
  var os = require("os");
  var rawCfg = fs.readFileSync(path.join(extRoot, "config.json"), "utf8");
  if (rawCfg.charCodeAt(0) === 0xFEFF) rawCfg = rawCfg.slice(1); // BOM'a dayaniklilik
  var cfg = JSON.parse(rawCfg);
  var home = os.homedir();
  var engineRoot = "";
  try {
    var erf = path.join(extRoot, "engine-root.txt");
    if (fs.existsSync(erf)) engineRoot = fs.readFileSync(erf, "utf8").trim();
  } catch (e) {}
  if (!engineRoot) engineRoot = path.join(home, "YusufwrlEngine");
  function exp(v) {
    if (typeof v !== "string") return v;
    v = v.split("%ENGINE%").join(engineRoot);
    v = v.split("%USERPROFILE%").join(home).split("%HOME%").join(home);
    if (v.charAt(0) === "~" && (v.charAt(1) === "/" || v.charAt(1) === "\\")) v = home + v.slice(1);
    return v;
  }
  var out = {};
  for (var k in cfg) { if (cfg.hasOwnProperty(k)) out[k] = exp(cfg[k]); }
  out._engineRoot = engineRoot;
  // Diarization cihazı (MAKİNEYE ÖZEL): reverb/pyannote PyTorch kullanır. Blackwell (RTX 50xx)
  // GPU'da torch kerneli yok → cpu şart. Çalışan GPU'da cuda çok daha hızlı (reverb ağır).
  // Varsayılan cpu (her yerde güvenli); makinede diarize-device.txt "cuda" yazıyorsa GPU.
  var diarDev = "cpu";
  try {
    var ddf = path.join(extRoot, "diarize-device.txt");
    if (fs.existsSync(ddf)) { var dv = fs.readFileSync(ddf, "utf8").trim().toLowerCase(); if (dv) diarDev = dv; }
  } catch (e) {}
  out.diarizeDevice = diarDev;
  return out;
}
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

// spawn -> Promise. o = { cwd, pathDirs, logFile }
function run(exe, args, onLog, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const opts = { windowsHide: true };
    if (o.cwd) opts.cwd = o.cwd;
    if (o.pathDirs && o.pathDirs.length) {
      opts.env = Object.assign({}, process.env, { PATH: o.pathDirs.join(";") + ";" + (process.env.PATH || "") });
    }
    let buf = "";
    function cap(d) { const s = d.toString(); buf += s; if (onLog) onLog(s); }
    function dump(tail) { if (o.logFile) { try { fs.writeFileSync(o.logFile, buf + (tail || ""), "utf8"); } catch (e) {} } }
    let proc;
    try { proc = spawn(exe, args, opts); }
    catch (e) { dump("\nSPAWN HATASI: " + e.message); e.cikti = buf; reject(e); return; }
    _procs.push(proc);
    function unreg() { const ix = _procs.indexOf(proc); if (ix >= 0) _procs.splice(ix, 1); }
    proc.stdout.on("data", cap);
    proc.stderr.on("data", cap);
    proc.on("error", (e) => { unreg(); dump("\nSPAWN HATASI: " + e.message); e.cikti = buf; reject(e); });
    proc.on("close", (code) => {
      unreg();
      dump("\nÇIKIŞ KODU: " + code);
      if (code === 0) resolve();
      else if (proc._iptalEdildi) {
        // Süreci kullanıcının "İptal"i öldürdü — çağırana anlaşılır bir mesaj git (ffmpeg
        // için de geçerli: log'da "ffmpeg çıkış kodu 1" yerine "İptal edildi" görünsün).
        const iptalHata = new Error("İptal edildi");
        iptalHata.iptal = true; iptalHata.cikti = buf;
        reject(iptalHata);
      }
      else {
        const hata = new Error(exe + " çıkış kodu " + code +
          (buf.trim() ? "\n" + buf.slice(-1200) : " (motor çıktı vermeden çöktü — DLL hatası olabilir)"));
        /* Hata mesajına yalnızca son 1200 karakter giriyor. Çağıran ("motor bu argümanı mı
           tanımadı?" gibi) TAM çıktıya bakabilsin diye ham dökümü hataya iliştiriyoruz. */
        hata.cikti = buf;
        hata.cikisKodu = code;
        reject(hata);
      }
    });
  });
}

/* Bir medya dosyasındaki SES AKIŞI sayısı. Motorla ffprobe gelmiyor; ffmpeg'in bilgi dökümü
   (çıktısız çağrıda stderr'e yazar) ayrıştırılır. Aynı dosya onlarca klipte geçtiği için
   sonuç önbelleklenir. Okunamazsa 1 varsayılır — en güvenli taban. */
var _sesAkisSayisi = {};
function _probeAudioCount(mediaPath, ffmpegExe) {
  if (_sesAkisSayisi[mediaPath] != null) return Promise.resolve(_sesAkisSayisi[mediaPath]);
  return new Promise(function (resolve) {
    var buf = "", proc;
    try { proc = spawn(ffmpegExe, ["-hide_banner", "-i", mediaPath], { windowsHide: true, cwd: path.dirname(ffmpegExe) }); }
    catch (e) { resolve(1); return; }
    /* ⚠ BU SUREC DE KAYDA GIRER. Dosyadaki diger butun ffmpeg'ler run() uzerinden aciliyor ve
       run _procs'a kaydediyor; cancelAll YALNIZ _procs icindekileri taskkill ediyor. Probe
       run'i atlayip dogrudan spawn ettigi icin kayitsizdi: 200+ tekil medyali bir projede
       kullanici "Iptal"e bassa bile _probeMany butun gruplari acmaya devam ediyordu. */
    _procs.push(proc);
    function unreg() { var ix = _procs.indexOf(proc); if (ix >= 0) _procs.splice(ix, 1); }
    proc.stdout.on("data", function (d) { buf += d; });
    proc.stderr.on("data", function (d) { buf += d; });
    proc.on("error", function () { unreg(); resolve(1); });
    proc.on("close", function () {
      unreg();
      /* ⚠ OLDURULEN PROBE ONBELLEGE YAZILMAZ — ZEHIRLI ONBELLEK TUZAGI.
         Sureci kayda almak tek basina daha kotu bir hata dogururdu: cancelAll onu oldurunce
         "close" yine tetikleniyor, buf BOS kaliyor ve asagidaki satir _sesAkisSayisi'na 1
         yaziyor. Onbellek modul omru boyunca hic temizlenmedigi icin kullanici iptal edip
         tekrar bastiginda o zehirli 1 okunuyor, _sIdx = Math.min(sIdx, 0) = 0 oluyor ve
         A2/A3 uretimi SESSIZCE A1 mikrofonunun akisindan ses aliyor — yani "arkadaslarin
         altyazisi senin sesinden" cikardi, ustelik hata da vermeden. */
      if (proc._iptalEdildi) { resolve(1); return; }
      var m = buf.match(/Stream #\d+:\d+[^\n]*: Audio:/g);
      _sesAkisSayisi[mediaPath] = (m && m.length) ? m.length : 1;
      resolve(_sesAkisSayisi[mediaPath]);
    });
  });
}
// Benzersiz dosyaları gruplar hâlinde ölçer (çok klipli projede yüzlerce süreç açılmasın).
async function _probeMany(yollar, ffmpegExe) {
  const harita = {}, BATCH = 8;
  for (let i = 0; i < yollar.length; i += BATCH) {
    const grup = yollar.slice(i, i + BATCH);
    const sonuc = await Promise.all(grup.map((p) => _probeAudioCount(p, ffmpegExe)));
    for (let j = 0; j < grup.length; j++) harita[grup[j]] = sonuc[j];
  }
  return harita;
}

/* Tek parça (klip grubu) -> timeline'a hizalı 16kHz mono WAV. Tüm klipler ffmpeg'e argüman
   olur, o yüzden ÇAĞIRAN parça boyutunu komut satırı sınırının altında tutmalı (bkz. _chunkSize). */
async function _renderTimelineChunk(clips, ffmpegExe, outWav, sIdx) {
  const inputArgs = [], filters = [], labels = [];
  clips.forEach((c, i) => {
    const inPoint = Math.max(0, c.inPointSec || 0);
    inputArgs.push("-ss", String(inPoint), "-t", String(c.durationSec), "-i", c.mediaPath);
    const delayMs = Math.round(Math.max(0, c.timelineStartSec || 0) * 1000);
    const si = (c._sIdx != null) ? c._sIdx : sIdx;   // dosyada o akış yoksa mevcut sona düşülür
    // adelay'de "all=1" ŞART: tek değer verilirse SADECE 1. kanal gecikir, 5.1/çok kanallı
    // kaynakta 3.-6. kanallar 0. saniyede de duyulur ve o klibin altyazı zamanları kayar.
    filters.push(`[${i}:a:${si}]aresample=16000,adelay=${delayMs}:all=1[a${i}]`);
    labels.push(`[a${i}]`);
  });
  let filterComplex, mapLabel;
  if (clips.length === 1) { filterComplex = filters[0]; mapLabel = "[a0]"; }
  else { filterComplex = filters.join(";") + ";" + labels.join("") + `amix=inputs=${clips.length}:normalize=0[mix]`; mapLabel = "[mix]"; }
  const args = [...inputArgs, "-filter_complex", filterComplex, "-map", mapLabel,
    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", outWav];
  await run(ffmpegExe, args, null, { cwd: path.dirname(ffmpegExe) });
  if (!fs.existsSync(outWav)) throw new Error("WAV üretilemedi: " + outWav);
  return outWav;
}

// Windows komut satırı sınırına (~32767 karakter) takılmadan bir ffmpeg çağrısına kaç klip
// sığdırılabilir? Yol uzunluğuna göre uyarlanır; güvenli tarafta kalınır.
function _chunkSize(clips) {
  let sum = 0;
  for (let i = 0; i < clips.length; i++) sum += (clips[i].mediaPath || "").length;
  const avgPath = clips.length ? (sum / clips.length) : 60;
  const perClip = avgPath + 95;   // -ss/-t/-i bayrakları + filter_complex payı
  const n = Math.floor(22000 / perClip);   // 32767'nin güvenli altı
  return Math.max(20, Math.min(100, n));
}

/* clips -> timeline'a hizalı 16kHz mono WAV. streamIndex = ses akışı (0=A1,1=A2,2=A3).
   Çok klipli timeline'da (ör. 300+ klip) tek ffmpeg komutu Windows sınırını aşıp
   "spawn ENAMETOOLONG" verir; bu yüzden klipler parçalara bölünür, her parça tam-uzunluk
   konumlandırılmış WAV üretir, sonra parçalar amix (mixWavs) ile birleştirilir. */
async function buildTimelineAudio(clips, ffmpegExe, outWav, onLog, streamIndex) {
  const sIdx = Number.isInteger(streamIndex) ? streamIndex : 0;
  /* ⚠ IPTAL SUREC ARALARINDA DA KONTROL EDILIR. cancelAll yalnizca O AN calisan ffmpeg'leri
     olduruyor; sonraki adim yeni bir surec dogurdugunda kimse onu durdurmuyordu ve akis
     sonuna kadar kosuyordu. Damga, iptalden SONRA dogan her adimi durdurur. */
  const _btDamga = iptalDamgasi();
  function _btIptalKontrol() {
    if (iptalEdildiMi(_btDamga)) { const h = new Error("İptal edildi"); h.iptal = true; throw h; }
  }
  /* Medya yolu okunamayan klipler ELENİR — ama sessizce değil. host.jsx getMediaPath/duration
     çağrılarını try/catch'e alıp hata olursa mediaPath="" bırakıyor; bu iç içe sekans (nested
     sequence), birleştirilmiş klip ve çevrimdışı medyada OLAĞAN. Eskiden bu klipler tek kelime
     uyarı olmadan düşüyordu: üretim "bitti" diyor, o kliplerdeki konuşma altyazıda hiç yok. */
  const valid = [], okunamayan = [];
  for (let ci0 = 0; ci0 < clips.length; ci0++) {
    const c0 = clips[ci0];
    if (c0 && c0.mediaPath && c0.durationSec > 0) valid.push(c0); else okunamayan.push(c0);
  }
  if (okunamayan.length && onLog) {
    onLog("[ffmpeg] UYARI: " + clips.length + " klipten " + okunamayan.length +
      " tanesinin medya dosyası okunamadı (iç içe sekans / birleştirilmiş klip / çevrimdışı medya" +
      " olabilir) — o kliplerdeki konuşma altyazıya GİRMEYECEK. Onları sekanstan çıkarıp ham ses" +
      " dosyalarını koyarsan tamamı yazıya döküleceğinden emin olursun.\n");
  }
  if (valid.length === 0) {
    // İki farklı durumu ayır: gerçekten klip yok mu, yoksa klip var ama medyası okunamadı mı?
    if (okunamayan.length) throw new Error("Bu kanaldaki " + okunamayan.length +
      " klibin medya dosyası okunamadı (iç içe sekans / birleştirilmiş klip / çevrimdışı medya olabilir). " +
      "Klipleri ham ses dosyalarıyla değiştirip tekrar dene.");
    throw new Error("Bu kanalda ses klibi bulunamadı.");
  }
  /* Çevrimdışı/taşınmış medya: dosya yoksa ffmpeg parçanın TAMAMINI anlaşılmaz bir hatayla
     düşürüyor (üstelik uzun bir işin ortasında). Baştan, hangi dosya olduğunu söyleyerek dur. */
  const tekilYollar = [], gorulenYol = {};
  for (let vy = 0; vy < valid.length; vy++) {
    const yol = valid[vy].mediaPath;
    if (!gorulenYol[yol]) { gorulenYol[yol] = 1; tekilYollar.push(yol); }
  }
  const eksikler = [];
  for (let ey = 0; ey < tekilYollar.length; ey++) {
    try { if (!fs.existsSync(tekilYollar[ey])) eksikler.push(tekilYollar[ey]); } catch (e) {}
  }
  if (eksikler.length) {
    const ornek = eksikler.slice(0, 3).map(function (y) { return path.basename(y); }).join(", ");
    throw new Error("Ses dosyası bulunamadı (" + eksikler.length + " dosya): " + ornek +
      (eksikler.length > 3 ? " …" : "") + ". Dosya taşındıysa/silindiyse Premiere'de medyayı yeniden bağla.");
  }
  if (onLog) onLog("[ffmpeg] ses hazırlanıyor (" + valid.length + " klip)...\n");

  /* A1/A2/A3 track'i, medya dosyasının 1./2./3. SES AKIŞINA karşılık gelir — bu yalnızca
     OBS çoklu-kanal kaydında (tek dosya, birden çok ses akışı) doğrudur. Tek akışlı kayıtta
     ya da A2'ye ayrı bir dosya konduğunda 2. akış yoktur; sabit "a:1" istenirse ffmpeg
     "matches no streams / Invalid argument" ile çöker. Bu yüzden akış sayısı ölçülür ve
     dosyada olmayan akış hiç istenmez — o klip için mevcut son akış kullanılır. */
  if (sIdx > 0) {
    const sayilar = await _probeMany(tekilYollar, ffmpegExe);   // tekil yol listesi yukarıda çıkarıldı
    _btIptalKontrol();   // probe'lar iptalde 1 dönüyor; o değerlerle render'a devam ETME
    let dusen = 0;
    for (let vj = 0; vj < valid.length; vj++) {
      const n = sayilar[valid[vj].mediaPath] || 1;
      valid[vj]._sIdx = Math.min(sIdx, n - 1);
      if (valid[vj]._sIdx !== sIdx) dusen++;
    }
    if (dusen && onLog) onLog("[ffmpeg] " + dusen + " klipte " + (sIdx + 1) +
      ". ses akışı yok (tek kanallı kayıt) — o kliplerin mevcut sesi kullanıldı.\n");
  }

  const chunkN = _chunkSize(valid);
  if (valid.length <= chunkN) {
    await _renderTimelineChunk(valid, ffmpegExe, outWav, sIdx);
    return outWav;
  }

  // Çok klip: parça parça üret, sonra birleştir.
  const dir = path.dirname(outWav);
  const base = path.basename(outWav, path.extname(outWav));
  const parts = [];
  try {
    for (let start = 0, ci = 0; start < valid.length; start += chunkN, ci++) {
      _btIptalKontrol();   // her parçadan ÖNCE: iptal sonrası yeni ffmpeg doğmasın
      const chunk = valid.slice(start, start + chunkN);
      const partWav = path.join(dir, base + "__part" + ci + ".wav");
      /* ⚠ ADI LİSTEYE RENDER'DAN ÖNCE YAZ — "üreteceğimiz dosyayı baştan sahiplen".
         Eskiden push render'dan SONRAYDI: o an üretilen parça hata alır ya da iptal edilirse
         (ffmpeg taskkill ile ölür ama yarım .wav'ı diskte bırakır) dosya adı listeye HİÇ
         girmiyor, aşağıdaki finally temizliği de onu görmüyordu. Her iptalde yüzlerce MB
         work klasöründe kalıyordu. Önce eklemek güvenli: temizlik yalnız var olan dosyayı
         siler, hiç oluşmamış dosyada unlinkSync zaten sessizce catch'e düşüyor. */
      parts.push(partWav);
      await _renderTimelineChunk(chunk, ffmpegExe, partWav, sIdx);
      if (onLog) onLog("[ffmpeg] parça " + (ci + 1) + "/" + Math.ceil(valid.length / chunkN) + " (" + chunk.length + " klip)\n");
    }
    _btIptalKontrol();
    await mixWavs(parts, ffmpegExe, outWav);
  } finally {
    for (let i = 0; i < parts.length; i++) { try { fs.unlinkSync(parts[i]); } catch (e) {} }
  }
  if (!fs.existsSync(outWav)) throw new Error("WAV üretilemedi: " + outWav);
  return outWav;
}

// saniye -> "HH:MM:SS,mmm"
function fmtTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  var ms = Math.round(t * 1000);
  var h = Math.floor(ms / 3600000); ms -= h * 3600000;
  var m = Math.floor(ms / 60000); ms -= m * 60000;
  var s = Math.floor(ms / 1000); ms -= s * 1000;
  function p(n, l) { n = String(n); while (n.length < l) n = "0" + n; return n; }
  return p(h, 2) + ":" + p(m, 2) + ":" + p(s, 2) + "," + p(ms, 3);
}

// Noktalamayı temizler; SADECE ! ve ? kalır. Rakam-içi noktalama (3.5, 14:30, 1.000) ve
// kelime-içi tire (e-posta, 16-9) korunur.
function cleanPunct(s) {
  s = String(s);
  // rakam-içi ayıraçları geçici işaretle (silinmesin)
  s = s.replace(/(\d)\.(\d)/g, "$1@DOT@$2").replace(/(\d),(\d)/g, "$1@COM@$2").replace(/(\d):(\d)/g, "$1@COL@$2");
  // noktalamayı temizle (ASCII tire hariç)
  s = s.replace(/[.,;:…"“”«»()\[\]\{\}—–]/g, " ");
  // yalnız kenar/başıboş tireleri temizle; kelime-içi tire kalır
  s = s.replace(/(^|\s)-+|-+(\s|$)/g, " ");
  // işaretlenen rakam-içi ayıraçları geri yaz
  s = s.replace(/@DOT@/g, ".").replace(/@COM@/g, ",").replace(/@COL@/g, ":");
  s = s.replace(/\s+([!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return s;
}

// Türkçe küçük harf (JS toLowerCase 'I'->'i' verir; Türkçe'de I->ı, İ->i olmalı)
function _trLower(s) { return String(s).replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase(); }

// Küfür/hakaret kökleri (4+ harf, düşük yanlış-pozitif; _trLower normalinde). Kısa/riskli kökler
// (am/sik/mal/göt vb.) prefix ile ASLA kullanılmaz — masum kelimeleri sansürler.
// AĞIR küfür — "Sadece ağır" seviyesinde de maskelenir
var _PROFANITY_HARD = ["orospu", "oruspu", "piç", "yavşa", "pezevenk", "kahpe", "kaltak", "gavat", "siktir",
  "hassiktir", "sikey", "sikik", "siker", "sikiş", "yarrak", "yarak", "puşt", "ibne", "ipne",
  "sürtük", "fahişe", "amcık", "kancık", "godoş", "taşak",
  /* "sik-" kökünün çekimleri: yukarıdaki beş kalıba (siktir/sikik/siker/sikiş/sikey) UYMAYAN
     çekimler sansürsüz geçiyordu ("sikiyorum", "sikti gitti", "sikimde değil"). Panelde sansür
     hep açık olduğu için bu satırlar doğrudan yayına çıkıyordu. Kök "sik" TEK BAŞINA hâlâ
     eklenmiyor — "sikke" gibi masum kelimeleri maskelerdi; en az 4 harfli çekimler yazılıyor
     ("sikke" bunların hiçbiriyle başlamaz, "sıkıntı" zaten noktasız ı ile yazılır). */
  "sike", "sikiyo", "sikti", "sikim", "sikin", "sikil", "sikmek",
  /* "amcık" listedeydi ama "amına koydu" sansürsüz geçiyordu. "ananas" bu öneklerden hiçbiriyle
     başlamaz (ananas ≠ ananı), masum çakışma yok. */
  "amına", "ananı", "avrad"];
// HAFİF hakaret — arkadaş şakalaşmasında normal; sadece "Hepsi" seviyesinde maskelenir
var _PROFANITY_MILD = ["şerefsiz", "namussuz", "haysiyetsiz", "gerizekalı", "gerzek", "dangalak",
  "salak", "aptal", "ahmak", "şıllık", "aşağılık", "beyinsiz", "ahlaksız", "terbiyesiz"];
var _PROFANITY_ROOTS = _PROFANITY_HARD.concat(_PROFANITY_MILD);

/* Türkçe ünsüz yumuşaması: kök ek alınca son sessiz harf değişir (salak -> salağın, kitap -> kitabı).
   Yumuşamış hâl eklenmezse "salak" maskelenir ama "salağın" SANSÜRSÜZ geçer.
   Tek heceli köklerde yumuşama olmaz (piç -> piçi), o yüzden en az 2 sesli harf aranır. */
function _softenRoot(r) {
  var map = { "k": "ğ", "p": "b", "t": "d", "ç": "c" };
  // "nk" -> "ng" (pezevenk -> pezevengi); tek "k" kuralı bunu kaçırıyordu
  if (/nk$/.test(r)) return r.slice(0, -1) + "g";
  var soft = map[r.charAt(r.length - 1)];
  if (!soft) return null;
  if ((r.match(/[aeıioöuü]/g) || []).length < 2) return null;
  return r.slice(0, -1) + soft;
}
// Aranacak önekler: kökler + yumuşamış hâlleri
function _prefixesOf(roots) {
  var out = [];
  for (var i = 0; i < roots.length; i++) {
    out.push(roots[i]);
    var s = _softenRoot(roots[i]);
    if (s) out.push(s);
  }
  return out;
}
var _PROFANITY_PREFIXES = _prefixesOf(_PROFANITY_ROOTS);
var _PROFANITY_PREFIXES_HARD = _prefixesOf(_PROFANITY_HARD);

// Kelimenin ortasını yıldızlar: ilk+son harf açık, ortadakiler '*' (aptal -> a***l). İşaretleri korur.
function _maskWord(w) {
  var letters = String(w).match(/[a-zçğıöşüA-ZÇĞİÖŞÜ]/g) || [];
  var total = letters.length; if (!total) return w;
  var seen = 0, out = "";
  for (var i = 0; i < w.length; i++) {
    var ch = w.charAt(i);
    if (/[a-zçğıöşüA-ZÇĞİÖŞÜ]/.test(ch)) { seen++; out += (seen === 1 || seen === total) ? ch : "*"; }
    else out += ch;
  }
  return out;
}

/* Metindeki küfür/hakaretleri (köke göre prefix eşleşme) maskeler; boşlukları korur.
   mode: "hard" = sadece ağır küfür, diğer her doğru değer = hepsi (hakaretler dahil).
   "salak/aptal" gibi hafif takılmalar arkadaş videolarında normal olduğu için ayrı seviye var. */
function censorText(text, mode) {
  var liste = (mode === "hard") ? _PROFANITY_PREFIXES_HARD : _PROFANITY_PREFIXES;
  var toks = String(text).split(/(\s+)/);
  for (var i = 0; i < toks.length; i++) {
    if (/^\s*$/.test(toks[i])) continue;
    var core = _trLower(toks[i]).replace(/[^a-zçğıöşü]/g, "");
    if (!core) continue;
    for (var r = 0; r < liste.length; r++) {
      if (core.indexOf(liste[r]) === 0) { toks[i] = _maskWord(toks[i]); break; }
    }
  }
  return toks.join("");
}

/* Türkçe soru/enklitik ekleri — önceki kelimeye yapışır, yoksa 3 kelimelik cue'dan bir slot yer
   ve ek yetim kalır ("Sen bunu gördün" + "müydünüz"). Elle yazılan liste hep eksik kalıyordu,
   bu yüzden ünlü uyumuna göre ÜRETİLİYOR. Düz regex kullanılamaz: "muz", "mim", "mısır" gibi
   masum kelimeleri yakalar — bu yüzden tam eşleşmeli kapalı bir küme şart. */
var _TR_PARTICLES = (function () {
  // [taban, geniş-zaman şahıs ekleri, geçmiş-zaman şahıs ekleri, dir, ydi, ymiş, yse]
  var gruplar = [
    ["mi", ["yim","sin","yiz","siniz","ler"], ["m","n","k","niz","ler"], "dir", "ydi", "ymiş", "yse"],
    ["mı", ["yım","sın","yız","sınız","lar"], ["m","n","k","nız","lar"], "dır", "ydı", "ymış", "ysa"],
    ["mu", ["yum","sun","yuz","sunuz","lar"], ["m","n","k","nuz","lar"], "dur", "ydu", "ymuş", "ysa"],
    ["mü", ["yüm","sün","yüz","sünüz","ler"], ["m","n","k","nüz","ler"], "dür", "ydü", "ymüş", "yse"]
  ];
  var s = {};
  for (var i = 0; i < gruplar.length; i++) {
    var g = gruplar[i], t = g[0], genis = g[1], hepsi = g[1].concat(g[2]);
    s[t] = true;
    // Tabana SADECE geniş zaman şahıs ekleri gelir. Geçmiş zaman ekleri (-m, -n, -k) tabana
    // doğrudan EKLENMEZ: "mi"+"m" = "mim", "mu"+"m" = "mum" — ikisi de gerçek Türkçe kelime
    // ve masum kullanımları soru eki sanılıp önceki kelimeye yapışırdı.
    for (var j = 0; j < genis.length; j++) s[t + genis[j]] = true;        // miyim, misin, …
    for (var k = 3; k <= 6; k++) {                                        // midir, miydi, miymiş, miyse
      s[t + g[k]] = true;
      for (var m = 0; m < hepsi.length; m++) s[t + g[k] + hepsi[m]] = true;   // miydim, miydiniz, miymişsin
    }
  }
  return s;
})();

/* Türkçe dolgu/söz kelimeleri — önceki kelimeye yapışır ki ayrı cue'ya düşmesin.
   "gördün mü ya", "kitap falan", "oldu yani" gibi. Cümle başındaki "ya"/"yani" için
   birleştirme koşullu yapılır (önceki kelime cümle sonu değilse, aynı konuşmacı, kısa boşluk).
   DİKKAT — "şey", "bak", "böyle", "tamam", "lan" BİLEREK eklenmedi: bunlar gerçek anlam taşır
   ve önceki kelimeye yapıştırılırsa cümlenin anlamı bozulur. */
var _TR_FILLERS = (function () {
  var list = ["ya", "falan", "filan", "işte", "yani", "hani", "yav", "be", "aynen", "abi", "kanka"];
  var s = {}; for (var i = 0; i < list.length; i++) s[list[i]] = true; return s;
})();
// Türkçe küçük harf ŞART: düz toLowerCase "İşte" -> "i̇şte" (araya görünmez U+0307 girer) verir
// ve _TR_FILLERS eşleşmesi hiç tutmaz.
function _bareWord(s) { return _trLower(s).replace(/[.,;:!?…"'`()\[\]]/g, ""); }

/* HALÜSİNASYON FİLTRESİ — Whisper sessizlikte metin uydurabiliyor. Gerçek çıktıda videonun
   SON satırı "Altyazı M.K." çıkmıştı: model uydurmuş ve timeline'a altyazı olarak basılmıştı.
   Motorun no_speech_prob skoru bunu yakalıyor, AMA skor segment değil 30 SANİYELİK PENCERE
   özelliği — aynı penceredeki bütün segmentler aynı skoru taşıyor (ölçüm: 35 pencerenin 35'i,
   pencere başına ortalama 12 segment). Düz "skoru yüksekse sil" kuralı 10-19 GERÇEK altyazıyı
   uyarısız silerdi. Bu yüzden DÖRT koşul birden aranır.
   Kara liste ("abone ol", "teşekkür ederiz") BİLEREK yapılmadı: bir YouTuber'ın outro'su tanımı
   gereği videonun sonundadır, kara liste er geç gerçek outro'yu siler. */
function filterHallucinations(data) {
  var segs = (data && data.segments) || [];
  /* "O pencerede az segment" koşulu SADECE uzun/yoğun kayıtta koruma sağlıyor: toplam segment
     sayısı azsa koşul kendiliğinden sağlanır ve filtre GERÇEK son cümleyi siler (kısa önizleme,
     süre aralığı, ayrı kanal modunda az konuşan kişi…). Bu yüzden filtre yalnızca yeterince
     uzun kayıtlarda çalışır — uydurma bir satır bırakmak, gerçek altyazı silmekten iyidir. */
  if (segs.length < 20) return [];
  // aynı metni saymak için normalize: noktalama/büyük-küçük fark etmesin
  function _norm(t) { return _trLower(String(t || "")).replace(/[^a-zçğıöşü0-9 ]/g, "").replace(/\s+/g, " ").trim(); }
  var sonZaman = 0, pencere = {}, tekrar = {};
  for (var i = 0; i < segs.length; i++) {
    if (Number(segs[i].end) > sonZaman) sonZaman = Number(segs[i].end);
    var k = String(segs[i].no_speech_prob);
    pencere[k] = (pencere[k] || 0) + 1;
    // aynı pencerede birebir aynı metin kaç kez geçti (Whisper'ın tipik "takılma" deseni)
    var tk = k + "|" + _norm(segs[i].text);
    tekrar[tk] = (tekrar[tk] || 0) + 1;
  }
  var atilan = [], oncekiEnd = null;
  data.segments = segs.filter(function (s) {
    var skor = Number(s.no_speech_prob), bosluk = (oncekiEnd == null) ? 99 : (Number(s.start) - oncekiEnd);
    oncekiEnd = Number(s.end);
    /* TAKILMA: model sessizlikte aynı cümleyi arka arkaya tekrarlıyor ("Yedim / Yedim / Yedim").
       Gerçek konuşmada birebir aynı kısa cümle aynı 30 sn'lik pencerede nadiren 2 kez geçer.
       Bu desen iki korumayı birden geçersiz kılıyordu: pencere kalabalık göründüğü için (3) ve
       tekrarlar birbirine bitişik olduğu için (5) hiçbir satır atılamıyordu. */
    var tekrarli = (tekrar[String(s.no_speech_prob) + "|" + _norm(s.text)] || 0) >= 2;
    var basta = Number(s.start) <= 3, sonda = Number(s.start) >= sonZaman - 3;
    if (!isFinite(skor) || skor < 0.6) return true;                             // 1) konuşma-yok skoru yüksek mi
    /* 2) videonun SON ya da İLK 3 saniyesinde mi. Eskiden yalnız sona bakılıyordu; model intro
       müziği/oyun sesi üzerinde videonun BAŞINDA da uyduruyor ve o satır hiç incelenmiyordu. */
    if (!basta && !sonda) return true;
    /* Videonun BAŞINDAKİ satırda 5. koruma ("öncesinde sessizlik") boşa çıkıyor: ilk segmentin
       öncesi yok, bosluk hep 99 geliyor. Bu yüzden başta yalnızca TEKRAR deseni varsa (model
       aynı cümleye takılmış) uydurma sayıyoruz; yoksa YouTuber'ın gerçek açılış cümlesi
       ("Naber arkadaşlar") sessizce siliniyordu — ölçüldü. */
    if (basta && !sonda && !tekrarli) return true;
    if ((pencere[String(s.no_speech_prob)] || 0) > 2 && !tekrarli) return true;  // 3) o pencerede az segment mi
    var metin = String(s.text || "").trim();
    if (!metin || metin.split(/\s+/).length > 5) return true;                   // 4) kısa metin mi
    if (bosluk < 1.0 && !tekrarli) return true;                                 // 5) öncesinde sessizlik var mı
    // Nerede atıldığını yaz: kullanıcı "gerçek cümlem mi silindi" diye denetleyebilsin.
    atilan.push(metin + (basta ? " (başta)" : " (sonda)"));
    return false;
  });
  return atilan;
}

/* Whisper JSON -> düz kelime listesi.
   Her kelime GELDİĞİ SEGMENTİN sırasını (seg) taşır. Segment ≈ bir cümle; cue'ya cumleId olarak
   geçer. Bu bilgi buradan atılırsa geri kazanılamaz: cleanPunct noktayı sildiği için cümle sınırı
   metinden de okunamıyor. Sıra numarası filterHallucinations'tan SONRAKİ listeye göredir —
   kimlik olarak kullanıldığı için (eşit mi değil mi) bu yeterli. */
function flattenWords(data) {
  var words = [];
  (data.segments || []).forEach(function (seg, segIx) {
    (seg.words || []).forEach(function (w) {
      var t = String(w.word).replace(/\s+/g, " ").trim();
      var st = Number(w.start), en = Number(w.end);
      /* Motor gerçek çıktıda start == end olan (SIFIR süreli) kelimeler üretebiliyor — ölçüldü,
         binde 3-5 kelime. Bunlar cue'ların aynı saniyede başlamasına yol açıyor; buildCues bunu
         ayrıca toparlıyor, burada sadece süreyi pozitife çekip zaman sırasını bozulmaz kılıyoruz. */
      if (en <= st) en = st + 0.001;
      // geçersiz/eksik zaman damgalı kelimeyi ele (null/undefined/NaN → bozuk SRT önlenir)
      if (t && w.start != null && w.end != null && isFinite(st) && isFinite(en)) words.push({ start: st, end: en, word: t, speaker: null, seg: segIx });
    });
  });
  return words;
}

// Diarize SRT'sinden [SPEAKER_XX] zaman aralıklarını çıkar
function parseSpeakerIntervals(srt) {
  var intervals = [], blocks = String(srt).replace(/\r/g, "").split(/\n\n+/);
  for (var b = 0; b < blocks.length; b++) {
    var lines = blocks[b].split("\n").filter(function (l) { return l.trim() !== ""; });
    if (lines.length < 2) continue;
    var ti = /-->/.test(lines[0]) ? 0 : 1;
    var m = lines[ti].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!m) continue;
    var start = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    var end = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
    var txt = lines.slice(ti + 1).join(" ");
    var sm = txt.match(/\[(SPEAKER_\d+)\]/i);
    // eşleşme yoksa null: downstream "konuşmacı yok" gibi nötr davranır (tek konuşmacıya sessizce çökmesin)
    intervals.push({ start: start, end: end, speaker: sm ? sm[1].toUpperCase() : null });
  }
  return intervals;
}

// Her kelimeye zamanına göre konuşmacı ata
function assignSpeakers(words, intervals) {
  for (var i = 0; i < words.length; i++) {
    var t = (words[i].start + words[i].end) / 2, best = null, bd = Infinity;
    for (var j = 0; j < intervals.length; j++) {
      var iv = intervals[j];
      if (t >= iv.start && t <= iv.end) { best = iv; break; }
      var d = Math.min(Math.abs(t - iv.start), Math.abs(t - iv.end));
      if (d < bd) { bd = d; best = iv; }
    }
    words[i].speaker = best ? best.speaker : null;
  }
}

/* Ekranda GÖRÜNEN kelime sayısı. Bir cue'nun "kaç kelime" olduğu, tuttuğu token sayısıyla aynı
   şey DEĞİL: aşağıdaki birleştirmeler (soru eki, dolgu, apostroflu ek) iki kelimeyi tek token'ın
   İÇİNE yazıyor ("gördün müydünüz" tek token, iki kelime). Kullanıcı ekranda kelimeleri sayıyor,
   token'ları değil — bu yüzden tavan boşlukla ayrılmış kelimeye uygulanır. */
function _kelimeSay(s) {
  var t = String(s == null ? "" : s).trim();
  return t ? t.split(/\s+/).length : 0;
}
function _grupKelimeSay(g) {
  var n = 0; for (var i = 0; i < g.length; i++) n += _kelimeSay(g[i].word); return n;
}

/* cumleId'nin ÇAĞRI ÖNEKİ. Segment sırası her transkriptte 0'dan başlar; "Herkes" kaynağında
   her ses kanalı AYRI yazıya döküldüğü ve sonuç tek listede birleştirildiği için düz segment
   numarası kullanılsaydı A2'nin 0. cümlesi ile A3'ün 0. cümlesi AYNI cümle sanılırdı
   (cümle birimiyle çalışan vurucu.js için sessiz ve bulunması zor bir hata). Sayaç her
   buildCues çağrısında artar, yani her kanal/çalıştırma kendi uzayında kalır.

   ⚠ SAYAÇ TEK BAŞINA YETMİYOR — panel yeniden yüklendiğinde 0'dan başlıyor, ama ESKİ cue'lar
   listede kalabiliyor: app.js runChannels yalnız İŞARETLİ kanalların cue'larını siliyor
   (işareti kaldırılmış kanalın altyazısı bilerek korunuyor), oturum geri yükleme de eski
   cue'ları olduğu gibi geri getiriyor. Senaryo: 1. oturumda A1+A5 (kaynakNo 1,2) → panel
   kapanıp açıldı → 2. oturumda A5 işaretsiz, A1+A2+A3 üretildi (yeni kaynakNo 1,2,3) →
   A2'nin "2:0"'ı ile korunan A5'in "2:0"'ı AYNI. vurucu.js cumleId'yi TEK ölçüt saydığı için
   iki FARKLI kişinin cue'ları tek cümle olurdu. Çözüm: önek panel oturumuna özel bir jetonla
   başlar; modül yüklenince BİR KEZ üretilir, yani her panel yüklemesi kendi uzayında kalır.
   Rastgele kuyruk, iki yüklemenin aynı milisaniyeye denk gelme ihtimalini de kapatır. */
var _cumleOturumJetonu = Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
var _cumleKaynakSayaci = 0;

// Kelimeleri kısa cue nesnelerine böl {start,end,text,speaker,cumleId}. censor=true ise küfür maskelenir.
function buildCues(words, maxWords, censor, maxChars, onLog) {   // censor: false | true (hepsi) | "hard" (sadece agir)
  var GAP = 0.7;
  /* KELİME TAVANI ÇAĞIRANDAN GELİR. config.json'daki maxWordsPerCue'ya bel bağlanamaz:
     oto-güncelleme (updater.configBirlestir) kullanıcının MEVCUT değerini koruyor, yani
     repodaki config.json'u değiştirmek kurulu panele hiç ulaşmıyor. Değer gelmezse eski
     varsayılan (3) sürer — çağıran susarken sessizce 2'ye çekmek onun isteğini ezmek olurdu. */
  maxWords = parseInt(maxWords, 10);
  if (!(maxWords >= 1)) maxWords = 3;
  var kaynakNo = ++_cumleKaynakSayaci;   // bkz. _cumleKaynakSayaci: kanallar arası cümle karışmasın
  // soru eki birleştir
  var merged = [];
  for (var r = 0; r < words.length; r++) {
    var wr = words[r];
    var bare = _bareWord(wr.word);
    var pv = merged.length > 0 ? merged[merged.length - 1] : null;
    // Apostrofla başlayan ek AYRI kelime gelmiş ("Tofi" + "'ye"): boşluksuz yapıştır, yoksa
    // ekranda tek başına "'ye" yazan bir altyazı çıkıyor.
    if (pv && /^['’]/.test(wr.word) && wr.word.length <= 6
        && !/[.!?…]$/.test(pv.word)                                       // önceki cümleyi bitirmemiş
        && (wr.start - pv.end) <= 0.35                                    // ek bitişik gelir, boşluk olmaz
        && (!wr.speaker || !pv.speaker || wr.speaker === pv.speaker)) {   // aynı konuşmacı
      /* Sadece GERÇEK ek yapıştırılır. ‘ (sol tek tırnak) bilerek dışarıda: o tırnak AÇMA
         karakteri ve alıntının ilk kelimesini bir öncekine kaynatıyordu. */
      pv.word += wr.word; pv.end = wr.end;
    } else if (pv && _TR_PARTICLES[bare]
               && !/[.!?…]$/.test(pv.word)                                   // önceki kelime cümleyi bitirmemiş
               && (wr.start - pv.end) <= GAP                                  // araya uzun duraklama girmemiş
               && (!wr.speaker || !pv.speaker || wr.speaker === pv.speaker)) { // aynı konuşmacı
      /* Soru eki önceki kelimeye yapışır — AMA koşulsuz değil. Üretilen küme kaçınılmaz olarak
         gerçek Türkçe kelimeler de içeriyor ("müdür", "müdürler", "müdürsünüz"); koşulsuz
         birleştirme "Ders bitti." + 2 sn sessizlik + "Müdürler geldi" cümlelerini tek altyazıya
         kaynatıp altyazıyı saniyelerce erken başlatıyordu. */
      pv.word += " " + wr.word; pv.end = wr.end;
    } else if (pv && _TR_FILLERS[bare]
               && !/[.!?…]$/.test(pv.word)                                   // önceki kelime cümleyi bitirmemiş
               && (wr.start - pv.end) <= GAP                                  // araya uzun duraklama girmemiş
               && (!wr.speaker || !pv.speaker || wr.speaker === pv.speaker)) { // aynı konuşmacı
      pv.word += " " + wr.word; pv.end = wr.end;
    /* seg (kaynak segment = cümle) İLK kelimeden alınır: yukarıdaki üç birleştirme de eki/dolguyu
       ÖNCEKİ kelimenin içine yazdığı için token hep başladığı cümleye aittir. */
    } else merged.push({ start: wr.start, end: wr.end, word: wr.word, speaker: wr.speaker, seg: wr.seg });
  }
  /* Grupla (konuşmacı değişince de böl).
     KARAKTER SINIRI ŞART: yukarıdaki birleştirmeler (soru eki, dolgu, apostroflu ek) metni
     pv.word'ün İÇİNE yazıyor, yani burada tek kelime sayılıyorlar. Sadece kelime sayısına
     bakılırsa "gördün müydünüz" gibi birleşikler yüzünden cue MOGRT'ye sığmayacak kadar
     uzayabiliyor. MAX_CHARS aynı zamanda yetim birleştirmede de kullanılıyor. */
  /* SHORTS: dikey videoda (1080 genişlik) satır çok daha dar. Panel Shorts kipinde
     buraya küçük bir sınır geçiyor; böylece "kelime uzunluğuna göre 1, olsa olsa 2"
     davranışı kelime sayısından DEĞİL karakterden çıkıyor — asıl belirleyici bu.
     Değer verilmezse yatay video varsayılanı (38) sürer. */
  var MAX_CHARS = parseInt(maxChars, 10);
  if (!MAX_CHARS || isNaN(MAX_CHARS) || MAX_CHARS < 6) MAX_CHARS = 38;
  var groups = [], cur = [];
  var segBol = 0;   // cümle sınırında bölünen cue sayısı (aşağıdaki segment dalı) — log'a düşer
  function flush() { if (cur.length) { groups.push(cur); cur = []; } }
  for (var i = 0; i < merged.length; i++) {
    var w = merged[i];
    if (cur.length) {
      var prev = cur[cur.length - 1];
      if (w.start - prev.end > GAP) flush();
      else if (w.speaker && prev.speaker && w.speaker !== prev.speaker) flush();
      /* CÜMLE (Whisper segmenti) DEĞİŞİNCE DE BÖL — yoksa cumleId "kesin" değil, YAKLAŞIK olur.
         Bir cue iki ayrı segmentten kelime taşıyabiliyordu ama cumleId olarak yalnız İLK
         kelimenin segmenti yazılıyordu. ÖLÇÜLDÜ (20 koşu × 500 kelime): segment sonları hep
         noktalamalıysa %0, %35'i noktalamasızsa cue'ların %4.3'ü, hiçbirinde noktalama yoksa
         %13.2'si iki cümleden kelime taşıyor. Sonucu vurucu.js'te görülüyor: "vurucu cümle"
         seçildiğinde sonraki cümlenin ilk kelimeleri de ekranda kalıyor ve bu hiçbir yerde
         SAYILMIYORDU. Bölmenin maliyeti yok (cue zaten maxWords'te bölünüyor), kazancı
         cumleId'nin gerçekten kesin olması. Segment bilgisi olmayan kelimede (seg == null)
         karar verilemez — orada eski davranış sürer, uydurma bölme yapılmaz. */
      else if (prev.seg != null && w.seg != null && w.seg !== prev.seg) { segBol++; flush(); }
    }
    /* SINIRI AŞMADAN ÖNCE BÖL. Uzunluk kontrolü eskiden kelime EKLENDİKTEN sonra
       yapılıyordu; yani bir grup sınırı son kelimenin boyu kadar aşabiliyordu.
       Yatayda (38) bu görünmüyordu, ama Shorts'ta (16) "hazır mısınız" gibi soru eki
       yapışmış tek bir token satırı 24 karaktere çıkarıyordu (ölçüldü).
       Tek başına sınırdan uzun bir token varsa yine de eklenir — daha fazla bölünemez. */
    if (cur.length) {
      var simdiki = 0;
      for (var hp = 0; hp < cur.length; hp++) simdiki += cur[hp].word.length + (hp ? 1 : 0);
      if (simdiki + 1 + w.word.length > MAX_CHARS) flush();
      /* KELİME TAVANINA da eklemeden ÖNCE bakılır. Eski kontrol (aşağıda) TOKEN sayıyordu:
         soru eki/dolgu yapışmış tek token iki kelime ettiği için "maxWords 2" denmesine rağmen
         ekranda 3 kelime çıkıyordu. Tek başına tavanı aşan token yine eklenir — bölünemez. */
      else if (_grupKelimeSay(cur) + _kelimeSay(w.word) > maxWords) flush();
    }
    cur.push(w);
    // "2." gibi SIRA SAYILARI cümle sonu değildir ("2. bölüm", "1. sıra") — rakam+nokta bölmez.
    var hard = /[!?…:]$/.test(w.word) || (/\.$/.test(w.word) && !/\d\.$/.test(w.word));
    var soft = /,$/.test(w.word);
    var harf = 0; for (var hq = 0; hq < cur.length; hq++) harf += cur[hq].word.length + (hq ? 1 : 0);
    if (_grupKelimeSay(cur) >= maxWords || harf >= MAX_CHARS || hard || (soft && cur.length >= 2)) flush();
  }
  flush();
  /* Yetim tek-kelimelik cue'ları öncekine bağla.
     ESKİ KOŞUL "önceki grup maxWords'ten az" idi; gerçek veride yetimlerin %88'inde önceki grup
     zaten doluydu, yani kural neredeyse hiç çalışmıyordu (728 cue'nun 109'u tek kelime, çoğu
     0.1-0.3 sn ekranda yanıp sönüyordu). Yeni ölçüt kelime SAYISI değil METNİN HARF SAYISI:
     MOGRT'ye sığdığı sürece birleşsin. Cümle sonu koruması ŞART — nokta cleanPunct'ta silindiği
     için iki ayrı cümle tek satıra kaynarsa ekranda anlamsız görünür.
     ⚠ Bu kural yalnız KARAKTER sınırına bakıyordu; kelime tavanını delen iki yerden biri buydu
     ("maxWords 2" verilmiş cue'ya üçüncü kelime buradan giriyordu). Artık kelime tavanı da
     kontrol ediliyor — tavan 2 iken önceki grup çoğunlukla dolu olduğu için bu birleştirme
     nadiren çalışır; geriye kalan kısacık yetim cue'lar aşağıda SÜRE ÖDÜNCÜ ile uzatılır. */
  function _grupMetin(g) { var t = ""; for (var q = 0; q < g.length; q++) t += (q ? " " : "") + g[q].word; return t; }
  for (var c = groups.length - 1; c > 0; c--) {
    if (groups[c].length !== 1) continue;
    var a = groups[c][0], onceki = groups[c - 1], bg = onceki[onceki.length - 1];
    var sameSp = (!a.speaker || !bg.speaker || a.speaker === bg.speaker);
    if (!sameSp || (a.start - bg.end) > GAP) continue;
    if (/[.!?…:]$/.test(bg.word)) continue;                                    // önceki cümleyi bitirmiş
    /* Yetim kelime BAŞKA BİR CÜMLEDEN geliyorsa birleştirme YOK: yukarıdaki segment bölmesini
       tam burada geri alırdı ve cue yine iki cümleden kelime taşırdı. cumleId ilk gruptan
       geldiği için de YANLIŞ cümleyi gösterirdi. Metin kaybolmuyor — yetim cue kendi başına
       kalıyor ve aşağıdaki SÜRE ÖDÜNCÜ ile yine de görünür uzunluğa çıkarılıyor. */
    if (bg.seg != null && a.seg != null && a.seg !== bg.seg) continue;
    if (_grupKelimeSay(onceki) + _kelimeSay(a.word) > maxWords) continue;      // kelime tavanı aşılır
    if (cleanPunct(_grupMetin(onceki) + " " + a.word).length > MAX_CHARS) continue;   // satır taşar
    groups[c - 1] = onceki.concat(groups[c]); groups.splice(c, 1);
  }
  var cues = [];
  for (var k = 0; k < groups.length; k++) {
    var g = groups[k], start = g[0].start, end = g[g.length - 1].end;
    if (end <= start) end = start + 0.4;
    var text = ""; for (var mm = 0; mm < g.length; mm++) text += (mm ? " " : "") + g[mm].word;
    text = cleanPunct(text);
    if (censor) text = censorText(text, censor);
    if (!text) continue;
    /* cumleId = "<oturum jetonu>-<çağrı no>:<Whisper segmenti>" (≈ bir cümle). Cue'da cümle
       kimliği yoktu: cleanPunct noktayı sildiği için cümle sınırı METİNDEN de okunamıyor.
       "Bir cümlenin bütün parçalarını birlikte göster/gizle" (vurucu cümle kipi) ancak bu
       alanla yapılabilir. Jeton önekinin NEDENİ için bkz. _cumleOturumJetonu — panel yeniden
       açıldığında ESKİ cue'ların kimliğiyle çakışmayı o engelliyor.
       Kimlik olarak kullanılır (eşit mi değil mi), sıralama/aritmetik için DEĞİL — metin olması
       bu yüzden sorun değil. Segment bilgisi yoksa null: okuyan taraf kendi sezgisine düşer.
       Grup artık tek segmentten geliyor (yukarıdaki cümle bölmesi), yani g[0].seg gruptaki
       BÜTÜN kelimeleri temsil ediyor — eskiden yalnız ilk kelimeyi temsil ediyordu. */
    cues.push({ start: start, end: end, text: text, speaker: g[0].speaker || null,
                cumleId: (g[0].seg != null ? (_cumleOturumJetonu + "-" + kaynakNo + ":" + g[0].seg) : null) });
  }
  /* NEREDEYSE AYNI ANDA BAŞLAYAN CUE'LARI TOPARLA — bunu süre döngüsünden ÖNCE yapmak şart.
     Whisper gerçek çıktıda start == end olan (sıfır süreli) kelime damgaları üretiyor; bunlardan
     doğan cue bir sonrakiyle aynı saniyede başlıyor. Aşağıdaki süre döngüsünde tavan
     (sonraki cue - 0.08) cue'nun KENDİ başlangıcının altına düşüyor ve cue 0.05 sn'de kalıyor.
     host.jsx cue'ları sırayla overwriteClip ile bastığı için aynı saniyeye gelen ikinci klip
     birincinin üstüne yazıyor: o altyazı videoda HİÇ görünmüyor, panel yine de "eklendi" diyor.
     Çözüm: sığıyorsa iki cue'yu birleştir, sığmıyorsa öncekinden zaman ödünç alarak geriye kaydır.

     ⚠ BİLİNEN TAKAS — bu blok "erken başlayan altyazı" üretebiliyor: kelimeSigar koşulu
     (kelime tavanı) birleşmeyi engellediğinde akış aşağıdaki "cue'yu ERKEN başlat" dalına
     düşüyor ve cue MIN_GORUNUR (0.25 sn) kadar GERİYE çekiliyor — yani ses gelmeden başlıyor.
     Normalde bunu sesleHizala geri topluyor (yalnız ileri kaydırır). Ama hizalama
     opts.sesHizala === false ile KAPATILIRSA bu geri çekmeler olduğu gibi kalır ve sessizde
     başlayan altyazı sayısı ARTAR. Yani kelime tavanını düşürmek (Shorts: 2) bu dalı daha sık
     çalıştırır ve hizalamayı kapatmanın bedelini büyütür. Hizalamayı kapatmadan önce bunu bil. */
  var MIN_GORUNUR = 0.25;   // bir altyazının ekranda fark edilmesi için gereken en kısa süre
  for (var z = 0; z + 1 < cues.length; z++) {
    var cA = cues[z], cB = cues[z + 1];
    if (cB.start - cA.start >= MIN_GORUNUR) continue;
    var ayniKisi = (!cA.speaker || !cB.speaker || cA.speaker === cB.speaker);
    /* Birleştirme kelime tavanını AŞAMAZ (burası da metni tek satıra kaynatıyor). Sığmıyorsa
       aşağıdaki "erken başlat" dalı çakışmayı zaten çözüyor, yani metin kaybolmuyor. */
    var kelimeSigar = (_kelimeSay(cA.text) + _kelimeSay(cB.text)) <= maxWords;
    /* ⚠ İKİ AYRI CÜMLENİN KELİMELERİ TEK CUE'YA KAYNAMASIN. Yukarıdaki segment bölmesi
       (`w.seg !== prev.seg` → flush) tam da "bir cue iki cümleden kelime taşımasın, cumleId
       gerçekten KESİN olsun" diye eklenmişti; yetim-birleştirme döngüsü de bu kuralı koruyor.
       Ama bu MIN_GORUNUR birleştirmesinde kontrol YOKTU: cB'nin metni cA'nın içine yazılıyor,
       cA'nın cumleId'si (ÖNCEKİ segment) olduğu gibi kalıyordu. Ölçüldü (maxWords=2):
       "Evet"(seg 0) + "Ama."(seg 1) → {"text":"Evet Ama","cumleId":"…-1:0"} — segment 1'in
       kelimesi segment 0'ın kimliğiyle ekrana çıkıyor. Bedeli üç yerde görünüyor: vurucu.js
       cue'ları YALNIZ cumleId ile gruplandığı için sonraki cümlenin ilk kelimesi önceki
       cümleyle birlikte ekranda kalıyor, emoji süresi yanlış cümle aralığından ölçülüyor ve
       cumleBirlestir köprüsü yanlış cümle sınırında karar veriyor.
       Tetikleyici nadir değil: motorun ürettiği SIFIR süreli kelime damgaları (bkz. flattenWords)
       tam da iki cue'yu 0.25 sn'den yakın başlatıyor.
       Reddedilince akış aşağıdaki "cue'yu ERKEN başlat" dalına düşüyor — metin KAYBOLMUYOR.
       Fuzz (5000 senaryo): çapraz-segment cue 118 → 0, metin farkı 0. */
    var ayniCumle = (!cA.cumleId || !cB.cumleId) ? true : (cA.cumleId === cB.cumleId);
    if (ayniKisi && ayniCumle && kelimeSigar && (cA.text.length + 1 + cB.text.length) <= MAX_CHARS) {
      cA.text = cA.text + " " + cB.text;
      cA.end = Math.max(cA.end, cB.end);
      cues.splice(z + 1, 1);
      z--;                                   // birleşen cue bir sonrakiyle de çakışıyor olabilir
      continue;
    }
    /* Tek satıra sığmıyor (ya da farklı konuşmacı): cue'yu ERKEN başlat ki ekranda kalacak
       yeri olsun. Önceki cue'nun da en az MIN_GORUNUR görünür kalması şartıyla geri çekilir. */
    var alt = (z > 0) ? (cues[z - 1].start + MIN_GORUNUR) : 0;
    var yeniBas = Math.max(alt, cB.start - MIN_GORUNUR);
    if (yeniBas < cA.start) cA.start = yeniBas;
  }
  // Okuma hızı (CPS) + min/max süre + ardıl cue boşluğu (S1/S2):
  // cue çok kısaysa okunacak kadar uzat, çok uzunsa kırp, sonrakine taşma.
  var MIN_GAP = 0.08, MAX_DUR = 7.0, CPS = 17;
  for (var ci = 0; ci < cues.length; ci++) {
    var cu = cues[ci];
    var minDur = Math.max(0.8, cu.text.length / CPS);        // ~17 karakter/saniye
    var target = Math.max(cu.end, cu.start + minDur);         // en az minDur; doğal daha uzunsa koru
    if (target - cu.start > MAX_DUR) target = cu.start + MAX_DUR;
    var tavan = (ci + 1 < cues.length) ? (cues[ci + 1].start - MIN_GAP) : Infinity;
    if (target > tavan) target = tavan;                      // sonraki cue'ya taşma engeli
    /* Taban 0.05 sn. Normalde minDur (>=0.8 sn) zaten çok daha uzun bir süre veriyor; bu taban
       yalnızca kelime zaman damgalarının ÇAKIŞTIĞI (tavan, cue'nun kendi başlangıcının altına
       indiği) durumda devreye giriyor. Daha uzun tutmak timeline'da klip çakışması demek —
       Premiere'de gerçek bir sorun olduğu için taşma pahasına uzatma yapılmıyor. */
    cu.end = Math.max(cu.start + 0.05, target);
  }
  /* SON EMNİYET — yukarıdaki toparlamaya rağmen MIN_KLIP'in (≈4 kare) altında kalan bir cue
     Premiere'de pratikte görünmez ve bir sonraki klip onu ezer, yani METİN KAYBOLUR.
     ESKİ ÇÖZÜM metni sığdığı komşuya TAŞIYIP cue'yu listeden düşürüyordu; kelime tavanını delen
     ikinci yer buydu — taşınan metin komşuyu 3-4 kelimeye çıkarıyordu. Yeni çözüm metne hiç
     dokunmuyor, komşudan SÜRE ödünç alıyor: cue uzuyor, kelime sayısı sabit kalıyor.
     Sıra: önce ÖNDEN (kendi başlangıcını geriye çek), yetmezse ARKADAN (sonrakinin başlangıcını
     ileri it). Her iki komşu da en az MIN_KLIP görünür kalır — birini kurtarıp diğerini
     görünmez yapmak hiçbir şey kazandırmaz. İleri döngü ŞART: arkadan ödünç alınca sonraki cue
     kısalabiliyor, sırası gelince o da aynı onarımdan geçsin. */
  var MIN_KLIP = 0.15;
  var sureOdunc = 0, sureYok = 0;
  for (var y = 0; y < cues.length; y++) {
    var cy = cues[y];
    if (cy.end - cy.start >= MIN_KLIP) continue;
    var on = (y > 0) ? cues[y - 1] : null;                    // önceki
    var sn = (y + 1 < cues.length) ? cues[y + 1] : null;      // sonraki
    // 1) ÖNDEN: başlangıcı geriye çek. Önceki cue'nun sonu da aynı kadar kısalır (üst üste binmesin).
    var enErken = on ? (on.start + MIN_KLIP + MIN_GAP) : 0;
    var geri = Math.min(MIN_KLIP - (cy.end - cy.start), cy.start - enErken);
    if (geri > 0) {
      cy.start = +(cy.start - geri).toFixed(3);
      if (on && on.end > cy.start - MIN_GAP) on.end = +(cy.start - MIN_GAP).toFixed(3);
    }
    // 2) ARKADAN: sonrakinin başlangıcını ileri it (en fazla kendisi MIN_KLIP görünür kalana dek).
    if (MIN_KLIP - (cy.end - cy.start) > 0.001) {
      var hedefSon = cy.start + MIN_KLIP;
      if (sn) {
        /* ÖNCE KAZANCI HESAPLA, SONRA İT — sonraki cue BOŞUNA itilmesin.
           Eski sıra tersti: sonraki cue önce itiliyor, hedefSon SONRA "üstüne binme" clamp'inden
           geçiyordu. Clamp hedefSon'u cy.end'in ALTINA düşürdüğünde kısa cue hiç uzamıyor ama
           sonraki cue yine de kısalmış oluyordu — karşılıksız bir bedel. ÖLÇÜLDÜ: 244 itmenin
           4'ü tamamen boşa (toplam 0.143 sn), 19'u kısmen faydalı ama hedefe ulaşmıyor.
           Yeni sıra: cue'nun ulaşabileceği EN İYİ bitişi baştan hesapla; kazanç yoksa sonraki
           cue'ya HİÇ dokunma, varsa yalnızca o kazancı sağlayacak mesafe kadar it.
           Not: "eksik süre kadar itmek" hâlâ yetmiyor — kelime damgaları çakıştığında
           (bkz. 0.05 sn tabanı) cy.end zaten MIN_GAP boşluğunun içine girmiş oluyor; bu yüzden
           hedef, sn.start'a MIN_GAP kalacak biçimde kurulur. */
        var itilebilir = Math.max(0, (sn.end - MIN_KLIP) - sn.start);   // sonraki de görünür kalmalı
        var ulasilabilir = Math.min(hedefSon, (sn.start + itilebilir) - MIN_GAP);
        if (ulasilabilir - cy.end > 0.001) {
          var ileri = (ulasilabilir + MIN_GAP) - sn.start;   // yalnız FAYDALI mesafe (<= itilebilir)
          if (ileri > 0) sn.start = +(sn.start + ileri).toFixed(3);
          // Yuvarlama sonrası gerçek sn.start'a göre son kez kıs: üstüne binme kalmasın.
          hedefSon = Math.min(ulasilabilir, sn.start - MIN_GAP);
        } else hedefSon = cy.end;   // kazanç yok → itme yok, cue olduğu gibi kalır
      }
      if (hedefSon > cy.end) cy.end = +hedefSon.toFixed(3);
    }
    if (MIN_KLIP - (cy.end - cy.start) > 0.001) sureYok++; else sureOdunc++;
  }
  /* Tavanı hâlâ aşan cue'lar: tek bir token'ın içinde iki kelime varsa (soru eki/dolgu yapışmış)
     bölünecek yer yoktur. SESSİZCE geçilmez — kaç satırın tavanı aştığı log'a yazılır ki
     "2 kelime dedim ama 3 görüyorum" şüphesi ölçüyle karşılansın. */
  var kelimeTasan = 0;
  for (var kt = 0; kt < cues.length; kt++) if (_kelimeSay(cues[kt].text) > maxWords) kelimeTasan++;
  /* RAPOR TEK UZUN SATIR OLAMAZ — panel onu KIRPAR. app.js whenLog her satırı
     `s.length > 80 ? s.slice(-80) : s` ile kısaltıyor (o sınır motorun tqdm çubuğu için kondu)
     ve transcribe'a geçilen onLog tam olarak o sarmalayıcı. ÖLÇÜLDÜ: eski tek satırlık özet
     278 karakterdi, yani panelde yalnız SON 80'i görünüyordu — altyazı sayısı, ödünç alınan
     süre ve "süre bulunamadı" uyarısı baştan kırpılıp atılıyordu; bu paketin raporlama amacı
     boşa gidiyordu. Çözüm: her ölçü AYRI ve 80 karakterin altında bir onLog çağrısı.
     (app.js'e dokunulmadı: 80 sınırı tqdm için doğru, düzeltilmesi gereken taraf burası.) */
  if (onLog) {
    onLog("[cue] " + cues.length + " altyazı üretildi (tavan " + maxWords + " kelime).\n");
    if (segBol) onLog("[cue] " + segBol + " altyazı cümle sınırında bölündü.\n");
    if (sureOdunc) onLog("[cue] " + sureOdunc + " kısa altyazı komşudan süre ödünç aldı.\n");
    if (sureYok) {
      onLog("[cue] " + sureYok + " kısa altyazıya süre BULUNAMADI, görünmeyebilir.\n");
      onLog("[cue] (sebep: komşuları da " + MIN_KLIP.toFixed(2) + " sn altına inerdi.)\n");
    }
    if (kelimeTasan) {
      onLog("[cue] " + kelimeTasan + " altyazı kelime tavanını aşıyor.\n");
      onLog("[cue] (sebep: soru eki/dolgu tek token'a yapışmış, bölünemez.)\n");
    }
  }
  return cues;
}

/* ÇAKIŞMA GİDER — zaman olarak ÜST ÜSTE BİNEN cue'ları ayırır.
   NEDEN GEREKLİ: Panel eskiden her ses kanalını AYRI caption track'e yazıyordu, o yüzden
   kanallar arası çakışma sorun değildi. Yeni düzende yalnız İKİ altyazı kanalı var —
   C1 = videoyu çeken (A1), C2 = diğer BÜTÜN konuşanlar birleşik. C2'de iki arkadaş aynı anda
   konuşunca cue'lar çakışıyor ve Premiere çakışan altyazılardan birini YUTUYOR: panel yine
   "ok" dönüyor, kullanıcı metnin kaybolduğunu ancak videoyu çıkarırken fark ediyor.
   buildCues çakışmayı yalnız KENDİ listesi içinde önlüyor (tek transkript), cuesToSrt ise
   sıfır kontrol yapıyor — bu yüzden birleştirmeden SONRA çalışacak ayrı bir adım gerekti.

   TAKAS (bilerek): metin ASLA birleştirilmez, cue ASLA silinmez. Birleştirme kelime tavanını
   (Shorts'ta 2) delerdi; silmek doğrudan metin kaybı olurdu. Çözülemeyen çakışma üst üste
   bırakılır ve SAYILIR — üst üste binme, kaybolan metinden yeğdir.
   Cue'lar geriye KAYDIRILMAZ (ses hizalamasının temel kuralı, bkz. sesleHizala): yalnız önceki
   cue'nun BİTİŞİ kırpılır, o mümkün değilse sonraki cue İLERİ itilir.
   Girdi zaman sırasına dizili olmalı — çağıran zaten sıralı veriyor. */
function cakismaGider(cues, onLog) {
  var MIN_GAP = 0.08;        // iki altyazı arasında bırakılan en küçük boşluk (buildCues ile aynı)
  /* 0.15 sn ≈ 4 kare: buildCues'un SON EMNİYET bölümündeki MIN_KLIP ile AYNI değer, çünkü
     ölçüt de aynı — bunun altındaki bir klip Premiere'de pratikte görünmez. (buildCues'taki
     MIN_GORUNUR 0.25'tir; o "göz fark etsin" ölçüsü, buradaki "klip var sayılsın" ölçüsü.) */
  var MIN_GORUNUR = 0.15;
  var sayac = { bulunan: 0, kirpilan: 0, itilen: 0, gecersiz: 0, yenidenSiralandi: 0 };
  /* Sayaçlar dizinin ÜZERİNE iliştirilir (aynı desen vurucu.js'te _bosCue vb. için kullanılıyor):
     fonksiyon diziyi döndürür, çağıran isterse ölçüyü de okur. Boş/tek elemanlı listede de
     iliştirilir ki çağıran "alan var mı" diye ayrıca kontrol etmek zorunda kalmasın. */
  if (!cues || cues.length < 2) { if (cues) cues._cakisma = sayac; return cues; }

  /* ÇOK TURLU — TEK GEÇİŞ YETMİYOR. İtme, cue'yu zamanda ileri taşıyor ama dizideki yerini
     değiştirmiyor; sıra onarıldıktan sonra ORTAYA YENİ KOMŞU ÇİFTLER çıkıyor ve onlar da
     çözülebiliyor. ÖLÇÜLDÜ (800 cue, yoğun çakışma): kalan çakışan çift
     1823 → 920 → 669 → 630 → 624; 4. turdan sonra kazanç sıfır.
     Tur sayısı SABİT ve küçük: sonsuz döngü riski yok, kazanç zaten tükeniyor. */
  var TUR = 4, tur, i, s;
  for (tur = 0; tur < TUR; tur++) {
    var turIslem = 0;
    for (i = 0; i + 1 < cues.length; i++) {
      var onc = cues[i], snr = cues[i + 1];
      /* Zaman damgası sayı değilse karşılaştırma SESSİZCE "çakışma yok" derdi. Atlanan çift
         gerçekten çakışıyor olabilir — sessiz geçmek yasak, sayılıp log'a düşürülür.
         Yalnız İLK turda sayılır, yoksa aynı çift 4 kez sayılıp sayaç şişer. */
      if (!isFinite(onc.start) || !isFinite(onc.end) ||
          !isFinite(snr.start) || !isFinite(snr.end)) { if (!tur) sayac.gecersiz++; continue; }
      if (onc.end <= snr.start) continue;            // çakışma yok
      sayac.bulunan++;
      /* 1) ÖNCE KIRP — en ucuz çözüm: yalnız önceki cue'nun bitişi kısalır, hiçbir cue yer
         değiştirmez. Yuvarlama ATAMADAN ÖNCE yapılır ki görünürlük kontrolü, gerçekten
         yazılacak değerin üstünde çalışsın. */
      var yeniBitis = +(snr.start - MIN_GAP).toFixed(3);
      if (yeniBitis - onc.start >= MIN_GORUNUR) { onc.end = yeniBitis; sayac.kirpilan++; turIslem++; continue; }
      /* 2) KIRPILAMIYORSA İT — kırpınca önceki cue görünmez kalıyor demektir. Bu kez sonraki
         cue ileri itilir, ama kendi bitişine MIN_GORUNUR kadar yer kalmak şartıyla: birini
         kurtarıp diğerini görünmez yapmak hiçbir şey kazandırmaz. */
      var yeniBas = +(onc.end + MIN_GAP).toFixed(3);
      if (snr.end - yeniBas >= MIN_GORUNUR) { snr.start = yeniBas; sayac.itilen++; turIslem++; continue; }
      // 3) İkisi de sıkışık: cue SİLİNMEZ, olduğu gibi bırakılır. Metin kaybetmektense üst üste binsin.
    }

    /* SIRAYI ONAR — İTME DİZİ SIRASINI BOZUYOR. İtilen cue zamanda ileri gidiyor ama dizideki
       YERİ değişmiyor; cuesToSrt diziyi olduğu sırayla yazdığı için SRT'de zaman damgası bir
       öncekinden GERİDE olan satırlar oluşuyordu (ölçüldü: 800 cue'luk koşuda 45 satır).
       Zamanı geriye giden SRT'yi Premiere reddedebilir ya da altyazıyı yanlış yere koyar.
       Sıralama YERİNDE yapılır: çağıran aynı dizi referansıyla devam ediyor. Aynı zamanda
       bir sonraki turun yeni komşu çiftleri görmesini sağlayan adım budur. */
    var bozuk = false;
    for (s = 1; s < cues.length; s++) {
      if (isFinite(cues[s].start) && isFinite(cues[s - 1].start) &&
          cues[s].start < cues[s - 1].start) { bozuk = true; break; }
    }
    if (bozuk) {
      cues.sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
      sayac.yenidenSiralandi++;
    }
    if (!turIslem) break;   // bu turda hiçbir şey düzelmedi, devamı da düzelmez
  }

  /* KALAN ÇAKIŞMAYI GERÇEKTEN SAY. Yukarıdaki döngü yalnız KOMŞU çiftlere bakıyor; uzun bir
     cue kendinden sonraki BİRDEN ÇOK cue'yu örtebiliyor ve o çiftler hiç görülmüyordu —
     ölçüldü: log "181 cozulemedi" derken gerçekte 238 çift hâlâ çakışıyordu. Kullanıcıya
     eksik sayı vermek sessiz başarısızlığın yumuşak hâli; gerçek sayı ölçülüp yazılır.
     Maliyet düşük: iç döngü ilk kesişmeyen cue'da BREAK ediyor (dizi artık sıralı). */
  var kalan = 0, a, b;
  for (a = 0; a < cues.length; a++) {
    if (!isFinite(cues[a].start) || !isFinite(cues[a].end)) continue;
    for (b = a + 1; b < cues.length; b++) {
      if (!isFinite(cues[b].start)) continue;
      if (cues[b].start >= cues[a].end) break;
      kalan++;
    }
  }
  sayac.kalanCakisma = kalan;

  /* RAPOR: her satır 80 karakterin ALTINDA ve ayrı bir onLog çağrısı — app.js whenLog uzun
     satırların BAŞINI kırpıyor (`s.slice(-80)`), yani tek uzun özet bilgiyi çöpe atardı.
     Hiç çakışma yoksa hiç satır basılmaz (gürültü olmasın); geçersiz zaman ve kalan çakışma
     ise çakışma bulunmasa bile basılır, çünkü ikisi de ATLAMA — sessiz kalması yasak. */
  if (onLog) {
    /* `bulunan` BASILMAZ: turlar boyunca birikiyor ve aynı çift birden çok kez sayılabiliyor,
       yani kullanıcıya anlamsız bir sayı olurdu. Kullanıcıyı ilgilendiren üç şey var:
       kaç tanesine dokunuldu, kaçı HÂLÂ üst üste, bir de atlanan varsa o. */
    if (sayac.kirpilan) onLog("[cakisma] " + sayac.kirpilan + " altyazinin bitisi kirpildi.\n");
    if (sayac.itilen) onLog("[cakisma] " + sayac.itilen + " altyazi ileri itildi.\n");
    if (sayac.yenidenSiralandi) onLog("[cakisma] zaman sirasi onarildi.\n");
    /* GERÇEK kalan sayısı: komşu-çift taraması uzun bir cue'nun örttüğü UZAK cue'ları
       göremiyordu (ölçüldü: "181 cozulemedi" derken gerçekte 238 çift çakışıyordu).
       Bu satır Premiere'de kaç altyazının üst üste bineceğini söylüyor. */
    if (kalan) onLog("[cakisma] " + kalan + " altyazi HALA ust uste kaliyor.\n");
    if (sayac.gecersiz) onLog("[cakisma] " + sayac.gecersiz + " cift gecersiz zaman, atlandi.\n");
  }
  cues._cakisma = sayac;
  return cues;
}

/* ================= KANALLAR ARASI ÇAKIŞMA =================
   NEDEN AYRI BİR FONKSİYON: cakismaGider TEK bir cue listesine bakıyor ve placeCaptions onu
   HER GRUP İÇİN AYRI çağırıyor — yani kanal İÇİ çakışmayı çözüyor, kanallar ARASI çakışmayı
   hiç görmüyor. "Ayrı caption track'te oldukları için sorun değil" gerekçesi METİN KAYBI
   ekseninde doğruydu (aynı track'e düşen cue'yu Premiere yutuyordu) ama GÖRSEL eksende
   YANLIŞ çıktı: kullanıcının ekran görüntüsünde birden çok caption track'inin yazısı AYNI
   ANDA ve aynı yerde görünüyor. ÖLÇÜLDÜ (Premiere'e giden gerçek 5 SRT / 443 cue): kanal içi
   çakışma 0 (cakismaGider işini yapıyor), kanallar ARASI 19 çift / 6.76 sn — ve örnekler
   kullanıcının ekran görüntüsüyle birebir aynı.
   ⚠ Bunun hangi Premiere sürümünden beri böyle olduğu ve Track Style'ın dikey konumu gerçekten
   taşıyıp taşımadığı ÖLÇÜLMEDİ — buraya sürüm numaralı bir iddia yazma.

   POLİTİKA — SIRA ÖNEMLİ, DEĞİŞTİRMEDEN ÖNCE OKU:
     1) KIRP: önce başlayan cue'nun BİTİŞİNİ, sonrakinin başına GAP kala çek. BAŞLANGIÇ
        ZAMANINA DOKUNULMAZ, yani senkron hiç bozulmaz ve metin kaybolmaz. Çoğu vakada bedava:
        cue bitişlerinin %77'si konuşmanın bitişi değil, buildCues'un "bir sonraki cue'ya kadar"
        doldurduğu YAPAY kuyruk (minDur = max(0.8, harf/17) — okunabilirlik payı).
     2) Kırpma cue'yu TABAN'ın altına indirecekse gerçekten aynı anda konuşuluyor demektir:
        - opts.gizle AÇIKSA kaybeden cue GİZLENİR. Cue SİLİNMEZ, `gizliCakisma` diye
          İŞARETLENİR — çağıran onu SRT'ye yazmaz ama nesne yerinde durur.
        - KAPALIYSA cue TABAN'a kadar kısaltılır (üst üste kalan SÜRE azalır) ve kalan
          çakışma olduğu gibi bırakılıp SAYILIR.
     3) İTME YOK — BURAYA İTME EKLEME. Sonraki cue'yu ileri itmek senkronu bozar, yani
        kullanıcının şikâyet ettiği şeyin ta kendisidir. İtmemek aynı zamanda dizi zaman
        sırasını da bozmuyor (cuesToSrt sırayla yazıyor), yani yeniden sıralama gerekmiyor.

   GİZLEME CUE BAZINDA — CÜMLE BAZINDA DEĞİL. ÖLÇÜLDÜ, İKİSİ DE DENENDİ (kullanıcının gerçek
   oturumu: 233 cue / 5 grup / 35 çakışan çift). Cümle bütünlüğünü korumak (aynı cumleId'nin
   tamamını gizlemek) sezgisel olarak doğru görünüyor — cümlenin ortasına delik açmaz — ama
   BEDELİ 4-5 KAT: 49-70 cue düşüyor, cue bazlıda 9-16. Sebep basit: kelime tavanı 2 olduğu
   için bir cümle 4-5 cue ve her çakışma koca bir repliği siliyor. Cue bazlı gizlemede 7-10
   cümlede 2 kelimelik bir boşluk kalıyor; ses zaten duyulduğu için bu, repliğin tamamen
   kaybolmasından daha ucuz. cumleId hâlâ okunuyor ama YALNIZ raporlama için değil — hiç
   kullanılmıyor; cümle bazına dönmek istersen önce yukarıdaki sayıyı yeniden ölç.

   KURBAN SEÇİMİ — GRUP SIRASI, BAŞKA HİÇBİR ŞEY. "Kısa cümle/cue kaybetsin" kuralları
   DENENDİ VE GERÇEK VERİDE TERS ÇALIŞTI: kullanıcı (C1) kısa cümlelerle çok konuşuyor,
   arkadaşlar uzun cümlelerle az konuşuyor — "ağırlık" kuralında 54 gizlemenin 47'si
   KULLANICININ KENDİ SESİ oldu. Grup sırasında C1 hiç kaybetmiyor (ölçüldü: Sage 3 · Mimi 4 ·
   Moni 5). C1 = videoyu çeken ana anlatıcı, çakışmayı o kazanmalı. Bu sıra placeCaptions'taki
   track sırasıyla birebir aynı, yani kullanıcı sonuç mesajındaki "C1 sen · C2 Moni"
   eşlemesinden kimin öncelikli olduğunu okuyabilir.

   gruplar: [{ad: "sen", cues: [...]}, ...]. Cue nesneleri YERİNDE değiştirilir; çağıranın
   KOPYA vermesi beklenir (placeCaptions öyle yapıyor — bkz. oradaki kopya bloğu). */
function kanallarArasiCakisma(gruplar, opts, onLog) {
  opts = opts || {};
  var GAP = (opts.gap > 0) ? opts.gap : 0.08;
  /* TABAN = kırpmanın durduğu yer: bunun altına inecekse kırpmak yerine gizlemeye geçilir.
     0.25 = buildCues'un MIN_GORUNUR'u ile AYNI değer ("göz fark etsin" ölçüsü) — bilinçli
     olarak DÜŞÜK tutuldu, çünkü buradaki takas "kısa görünen altyazı mı, HİÇ görünmeyen mi":
     kullanıcı üst üste binmesin dedi, altyazı kaybolsun demedi. ÖLÇÜLDÜ (233 cue / 5 grup):
     taban 0.20 -> 9 gizleme · 0.25 -> 12 · 0.30 -> 13 · 0.40 -> 16. Yükseltmek doğrudan
     metin kaybı satın alıyor, karşılığında yalnız 3-4 cue'yu 0.05 sn uzatıyor.
     ⚠ pipeline'da artık DÖRT ayrı "en kısa süre" sabiti var, her biri BAŞKA bir soruya cevap
     veriyor: 0.15 MIN_KLIP (Premiere klibi var saysın) · 0.25 buildCues MIN_GORUNUR + buradaki
     TABAN (göz fark etsin) · 0.40 sesleHizala MIN_GOR (hizalarken kısaltmanın tabanı) ·
     0.80 buildCues minDur (rahat okunsun). Birini değiştirirken diğerlerine bak. */
  var TABAN = (opts.taban > 0) ? opts.taban : 0.25;
  var GIZLE = !!opts.gizle;
  var sayac = { kirpilan: 0, kismiKirpilan: 0, kirpilanSn: 0,
                gizlenen: 0, gizlenenAd: {}, kalan: 0, gecersiz: 0 };
  gruplar = gruplar || [];
  /* Tek grupta "kanallar arası" diye bir şey yoktur — tek kaynak (A1/A2) modunda ve eski
     diarizasyonlu oturum geri yüklendiğinde buraya girilir. Davranış birebir eskisi gibi
     kalmalı, o yüzden hiç dokunmadan çık. */
  if (gruplar.length < 2) return sayac;

  /* Düz liste: her öğe hangi gruba ait olduğunu TAŞIR ama cue nesnesi kendi grubunda KALIR.
     Böylece cue'lar track'ler arasında yer değiştirmiyor — karaktere göre renk düzeni
     (her karakter kendi caption track'inde) olduğu gibi korunuyor. */
  var hepsi = [], g, i, cs, c;
  for (g = 0; g < gruplar.length; g++) {
    cs = (gruplar[g] && gruplar[g].cues) || [];
    for (i = 0; i < cs.length; i++) {
      c = cs[i];
      /* Zaman damgası sayı değilse karşılaştırma SESSİZCE "çakışma yok" derdi. Listeye hiç
         alınmaz ve sayılır — sessiz atlama yasak (cakismaGider'deki aynı kural). */
      if (!c || !isFinite(c.start) || !isFinite(c.end)) { sayac.gecersiz++; continue; }
      hepsi.push({ g: g, c: c });
    }
  }
  hepsi.sort(function (a, b) { return (a.c.start - b.c.start) || (a.c.end - b.c.end); });

  function grupAdi(gi) {
    return (gruplar[gi] && gruplar[gi].ad) ? String(gruplar[gi].ad) : ("C" + (gi + 1));
  }
  function gizle(o) {
    if (o.c.gizliCakisma) return;
    o.c.gizliCakisma = true;
    sayac.gizlenen++;
    // Karakter kırılımı: "hep Sage gizleniyor" şüphesi tahminle değil SAYIYLA karşılansın.
    var ad = grupAdi(o.g);
    sayac.gizlenenAd[ad] = (sayac.gizlenenAd[ad] || 0) + 1;
  }

  var a, b, A, B, yeniBitis, tabanBitis, kurban;
  for (a = 0; a < hepsi.length; a++) {
    if (hepsi[a].c.gizliCakisma) continue;
    for (b = a + 1; b < hepsi.length; b++) {
      A = hepsi[a].c; B = hepsi[b].c;
      /* Liste başlangıca göre sıralı: B artık A'nın bitişinden sonra başlıyorsa bundan sonraki
         hiçbir cue de A ile kesişmez. A kırpıldıkça bu kırılma ERKEN oluyor. */
      if (B.start >= A.end) break;
      if (B.gizliCakisma) continue;
      if (hepsi[a].g === hepsi[b].g) continue;   // kanal İÇİ: cakismaGider'in işi, karışma
      yeniBitis = +(B.start - GAP).toFixed(3);
      if (yeniBitis - A.start >= TABAN) {
        // 1) BEDAVA ÇÖZÜM: yalnız bitiş kısalıyor, başlangıç yerinde — senkron bozulmuyor.
        sayac.kirpilanSn += (A.end - yeniBitis);
        A.end = yeniBitis; sayac.kirpilan++;
        continue;
      }
      /* Kırpmak A'yı okunamaz hale getirirdi: GERÇEKTEN aynı anda konuşuluyor. */
      if (!GIZLE) {
        /* Gizleme kapalı: çakışma KALACAK, ama süresini kısaltmak yine de kazanç — iki yazının
           üst üste durduğu saniye azalır. TABAN'ın altına İNMEZ. */
        tabanBitis = +(A.start + TABAN).toFixed(3);
        if (tabanBitis < A.end - 0.005) {
          sayac.kirpilanSn += (A.end - tabanBitis);
          A.end = tabanBitis; sayac.kismiKirpilan++;
        }
        continue;
      }
      // Gizleme açık: ALT SIRADAKİ karakter kaybeder (büyük grup indeksi). C1 hiç kaybetmez.
      kurban = (hepsi[a].g > hepsi[b].g) ? hepsi[a] : hepsi[b];
      gizle(kurban);
      if (kurban === hepsi[a]) break;   // A gizlendi: bu A ile devam etmenin anlamı yok
    }
  }

  /* KALAN ÇAKIŞMAYI GERÇEKTEN SAY (gizlenenler hariç). Yukarıdaki döngü bir çifti çözerken
     başka bir çifti çözmemiş olabilir; kullanıcıya "kaç altyazı hâlâ üst üste" diye kesin sayı
     vermek şart — eksik sayı, sessiz başarısızlığın yumuşak hâlidir. */
  var x, y;
  for (x = 0; x < hepsi.length; x++) {
    if (hepsi[x].c.gizliCakisma) continue;
    for (y = x + 1; y < hepsi.length; y++) {
      if (hepsi[y].c.gizliCakisma) continue;
      if (hepsi[y].c.start >= hepsi[x].c.end) break;
      if (hepsi[x].g === hepsi[y].g) continue;
      sayac.kalan++;
    }
  }

  /* RAPOR: her satır 80 karakterin ALTINDA ve AYRI bir onLog çağrısı — app.js whenLog uzun
     satırların BAŞINI kırpıyor (s.slice(-80)), tek uzun özet bilgiyi çöpe atardı. */
  if (onLog) {
    if (sayac.kirpilan) onLog("[kanalcak] " + sayac.kirpilan + " altyazinin bitisi kirpildi.\n");
    if (sayac.kismiKirpilan) onLog("[kanalcak] " + sayac.kismiKirpilan + " altyazi kismen kirpildi.\n");
    if (sayac.gizlenen) {
      onLog("[kanalcak] " + sayac.gizlenen + " altyazi GIZLENDI: ayni anda konusma.\n");
      // Kırılım: hangi karakterin ne kadar kaybettiği tahmin edilmesin, GÖRÜLSÜN.
      var dk = [], ad;
      for (ad in sayac.gizlenenAd) if (Object.prototype.hasOwnProperty.call(sayac.gizlenenAd, ad))
        dk.push(ad + " " + sayac.gizlenenAd[ad]);
      if (dk.length) onLog("[kanalcak] dagilim: " + dk.join(" · ").slice(0, 62) + "\n");
    }
    if (sayac.kalan) {
      onLog("[kanalcak] " + sayac.kalan + " altyazi HALA ust uste kaliyor.\n");
      onLog("[kanalcak] cozum: her altyazi kanalina FARKLI dikey konum ver.\n");
    }
    if (sayac.gecersiz) onLog("[kanalcak] " + sayac.gecersiz + " cue gecersiz zaman, atlandi.\n");
  }
  return sayac;
}

/* ================= AYNI CÜMLEDE BOŞLUK BIRAKMA (KÖPRÜ) =================
   SORUN (kullanıcı, 8 Ağustos 2026): "altyazılar yazılırken kelime aralarında boşluk oluyo,
   o biraz garip duruyo — tek cümleyse birleşik olmalı."
   SEBEP ÖLÇÜLDÜ: buildCues her cue'nun bitişini `sonraki.start - MIN_GAP` değerine DAYIYOR
   (pipeline.js süre döngüsü) ve MIN_GAP = 0.08 sn. Kelime tavanı 2 olduğu için hızlı konuşmada
   cue'ların BÜYÜK ÇOĞUNLUĞU bu tavana çarpıyor — yani neredeyse HER cue sınırında ekranda
   2 karelik (30 fps'te 2.4 kare) bir boşluk kalıyor ve yazı sürekli yanıp sönüyor.

   ÇÖZÜM: aynı CÜMLENİN ardışık cue'larında önceki cue'nun bitişi sonrakinin başlangıcına
   YAPIŞTIRILIR (end = next.start). Cümleler ARASINDA boşluk KORUNUR — orada yanıp sönme
   bilgi taşıyor ("yeni cümle başlıyor") ve kullanıcı da "tek cümleyse" dedi.

   NEDEN GÜVENLİ — ÜÇ NOKTA ÖLÇÜLDÜ:
     · cuesToSrt zaman damgasını `Math.round(t*1000)` ile üretiyor; end ile next.start BİREBİR
       aynı sayıdan geldiği için aynı ms dizgisini verirler. SRT'de bitiş == sonraki başlangıç
       tamamen olağan; ters dönen ya da 1 ms çakışan satır oluşmaz.
     · cakismaGider'in testi `if (onc.end <= snr.start) continue;` → end === start ÇAKIŞMA
       DEĞİL. kanallarArasiCakisma'nın testi `if (B.start >= A.end) break;` → o da değil.
       Yani iki giderici de bu köprüyü geri açmaz.
     · start'a ASLA dokunulmaz: senkron bu projede en pahalı şey ve yalnız bitiş uzuyor.

   ⚠ KANALLAR ARASI GÜVENLİK BURADA, ÇAĞIRANDA DEĞİL. Köprü bitişi 0.08 sn uzatıyor; o aralıkta
   BAŞKA bir kanalın cue'su varsa Premiere ikisini aynı anda ve aynı yerde çizer — yani
   kullanıcının şikâyet ettiği üst üste binme geri gelir. Bu yüzden köprü, uzatılacak aralıkta
   başka grubun cue'su varsa KURULMAZ. Alternatifi (köprüyü kanallarArasiCakisma'dan ÖNCE
   kurmak) daha kolaydı ama bedeli vardı: uzayan cue yeni çakışma doğurur, o da kırpma ya da
   GİZLEME üretir — yani metin kaybı satın alırdık. Yanıp sönmeyi düzeltmek için altyazı
   kaybetmek yanlış takas.

   gruplar: [{ad, cues:[...]}] — cue nesneleri YERİNDE değiştirilir, çağıranın KOPYA vermesi
   beklenir (placeCaptions öyle yapıyor). Her grubun cues'u zaman sırasına dizili olmalı. */
function cumleBirlestir(gruplar, opts, onLog) {
  opts = opts || {};
  /* KÖPRÜ KURULACAK EN BÜYÜK BOŞLUK. 0.08 buildCues'un MIN_GAP'i, 0.15 onun iki katına yakın
     bir pay: yuvarlama ve sesleHizala'nın kaydırmaları yüzünden boşluk tam 0.08 çıkmayabiliyor.
     BÜYÜTME — 0.15'in üstündeki boşluk artık yapay değil GERÇEK bir duraklamadır ve altyazının
     orada kaybolması doğrudur. */
  var MAX_KOPRU = (opts.maxKopru > 0) ? opts.maxKopru : 0.15;
  /* Başka kanalın cue'suna bırakılacak emniyet payı — kanallarArasiCakisma'nın GAP'i ile aynı. */
  var GAP = (opts.gap > 0) ? opts.gap : 0.08;
  var sayac = { koprulen: 0, kanalEngeli: 0, farkliCumle: 0, uzakBosluk: 0 };
  gruplar = gruplar || [];

  /* Diğer grupların cue'ları — köprü aralığında biri var mı diye bakmak için tek düz liste.
     Grup sayısı 1 ise liste boş kalır ve kontrol bedava geçer (tek kaynak modu).
     ⚠ CUE NESNESİNİN KENDİSİ TUTULUR, start/end KOPYASI DEĞİL. Kopyayla çalışırken bu
     fonksiyon KENDİ kurduğu köprüleri göremiyordu: C1'in cue'su 10.42 → 10.55'e uzatılıyor,
     sonra C2 işlenirken kontrol hâlâ eski 10.42'yi görüp "önce bitmiş" diyor ve ikinci köprüyü
     kuruyordu → 10.50-10.55 arasında iki kanalın yazısı ekranda ÜST ÜSTE. Sızıntı köprü başına
     en fazla MAX_KOPRU (0.15 sn) ile sınırlıydı ama tam olarak kullanıcının şikâyet ettiği
     eksende ve SESSİZ. Referansla canlı okununca aynı turda kurulan köprüler de görünüyor.
     Sıralama `start`'a göre ve start HİÇ değişmiyor (yalnız end uzuyor), yani erken çıkış
     (break) geçerliliğini koruyor. */
  var digerBas = [], g, i, cs;
  for (g = 0; g < gruplar.length; g++) {
    cs = (gruplar[g] && gruplar[g].cues) || [];
    for (i = 0; i < cs.length; i++) {
      if (!isFinite(cs[i].start) || !isFinite(cs[i].end)) continue;
      digerBas.push({ g: g, c: cs[i] });
    }
  }
  digerBas.sort(function (a, b) { return a.c.start - b.c.start; });

  /* (grupNo, bas, son) aralığında BAŞKA gruptan cue var mı. Doğrusal tarama yeterli:
     köprü sayısı cue sayısıyla orantılı ve aralık çok kısa, ama yine de erken çıkılıyor.
     (Ölçüldü: 5000 cue / 5 grup → 13 ms.) */
  function baskaKanalVar(grupNo, bas, son) {
    var j;
    for (j = 0; j < digerBas.length; j++) {
      if (digerBas[j].c.start >= son) break;            // sıralı: buradan sonrası hep uzakta
      if (digerBas[j].g === grupNo) continue;           // kendi grubu — kanal içi zaten çözülmüş
      if (digerBas[j].c.end <= bas) continue;           // önce bitmiş (CANLI bitiş)
      return true;
    }
    return false;
  }

  for (g = 0; g < gruplar.length; g++) {
    cs = (gruplar[g] && gruplar[g].cues) || [];
    for (i = 0; i + 1 < cs.length; i++) {
      var a = cs[i], b = cs[i + 1];
      if (!isFinite(a.end) || !isFinite(b.start)) continue;
      var d = b.start - a.end;
      if (d <= 0) continue;                             // zaten bitişik ya da çakışıyor
      if (d > MAX_KOPRU) { sayac.uzakBosluk++; continue; }
      /* AYNI CÜMLE Mİ? cumleId "<oturum jetonu>-<kaynakNo>:<segment>" ve buildCues cümle
         sınırında grubu BÖLÜYOR, yani kimlik gerçekten kesin. Kimliği olmayan cue'da
         (seg bilgisi yok) köprü kurulmaz: cümle sınırını uydurmaktansa boşluk bırakmak
         yeğdir — kullanıcı "TEK CÜMLEYSE birleşik olsun" dedi, "her zaman" demedi. */
      if (!a.cumleId || !b.cumleId || a.cumleId !== b.cumleId) { sayac.farkliCumle++; continue; }
      if (baskaKanalVar(g, a.end, b.start + GAP)) { sayac.kanalEngeli++; continue; }
      a.end = b.start;
      sayac.koprulen++;
    }
  }

  /* ── DOĞRULAMA TURU: İDDİAYI ÖLÇ ──
     "Köprü kanallar arası çakışma DOĞURMAZ" bir iddia; bu projede iddiaların gerçek veriyle
     sınanmadan yazılmasının bedeli birkaç kez ödendi. Köprüden SONRA kalan kanallar arası
     çakışma gerçekten sayılır ve varsa log'a yazılır — sıfırsa hiç satır basılmaz. */
  var kalanKA = 0, duz = [], x, y;
  for (g = 0; g < gruplar.length; g++) {
    cs = (gruplar[g] && gruplar[g].cues) || [];
    for (i = 0; i < cs.length; i++)
      if (isFinite(cs[i].start) && isFinite(cs[i].end)) duz.push({ g: g, c: cs[i] });
  }
  duz.sort(function (p, q) { return p.c.start - q.c.start; });
  for (x = 0; x < duz.length; x++) {
    for (y = x + 1; y < duz.length; y++) {
      if (duz[y].c.start >= duz[x].c.end) break;      // sıralı: örtüşme bitti
      if (duz[y].g !== duz[x].g) kalanKA++;
    }
  }
  sayac.kalanKanallarArasi = kalanKA;

  if (onLog) {
    if (sayac.koprulen) onLog("[kopru] " + sayac.koprulen + " altyazi ayni cumlede birlestirildi.\n");
    /* Kurulamayan köprüler SESSİZ KALMAZ: kullanıcı hâlâ yanıp sönme görürse sebebi burada. */
    if (sayac.kanalEngeli) onLog("[kopru] " + sayac.kanalEngeli + " tanesi baska kanal yuzunden kurulmadi.\n");
    if (sayac.farkliCumle) onLog("[kopru] " + sayac.farkliCumle + " bosluk cumle sinirinda, birakildi.\n");
    if (kalanKA) onLog("[kopru] UYARI: koprüden sonra " + kalanKA + " kanallar arasi cakisma var.\n");
  }
  return sayac;
}

function cuesToSrt(cues) {
  var out = [];
  for (var i = 0; i < cues.length; i++)
    out.push((i + 1) + "\n" + fmtTime(cues[i].start) + " --> " + fmtTime(cues[i].end) + "\n" + cues[i].text);
  return out.join("\n\n") + "\n";
}
function buildShortSrt(data, maxWords) { return cuesToSrt(buildCues(flattenWords(data), maxWords)); }

// saniye -> "M:SS" (1 saatten kısa) veya "H:MM:SS" (YouTube bölüm formatı)
function fmtChapter(t) {
  if (!isFinite(t) || t < 0) t = 0;
  var s = Math.floor(t), h = Math.floor(s / 3600); s -= h * 3600;
  var m = Math.floor(s / 60); s -= m * 60;
  function p(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  return h > 0 ? (h + ":" + p(m) + ":" + p(s)) : (m + ":" + p(s));
}

// cue'ları düz metne çevirir (! veya ? sonrası satır kırar)
function cuesToTxt(cues) {
  var out = "";
  for (var i = 0; i < cues.length; i++) {
    var t = cues[i].text;
    out += (i ? " " : "") + t;
    if (/[!?]$/.test(t)) out += "\n";
  }
  return out.replace(/[ \t]+\n/g, "\n").trim() + "\n";
}

// YouTube bölüm (chapter) zaman damgaları — sabit aralıkla (nokta silindiği için cümle sınırı güvenilmez)
function cuesToChapters(cues, opts) {
  opts = opts || {};
  var iv = opts.interval || 60, minGap = opts.minGap || 10, maxT = opts.maxTitle || 45;
  if (!cues.length) return "";
  var lines = [], lastStart = -999;
  function push(start, txt) { lines.push(fmtChapter(start) + " " + String(txt).slice(0, maxT)); lastStart = start; }
  push(0, cues[0].text);                       // ilk bölüm zorunlu 00:00
  var t = iv;
  while (true) {
    var picked = null;
    for (var i = 0; i < cues.length; i++) { if (cues[i].start >= t) { picked = cues[i]; break; } }
    if (!picked) break;
    if (picked.start - lastStart >= minGap) push(picked.start, picked.text);
    t = Math.floor(picked.start / iv) * iv + iv;
  }
  return lines.join("\n") + "\n";
}

/* Motor "--hotwords diye bir argüman tanımıyorum" mu dedi? Yalnızca bu KANIT varken ipucusuz
   yeniden deneme yapılır. Motor sürümleri farklı cümle kurduğu için birkaç kalıp birden aranır;
   ikisi de (hem "hotwords" hem "tanımadım" ifadesi) çıktıda geçmiyorsa çökme sebebi başkadır
   (CUDA belleği, bozuk WAV, disk dolu…) ve tekrar denemek sadece süreyi ikiye katlar. */
function _hotwordsTaninmadi(e) {
  var cikti = String((e && e.cikti) || (e && e.message) || "");
  if (!/hotwords/i.test(cikti)) return false;
  return /(unrecognized argument|unknown option|no such option|unexpected argument|invalid option|not recognized)/i.test(cikti);
}

/*
 * Ses -> cue nesneleri. opts = { model, language, diarize, maxWords, hotwords, dictMap }
 * diarize true ise cue'lar .speaker (SPEAKER_00...) taşır.
 * hotwords: motora verilecek özel isim ipucu ("Tofi, Moni, ...").
 * dictMap:  sozluk.buildMap() tablosu — transkript sonrası isim düzeltmesi için.
 */
/* ================= ALTYAZIYI SESE HİZALA =================
   Motorun kelime zaman damgası, konuşma DUYULMADAN önceye düşebiliyor: altyazı ekranda
   beliriyor, sonra kişi konuşmaya başlıyor. Kullanıcının gerçek kaydında ölçüldü
   (1847 kelime / 664 altyazı): 216 altyazı (%33) ses henüz yokken başlıyordu —
   ortanca 0.26 sn, %90'ı 0.58 sn, en fazlası 1.18 sn erken.
   Bunu üreten panel DEĞİL: cue'ların 656/664'ü kendi ilk kelimesiyle birebir aynı anda
   başlıyor. Kaynak motorun damgası, o yüzden düzeltme burada, cue kurulduktan sonra.

   Kural: SADECE İLERİ kaydırılır, asla geriye. Cue'nun başında ses zaten varsa dokunulmaz.
   Kaydırma en fazla MAX_KAYDIR; daha büyük boşluk muhtemelen yanlış hizalama demektir ve
   körlemesine kaydırmak altyazıyı yanlış yere taşır. Cue KISALMAZ — start ile end birlikte
   kayar, tek fren sonraki cue'nun başlangıcıdır (üst üste binen altyazı, erken altyazıdan
   kötüdür). Eski "okunacak süre kalmıyorsa dokunma" kuralı kaldırıldı: cue artık kısalmadığı
   için okuma süresi zaten korunuyor, o fren yalnızca düzeltmeleri iptal ediyordu. */
function _wavZarf(wavPath, pencereSn) {
  var buf = fs.readFileSync(wavPath);
  var hz = 16000, bit = 16, kanal = 1, dataOff = -1, dataLen = 0;
  for (var o = 12; o + 8 <= buf.length; ) {
    var id = buf.toString("ascii", o, o + 4), sz = buf.readUInt32LE(o + 4);
    if (id === "fmt ") {
      kanal = buf.readUInt16LE(o + 10); hz = buf.readUInt32LE(o + 12); bit = buf.readUInt16LE(o + 22);
    } else if (id === "data") { dataOff = o + 8; dataLen = sz; break; }
    o += 8 + sz + (sz & 1);
  }
  /* buildTimelineAudio 16 kHz mono 16-bit üretir; başka bir şey gelirse hizalama atlanır —
     ama SEBEBİ SÖYLENEREK. Eskiden hepsi düz `null` dönüyordu ve çağıran tek bir "ses
     okunamadı" mesajı basıyordu; kullanıcı hangi sorunu arayacağını bilemiyordu. */
  if (dataOff < 0) return { zarf: null, sebep: "WAV'da 'data' bloğu yok" };
  if (bit !== 16) return { zarf: null, sebep: bit + " bit (16 bekleniyordu)" };
  if (!hz) return { zarf: null, sebep: "örnekleme hızı okunamadı" };
  var adim = Math.max(1, Math.round(hz * pencereSn)) * kanal;
  var toplamOrnek = Math.floor(Math.min(dataLen, buf.length - dataOff) / 2);
  var n = Math.floor(toplamOrnek / adim);
  if (n < 10) return { zarf: null, sebep: "ses çok kısa (" + n + " pencere)" };
  var zarf = new Float64Array(n);
  for (var i = 0; i < n; i++) {
    var s = 0, taban = dataOff + i * adim * 2;
    for (var j = 0; j < adim; j++) { var v = buf.readInt16LE(taban + j * 2) / 32768; s += v * v; }
    zarf[i] = Math.sqrt(s / adim);
  }
  return { zarf: zarf, pencere: pencereSn };
}

function sesleHizala(cues, wavPath, onLog) {
  /* CUE KISALTILMAZ — start ile birlikte end de AYNI MİKTAR kaydırılır.
     Eskiden yalnız start ileri gidiyordu: cue kısalıyor, "okunacak süre kalmıyor" freni
     (EN_AZ_KALAN) devreye giriyor ve cue'ya HİÇ dokunulmuyordu. Kelime tavanı 2'ye inince
     cue'lar zaten kısaldığı için o fren düzeltmelerin çoğunu iptal ediyordu. Cue tümüyle
     kaydırılınca süresi sabit kalıyor, fren gereksizleşiyor ve daha çok cue düzeltilebiliyor.
     Kurallar aynı: ASLA geriye kaydırma yok · en fazla MAX_KAYDIR ileri · sonraki cue'nun
     başına HIZ_GAP kala durulur (üst üste binen altyazı, erken altyazıdan kötüdür). */
  /* MIN_GOR = kısaltılan bir altyazının ekranda kalabileceği EN KISA süre. cakismaGider'deki
     0.15 buraya KONMAZ: o "Premiere klibi var saysın" ölçüsüdür, okunabilirlik ölçüsü değil.
     ÖLÇÜLDÜ (kullanıcının A1 kaydı, 1059 cue): 0.30 daha çok düzeltiyor (sessizde başlayan
     234 -> 119) ama 0.30 sn altındaki cue sayısını 165'ten 186'ya çıkarıyor; 0.40'ta o sayı
     hiç değişmiyor (165 -> 165). Kazancın büyük kısmını alıp regresyon üretmeyen değer 0.40.

     ARA_PENCERE ≠ MAX_KAYDIR — İKİSİ AYRI ŞEY, BİRLEŞTİRME. Eskiden onset araması da
     kaydırma tavanı da aynı 0.60'tı: 0.60 sn'den daha geç başlayan konuşmada cue "pencere
     dışı" sayılıp HİÇ düzeltilmiyordu (kullanıcının işaret ettiği ~0.7 sn'lik vaka tam da bu).
     Artık konuşma 1.20 sn'ye kadar ARANIYOR ama cue yine en fazla MAX_KAYDIR kadar kayıyor:
     yer değiştirme üst sınırı büyümediği için "yanlış onset'e yapışma" riski de büyümüyor,
     en kötü durumda zaten izin verilen 0.60'ı kullanmış oluruz ve cue tanım gereği
     sessizlikte başlıyordu — 0.60 ileri gitmek nötr ya da iyi. */
  var PEN = 0.010, MAX_KAYDIR = 0.60, ONEMSIZ = 0.06, HIZ_GAP = 0.08;
  var MIN_GOR = 0.40, ARA_PENCERE = 1.20;
  /* İKİ AYRI SEBEP, İKİ AYRI MESAJ. Eskiden `catch (e) { z = null; }` istisna metnini YUTUYOR
     ve tek bir "ses okunamadı" satırı iki bambaşka durumu birbirine karıştırıyordu:
     (a) dosya açılamadı / WAV başlığı ayrıştırılırken çöktü (istisna — yol, izin, bozuk dosya),
     (b) dosya okundu ama hizalamaya elverişli değil (16-bit değil, data bloğu yok, çok kısa).
     Kullanıcı bu ikisini ayırt edemeyince nereye bakacağını da bilemiyordu. */
  var z = null, zIstisna = "";
  try { z = _wavZarf(wavPath, PEN); }
  catch (e) { z = null; zIstisna = String((e && e.message) || e); }
  if (!z || !z.zarf) {
    if (onLog) {
      /* İstisna metni panelde kırpılmasın diye kısaltılır (bkz. app.js whenLog 80 karakter
         sınırı); dosya adı AYRI satıra yazılır, yoksa tam yol istisna metnini yiyor. */
      if (zIstisna) {
        onLog("[hizala] WAV okunamadı (istisna): " + zIstisna.slice(0, 40) + "\n");
        onLog("[hizala] dosya: " + path.basename(String(wavPath)).slice(0, 55) + "\n");
      } else onLog("[hizala] WAV elverişsiz: " + ((z && z.sebep) || "bilinmeyen sebep") + "\n");
      onLog("[hizala] altyazı zamanlarına dokunulmadı.\n");
    }
    return cues;
  }
  var zarf = z.zarf, N = zarf.length;

  /* Konuşma eşiği: gürültü tabanının katı. Taban, sıfır olmayan değerlerin %35'lik
     dilimi (sessizlik payı bol tutuldu ki nefes/tık sesi konuşma sayılmasın). */
  var sirali = [];
  for (var i = 0; i < N; i++) if (zarf[i] > 0) sirali.push(zarf[i]);
  // Eşik kurulamıyorsa hizalama YAPILMAZ — ama sessizce değil: kullanıcı "hizalama açıktı,
  // neden hiçbir şey değişmedi?" diye sorduğunda cevabı log'da bulsun.
  if (sirali.length < 10) {
    // İki kısa satır: tek uzun satır panelde kırpılıyor (bkz. app.js whenLog 80 karakter).
    if (onLog) {
      onLog("[hizala] ses neredeyse tümüyle sessiz (ölçülebilir " + sirali.length + " pencere).\n");
      onLog("[hizala] eşik kurulamadı, altyazı zamanlarına dokunulmadı.\n");
    }
    return cues;
  }
  sirali.sort(function (a, b) { return a - b; });
  var esik = sirali[Math.floor(sirali.length * 0.35)] * 3;
  if (!(esik > 0)) {
    if (onLog) onLog("[hizala] konuşma eşiği hesaplanamadı — altyazı zamanlarına dokunulmadı.\n");
    return cues;
  }

  /* SAYAÇLAR — sessiz düzeltme de sessiz başarısızlık da yasak. "Kaç cue'ya dokunuldu"
     tek başına işe yaramıyor: asıl soru DÜZELTİLEMEYENLERİN NEDEN düzeltilemediği.
     Sonraki her değişikliğin (kelime tavanı, pencere boyu, eşik) etkisini ölçmenin tek yolu bu. */
  var duzeltildi = 0, toplamKayma = 0, kismi = 0;
  var kisaldi = 0;       // rijit kaydırılamadı, yalnız BAŞLANGICI ilerledi (cue kısaldı)
  var tavanaDayandi = 0; // konuşma MAX_KAYDIR'dan daha geç başlıyor — kısmen düzeldi, tam değil
  var yokPencere = 0;    // ARA_PENCERE içinde konuşma hiç başlamadı
  var yokSure = 0;       // cue zaten MIN_GOR kadar kısa — kısaltacak yer yok
  var yokOnset = 0;      // cue, ses zarfının dışında kalıyor (WAV o noktayı kapsamıyor)
  var dokunulmadi = 0;   // başında ses zaten var / kayma önemsiz — düzeltmeye gerek yok
  for (var c = 0; c < cues.length; c++) {
    var cue = cues[c];
    var bas = Math.floor(cue.start / PEN);
    if (bas < 0 || bas >= N) { yokOnset++; continue; }
    if (zarf[bas] >= esik) { dokunulmadi++; continue; }     // başında ses VAR, dokunma
    var sinir = Math.min(N, bas + Math.ceil(ARA_PENCERE / PEN));
    var onset = -1;
    for (var k = bas; k < sinir; k++) if (zarf[k] >= esik) { onset = k; break; }
    if (onset < 0) { yokPencere++; continue; }              // sınır içinde konuşma yok
    var kayma = onset * PEN - cue.start;
    if (kayma <= ONEMSIZ) { dokunulmadi++; continue; }      // zaten neredeyse aynı
    /* Konuşma tavandan daha geç başlıyor: elimizden geldiği kadar yaklaş, ama SÖYLE.
       Sessizce 0.60'a kırpıp "düzeltildi" demek, kullanıcının ekranda hâlâ kaymış gördüğü
       altyazıyı log'da "düzeldi" diye göstermek olurdu. */
    if (kayma > MAX_KAYDIR) { kayma = MAX_KAYDIR; tavanaDayandi++; }
    /* TAVAN İKİ AŞAMALI — TEK KURALLI ESKİ HÂLİ HİZALAMAYI KİLİTLİYORDU.
       Eski kural: "cue'nun SONU sonrakinin başına HIZ_GAP kala durmalı" ve cue RİJİT
       kayıyordu (start+end birlikte). Ama buildCues zaten her cue'nun bitişini
       `sonraki.start - MIN_GAP` değerine DAYIYOR ve MIN_GAP ile HIZ_GAP AYNI sayı (0.08),
       yani `(sonraki.start - HIZ_GAP) - cue.end` tavanı tam SIFIR çıkıyor ve `tavan <= ONEMSIZ`
       freni cue'ya hiç dokunmadan geçiyordu. Bu bir ayar meselesi değil, ARİTMETİK ÖZDEŞLİK:
       buildCues'un kendi doldurması hizalayıcıyı kilitliyordu. ÖLÇÜLDÜ (kullanıcının gerçek
       A1 kaydı, 1059 cue): cue'ların %78'inde tavan 0; sessizde başlayan 234 altyazının
       yalnız 21'i düzeliyordu (234 -> 213), 144'ü "tavana çarptı" diye atlanıyordu.

       YENİ KURAL — tek formül, üç davranışı birden veriyor:
         sonKaydir = bitişin gidebileceği kadarı (rijit tavanla sınırlı, hiç yer yoksa 0)
         basKaydir = başlangıcın gidebileceği kadarı (cue'ya MIN_GOR kalmak şartıyla)
       · Yer VARSA ikisi de `kayma` olur -> cue RİJİT kayar, okuma süresi aynen korunur
         (eski davranışla birebir aynı).
       · Yer YOKSA sonKaydir 0 kalır, yalnız BAŞLANGIÇ ilerler ve BİTİŞ yerinde durur. Cue
         kısalır ama kısalan kısım tanım gereği SESSİZLİKTİ (onset'e kadar konuşma yok).
       · Arada kalan melez durumda (yer var ama yetmiyor) bitiş gidebildiği kadar gider,
         başlangıç ondan biraz daha fazla — böylece hiçbir durumda eski koddan AZ düzeltilmez.
       Cue'nun zaman aralığı yalnız-başlangıç dalında DARALDIĞI için kanallar arası çakışmayı
       da azaltır; rijit dalda ise cue ileri UZAR ve yeni bir kanallar arası çakışma
       DOĞURABİLİR — kanallarArasiCakisma bu yüzden sesleHizala'dan SONRA çalışmak zorunda. */
    var sonrakiBas = (c + 1 < cues.length) ? cues[c + 1].start : Infinity;
    var rijitTavan = isFinite(sonrakiBas) ? ((sonrakiBas - HIZ_GAP) - cue.end) : MAX_KAYDIR;
    var sonKaydir = Math.min(kayma, Math.max(0, rijitTavan));
    var basKaydir = Math.min(kayma, (cue.end + sonKaydir - MIN_GOR) - cue.start);
    // Cue zaten MIN_GOR kadar kısa: kaydırmak onu görünmez yapardı, kazanç sıfır olurdu.
    if (basKaydir <= ONEMSIZ) { yokSure++; continue; }
    if (basKaydir < kayma) kismi++;                         // kısmen kaydırıldı: hiç yoktan iyi
    cue.start = +(cue.start + basKaydir).toFixed(3);
    if (sonKaydir > 0) cue.end = +(cue.end + sonKaydir).toFixed(3);
    duzeltildi++; toplamKayma += basKaydir;
    if (sonKaydir < basKaydir) kisaldi++;                   // bitiş geride kaldı -> cue kısaldı
  }
  /* ÖZET AYRI AYRI KISA SATIRLAR HÂLİNDE BASILIR. Eski tek satırlık özet 274 karakterdi;
     app.js whenLog satırı 80 karaktere kırptığı için (`s.slice(-80)`) panelde YALNIZCA sonu
     görünüyordu — "kaç düzeltildi / kaç düzeltilemedi" hiç görünmüyordu, yani bu sayaçların
     varlık sebebi boşa gidiyordu. Her satır 80 karakterin altında tutulur. */
  if (onLog) {
    var basarisiz = yokPencere + yokSure + yokOnset;
    var sat = "[hizala] " + duzeltildi + " altyazı düzeltildi";
    if (duzeltildi) sat += " (ort. " + (toplamKayma / duzeltildi).toFixed(2) + " sn ileri)";
    onLog(sat + ".\n");
    /* KISALANLARI SÖYLE. Yeni tavan mantığında cue'nun bitişi yerinde kalıp yalnız başlangıcı
       ilerleyebiliyor; bu, altyazının ekranda daha kısa kalması demek. Kullanıcı bunu fark
       edip "altyazılarım niye kısaldı?" diye sorduğunda cevabı burada bulmalı — kısalan kısım
       sessizlikti, ama bunu söylemeden yapmak sessiz değişikliktir. */
    if (kisaldi) onLog("[hizala] " + kisaldi + " altyazının yalnız başlangıcı ilerledi.\n");
    if (kismi) onLog("[hizala] " + kismi + " tanesi tabana takılıp kısmen kaydı.\n");
    /* Tavana dayananlar DÜZELTİLDİ sayılır ama tam değil: konuşma MAX_KAYDIR'dan geç
       başlıyor, yani o altyazılar hâlâ erken görünüyor olabilir. Kullanıcı ekranda kayma
       görmeye devam ederse cevabı bu satır. */
    if (tavanaDayandi) onLog("[hizala] " + tavanaDayandi + " altyazı " + MAX_KAYDIR.toFixed(2) +
      " sn tavanına dayandı, hâlâ erken olabilir.\n");
    onLog("[hizala] " + basarisiz + " düzeltilemedi · " + dokunulmadi + " zaten yerinde.\n");
    // Düzeltilemeyenlerin SEBEBİ tek tek: "neden değişmedi" sorusunun cevabı burada.
    if (yokPencere) onLog("[hizala] " + yokPencere + " pencere dışı: " + ARA_PENCERE.toFixed(2) +
      " sn'de konuşma başlamadı.\n");
    if (yokSure) onLog("[hizala] " + yokSure + " altyazı zaten çok kısa, kısaltılamadı.\n");
    if (yokOnset) onLog("[hizala] " + yokOnset + " onset yok: ses o noktayı kapsamıyor.\n");
  }
  return cues;
}

async function transcribe(cfg, wavPath, onLog, opts) {
  opts = opts || {};
  const outDir = path.dirname(wavPath);
  const base = path.basename(wavPath, path.extname(wavPath));
  const args = [
    wavPath,
    "--model", opts.model || cfg.model,
    "--language", opts.language || cfg.language,
    "--device", cfg.device,
    "--compute_type", cfg.computeType || "float16",
    "--task", "transcribe",
    "--word_timestamps", "true",
    "--beep_off",   // motorun bitişte çaldığı bip sesini kapat
  ];
  // Konuşmacı ayırma (pyannote) PyTorch kullanır; bazı GPU'larda "no kernel image" verir
  // (torch o mimari için derlenmemiş). Diarization'ı CPU'da çalıştırırız — her GPU'da güvenli.
  // Ana transkripsiyon (CTranslate2) GPU'da hızlı kalır.
  if (opts.diarize) {
    // pyannote_v3.1: kullanıcı testinde reverb_v2'den daha iyi sonuç verdi (+MIT lisanslı, ticari-güvenli).
    // Cihaz makineye özel: çalışan GPU'da cuda (hızlı), Blackwell/desteksiz GPU'da cpu.
    args.push("--diarize", "pyannote_v3.1", "--diarize_device", (opts.diarizeDevice || cfg.diarizeDevice || "cpu"));
    // Otomatik kümeleme benzer sesleri birleştirebilir (5 kişi -> 2). Kullanıcı sayıyı
    // verirse modeli tam o kadar konuşmacıya zorlarız (daha hassas ayırma).
    var ns = parseInt(opts.numSpeakers, 10);
    if (ns > 0) args.push("--num_speakers", String(ns));
    else {
      /* Kesin sayı bilinmiyorsa alt/üst sınır ver. Otomatik kümeleme benzer sesleri BİRLEŞTİRME
         eğiliminde (4 arkadaş -> 2 konuşmacı) ve panelde bunu düzeltmek imkânsız: sonradan
         konuşmacı EKLENEMİYOR. Fazla bölme ise bedava — iki konuşmacıya aynı rengi verirsin.
         Bu yüzden alt sınır ("en az N kişi") pratikte en faydalı ayar. */
      var mn = parseInt(opts.minSpeakers, 10), mx = parseInt(opts.maxSpeakers, 10);
      if (mn > 0) args.push("--min_speakers", String(mn));
      if (mx > 0) args.push("--max_speakers", String(mx));
    }
    args.push("--output_format", "json", "srt");
  } else args.push("--output_format", "json");
  args.push("--output_dir", outDir);

  /* Hızlı önizleme bayrağı ipucusuz YEDEK kopyaya da girmeli; yoksa motor --hotwords'ü
     tanımayıp yedeğe düşüldüğünde hızlı mod sessizce kapanıyor. */
  if (opts.batched) args.push("--batched");
  // İpucusuz kopya — motor --hotwords'ü tanımazsa (eski sürüm) buna geri dönülür.
  const argsNoHot = args.slice();
  // Karakter/özel isim ipucu: modele "bu isimler geçecek" der, doğru yazma olasılığı artar.
  // Motorun --reprompt varsayılanı True olduğu için ipucu TÜM video boyunca taşınır.
  // --initial_prompt'a DOKUNULMAZ: onun 'auto' preset'i Türkçe noktalama/büyük harf kalitesini taşır.
  const hot = String(opts.hotwords || "").trim();
  if (hot) args.push("--hotwords", hot);

  const engDir = path.dirname(cfg.engineExe);
  const xxl = path.join(engDir, "_xxl_data");
  const pathDirs = [engDir, xxl, path.join(xxl, "ctranslate2"), path.join(xxl, "torch", "lib")];
  const logFile = path.join(outDir, "engine_last.log");
  const jsonPath = path.join(outDir, base + ".json");
  const srtPath = path.join(outDir, base + ".srt");

  if (onLog) onLog("[whisper] " + (opts.diarize ? "konuşmacı ayırma + " : "") + "yazıya dökülüyor (GPU)...\n");
  const runOpts = { cwd: engDir, pathDirs: pathDirs, logFile: logFile };
  const damga = iptalDamgasi();   // bu çalıştırma başlarken iptal sayacı kaçtı
  try {
    await run(cfg.engineExe, args, onLog, runOpts);
  } catch (e) {
    /* 1) İPTAL — kullanıcı "İptal"e bastıysa motoru BİZ öldürdük. Öldürülen süreç de sıfırdan
       farklı çıkış kodu verdiği ve JSON yazamadığı için eski kod bunu "--hotwords desteklenmiyor"
       sanıp motoru baştan çalıştırıyordu: iptal işe yaramıyor, GPU süresi ikiye katlanıyordu.
       İptalde ASLA yeniden deneme yapma, hemen çık. */
    if (iptalEdildiMi(damga)) {
      if (onLog) onLog("[whisper] iptal edildi, motor durduruldu.\n");
      throw new Error("İptal edildi");
    }
    /* 2) Yedek (ipucusuz) yol iki durumda çalışır: (a) motor açıkça "unrecognized argument
       --hotwords" dedi, (b) motor TEK SATIR bile yazmadan çöktü — eski sürümlerin --hotwords'te
       yaptığı buydu, o yüzden yalnız (a) aranırsa yedek yol hiç devreye girmez.
       Çıktı dolu ama argüman hatası yoksa sebep başkadır (CUDA belleği, bozuk WAV, disk dolu) ve
       tekrar denemek kullanıcıyı aynı hataya tam süre bekleterek ikinci kez sokar. */
    var ciktiYok = !String((e && e.cikti) || "").trim();
    if (!fs.existsSync(jsonPath) && hot && (_hotwordsTaninmadi(e) || ciktiYok)) {
      if (onLog) onLog("[whisper] motor isim ipucunu (--hotwords) tanımadı, ipucusuz tekrar deneniyor...\n");
      /* ⚠ İKİNCİ DENEMENİN HATASI SAKLANIR, YUTULMAZ.
         Eskiden `catch (e2) {}` ile tamamen atılıyor ve iki satır sonra BİRİNCİ hata
         fırlatılıyordu; oysa bu dala ancak birinci denemenin çıktısı BOŞ olduğunda
         giriliyor (ciktiYok), yani kullanıcıya gösterilen hata neredeyse her zaman
         sebepsiz oluyordu. Gerçek sebep (CUDA belleği, bozuk WAV, disk dolu) ikinci
         koşunun çıktısındaydı ve görünmüyordu. Artık çıktısı DOLU olan deneme fırlatılır.
         Ayrı log dosyası: ikinci koşu aynı runOpts ile engine_last.log'un üzerine yazıyor,
         birinci denemenin izini siliyordu. */
      var ikinciHata = null;
      var runOpts2 = { cwd: engDir, pathDirs: pathDirs, logFile: path.join(outDir, "engine_last_ipucusuz.log") };
      try { await run(cfg.engineExe, argsNoHot, onLog, runOpts2); } catch (e2) { ikinciHata = e2; }
      if (iptalEdildiMi(damga)) throw new Error("İptal edildi");
      if (!fs.existsSync(jsonPath) && ikinciHata) {
        // Hangisinde gerçek çıktı varsa onu göster; ikisi de boşsa birinci hata (eski davranış).
        var birinciDolu = !!String((e && e.cikti) || "").trim();
        var ikinciDolu = !!String((ikinciHata && ikinciHata.cikti) || "").trim();
        if (ikinciDolu && !birinciDolu) throw ikinciHata;
      }
    }
    if (!fs.existsSync(jsonPath)) throw e;
    if (onLog) onLog("[whisper] çıkışta uyardı ama transkript hazır.\n");
  }
  if (!fs.existsSync(jsonPath)) throw new Error("JSON üretilemedi: " + jsonPath);
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const uydurma = filterHallucinations(data);
  if (uydurma.length && onLog) onLog("[whisper] " + uydurma.length + " uydurma satır atıldı: " + uydurma.join(" / ") + "\n");
  const words = flattenWords(data);
  // Karakter isimlerini düzelt (Toffy'ye -> Tofi'ye). Model ipucuna uymamış olsa bile
  // burası deterministik: sözlükteki yanlış yazımlar doğrusuyla değiştirilir.
  // Konuşmacı atamasından ÖNCE: bölünmüş isimler burada birleşebiliyor.
  if (opts.dictMap) {
    var nFix = sozluk.fixWords(words, opts.dictMap);
    if (nFix && onLog) onLog("[sözlük] " + nFix + " isim düzeltildi.\n");
  }
  if (opts.diarize) {
    if (fs.existsSync(srtPath)) {
      assignSpeakers(words, parseSpeakerIntervals(fs.readFileSync(srtPath, "utf8")));
    } else if (onLog) {
      onLog("[whisper] UYARI: konuşmacı ayırma istendi ama SRT üretilmedi, konuşmacı ayrımı atlandı.\n");
    }
  }
  // DİKKAT: "!!" KULLANMA — censor üç değerli (false | "all" | "hard"); boolean'a çevirmek
  // "sadece ağır küfür" seçeneğini sessizce "hepsi" yapar.
  /* KELİME TAVANI: önce çağıranın dediği (opts.maxWords). config.json yalnızca YEDEK — kullanıcının
     kurulu kopyasındaki maxWordsPerCue oto-güncellemede korunduğu için repodaki değeri değiştirmek
     panele ulaşmaz; kalıcı bir tavan istiyorsan app.js'te opts.maxWords ver.
     onLog buildCues'a da geçer: kısa cue onarımı ve tavanı aşan satırlar log'a SAYIYLA düşsün. */
  var cues = buildCues(words, opts.maxWords || cfg.maxWordsPerCue || 3, opts.censor, opts.maxChars, onLog);
  /* Altyaziyi sese hizala: motorun damgasi konusmadan once basliyor olabilir (bkz. sesleHizala).
     opts.sesHizala === false ile kapatilabilir; varsayilan ACIK. */
  if (opts.sesHizala !== false) {
    try { cues = sesleHizala(cues, wavPath, onLog); }
    catch (eSH) { if (onLog) onLog("[hizala] atlandı: " + (eSH.message || eSH) + "\n"); }
  }
  try { fs.unlinkSync(jsonPath); } catch (e) {}
  try { if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath); } catch (e) {}
  if (onLog) onLog("[whisper] bitti (" + cues.length + " satır).\n");
  return cues;
}

// Birden fazla wav'ı tek wav'a karıştırır (A1+A2 sesleri)
async function mixWavs(wavs, ffmpegExe, outWav) {
  if (wavs.length === 1) { fs.copyFileSync(wavs[0], outWav); return outWav; }
  const inputs = [], labels = [];
  for (let i = 0; i < wavs.length; i++) { inputs.push("-i", wavs[i]); labels.push("[" + i + ":a]"); }
  const fc = labels.join("") + "amix=inputs=" + wavs.length + ":normalize=0[m]";
  await run(ffmpegExe, [...inputs, "-filter_complex", fc, "-map", "[m]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", outWav], null, { cwd: path.dirname(ffmpegExe) });
  return outWav;
}

// WAV'ı [startSec, endSec] aralığına kırpar (PCM -> örnek-hassas). endSec sonsuz/geçersizse sona kadar.
async function trimWav(inWav, outWav, startSec, endSec, ffmpegExe) {
  const args = ["-ss", String(Math.max(0, startSec || 0)), "-i", inWav];
  if (isFinite(endSec) && endSec > (startSec || 0)) args.push("-t", String(endSec - (startSec || 0)));
  args.push("-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", outWav);
  await run(ffmpegExe, args, null, { cwd: path.dirname(ffmpegExe) });
  if (!fs.existsSync(outWav)) throw new Error("Kırpılmış WAV üretilemedi: " + outWav);
  return outWav;
}

/* Ses dosyasinin BASINI kirpar — KODEK KOPYALANIR, yeniden kodlama YOK.
   trimWav bu is icin kullanilamaz: o altyazi hatti icin yazilmis ve ciktiyi sabit
   16 kHz MONO pcm_s16le yaziyor; Craig'in 48 kHz kaydini oraya sokmak kalite kaybi olur.
   "-c copy" ile uzanti ve kodek korunur (m4a -> m4a). */
async function trimAudioCopy(inFile, outFile, startSec, ffmpegExe) {
  const args = ["-ss", String(Math.max(0, startSec || 0)), "-i", inFile, "-c", "copy", "-y", outFile];
  await run(ffmpegExe, args, null, { cwd: path.dirname(ffmpegExe) });
  if (!fs.existsSync(outFile)) throw new Error("Kırpılmış ses üretilemedi: " + outFile);
  return outFile;
}

/*
 * AutoCut analizi: HAZIR bir konuşma wav'ını (timeline'a hizalı) analiz eder.
 * voiceWav sekans zamanına hizalı olduğu için bulunan boşluklar SEKANS zamanıdır.
 * opts = { sensitivity:14, minSilence:0.5, padding:0.12 }
 * Döner: { mean, threshold, cuts:[{start,end,dur}], count, totalCut }
 */
async function analyzeSilence(cfg, voiceWav, onLog, opts) {
  opts = opts || {};
  /* Bu çalıştırma başlarken iptal sayacı kaçtı (transcribe:1569 ile aynı desen).
     Aşağıdaki ön-filtre catch'i reddin sebebini bununla ayırt ediyor. */
  const _asDamga = iptalDamgasi();
  const sensitivity = (opts.sensitivity != null) ? opts.sensitivity : 14;
  const minSilence = (opts.minSilence != null) ? opts.minSilence : 0.5;
  // Asimetrik kenar payı (A8): konuşma başlangıcından önce daha çok "nefes" bırak (leadIn),
  // önceki konuşmanın kuyruğunu daha sıkı kırp (tailOut) — ilk hece aceleci duyulmasın.
  const tailOut = (opts.padding != null) ? opts.padding : Math.min(0.10, minSilence * 0.18);
  const leadIn = Math.min(0.18, Math.max(tailOut, minSilence * 0.30));
  // 0.05 mutlak taban: kesim en az ~1 kare olsun ki razor sub-frame'de bozulmasın.
  const minCut = Math.max(0.05, Math.min(0.15, minSilence * 0.4));
  const ffmpeg = cfg.ffmpegExe, ffDir = path.dirname(ffmpeg);

  /* Tespit ön-filtresi (A1): SADECE analiz için — konuşma bandını izole eder, oyun sesi/hum/
     rumble tabanını düşürür. Kesime giden ses bundan ETKİLENMEZ (bu wav yalnız analiz içindir).
     Filtre bu ffmpeg sürümünde yoksa filtresiz devam edilir.
     PERFORMANS: afftdn (gürültü azaltma) FFT tabanlı ve ÇOK pahalı — ölçüldü, 23 dakikalık seste
     analizin %94'ünü yiyor (14.1 sn -> 2.6 sn). Boşlukların %83'ü onsuz da aynı çıktığı için
     VARSAYILAN KAPALI; gürültülü kayıtta panelden açılabilir. */
  const nr = opts.denoise ? "afftdn=nr=12," : "";
  let pre = "highpass=f=90,lowpass=f=7000," + nr;
  if (onLog) onLog("[autocut] ses seviyesi ölçülüyor...\n");
  let vd = "";
  try {
    await run(ffmpeg, ["-i", voiceWav, "-af", pre + "volumedetect", "-f", "null", "-"], function (l) { vd += l; }, { cwd: ffDir });
  } catch (ePre) {
    /* ⚠ IPTALI "FILTRE DESTEKLENMIYOR" SANMA — YOKSA IPTAL DUGMESI HIC CALISMIYOR.
       cancelAll() calisan ffmpeg'i taskkill ile olduruyor ve run() bu yuzden REJECT ediyor.
       Bu catch reddin SEBEBINE bakmadigi icin iptali "demek ki bu ffmpeg surumu highpass/
       lowpass desteklemiyor" diye yorumluyor, log'a YANLIS sebebi yaziyor ve ffmpeg'i IKINCI
       KEZ baslatiyordu. Ikinci surec cancelAll'dan SONRA dogdugu icin _procs bos, kimse onu
       oldurmuyor; akis boskluk taramasina gecip normal bitiyor ve panel "Bitti — N bosluk
       bulundu" diyordu. Ustelik analiz artik on-filtresiz esikle yapildigi icin bulunan
       bosluklar da normal kosudakinden FARKLI cikiyordu.
       Kontrol LOG'DAN ONCE: yanlis teshis ekrana hic yazilmasin. transcribe:1577'deki desen. */
    if (iptalEdildiMi(_asDamga) || (ePre && ePre.iptal)) throw ePre;
    if (onLog) onLog("[autocut] ön-filtre uygulanamadı, filtresiz devam.\n");
    pre = ""; vd = "";
    await run(ffmpeg, ["-i", voiceWav, "-af", "volumedetect", "-f", "null", "-"], function (l) { vd += l; }, { cwd: ffDir });
  }
  const mv = vd.match(/mean_volume:\s*(-?[\d.]+)/);
  const mx = vd.match(/max_volume:\s*(-?[\d.]+)/);
  const mean = mv ? parseFloat(mv[1]) : -20;
  const maxVol = mx ? parseFloat(mx[1]) : 0;
  // Eşik = ortalama - hassasiyet; ama konuşma tepesine (maxVol) göre kelepçele (A2):
  // videolar arası tutarlılık için eşik tepe-göreli bir bantta kalsın.
  let threshold = Math.round(mean - sensitivity);
  const hiClamp = Math.round(maxVol - 10);  // tepenin 10dB altından yukarı çıkmasın (aşırı kesim)
  const loClamp = Math.round(maxVol - 42);  // ve 42dB altından aşağı inmesin (hiç boşluk bulamama)
  if (threshold > hiClamp) threshold = hiClamp;
  if (threshold < loClamp) threshold = loClamp;

  if (onLog) onLog("[autocut] boşluklar taranıyor (eşik " + threshold + "dB)...\n");
  let sd = "";
  await run(ffmpeg, ["-i", voiceWav, "-af", pre + "silencedetect=noise=" + threshold + "dB:d=" + minSilence, "-f", "null", "-"], function (l) { sd += l; }, { cwd: ffDir });

  const cuts = [];
  const re = /silence_(start|end):\s*(-?[\d.]+)/g;
  let m, curStart = null;
  while ((m = re.exec(sd))) {
    if (m[1] === "start") curStart = parseFloat(m[2]);
    else if (m[1] === "end" && curStart != null) {
      const hamSon = parseFloat(m[2]);
      const s = curStart + tailOut, e = hamSon - leadIn;
      /* hamBas/hamSon = silencedetect'in HAM sessizlik sınırları (dolgu payları uygulanmadan).
         Birleştirme kararı bunlarla verilir; sebebi hemen aşağıda. */
      if (e - s >= minCut) cuts.push({ start: s, end: e, dur: e - s, hamBas: curStart, hamSon: hamSon });
      curStart = null;
    }
  }
  /* ARDIŞIK BOŞLUKLARI BİRLEŞTİR — kesim SAYISI, kesim süresinden çok daha pahalı.
     İki boşluk arasında MERGE_GAP'ten kısa bir konuşma parçası kalıyorsa ikisi tek kesim yapılır.
     Ölçüm (gerçek 42 dakikalık kayıt): 1137 kesim -> 606 kesim, kazanılan süre 655.5 -> 649.9 sn,
     yani kesim sayısı yarıya inerken kazanç sadece %0.8 azalıyor.
     Ayrıca KALİTE de artıyor: 0.15 sn'lik konuşma kırıntıları zaten makineli tüfek gibi
     jump-cut üretiyordu. Değer muhafazakâr tutuldu — anlamlı bir kelime 0.15 sn'ye sığmaz. */
  /* ⚠ KARŞILAŞTIRMA HAM SESSİZLİK SINIRLARIYLA YAPILIR — eskiden DOLGU PAYLI kesim
     aralığıyla yapılıyordu ve bu dal varsayılan ayarda MATEMATİKSEL OLARAK hiç çalışmıyordu.
     Hesap: cuts[q].start = hamBas_q + tailOut · son.end = hamSon_(q-1) - leadIn
            cuts[q].start - son.end = (hamBas_q - hamSon_(q-1)) + tailOut + leadIn
     Yani ölçülen fark, gerçek konuşma parçasının üstüne (tailOut + leadIn) ekliyordu.
     Varsayılanlarda (minSilence 0.5): tailOut = 0.09 · leadIn = 0.15 -> toplam 0.24.
     Gerçek konuşma parçası hiçbir zaman negatif olamayacağı için fark daima >= 0.24 ve
     MERGE_GAP 0.15'in ALTINA hiç inemiyordu; yorumda anlatılan "1137 -> 606 kesim" ölçümü
     bu koddan çıkamazdı. Artık iki sessizlik ARASINDA kalan konuşma parçasının ham süresi
     ölçülüyor: hamBas_q - hamSon_(q-1). Bu dal artık gerçekten çalıştığı için kesim SAYISI
     değişir; kaç kesimin birleştirildiği aşağıda log'a yazılır. */
  /* ⚠⚠ VARSAYILAN 0 = BIRLESTIRME KAPALI (18 Agustos 2026 regresyon turu).
     Bu dal uzun sure OLU kaldi: karsilastirma dolgu paylari CIKARILMIS kesim araligi ile
     yapiliyordu ve varsayilan paylarla matematiksel olarak esigin altina hic inemiyordu.
     Denetimde matematik DUZELTILDI (ham sessizlik sinirlari) ve 1000 rastgele senaryoda
     sira/cakisma hatasi uretmedigi olculdu. AMA calisir hale gelmesi bir DAVRANIS
     degisikligi: iki sessizlik arasinda kalan ve esigin USTUNDE olan (yani DUYULAN)
     kisa parcalar artik kesim araligina giriyor ve SILINIYOR. Birlesme zincirleme:
     her birlesmede karsilastirma noktasi ileri tasiniyor, halka sayisina tavan yok.
     Olculdu (simulasyon): 0.12 sn'lik 6 gulme patlamasi, aralarinda 0.6 sn sessizlik ->
     eski davranis 6 ayri kesim ve patlamalarin hepsi KALIYOR; birlestirme acikken TEK
     kesim ve 5 patlamanin TAMAMI siliniyor. Kullanici bunu ancak videoyu izlerken fark eder.
     Yorumdaki '1137 -> 606 kesim' olcumu ise bu koddan CIKAMAZ (dal zaten oluydu), yani
     0.15 esigi kullanicinin gercek kaydinda HIC dogrulanmadi.
     KARAR: varsayilan 0 (kapali) — panel bugunku davranisini birebir korur. Deger
     `opts.mergeGap` ile acilabilir; acmadan once KULLANICININ GERCEK KAYDINDA olculmeli
     ve acCut onay metnine 'aralardaki kisa sesler de silinecek' satiri eklenmeli.
     ⚠ Bu sayiyi varsayilan olarak buyutmeden once yukaridaki olcumu tekrarla. */
  const MERGE_GAP = (opts.mergeGap != null) ? opts.mergeGap : 0;
  let merged = cuts, birlesen = 0;
  if (MERGE_GAP > 0 && cuts.length > 1) {
    merged = [cuts[0]];
    for (let q = 1; q < cuts.length; q++) {
      const son = merged[merged.length - 1];
      // Ham sınır yoksa (beklenmedik) birleştirme YAPMA — eski, kesin davranışta kal.
      const araHam = (cuts[q].hamBas != null && son.hamSon != null) ? (cuts[q].hamBas - son.hamSon) : Infinity;
      if (araHam <= MERGE_GAP) {
        son.end = cuts[q].end; son.dur = son.end - son.start;
        // hamSon da taşınmalı: sonraki karşılaştırma birleşmiş boşluğun GERÇEK bitişine bakmalı.
        son.hamSon = cuts[q].hamSon;
        birlesen++;
      }
      else merged.push(cuts[q]);
    }
  }
  let total = 0; for (let c = 0; c < merged.length; c++) total += merged[c].dur;
  if (onLog) onLog("[autocut] " + merged.length + " boşluk, " + total.toFixed(1) + " sn" +
    /* Sayı ham sayıdan farklıysa SEBEBİ yazılır: kullanıcı kesim sayısının neden düştüğünü
       görebilmeli (bu dal düzeltilmeden önce hiç çalışmıyordu, yani sayı artık değişiyor). */
    (birlesen ? (" (birleştirildi: " + birlesen + " yakın boşluk, " + cuts.length +
                 " -> " + merged.length + " kesim — kesim hızlanır)") : "") + ".\n");
  return { mean: mean, threshold: threshold, cuts: merged, count: merged.length, totalCut: total,
           merged: birlesen, rawCount: cuts.length };
}

module.exports = {
  loadConfig, ensureDir, buildTimelineAudio, transcribe, mixWavs, trimWav, trimAudioCopy,
  buildCues, sesleHizala, cakismaGider, kanallarArasiCakisma, cumleBirlestir, cuesToSrt, buildShortSrt, cleanPunct, flattenWords,
  analyzeSilence, cancelAll,
  fmtChapter, cuesToTxt, cuesToChapters, censorText, sozluk, filterHallucinations,
  // İptal damgası: uzun bir döngü (ör. kanal kanal üretim) adımlar arasında
  // "kullanıcı iptal etti mi?" diye sorabilsin diye dışa açıldı.
  iptalDamgasi, iptalEdildiMi,
};
