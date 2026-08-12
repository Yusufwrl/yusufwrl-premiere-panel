/*
 * Panel oto-güncelleme (GitHub Releases).
 * Panel her açılışta son sürümü kontrol eder; yeni sürüm varsa panel.zip'i indirir,
 * uzantı klasörüne açar ve kullanıcıdan Premiere'i yeniden başlatmasını ister.
 * SADECE panel kodunu (HTML/JS/JSX/CSS) günceller — motor (YusufwrlEngine) İNDİRİLMEZ.
 *
 * Repo/asset yapılandırması: uzantı kökündeki update.json
 *   { "repo": "kullanici/repo", "asset": "panel.zip" }
 * Yerel sürüm: uzantı kökündeki version.json  { "version": "1.1.0" }
 */
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

function stripBom(s) { return (s && s.charCodeAt(0) === 0xFEFF) ? s.slice(1) : s; }
function readJson(p, def) { try { return JSON.parse(stripBom(fs.readFileSync(p, "utf8"))); } catch (e) { return def; } }

/*
 * Kullaniciya/makineye ozel dosyalar — guncelleme bunlarin UZERINE YAZMAZ.
 *
 * BU BES DOSYA HER YERDE AYNI. Tekrarlandigi yerler:
 *   1) .gitignore
 *   2) installer\panel-files.ps1  ($PanelUserFiles)  <- pack-panel.ps1 ve deploy-dev.ps1
 *                                                       listeyi buradan okur, ayri liste tutmaz
 *   3) installer\installer.iss    (Excludes)
 *   4) installer\kur.ps1          ($koru)
 *   5) burasi                     (KULLANICI_DOSYALARI)
 * Yeni bir kullanici dosyasi eklerken BESINI birden guncelle.
 */
var KULLANICI_DOSYALARI = ["engine-root.txt", "diarize-device.txt", "sozluk.json",
                           "kisiler.json", "assemblyai-key.txt", "anthropic-key.txt",
                           "presetler.json", "presetler.bak.json",
                           /* lisans.json: bu makinenin lisansi. Guncelleme ezerse arkadas
                              sifreyi HER guncellemede yeniden girer — kullanici "bir kere
                              girmesi yetsin" dedi, o yuzden korunanlar arasinda. */
                           "lisans.json",
                           /* lisans.json.bak: kayitYaz artik atomik (.tmp -> rename) ve
                              eskisini .bak'a aliyor; ana dosya bozulursa kayitOku oradan
                              kurtariyor. Ezilirse "ariza kalici kilit uretmesin" korumasi
                              tam da guncelleme aninda kaybolurdu. */
                           "lisans.json.bak"];

/*
 * config.json listenin PARCASI DEGIL — yalnizca burada ve installer\kur.ps1'de korunur.
 * installer.iss Excludes'a SAKIN EKLEME: pakette geliyor ve TEMIZ kurulumda gerekiyor,
 * dislanirsa hic kopyalanmaz -> js\pipeline.js loadConfig() readFileSync'te patlar ve
 * panel hic acilmaz. Guncellemede uzerine yazilmiyor; asagida configBirlestir() ile
 * birlestiriliyor: kullanicinin degerleri (maxWordsPerCue, device, fontName...) kalir,
 * yeni surumde eklenen anahtarlar eklenir.
 */
var KORUNAN = KULLANICI_DOSYALARI.concat(["config.json"]);

// "v1.2.0" / "1.2" karşılaştırması → 1: a yeni, -1: b yeni, 0: eşit
function cmpVer(a, b) {
  var pa = String(a).replace(/^v/i, "").split("."), pb = String(b).replace(/^v/i, "").split(".");
  for (var i = 0; i < 3; i++) {
    var na = parseInt(pa[i] || "0", 10) || 0, nb = parseInt(pb[i] || "0", 10) || 0;
    if (na > nb) return 1; if (na < nb) return -1;
  }
  return 0;
}

function httpsGetJson(url, depth) {
  depth = depth || 0;
  return new Promise(function (resolve, reject) {
    if (depth > 6) return reject(new Error("çok fazla yönlendirme"));
    var req = https.get(url, { headers: { "User-Agent": "YusufwrlPanel", "Accept": "application/vnd.github+json" } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return httpsGetJson(res.headers.location, depth + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      var b = ""; res.on("data", function (d) { b += d; });
      res.on("end", function () { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.setTimeout(12000, function () { req.destroy(new Error("zaman aşımı")); });
  });
}

/* ⚠⚠ İNDİRME YENİDEN DENENİR — TEK SEFERLİK DEĞİL (ParsMazi, 12 Ağustos 2026:
   "Güncelleme başarısız: socket hang up").
   `socket hang up`, `ECONNRESET`, `ETIMEDOUT` GEÇİCİ ağ hatalarıdır: sunucu ya da aradaki
   CDN bağlantıyı kapatır, bir sonraki denemede sorunsuz iner. Panel paketi 22 MB ve
   GitHub'ın CDN'inden geliyor; tek bir kopmada bütün güncelleme iptal oluyordu ve kullanıcı
   eski sürümde kalıyordu — üstelik hiçbir şey bozulmadığı hâlde "hata" görüyordu.
   ⚠ YALNIZ AĞ HATALARI YENİDEN DENENİR. HTTP 404/403 gibi kalıcı cevaplar tekrar denenmez:
   dosya yoksa üç kez beklemek yalnızca kullanıcıyı oyalar.
   ⚠ Her deneme dosyayı SIFIRDAN indirir (yarım zip `hata()` içinde zaten siliniyor).
   22 MB için kısmi devam (Range) karmaşıklığı gereksiz. */
var INDIRME_DENEME = 3;
var _AG_HATASI = /socket hang up|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|zaman aşımı|ECONNREFUSED|EPIPE/i;

function download(url, dest, onLog) {
  var deneme = 0;
  function birKez() {
    deneme++;
    return _downloadBir(url, dest)["catch"](function (e) {
      var m = String((e && e.message) || e);
      if (deneme < INDIRME_DENEME && _AG_HATASI.test(m)) {
        if (onLog) onLog("İndirme koptu (" + m + ") — " + deneme + ". deneme başarısız, tekrar deneniyor…");
        /* Kısa bekleme: anlık ağ dalgalanması geçsin. Artan bekleme (1.5 sn, 4 sn). */
        return new Promise(function (r) { setTimeout(r, deneme === 1 ? 1500 : 4000); }).then(birKez);
      }
      /* ⚠⚠ NODE PES ETTİYSE İŞLETİM SİSTEMİNİN AĞ YIĞININI DENE — SON ÇARE.
         GERÇEK VAKA (ParsMazi, 12 Ağustos 2026): "socket hang up (3 deneme yapıldı)".
         Üç denemenin de aynı hatayla düşmesi, sorunun GEÇİCİ olmadığını gösteriyor: panelin
         Node'u CEP'in içindeki ESKİ sürüm ve GitHub'ın CDN'iyle (TLS/bağlantı yönetimi)
         anlaşamıyor. Aynı dosya aynı ağdan tarayıcıyla sorunsuz iniyor — yani sorun ağ
         değil, TAŞIMA KATMANI.
         Panel zaten unzip için Windows'un PowerShell'ini kullanıyor; indirmeyi de OS'a
         devretmek yeni bir bağımlılık getirmiyor. `curl.exe` Windows 10 1803'ten beri
         yerleşik; yoksa PowerShell'in Invoke-WebRequest'ine düşüyoruz.
         ⚠ Bu YALNIZCA ağ hatalarından sonra denenir: HTTP 404 gibi kalıcı cevaplarda
         ikinci bir yolu denemek yalnızca kullanıcıyı oyalar. */
      if (_AG_HATASI.test(m)) {
        if (onLog) onLog("Node ile indirilemedi (" + m + ") — Windows'un indiricisi deneniyor…");
        return _osIndir(url, dest, onLog)["catch"](function (e2) {
          /* ⚠⚠ İKİ FARKLI TAŞIMA DA DÜŞTÜYSE SUÇLU AĞ DEĞİL, SUNUCUDUR — ÖLÇÜLDÜ
             (12 Ağustos 2026). Panelin Node'u da, Windows'un curl'ü de aynı hatayı verdi
             ("Empty reply from server") ama KİMLİKLİ istek (gh) aynı anda sorunsuz indirdi.
             Sebep: GitHub, release varlıklarının ANONİM indirmesine API'den AYRI bir
             kötüye-kullanım sınırı uyguluyor ve o gün depoya çok sayıda sürüm çıkarılmıştı.
             Bu, kullanıcının ağıyla ilgili DEĞİL ve kendiliğinden geçer — mesaj bunu
             söylemezse kullanıcı boş yere modem/güvenlik duvarı kurcalar. */
          var m2 = String((e2 && e2.message) || e2);
          var sunucuRed = /Empty reply|52|socket hang up|ECONNRESET/i.test(m2) || _AG_HATASI.test(m2);
          throw new Error(sunucuRed
            ? ("GitHub şu an indirmeyi reddediyor (iki farklı yöntem de denendi). " +
               "Bu geçicidir ve senin internetinle ilgili değil — 15-30 dakika sonra paneli " +
               "kapatıp aç, kendiliğinden güncellenir.")
            : (m + " (" + deneme + " deneme + Windows indiricisi: " + m2 + ")"));
        });
      }
      /* Son deneme de düştüyse kaç kez denendiğini SÖYLE — "bir kez denedi ve pes etti"
         izlenimi kullanıcıyı ağ sorununu araştırmaktan alıkoyuyordu. */
      if (deneme > 1) e = new Error(m + " (" + deneme + " deneme yapıldı)");
      throw e;
    });
  }
  return birKez();
}

/* İŞLETİM SİSTEMİNİN İNDİRİCİSİ — Node'un https'i düştüğünde son çare.
   Önce `curl.exe` (Windows 10 1803+ yerleşik, -L yönlendirmeyi izler), o yoksa PowerShell.
   ⚠ Dosya boyutu SONRADAN doğrulanır: curl 0 baytlık bir dosya bırakıp 0 ile çıkabiliyor.
   ⚠ Yol tırnak içinde ve PowerShell tarafında ' ikiye katlanıyor — kullanıcı yollarında
   boşluk ve Türkçe karakter var (bu projenin bilinen tuzağı). */
function _osIndir(url, dest, onLog) {
  return new Promise(function (resolve, reject) {
    try { fs.unlinkSync(dest); } catch (_) {}
    function dogrula() {
      var n = 0;
      try { n = fs.statSync(dest).size; } catch (e) { return reject(new Error("dosya oluşmadı")); }
      if (n < 1024) return reject(new Error("indirilen paket çok küçük (" + n + " bayt)"));
      if (onLog) onLog("Windows indiricisi başardı: " + Math.round(n / 1048576) + " MB");
      resolve();
    }
    function psIle() {
      var ps = "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '" +
               String(url).replace(/'/g, "''") + "' -OutFile '" +
               String(dest).replace(/'/g, "''") + "' -UseBasicParsing";
      var p2 = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { windowsHide: true });
      p2.on("error", function (e) { reject(new Error("PowerShell çalıştırılamadı: " + (e.message || e))); });
      p2.on("close", function (k) {
        if (k !== 0) return reject(new Error("PowerShell indirme kodu " + k));
        dogrula();
      });
    }
    var c = spawn("curl.exe", ["-L", "--fail", "--silent", "--show-error",
                               "--retry", "2", "--connect-timeout", "20",
                               "-o", dest, url], { windowsHide: true });
    var curlHata = "";
    try { c.stderr.on("data", function (d) { curlHata += String(d); }); } catch (_) {}
    c.on("error", function () { psIle(); });          // curl yok → PowerShell
    c.on("close", function (kod) {
      if (kod === 0) return dogrula();
      if (onLog) onLog("curl başarısız (kod " + kod + (curlHata ? ": " + curlHata.trim().slice(0, 120) : "") + ") — PowerShell deneniyor…");
      psIle();
    });
  });
}

function _downloadBir(url, dest) {
  return new Promise(function (resolve, reject) {
    var file = fs.createWriteStream(dest);
    var bitti = false;                       // tek sonuc: hem hata hem basari icin
    function hata(e) {
      if (bitti) return; bitti = true;
      try { file.destroy(); } catch (_) {}
      try { fs.unlinkSync(dest); } catch (_) {}   // yarim zip diskte kalmasin
      reject(e);
    }
    function go(u, depth) {
      if (depth > 6) return hata(new Error("çok fazla yönlendirme"));
      var req = https.get(u, { headers: { "User-Agent": "YusufwrlPanel" } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); return go(res.headers.location, depth + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return hata(new Error("HTTP " + res.statusCode)); }
        // Sunucunun bildirdigi boyut: yarim inen zip'i "indi" sayip panelin uzerine acmayalim.
        var beklenen = parseInt(res.headers["content-length"] || "0", 10) || 0;
        res.on("error", hata);
        res.pipe(file);
        file.on("error", hata);
        file.on("finish", function () {
          file.close(function () {
            if (bitti) return;
            var inen = 0;
            try { inen = fs.statSync(dest).size; }
            catch (e) { return hata(new Error("indirilen dosya bulunamadı")); }
            if (beklenen && inen !== beklenen) {
              return hata(new Error("indirme yarım kaldı (" + inen + "/" + beklenen + " bayt)"));
            }
            if (inen < 1024) return hata(new Error("indirilen paket çok küçük (" + inen + " bayt)"));
            bitti = true; resolve();
          });
        });
      });
      req.on("error", hata);
      req.setTimeout(60000, function () { req.destroy(new Error("indirme zaman aşımı")); });
    }
    go(url, 0);
  });
}

// Windows'ta yerleşik PowerShell Expand-Archive — ek bağımlılık yok.
function unzip(zipPath, destDir) {
  return new Promise(function (resolve, reject) {
    var ps = "Expand-Archive -LiteralPath '" + zipPath.replace(/'/g, "''") +
             "' -DestinationPath '" + destDir.replace(/'/g, "''") + "' -Force";
    var p = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { windowsHide: true });
    var err = "";
    p.stderr.on("data", function (d) { err += d; });
    p.on("error", reject);
    p.on("close", function (code) { code === 0 ? resolve() : reject(new Error("Expand-Archive: " + (err || code))); });
  });
}

/* skip listesi YALNIZ PANEL KÖKÜNDE geçerli (derinlik 0).
   TUZAK: eskiden ad her derinlikte eşleşiyordu. Kullanıcı dosyalarının hepsi zaten panel
   kökünde, ama pakete giren varsayilan\ klasöründeki hazır dosya aynı adı taşıyınca
   sessizce kopyalanmıyordu — panel güncelleniyor, hazır içerik gelmiyordu.
   Aynı tuzak .gitignore ve pack-panel.ps1'de de vardı; üçü de köke sabitlendi. */
function copyDir(src, dst, skip, derinlik) {
  skip = skip || [];
  derinlik = derinlik || 0;
  var entries = fs.readdirSync(src, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (derinlik === 0 && skip.indexOf(e.name) !== -1) continue;
    var s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); copyDir(s, d, skip, derinlik + 1); }
    else { fs.copyFileSync(s, d); }
  }
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { try { fs.unlinkSync(p); } catch (_) {} } }

/*
 * Acilan zip'in icinde GERCEK panel kokunu bul ve dogrula.
 * Neden: release'e yanlislikla "klasoruyle birlikte" sikistirilmis bir zip yuklenirse
 * (icinde tek bir panel\ klasoru) eski kod hicbir dosyayi degistirmeden version.json'a
 * yeni surumu yaziyordu — panel kodu eski kalip bir daha ASLA guncelleme almiyordu.
 * Simdi: tek sarmalayici klasor varsa icine ininiyor, beklenen yapi yoksa hata veriliyor.
 */
function paketKoku(stage) {
  function uygunMu(d) {
    return fs.existsSync(path.join(d, "index.html")) &&
           fs.existsSync(path.join(d, "CSXS", "manifest.xml"));
  }
  if (uygunMu(stage)) return stage;
  var alt = fs.readdirSync(stage, { withFileTypes: true }).filter(function (e) { return e.isDirectory(); });
  if (alt.length === 1) {
    var ic = path.join(stage, alt[0].name);
    if (uygunMu(ic)) return ic;
  }
  throw new Error("indirilen paket panel yapısında değil (index.html + CSXS\\manifest.xml yok)");
}

/*
 * config.json'i EZMEDEN guncelle: kullanicinin degerleri kalir, paketteki YENI anahtarlar eklenir.
 * (Eskiden dosya duz kopyalaniyordu; kullanicinin maxWordsPerCue / device ayarlari her
 * guncellemede geri aliniyordu ve sebebi kullanici icin gorunmezdi.)
 * Doner: eklenen yeni anahtar sayisi.
 */
/* paketAd (istege bagli): paket tarafindaki dosyanin ADI. Varsayilan "config.json" —
   oto-guncelleme yolu boyle cagiriyor. Kurulum exe'si ayni dosyayi "config.pkg.json" adiyla
   da kuruyor ve panel acilista onu bu fonksiyona veriyor (bkz. app.js configPaketTazele). */
function configBirlestir(paketKok, extRoot, paketAd) {
  var yeniYol = path.join(paketKok, paketAd || "config.json");
  if (!fs.existsSync(yeniYol)) return 0;
  /* Paket dosyasi hedefin KENDISI ise (ayni klasor, ayni ad) yapacak bir sey yok. */
  if (path.resolve(yeniYol) === path.resolve(path.join(extRoot, "config.json"))) return 0;
  var hedef = path.join(extRoot, "config.json");
  var yeni = readJson(yeniYol, null);
  if (!yeni) return 0;                                   // pakette bozuk -> kullanicininkine dokunma
  var eski = readJson(hedef, null);
  if (!eski) { fs.copyFileSync(yeniYol, hedef); return 0; } // kullanicida yok/bozuk -> paketteki gecerli
  var eklenen = 0;
  for (var k in yeni) {
    if (Object.prototype.hasOwnProperty.call(yeni, k) &&
        !Object.prototype.hasOwnProperty.call(eski, k)) { eski[k] = yeni[k]; eklenen++; }
  }
  /* Bunlar KULLANICI AYARI DEGIL, panelin kendi program yollari: motor klasorunun ic
     duzeni. Hepsi %ENGINE% token'i ile yazilir (makineye ozel yol icermez; o bilgi
     engine-root.txt'te). Kullanicinin degeri dondurulursa, ileride motor duzeni
     degistiginde (exe adi/konumu degisir, styles klasoru tasinir) yeni surum bu
     degisikligi MEVCUT kullanicilara ASLA ulastiramaz: panel "motor bulunamadi" der ve
     tek cozum kullanicinin config.json'i elle duzenlemesi olur. O yuzden paketten zorlanir. */
  var PAKETTEN = ["engineExe", "ffmpegExe", "workDir", "stylesDir"];
  var degisti = (eklenen > 0), zorlanan = [];
  for (var j = 0; j < PAKETTEN.length; j++) {
    var pk = PAKETTEN[j];
    if (Object.prototype.hasOwnProperty.call(yeni, pk) && eski[pk] !== yeni[pk]) {
      eski[pk] = yeni[pk]; degisti = true; zorlanan.push(pk);
    }
  }
  if (degisti) fs.writeFileSync(hedef, JSON.stringify(eski, null, 2), "utf8");
  /* ⚠ PROGRAM YOLU ZORLAMASI IZ BIRAKIR. Fonksiyon yalnizca "eklenen anahtar" sayisini
     donduruyordu; motor yolu degistiginde (asil is bu) donus 0 kaliyor ve cagiran taraf
     hicbir sey yazmiyordu. "Motor bulunamadi" hatasi arastirilirken yolun NE ZAMAN ve NEYE
     gore degistigi hicbir kayitta gorunmuyordu. Sayac ayri bir alanda: donus tipi degismesin
     (iki cagiran da sayi bekliyor). */
  configBirlestir.sonZorlanan = zorlanan;
  return eklenen;
}

// repo değeri gerçek mi (placeholder değil mi)?
function isConfigured(repo) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "") && !/kullanici|repo-adi/i.test(repo);
}

/*
 * ui = {
 *   log(msg),                       // sessiz bilgi (log paneli)
 *   setStatus(text),                // kısa durum
 *   confirm(msg, title)->Promise,   // kullanıcı onayı
 *   alert(msg, title)->Promise
 * }
 */
async function checkForUpdate(extRoot, ui) {
  ui = ui || {};
  var log = ui.log || function () {};
  var conf = readJson(path.join(extRoot, "update.json"), null);
  if (!conf || !isConfigured(conf.repo)) { log("Oto-güncelleme yapılandırılmadı (update.json)."); return; }

  var local = (readJson(path.join(extRoot, "version.json"), { version: "0.0.0" }) || {}).version || "0.0.0";

  var rel;
  try { rel = await httpsGetJson("https://api.github.com/repos/" + conf.repo + "/releases/latest"); }
  catch (e) { log("Güncelleme kontrolü atlandı: " + e.message); return; }

  var remote = rel && (rel.tag_name || rel.name) || "0.0.0";
  if (cmpVer(remote, local) <= 0) { log("Panel güncel (v" + local + ")."); return; }

  var assetName = conf.asset || "panel.zip";
  var asset = (rel.assets || []).filter(function (a) { return a.name === assetName; })[0];
  if (!asset) { log("Yeni sürüm v" + remote + " var ama " + assetName + " eklentisi bulunamadı."); return; }

  var ok = ui.confirm ? await ui.confirm(
    "Yeni panel sürümü: v" + String(remote).replace(/^v/i, "") + " (şu an v" + local + ").\n\n" +
    "Şimdi güncellensin mi? Sadece panel indirilir (motor değişmez). İşlem sonunda Premiere'i yeniden başlatman gerekir.",
    "Güncelleme var") : true;
  if (!ok) return;

  var clean = String(remote).replace(/^v/i, "");
  var tmp = path.join(os.tmpdir(), "yusufwrl_update_" + clean + ".zip");
  var stage = path.join(os.tmpdir(), "yusufwrl_stage_" + clean);
  // Yedek TEMP'e alinir; extensions klasorunun icine/yanina KONMAZ — CEP orayi tarayip
  // ayni BundleId'li ikinci bir uzanti gormemeli.
  var yedek = path.join(os.tmpdir(), "yusufwrl_yedek_" + local + "_" + Date.now());
  var yedekAlindi = false, basarili = false;
  try {
    if (ui.setStatus) ui.setStatus("Güncelleme indiriliyor v" + clean + "…");
    log("İndiriliyor: " + asset.browser_download_url);
    /* Yeniden deneme bilgisi hem log'a hem DURUM SATIRINA gitsin: 22 MB'lık indirme
       koptuğunda kullanıcı panelin donduğunu değil, tekrar denediğini görmeli. */
    await download(asset.browser_download_url, tmp, function (m) {
      log(m);
      if (ui.setStatus) ui.setStatus("Güncelleme indiriliyor v" + clean + " — bağlantı koptu, tekrar deneniyor…");
    });
    rmrf(stage); fs.mkdirSync(stage, { recursive: true });
    await unzip(tmp, stage);
    var kok = paketKoku(stage);                       // paket gercekten panel mi?

    // Kopyalama ortasinda hata olursa (OneDrive/antivirus kilidi, disk dolu) panel yari
    // yeni yari eski kalmasin: once mevcut kurulumun tam yedegini al.
    fs.mkdirSync(yedek, { recursive: true });
    copyDir(extRoot, yedek, []);
    yedekAlindi = true;

    try {
      copyDir(kok, extRoot, KORUNAN);                 // kullanici dosyalarina dokunma
      /* Eski surumlerden kalan .debug'i kaldir. Yeni paketlerde .debug YOK ama copyDir
         yalnizca EKLIYOR, hicbir seyi silmiyor — yani daha once kurulmus her panelde dosya
         oldugu yerde kaliyor ve son kullanicida gereksiz DevTools portunu (localhost:8088)
         acik tutuyor. Gelistirici makinesinde zararsiz: deploy-dev.ps1 her deploy'da geri koyar. */
      try { fs.unlinkSync(path.join(extRoot, ".debug")); } catch (_) {}
      var yeniAnahtar = configBirlestir(kok, extRoot);
      if (yeniAnahtar) log("config.json: " + yeniAnahtar + " yeni ayar eklendi (seninkiler korundu).");
      // Program yolu degistiyse SOYLE — "motor bulunamadi" arastirilirken tek iz bu.
      var _zorlanan = configBirlestir.sonZorlanan || [];
      if (_zorlanan.length) log("config.json: program yolu tazelendi -> " + _zorlanan.join(", "));
      /* ⚠ EXE'DEN KALAN config.pkg.json'u SIL — IKINCI EMNIYET.
         O dosyayi yalniz kurulum exe'si koyuyor ve panel acilista uygulayip siliyor. Ama
         silme basarisiz olduysa (dosya kilitli) diskte kalir; zip guncellemesi program
         yollarini burada dogru tazeler, panel bir sonraki acilista BAYAT dosyadan eski
         degerlere geri cekerdi. copyDir hicbir seyi silmedigi icin bu temizlik burada
         yapilmak zorunda. */
      try { fs.unlinkSync(path.join(extRoot, "config.pkg.json")); } catch (_cp) {}
      fs.writeFileSync(path.join(extRoot, "version.json"), JSON.stringify({ version: clean }, null, 2));
    } catch (eKopya) {
      // Geri al: yedekteki eski dosyalari uzerine yaz. version.json henuz yazilmadigi icin
      // panel eski surumde kalir ve guncelleme teklifi bir sonraki acilista tekrar cikar.
      try { copyDir(yedek, extRoot, []); log("Kopyalama hatası — panel eski hâline geri alındı."); }
      catch (eGeri) { log("Geri alma da başarısız: " + eGeri.message + " — yedek: " + yedek); }
      throw eKopya;
    }

    basarili = true;
    if (ui.setStatus) ui.setStatus("");
    if (ui.alert) await ui.alert("Panel v" + clean + " kuruldu.\nPremiere'i kapatıp yeniden aç.", "Güncelleme tamam");
    else log("Güncelleme tamam (v" + clean + "). Premiere'i yeniden başlat.");
  } catch (e) {
    if (ui.setStatus) ui.setStatus("");
    log("Güncelleme başarısız: " + e.message);
    if (ui.alert) ui.alert("Güncelleme başarısız: " + e.message +
      "\nPanel eski sürümde (v" + local + ") kaldı, bir şey bozulmadı.\n(Paneli kapatıp tekrar dene.)", "Hata");
  } finally {
    rmrf(tmp); rmrf(stage);
    // Yedegi yalnizca is yolunda gittiyse sil; hata durumunda elle kurtarilabilsin diye dursun.
    if (basarili) rmrf(yedek);
    else if (yedekAlindi) log("Panelin güncelleme öncesi yedeği: " + yedek);
  }
}

/* configBirlestir DISA ACIK: app.js acilista "config.pkg.json" ile cagiriyor (exe kurulumu
   o adla da kuruyor). Yoksa program yollari YALNIZ oto-guncelleme yolunda tazeleniyordu ve
   exe ile kurulan/guncellenen kullanici motor duzeni degisikligini HIC almiyordu. */
module.exports = { checkForUpdate: checkForUpdate, cmpVer: cmpVer, configBirlestir: configBirlestir };
