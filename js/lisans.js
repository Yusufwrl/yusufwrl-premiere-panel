/*
 * LISANS — kod + bilgisayar kilidi.
 *
 * TEMEL KURAL, HER SEYDEN ONCE: TEKNIK ARIZA KULLANICIYI ASLA KILITLEMEZ.
 * Internet yok · sunucu olu · registry okunamadi · crypto yuklenemedi · dosya bozuk —
 * hepsi panelin ACILMASIYLA biter. Kilit YALNIZ iki seyden gelir:
 *   1) yerel kayit yok (hic aktivasyon yapilmamis)
 *   2) yerel kayit BASKA bir bilgisayara ait
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

function kayitOku(extRoot) {
  try {
    var s = fs.readFileSync(_lisansYolu(extRoot), "utf8");
    if (s && s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var j = JSON.parse(s);
    return (j && typeof j === "object") ? j : null;
  } catch (e) { return null; }
}

function kayitYaz(extRoot, kayit) {
  try { fs.writeFileSync(_lisansYolu(extRoot), JSON.stringify(kayit, null, 2), "utf8"); return true; }
  catch (e) { return false; }
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
        kayitYaz(extRoot, kayit);
        return { ok: true, mesaj: "" };
      }
      /* Sunucu kendi mesajini gonderdiyse ONU goster: iptal, hiz freni, sure dolmus gibi
         durumlar "kod gecersiz"den bambaska sebeplerdir ve ayni metni gostermek kullaniciyi
         yanlis yere yollar. */
      if (g && g.mesaj) return { ok: false, mesaj: String(g.mesaj) };
      if (c.kod === 403) return { ok: false, mesaj: "Kod geçersiz." };
      if (c.kod === 409) return { ok: false, mesaj: "Bu kod başka bir bilgisayarda kullanılıyor." };
      /* Adres bulunamadi = SUNUCU tarafinda sorun, kullanicinin internetinde degil.
         Ikisini ayirmak "modemi yeniden baslat" turundaki bosa ugrasi engelliyor. */
      if (c.hata === "ENOTFOUND" || c.hata === "EAI_AGAIN")
        return { ok: false, mesaj: "Sunucuya ulaşılamıyor. Biraz sonra tekrar dene." };
      if (c.hata === "sunucusuz") return { ok: false, mesaj: "Doğrulama şu an yapılamıyor." };
      if (!c.kod) return { ok: false, mesaj: "İnternet bağlantısı yok gibi görünüyor." };
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
function ping(extRoot, kayit, surum) {
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
        }
      }, function () {});
  } catch (e) {}
}

module.exports = { hwid: hwid, durumOku: durumOku, aktivasyon: aktivasyon, ping: ping,
                   kayitOku: kayitOku, sunucuVarMi: function () { return !!SUNUCU_HOST; } };
