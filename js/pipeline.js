/*
 * Node.js işlem hattı (CEP nodejs açık olmalı).
 * ffmpeg ile ses hazırlar, Whisper ile yazıya döker (opsiyonel konuşmacı ayırma),
 * 2-3 kelimelik cue nesneleri üretir (renk/konuşmacı bilgisi taşır).
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
    proc.stdout.on("data", function (d) { buf += d; });
    proc.stderr.on("data", function (d) { buf += d; });
    proc.on("error", function () { resolve(1); });
    proc.on("close", function () {
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
      const chunk = valid.slice(start, start + chunkN);
      const partWav = path.join(dir, base + "__part" + ci + ".wav");
      await _renderTimelineChunk(chunk, ffmpegExe, partWav, sIdx);
      parts.push(partWav);
      if (onLog) onLog("[ffmpeg] parça " + (ci + 1) + "/" + Math.ceil(valid.length / chunkN) + " (" + chunk.length + " klip)\n");
    }
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

// Whisper JSON -> düz kelime listesi
function flattenWords(data) {
  var words = [];
  (data.segments || []).forEach(function (seg) {
    (seg.words || []).forEach(function (w) {
      var t = String(w.word).replace(/\s+/g, " ").trim();
      var st = Number(w.start), en = Number(w.end);
      /* Motor gerçek çıktıda start == end olan (SIFIR süreli) kelimeler üretebiliyor — ölçüldü,
         binde 3-5 kelime. Bunlar cue'ların aynı saniyede başlamasına yol açıyor; buildCues bunu
         ayrıca toparlıyor, burada sadece süreyi pozitife çekip zaman sırasını bozulmaz kılıyoruz. */
      if (en <= st) en = st + 0.001;
      // geçersiz/eksik zaman damgalı kelimeyi ele (null/undefined/NaN → bozuk SRT önlenir)
      if (t && w.start != null && w.end != null && isFinite(st) && isFinite(en)) words.push({ start: st, end: en, word: t, speaker: null });
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

// Kelimeleri 2-3 kelimelik cue nesnelerine böl {start,end,text,speaker}. censor=true ise küfür maskelenir.
function buildCues(words, maxWords, censor) {   // censor: false | true (hepsi) | "hard" (sadece agir)
  var GAP = 0.7; maxWords = maxWords || 3;
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
    } else merged.push({ start: wr.start, end: wr.end, word: wr.word, speaker: wr.speaker });
  }
  /* Grupla (konuşmacı değişince de böl).
     KARAKTER SINIRI ŞART: yukarıdaki birleştirmeler (soru eki, dolgu, apostroflu ek) metni
     pv.word'ün İÇİNE yazıyor, yani burada tek kelime sayılıyorlar. Sadece kelime sayısına
     bakılırsa "gördün müydünüz" gibi birleşikler yüzünden cue MOGRT'ye sığmayacak kadar
     uzayabiliyor. MAX_CHARS aynı zamanda yetim birleştirmede de kullanılıyor. */
  var MAX_CHARS = 38;
  var groups = [], cur = [];
  function flush() { if (cur.length) { groups.push(cur); cur = []; } }
  for (var i = 0; i < merged.length; i++) {
    var w = merged[i];
    if (cur.length) {
      var prev = cur[cur.length - 1];
      if (w.start - prev.end > GAP) flush();
      else if (w.speaker && prev.speaker && w.speaker !== prev.speaker) flush();
    }
    cur.push(w);
    // "2." gibi SIRA SAYILARI cümle sonu değildir ("2. bölüm", "1. sıra") — rakam+nokta bölmez.
    var hard = /[!?…:]$/.test(w.word) || (/\.$/.test(w.word) && !/\d\.$/.test(w.word));
    var soft = /,$/.test(w.word);
    var harf = 0; for (var hq = 0; hq < cur.length; hq++) harf += cur[hq].word.length + (hq ? 1 : 0);
    if (cur.length >= maxWords || harf >= MAX_CHARS || hard || (soft && cur.length >= 2)) flush();
  }
  flush();
  /* Yetim tek-kelimelik cue'ları öncekine bağla.
     ESKİ KOŞUL "önceki grup maxWords'ten az" idi; gerçek veride yetimlerin %88'inde önceki grup
     zaten doluydu, yani kural neredeyse hiç çalışmıyordu (728 cue'nun 109'u tek kelime, çoğu
     0.1-0.3 sn ekranda yanıp sönüyordu). Yeni ölçüt kelime SAYISI değil METNİN HARF SAYISI:
     MOGRT'ye sığdığı sürece birleşsin. Cümle sonu koruması ŞART — nokta cleanPunct'ta silindiği
     için iki ayrı cümle tek satıra kaynarsa ekranda anlamsız görünür. */
  function _grupMetin(g) { var t = ""; for (var q = 0; q < g.length; q++) t += (q ? " " : "") + g[q].word; return t; }
  for (var c = groups.length - 1; c > 0; c--) {
    if (groups[c].length !== 1) continue;
    var a = groups[c][0], onceki = groups[c - 1], bg = onceki[onceki.length - 1];
    var sameSp = (!a.speaker || !bg.speaker || a.speaker === bg.speaker);
    if (!sameSp || (a.start - bg.end) > GAP) continue;
    if (/[.!?…:]$/.test(bg.word)) continue;                                    // önceki cümleyi bitirmiş
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
    cues.push({ start: start, end: end, text: text, speaker: g[0].speaker || null });
  }
  /* NEREDEYSE AYNI ANDA BAŞLAYAN CUE'LARI TOPARLA — bunu süre döngüsünden ÖNCE yapmak şart.
     Whisper gerçek çıktıda start == end olan (sıfır süreli) kelime damgaları üretiyor; bunlardan
     doğan cue bir sonrakiyle aynı saniyede başlıyor. Aşağıdaki süre döngüsünde tavan
     (sonraki cue - 0.08) cue'nun KENDİ başlangıcının altına düşüyor ve cue 0.05 sn'de kalıyor.
     host.jsx cue'ları sırayla overwriteClip ile bastığı için aynı saniyeye gelen ikinci klip
     birincinin üstüne yazıyor: o altyazı videoda HİÇ görünmüyor, panel yine de "eklendi" diyor.
     Çözüm: sığıyorsa iki cue'yu birleştir, sığmıyorsa öncekinden zaman ödünç alarak geriye kaydır. */
  var MIN_GORUNUR = 0.25;   // bir altyazının ekranda fark edilmesi için gereken en kısa süre
  for (var z = 0; z + 1 < cues.length; z++) {
    var cA = cues[z], cB = cues[z + 1];
    if (cB.start - cA.start >= MIN_GORUNUR) continue;
    var ayniKisi = (!cA.speaker || !cB.speaker || cA.speaker === cB.speaker);
    if (ayniKisi && (cA.text.length + 1 + cB.text.length) <= MAX_CHARS) {
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
  // Metni komşuya taşırken konuşmacı KARIŞMAMALI — üstteki toparlama döngüsündeki
  // `ayniKisi` kuralının aynısı (yoksa S1'in kelimesi S3'ün rengine yazılıyor).
  function _ayniKisi(a, b) { return (!a.speaker || !b.speaker || a.speaker === b.speaker); }
  /* SON EMNİYET — yukarıdaki toparlamaya rağmen 0.15 sn'nin (≈4 kare) altında kalan bir cue
     Premiere'de pratikte görünmez ve bir sonraki klip onu ezer, yani METİN KAYBOLUR. Böyle bir
     satırın metnini sığdığı komşuya taşıyıp cue'yu listeden düşürüyoruz: hiçbir kelime kaybolmaz.
     Hiçbir komşuya sığmıyorsa dokunmuyoruz (eski davranış) — kelimeyi silmek daha kötü olurdu. */
  for (var y = cues.length - 1; y >= 0; y--) {
    if (cues[y].end - cues[y].start >= 0.15) continue;
    var sn = (y + 1 < cues.length) ? cues[y + 1] : null;      // sonraki (zaman olarak en yakın)
    var on = (y > 0) ? cues[y - 1] : null;                    // önceki
    if (sn && _ayniKisi(cues[y], sn) && (cues[y].text.length + 1 + sn.text.length) <= MAX_CHARS) {
      sn.text = cues[y].text + " " + sn.text;
      sn.start = Math.min(sn.start, cues[y].start);
      cues.splice(y, 1);
    } else if (on && _ayniKisi(on, cues[y]) && (on.text.length + 1 + cues[y].text.length) <= MAX_CHARS) {
      on.text = on.text + " " + cues[y].text;
      // uzatırken sonraki cue'nun üstüne binme (0.05 tabanı bazen tavanı aşabiliyor)
      on.end = Math.max(on.end, Math.min(cues[y].end, sn ? (sn.start - MIN_GAP) : Infinity));
      cues.splice(y, 1);
    }
  }
  return cues;
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
      try { await run(cfg.engineExe, argsNoHot, onLog, runOpts); } catch (e2) {}
      if (iptalEdildiMi(damga)) throw new Error("İptal edildi");
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
  const cues = buildCues(words, opts.maxWords || cfg.maxWordsPerCue || 3, opts.censor);
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
      const s = curStart + tailOut, e = parseFloat(m[2]) - leadIn;
      if (e - s >= minCut) cuts.push({ start: s, end: e, dur: e - s });
      curStart = null;
    }
  }
  /* ARDIŞIK BOŞLUKLARI BİRLEŞTİR — kesim SAYISI, kesim süresinden çok daha pahalı.
     İki boşluk arasında MERGE_GAP'ten kısa bir konuşma parçası kalıyorsa ikisi tek kesim yapılır.
     Ölçüm (gerçek 42 dakikalık kayıt): 1137 kesim -> 606 kesim, kazanılan süre 655.5 -> 649.9 sn,
     yani kesim sayısı yarıya inerken kazanç sadece %0.8 azalıyor.
     Ayrıca KALİTE de artıyor: 0.15 sn'lik konuşma kırıntıları zaten makineli tüfek gibi
     jump-cut üretiyordu. Değer muhafazakâr tutuldu — anlamlı bir kelime 0.15 sn'ye sığmaz. */
  const MERGE_GAP = (opts.mergeGap != null) ? opts.mergeGap : 0.15;
  let merged = cuts, birlesen = 0;
  if (MERGE_GAP > 0 && cuts.length > 1) {
    merged = [cuts[0]];
    for (let q = 1; q < cuts.length; q++) {
      const son = merged[merged.length - 1];
      if (cuts[q].start - son.end <= MERGE_GAP) { son.end = cuts[q].end; son.dur = son.end - son.start; birlesen++; }
      else merged.push(cuts[q]);
    }
  }
  let total = 0; for (let c = 0; c < merged.length; c++) total += merged[c].dur;
  if (onLog) onLog("[autocut] " + merged.length + " boşluk, " + total.toFixed(1) + " sn" +
    (birlesen ? (" (" + birlesen + " yakın boşluk birleştirildi — kesim hızlanır)") : "") + ".\n");
  return { mean: mean, threshold: threshold, cuts: merged, count: merged.length, totalCut: total,
           merged: birlesen, rawCount: cuts.length };
}

module.exports = {
  loadConfig, ensureDir, buildTimelineAudio, transcribe, mixWavs, trimWav, trimAudioCopy,
  buildCues, cuesToSrt, buildShortSrt, cleanPunct, flattenWords, analyzeSilence, cancelAll,
  fmtChapter, cuesToTxt, cuesToChapters, censorText, sozluk, filterHallucinations,
  // İptal damgası: uzun bir döngü (ör. kanal kanal üretim) adımlar arasında
  // "kullanıcı iptal etti mi?" diye sorabilsin diye dışa açıldı.
  iptalDamgasi, iptalEdildiMi,
};
