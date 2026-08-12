/*
 * LISANS — kod + bilgisayar kilidi.
 *
 * TEMEL KURAL, HER SEYDEN ONCE: TEKNIK ARIZA KULLANICIYI ASLA KILITLEMEZ.
 * Internet yok · sunucu olu · registry okunamadi · crypto yuklenemedi — hepsi panelin
 * ACILMASIYLA biter. Kilit YALNIZ su seylerden gelir:
 *   1) yerel kayit yok (hic aktivasyon yapilmamis)
 *   2) yerel kayit BASKA bir bilgisayara ait
 *   3) sunucu KESIN bir iptal bildirdi (yoneticinin kasitli karari)
 *
 * ⚠ "DOSYA BOZUK" DA KILITTIR — YANLIS HATIRLAMA. Bu satir eskiden "dosya bozuk -> ACILIR"
 * diyordu ve OLCUM bunun tersini gosterdi: bozuk lisans.json kayitOku'dan null donuyor,
 * durumOku "kayityok" ile KILITLIYOR. Politika bilerek boyle — "bozuksa ac" demek, dosyaya
 * rastgele bir karakter yazmayi tek adimlik kalici bir bypass'a cevirirdi. Ariza kalici kilit
 * uretmesin diye yapilan sey POLITIKAYI gevsetmek DEGIL, bozulmayi ONLEMEK: kayitYaz atomik
 * (.tmp -> rename) ve her yazmada .bak'a ayna birakiyor; kayitOku ana dosya bozuksa yedekten
 * kurtarip geri yaziyor. Bu notu "duzeltip" bozuk-dosya dalini acma — bypass acmis olursun.
 * Gerekce: bu bir montaj araci. Arkadas videonun ortasindayken "lisans sunucusuna
 * ulasilamadi" diye panelin kapanmasi, korumanin sagladigi her seyden pahali.
 *
 * DURUSTLUK NOTU (yoruma guvenip yanlis is yapmamak icin): bu bir DRM DEGIL.
 * Panel acik kaynak JavaScript; kontrolu silmek ya da lisans.json'daki hwid alanini elle
 * degistirmek kilidi tamamen asar. Amac kotu niyetli birini durdurmak degil, dosyayi
 * oradan oraya kopyalamanin kendiliginden calismamasi ve kimin kullandiginin bilinmesi.
 *
 * HWID = MachineGuid (HKLM\SOFTWARE\Microsoft\Cryptography), tuzlanip SHA-256'lanir.
 * TEK KAYNAK, bilerek. Olculdu (kullanicinin Windows 11 makinesi):
 *   · MachineGuid  : 25 ms · donanim degisse de AYNI kalir (yalniz Windows yeniden
 *                    kurulunca degisir) · reg query ile okunuyor          <- SECILEN
 *   · anakart UUID : 295 ms, PowerShell sart (12 kat yavas)
 *   · BIOS serisi  : "System Serial Number" duz metni geliyor — COP. Kimlik sayilsaydi
 *                    ayni model anakarti kullanan HERKES ayni HWID'e duserdi.
 *   · wmic         : Windows 11'de KALDIRILMIS, komut yok.
 * Birden cok kaynagi birlestirip hash'lemek REDDEDILDI: kaynaklardan biri degisince
 * (disk takasi, VPN'in taktigi sanal ag karti yuzunden MAC) karma komple degisir ve
 * arkadas panelden atilir. Risk asimetrik — yanlis kilitlemenin bedeli cok daha buyuk.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var https = require("https");
var cp = require("child_process");
var crypto = null;
try { crypto = require("crypto"); } catch (e) { crypto = null; }

/* Worker adresi. Deploy edilince `npx wrangler deploy` ciktisindaki adres BURAYA yazilir
   (yalniz host: https:// ve sondaki / OLMADAN). Bos birakilirsa panel sunucusuz calisir:
   yerel kayit varsa acilir, yoksa kod dogrulanamaz. */
var SUNUCU_HOST = "lisans.yusufwrl.workers.dev";
var YOL_AKTIVASYON = "/aktivasyon";
var YOL_PING = "/ping";
var ZAMAN_ASIMI = 8000;         // ms — panel acilisi bundan uzun beklemez

/* Tuz: HWID karmasini ham MachineGuid'den ayirir. Gizli DEGIL (dosyada duz metin) —
   isi yalniz kaydin baska bir uygulamanin kimligiyle karismasini onlemek. */
var TUZ = "yusufwrl-panel-2026";

var _hwidCache = null;

// ---------------------------------------------------------------- yardimcilar
function _sha256(s) {
  if (!crypto) return "";
  try { return crypto.createHash("sha256").update(String(s), "utf8").digest("hex"); }
  catch (e) { return ""; }
}

/* Komutu senkron calistirir. execFileSync yoksa (cok eski Node) bos doner ve cagiran
   taraf "HWID okunamadi" dalina duser — o dal paneli ACIYOR, kilitlemiyor. */
function _calistir(komut, argv) {
  try {
    var r = cp.execFileSync(komut, argv, { encoding: "utf8", timeout: 5000,
                                           windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    return String(r || "");
  } catch (e) { return ""; }
}

/* ⚠ /reg:64 SART — OLCULDU. MachineGuid 32-bit registry gorunumunde YOK:
     reg query …\Cryptography /v MachineGuid /reg:32          -> "unable to find"
     reg query HKLM\SOFTWARE\WOW6432Node\… /v MachineGuid     -> "unable to find"
     reg query …\Cryptography /v MachineGuid /reg:64          -> CALISIYOR
   CEP'in Node'u 32-bit ise bayraksiz okuma sessizce bos doner. Bayragin bedeli sifir. */
function _machineGuid() {
  var argv = ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid", "/reg:64"];
  var out = _calistir("reg", argv);
  /* TAM YOL YEDEGI — PATH'e guvenme. Olculdu: ayni komut PowerShell'den calisirken Git
     Bash ortamindan BOS dondu (PATH'te reg yok). CEP paneli Premiere'in ortamini miras
     aliyor ve orada PATH'in ne oldugunu bilmiyoruz; bos donmesinin bedeli "HWID okunamadi"
     dalina dusmek, yani kilit calismamasi. Iki satirlik yedek bu belirsizligi kapatiyor. */
  if (!out) {
    var kok = "";
    try { kok = String(process.env.SystemRoot || process.env.windir || "C:\\Windows"); } catch (e) { kok = "C:\\Windows"; }
    out = _calistir(path.join(kok, "System32", "reg.exe"), argv);
  }
  var m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F\-]{10,})/);
  return m ? m[1].toLowerCase() : "";
}

/* Bilgisayar kimligi. Bos string = okunamadi (cagiran taraf paneli ACAR).
   Onbellek: soguk ilk `reg` cagrisi 210 ms (surec yaratma isinmasi), sonrakiler 30 ms.
   BOS SONUC ONBELLEGE ALINMAZ — gecici bir okuma hatasi kalicilasmasin. */
function hwid() {
  if (_hwidCache) return _hwidCache;
  var ham = _machineGuid();
  if (!ham) return "";
  var karma = _sha256(TUZ + "|" + ham);
  _hwidCache = karma || ("ham:" + ham);   // crypto yoksa ham deger: kilit yine calisir
  return _hwidCache;
}

function _lisansYolu(extRoot) { return path.join(extRoot, "lisans.json"); }

function _kayitOku1(yol) {
  var s = fs.readFileSync(yol, "utf8");
  if (s && s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  var j = JSON.parse(s);
  return (j && typeof j === "object") ? j : null;
}

/* ⚠ YEDEKTEN KURTARMA — "ARIZA ASLA KILITLEMEZ" KURALININ GERCEKTEN TUTMASI ICIN SART.
   Eskiden okuma tek denemeydi ve yazma atomik DEGILDI (dogrudan writeFileSync). ping()
   iptal yazarken ya da aktivasyon sirasinda surec olur/disk dolarsa YARIM dosya kaliyor;
   sonraki acilista JSON.parse patliyor, kayitOku null donuyor ve durumOku bunu "kayityok"
   = KILIT sayiyordu. Kullanicinin elinde kod yoksa (arkadas "bir kere girilecek" diye
   saklamamis) panel bir daha HIC acilmiyordu — teknik ariza kalici kilide donusuyordu.
   Cozum kilit POLITIKASINA dokunmuyor (bozuk dosya hala kilit sayilir; "bozuksa ac" demek
   tek adimlik bir bypass acardi): yedek dosya sayesinde bozulma zaten olusmuyor.
   presetler.json'daki .bak deseninin aynisi. */
function kayitOku(extRoot) {
  var yol = _lisansYolu(extRoot);
  try { var j = _kayitOku1(yol); if (j && j.hwid) return j; } catch (e) {}
  try {
    var b = _kayitOku1(yol + ".bak");
    if (b && b.hwid) {
      // Kurtarilan kayit ana dosyaya geri yazilir; yoksa her acilista yedekten okunur.
      try { fs.writeFileSync(yol, JSON.stringify(b, null, 2), "utf8"); } catch (e2) {}
      return b;
    }
  } catch (e3) {}
  return null;
}

/* ATOMIK: .tmp yaz -> .tmp'yi yerine koy -> YENI kaydi .bak'a aynala.
   Yarida kesilirse ana dosya ya eski hali ya yeni hali olur, ASLA yarim olmaz.

   ⚠ .bak "ONCEKI kaydi" DEGIL "YAZILAN KAYDI" tutar — ve rename BASARILI olduktan SONRA
   yazilir. Iki ayri hata bunu zorunlu kildi (ikisi de olculdu):
     1. SIRA: .bak once yaziliyordu. renameSync salt-okunur/kilitli hedefte EPERM atinca ana
        dosyaya yeni kayit gitmiyor AMA .bak zaten ezilmis oluyordu. Yani basarisiz bir yazma,
        yedekte kalicilastirilmis IPTALI diskten siliyordu: `attrib +R lisans.json` + ana
        dosyayi silmek, iptali her iki dosyadan da yok ediyordu.
     2. ICERIK: .bak'a yalnizca "iptal===true" ise yeni kayit yaziliyordu. Yonetici lisansi
        tekrar acip kullanici yeniden aktive ettiginde ana dosya temizleniyor ama .bak
        SONSUZA KADAR iptalli kaliyordu; ana dosya bir gun bozulunca kayitOku o iptalli kaydi
        geri yazip paneli KALICI kilitliyordu — dosyanin kendi "teknik ariza asla kilit
        uretmez" kuralinin ihlali.
   Ikisinin ortak cozumu: .bak HER ZAMAN yazilan yeni kaydin aynasi olsun. Atomiklik zaten
   .tmp+rename ile saglaniyor; .bak'in gorevi "onceki hali saklamak" degil, ana dosya
   BOZULURSA okunacak saglam bir kopya bulundurmak.
   ⚠ IPTAL, RENAME BASARISIZ OLSA BILE .bak'a YAZILIR: iptal kasitli bir yonetici karari,
   "ariza kilitlemez" kurali onu kapsamaz — tersine, ariza iptali SILMEMELI. */
function kayitYaz(extRoot, kayit) {
  var yol = _lisansYolu(extRoot), tmp = yol + ".tmp";
  var govde = JSON.stringify(kayit, null, 2);
  try {
    fs.writeFileSync(tmp, govde, "utf8");
    fs.renameSync(tmp, yol);   // Windows'ta rename hedefin uzerine yazar
    try { fs.writeFileSync(yol + ".bak", govde, "utf8"); } catch (eB) {}
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) {}
    /* Ana dosyaya yazilamadi. Iptal ise yedege YINE de isle — yoksa salt-okunur bir
       lisans.json iptali kalici olarak etkisiz kilardi. */
    if (kayit && kayit.iptal === true) {
      try { fs.writeFileSync(yol + ".bak", govde, "utf8"); } catch (eI) {}
    }
    return false;
  }
}

// ---------------------------------------------------------------- durum makinesi
/*
 * SENKRON — ag YOK. Async olsaydi panel icerigi bir an gorunup sonra kilit inerdi.
 * Donus: { durum: "acik" | "kilit", sebep, kayit }
 */
function durumOku(extRoot) {
  var kayit = kayitOku(extRoot);
  if (!kayit || !kayit.hwid) return { durum: "kilit", sebep: "kayityok", kayit: null };
  // Sunucu acikca iptal ettiyse (yalniz KESIN bir yonetici islemi bunu yazar, bkz. ping)
  if (kayit.iptal === true) return { durum: "kilit", sebep: "iptal", kayit: kayit };

  var h = hwid();
  /* HWID OKUNAMADI -> AC. Kayit zaten var, yani bu makine bir kez onaylanmis; kimligi
     okuyamadigimiz icin onayli kullaniciyi atmak korumadan cok zarar verir. */
  if (!h) return { durum: "acik", sebep: "hwidyok", kayit: kayit };
  /* ⚠ KARMA BICIMI DEGISTIYSE KARSILASTIRMA ANLAMSIZ — KILIT DEGIL, AC.
     hwid() crypto varsa sha256 karmasi, YOKSA "ham:<guid>" donduruyor (satir ~97: crypto
     arizasinda kilit yine calissin diye bilerek). Ama bu, ariza durumunda BOS degil FARKLI
     bir deger uretiyor: karma ile aktive edilmis bir makinede crypto bir kez yuklenemezse
     kayit.hwid ("sha256…") ile h ("ham:…") esitlenmez ve panel "baskapc" ile KILITLENIR —
     tam da dosyanin yasakladigi sonuc (teknik ariza kullaniciyi disari atiyor).
     Kontrol SIMETRIK olmak zorunda: ters yon de (crypto YOKKEN aktive edildi, sonra crypto
     GELDI) ayni kilidi uretiyordu. Guvenlik kaybi yok — dosyanin kendi basligi bunun DRM
     olmadigini, lisans.json'daki hwid'i elle degistirmenin kilidi zaten astigini soyluyor. */
  /* ⚠ KONTROL ASIMETRIK OLMAK ZORUNDA — SIMETRIK HALI JOKER KIMLIK URETIYORDU.
     Iki yon esit DEGIL:
       · CANLI taraf "ham:" (crypto yuklenemedi) -> saldirgan bunu zorlayamaz, kosulsuz AC.
       · KAYIT tarafi "ham:" -> ham GUID kaydin ICINDE duruyor, yani karma YENIDEN
         HESAPLANABILIR. Simetrik hal burada dogrulanabilir bir kontrolu atip hicbir makineye
         bagli olmayan bir jeton kabul ediyordu: hwid'i "ham:11111111-…" yazilmis tek bir
         lisans.json HER bilgisayarda aciliyordu (olculdu). Hedef makinenin karmasini bilmek
         de gerekmiyordu, tek bir onek yetiyordu. */
  var _hamH = (String(h).indexOf("ham:") === 0), _hamK = (String(kayit.hwid).indexOf("ham:") === 0);
  if (_hamH && !_hamK) return { durum: "acik", sebep: "karmayok", kayit: kayit };
  if (_hamK && !_hamH) {
    var _yeniden = _sha256(TUZ + "|" + String(kayit.hwid).slice(4));
    /* Hesaplayamadiysak bu bir ARIZA — kilitleme (dosyanin kendi kurali). */
    if (!_yeniden) return { durum: "acik", sebep: "karmayok", kayit: kayit };
    return (_yeniden === h) ? { durum: "acik", sebep: "karmagoc", kayit: kayit }
                            : { durum: "kilit", sebep: "baskapc", kayit: kayit };
  }
  if (kayit.hwid !== h) return { durum: "kilit", sebep: "baskapc", kayit: kayit };
  return { durum: "acik", sebep: "tamam", kayit: kayit };
}

// ---------------------------------------------------------------- ag
function _post(yol, govde, zamanAsimi) {
  return new Promise(function (resolve) {
    if (!SUNUCU_HOST) { resolve({ kod: 0, hata: "sunucusuz" }); return; }
    var veri = JSON.stringify(govde || {});
    var req = https.request({
      host: SUNUCU_HOST, path: yol, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(veri) }
    }, function (res) {
      var b = "";
      res.on("data", function (d) { b += d; });
      res.on("end", function () {
        var g = null; try { g = JSON.parse(b); } catch (e) { g = null; }
        resolve({ kod: res.statusCode, govde: g || {} });
      });
      /* ⚠ CEVAP AKIŞININ HATASI DA DİNLENMELİ. Sunucu 200 + başlıkları yollayıp gövde
         ORTASINDA bağlantı koparsa (VPN açılışı, wifi→ethernet geçişi, CDN reset) Node
         `res`i yok ediyor: "end" HİÇ gelmiyor ve `req.on("error")` de tetiklenmiyor —
         yani Promise HİÇ sonuçlanmıyordu. Kilit ekranındaki "Devam" düğmesi sonsuza kadar
         bekliyor, kullanıcı paneli donmuş sanıyordu.
         `resolve` (reject DEĞİL): kod 0 + hata "ag" zaten "teknik arıza → kilitleme" kuralına
         bağlanıyor. Bu projenin değişmez kuralı: ARIZA ASLA KALICI KİLİT ÜRETMEZ. */
      res.on("error", function () { resolve({ kod: 0, hata: "ag" }); });
      res.on("aborted", function () { resolve({ kod: 0, hata: "ag" }); });
    });
    req.on("error", function (e) { resolve({ kod: 0, hata: (e && e.code) || "ag" }); });
    req.setTimeout(zamanAsimi || ZAMAN_ASIMI, function () { req.destroy(); resolve({ kod: 0, hata: "zamanasimi" }); });
    req.write(veri); req.end();
  });
}

/*
 * Kod dogrulama. Donus: { ok, mesaj }
 * MESAJLAR KISA VE NOTR — kullanici istegi: "sifreyi yusuf verir gibi cringe seyler olmasin".
 * ⚠ HATA AYRIMI SART: iptal edilmis lisansa "kod gecersiz" demek kullaniciyi kodda hata
 * aramaya yollar; sunucu ne dediyse o gosterilir.
 */
function aktivasyon(extRoot, kod, surum) {
  var h = hwid();
  /* ⚠ HWID YOKKEN SUNUCUYA GITME — YOKSA DOGRU KOD "Kod eksik." DIYE REDDEDILIYOR.
     durumOku'daki "kimlik okunamadi -> AC" dali YALNIZ kayit VARKEN calisir. Yeni kurulumda
     kayit yoktur: kilit ekrani cikar, aktivasyon h="" ile gonderilir, worker.js'teki
     `hwidHam.length < 8` testi 400 + "Kod eksik." doner ve panel o metni aynen yazar.
     Kullanici dogru sifreyi elinde tutarken karakter karakter kontrol edip durur, panel hic
     acilmaz ve log'da da sebep yoktur — dosyanin "registry okunamadi -> panel ACILIR" kurali
     tam da kurtarilamayan noktada tutmuyordu. Mesaj KISA ve NOTR (kullanici istegi); "yonetici
     olarak ac" gibi bir tavsiye YANLIS yonlendirme olurdu — MachineGuid okumak yonetici
     yetkisi gerektirmiyor, gercek sebep reg.exe'ye erisim. */
  if (!h) return Promise.resolve({ ok: false, sebep: "hwidyok",
                                   mesaj: "Bilgisayar kimliği okunamadı." });
  /* ⚠ ALAN ADI "sifre" — sunucu bunu bekliyor (worker.js aktivasyon: g.sifre).
     Panelde kullanıcıya "kod" deniyor ama telde adı sifre; ikisi karışırsa sunucu
     "Sifre ve cihaz kimligi gerekli" der ve kullanıcı kodu doğru yazdığı hâlde giremez.
     Bu uyumsuzluk gerçekten oldu ve canlı istekle yakalandı. */
  return _post(YOL_AKTIVASYON, { sifre: String(kod || "").trim(), hwid: h,
                                 makine: _makineAdi(), panel: surum || "" })
    .then(function (c) {
      var g = c.govde || {};
      if (c.kod === 200 && g.ok) {
        /* İMZA (cihaz jetonu) SAKLANIYOR, KOD DEĞİL. Sonraki açılışlarda sunucuya bu
           gidiyor; kodun kendisini diskte tutmanın bir faydası yok, kaybının bedeli var. */
        var kayit = { lisansId: g.lisansId || g.id || "", imza: g.imza || g.token || "",
                      hwid: h, ad: g.ad || "",
                      tarih: new Date().toISOString(), surum: surum || "" };
        /* ⚠ DISKE YAZILAMADIYSA SESSIZ KALMA. renameSync, yerinde writeFileSync'in gectigi
           bazi durumlarda basarisiz oluyor (hedefi FILE_SHARE_DELETE olmadan acik tutan bir
           yedekleme/AV/indeksleyici sureci -> MoveFileEx EPERM). O zaman sunucu cihazi
           kaydediyor, panel "bir daha sorulmayacak" diyor ama diskte hicbir sey yok: Premiere
           kapanip acilinca kilit ekrani geri geliyor ve dongu her acilista tekrarliyordu.
           Panel yine ACILIR (ok:true), yalnizca soz verilen sey duzeltilir. */
        var _yazildi = kayitYaz(extRoot, kayit);
        /* ⚠ KAYIT GERI DONMEK ZORUNDA. app.js aktivasyondan sonra `ac(r.kayit)` diyor ve o
           kayit ping()'e geciyor; alan dondurulmedigi icin undefined gidiyordu ve
           ping'in ilk satiri (`if (!kayit || !kayit.hwid) return;`) sessizce cikiyordu.
           Sonuc: yeni aktive edilen kullanici yonetim tablosunda "hic acmamis" gorunuyor,
           iptal bayragi da o oturumda hic okunmuyordu. */
        return { ok: true, mesaj: "", kayit: kayit, yazildi: _yazildi };
      }
      /* Sunucu kendi mesajini gonderdiyse ONU goster: iptal, hiz freni, sure dolmus gibi
         durumlar "kod gecersiz"den bambaska sebeplerdir ve ayni metni gostermek kullaniciyi
         yanlis yere yollar. */
      if (g && g.mesaj) return { ok: false, mesaj: String(g.mesaj) };
      if (c.kod === 403) return { ok: false, mesaj: "Kod geçersiz." };
      if (c.kod === 409) return { ok: false, mesaj: "Bu kod başka bir bilgisayarda kullanılıyor." };
      /* Adres bulunamadi = SUNUCU tarafinda sorun, kullanicinin internetinde degil.
         Ikisini ayirmak "modemi yeniden baslat" turundaki bosa ugrasi engelliyor. */
      /* ⚠ AG HATALARINDA sebep:"internet" — app.js bu alana bakip "tekrar dene" ipucunu
         gosteriyor (kod yanlissa o ipucu yaniltici olurdu). Alan hic uretilmedigi icin
         ipucu dali OLUYDU: gecici bir baglanti sorununda kullanici kodunu yanlis saniyordu. */
      if (c.hata === "ENOTFOUND" || c.hata === "EAI_AGAIN")
        return { ok: false, sebep: "internet", mesaj: "Sunucuya ulaşılamıyor. Biraz sonra tekrar dene." };
      if (c.hata === "sunucusuz") return { ok: false, sebep: "internet", mesaj: "Doğrulama şu an yapılamıyor." };
      if (!c.kod) return { ok: false, sebep: "internet", mesaj: "İnternet bağlantısı yok gibi görünüyor." };
      return { ok: false, mesaj: "Doğrulanamadı. Biraz sonra tekrar dene." };
    });
}

function _makineAdi() {
  try { return String(process.env.COMPUTERNAME || ""); } catch (e) { return ""; }
}

/*
 * PING — her acilista, arka planda. "Kim kullaniyor, en son ne zaman, hangi surumde"
 * tablosu bundan doluyor.
 * ⚠ BU FONKSIYONUN PANELI ENGELLEME YETKISI YOK: hicbir dali kilit dondurmez, hatasi
 * yutulur, cagiran sonucu BEKLEMEZ.
 * ⚠ IPTAL YALNIZ POZITIF KANITLA yazilir (g.iptal === true VE g.kesin === true). Sunucu
 * "kaydi bulamadim" derse bu KV'nin gecici tutarsizligi olabilir; onu kalici iptal diye
 * diske yazmak, calisan bir kurulumu bir daha acilmaz hale getirirdi.
 */
/* log (istege bagli): app.js DORDUNCU arguman olarak logLine gonderiyordu ama parametre
   listesinde karsiligi yoktu — sessizce dusuyordu. Ping'in kendi kurali geregi hicbir dali
   paneli engellemez; log yalnizca "iptal geldi" gibi kalici bir sonuc yazildiginda kullanilir. */
function ping(extRoot, kayit, surum, log) {
  if (!kayit || !kayit.hwid) return;
  try {
    /* Alan adları sunucunun beklediği gibi: lisansId + imza (cihaz jetonu) + hwid + panel.
       İmza yoksa (eski kayıt) sunucu "imzasiz" deyip hiçbir şey yapmıyor — zararsız. */
    _post(YOL_PING, { lisansId: kayit.lisansId || "", imza: kayit.imza || "",
                      hwid: kayit.hwid, makine: _makineAdi(), panel: surum || "" }, 6000)
      .then(function (c) {
        var g = (c && c.govde) || {};
        if (c.kod === 200 && g.iptal === true && g.kesin === true) {
          kayit.iptal = true; kayitYaz(extRoot, kayit);
          /* Diske KALICI bir karar yazildi — tek iz burasi. Yoksa kullanici bir sonraki
             acilista kilidi goruyor ve sebebini hicbir yerde bulamiyordu. */
          try { if (typeof log === "function") log("Lisans sunucu tarafından iptal edildi."); } catch (eL) {}
        }
      }, function () {});
  } catch (e) {}
}

/* kayitYaz DISA ACIK: panel onu cagirmiyor (aktivasyon/ping kendi icinde kullaniyor) ama
   testler\tumtest.js atomik yazmayi ve "iptal yedege de islenir" kuralini AGA CIKMADAN
   olcebilsin diye disarida. kayitOku zaten disa acikti; ikisi simetrik. */
module.exports = { hwid: hwid, durumOku: durumOku, aktivasyon: aktivasyon, ping: ping,
                   kayitOku: kayitOku, kayitYaz: kayitYaz,
                   sunucuVarMi: function () { return !!SUNUCU_HOST; } };
