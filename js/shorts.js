/*
 * SHORTS — "videonun en iyi 3-5 anını seç" katmanı.
 *
 * Kullanıcı isteği (11 Ağustos 2026): uzun video bittikten sonra tek tıkla 30-40 saniyelik
 * DİKEY bir özet Shorts. "3-5 kısa kesit birleşsin", "süre hep aynı olmasın".
 *
 * ⚠ ALTYAPI vurucu.js'TEN MİRAS — KOPYALAMA. `istekGonder` tam da bu amaçla ayrılmış
 * (tekrar deneme, 429/retry-after beklemesi, 401/400 net Türkçe mesaj, şemasız geri düşme,
 * iptal). emoji.js de onu kullanıyor. Retry/iptal mantığı üç kez yazılırsa üçü de ayrı ayrı
 * bozulur.
 * `cumleleriCikar` da aynen kullanılır: cümle sınırlarını O veriyor, yani kullanıcının
 * "kesitler cümle ortasından bölünmesin" isteği veri yapısında garanti altına alınıyor.
 *
 * ⚠⚠ PARÇA NUMARALANDIRMA — BU PROJEDE AYNEN YAŞANDI, ÜÇ KORUMA ŞART.
 * `duygulariSec` cümleleri parçalar hâlinde gönderip satırları GLOBAL sırayla numaralıyordu;
 * model 250 satırlık listeyi 1'den numaralayınca cevabı başka konuşmacının cümlesine düştü
 * ve panelde HİÇBİR doğrulama yoktu (ölçüldü: 400 cümlede 150'si iki kez seçildi, 150'si
 * hiç seçilmedi; tek parçalık test oturumunda AYLARCA görünmedi).
 * Shorts'ta bedeli DAHA BÜYÜK: yalnız 3-5 kesit var, tek yanlış numara Shorts'un %25'ini
 * bambaşka bir ana çevirir. Korumalar:
 *   1. Her parça KENDİ İÇİNDE 1..N numaralanır — global numara ASLA gönderilmez.
 *   2. Cevaptaki numara `1 <= no <= dilim.length` kapısından geçer; geçmezse ATILIR ve
 *      `siraDisi` ile SAYILIR (sessiz düşüş yok).
 *   3. Gerçek cümle panelin KENDİ kaydından yazılır: `dilim[no-1]` — modelin verdiği
 *      numaradan değil.
 * ⚠ MODELDEN SANİYE İSTENMEZ: uydurduğu saniyenin doğrulaması yok, numaranın aralık
 * kontrolü var.
 *
 * ⚠ SÜRE BÜTÇESİ PANELDE, MODELDE DEĞİL. Model "hangi anlar iyi" sorusunu cevaplar; toplam
 * süre, çakışma ve kesit uzunluğu aritmetiği burada yapılır. Model saniye toplayamaz.
 */
"use strict";

var MODEL = "claude-sonnet-5";

var VARSAYILAN = {
  hedefSure: 35,        // kullanıcı: "30-40 saniye"
  minSure: 28,
  maxSure: 42,
  adetMin: 3,           // kullanıcı: "3-5 kısa kesit"
  adetMax: 5,
  kesitMin: 4,          // bir kesit en az bu kadar sürsün (daha kısası "an" değil, kırpıntı)
  kesitMax: 14,         // en fazla — tek kesit Shorts'u yemesin
  elemeAday: 6,         // eleme turunda parça başına kaç aday
  parcaCumle: 250,      // emoji.js ile aynı: bir istekte kaç cümle
  metinSiniri: 220,     // cümle metni bu kadar karakterde kesilir (token bütçesi)
  maxTokens: 4000,
  yapisalCikti: true
};

var SISTEM_ELEME =
  "Sen bir YouTube kurgucususun. Sana bir videonun konuşma dökümünden bir bölüm veriliyor. " +
  "Görevin: bu bölümdeki EN İLGİ ÇEKİCİ anları seçmek — Shorts'a konacak anlar.\n\n" +
  "İYİ AN: komik, şaşırtıcı, gergin, bir şeyin olduğu an; tepki, çığlık, başarı, başarısızlık, " +
  "kavga, sürpriz. Kendi başına anlaşılır olmalı.\n" +
  "KÖTÜ AN: bağlam gerektiren, sıradan sohbet, tekrar, yarım kalan cümle, sessizlik dolgusu.\n\n" +
  "Her satır bir CÜMLE ve başında o parçaya ait sıra numarası var. Bir an birden çok ardışık " +
  "cümleden oluşabilir: basNo ve bitNo ile aralık ver.\n" +
  "SADECE bu parçadaki numaraları kullan. Numara uydurma.";

var SISTEM_FINAL =
  "Sen bir YouTube kurgucususun. Sana bir videodan seçilmiş aday anlar veriliyor. " +
  "Görevin: bunlardan Shorts'a girecek EN İYİ olanları seçmek ve puanlamak.\n\n" +
  "Shorts 30-40 saniye olacak ve bu anlar arka arkaya eklenecek. İzleyici videoyu görmemiş " +
  "olacak, yani her an KENDİ BAŞINA anlaşılır olmalı.\n" +
  "Çeşitlilik iyidir: hepsi aynı kişiden ya da aynı tip olmasın.\n" +
  "puan: 1-10, 10 = kesinlikle girsin.\n" +
  "SADECE listedeki numaraları kullan. Numara uydurma.";

var SEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kesitler"],
  properties: {
    kesitler: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        /* ⚠ ALAN ADLARI BİLEREK `basNo`/`bitNo` — `bas`/`bit` denirse hem model hem kodu
           okuyan bunları SANİYE sanıyor. Bunlar parça içi cümle NUMARASI. */
        required: ["basNo", "bitNo", "puan", "sebep"],
        properties: {
          basNo: { type: "integer" },
          bitNo: { type: "integer" },
          puan: { type: "integer" },
          sebep: { type: "string" }
        }
      }
    }
  }
};

function _ayar(opts, ad) {
  if (opts && opts[ad] !== undefined && opts[ad] !== null && opts[ad] !== "") return opts[ad];
  return VARSAYILAN[ad];
}
function _sayi(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function _saat(sn) {
  sn = Math.max(0, Math.floor(_sayi(sn)));
  var d = Math.floor(sn / 60), s = sn % 60;
  return d + ":" + (s < 10 ? "0" : "") + s;
}

/* Gruplardan (kanal başına cue listesi) TEK bir cümle listesi üretir; her cümle hangi
   gruptan geldiğini taşır. Zaman sırasına dizilir — numaralar SIRALAMADAN SONRA verilir
   (app.js'teki ölçülmüş ders: kanal sırasında numaralamak modele zıplayan numara gönderiyor). */
function cumleleriTopla(VUR, gruplar, opts) {
  var hepsi = [], gi;
  for (gi = 0; gi < (gruplar || []).length; gi++) {
    var g = gruplar[gi];
    if (!g || !g.cues || !g.cues.length) continue;
    var cl = VUR.cumleleriCikar(g.cues, opts) || [];
    for (var i = 0; i < cl.length; i++) {
      var c = cl[i];
      if (!c.metin) continue;
      hepsi.push({
        bas: _sayi(c.bas), bit: _sayi(c.bit), metin: c.metin,
        grup: String(g.ad || ("A" + (gi + 1))), grupIdx: gi,
        cueler: c.cueler || []
      });
    }
  }
  hepsi.sort(function (a, b) { return a.bas - b.bas; });
  for (var k = 0; k < hepsi.length; k++) hepsi[k].globalIdx = k;   // panelin KENDİ kaydı
  return hepsi;
}

/* Bir dilimi modele gönderilecek metne çevirir. ⚠ Numara DİLİM İÇİ (1..N). */
function _dilimMetni(dilim, metinSiniri) {
  var out = [], i;
  for (i = 0; i < dilim.length; i++) {
    var m = String(dilim[i].metin || "");
    if (m.length > metinSiniri) m = m.slice(0, metinSiniri - 1) + "…";
    out.push((i + 1) + " [" + _saat(dilim[i].bas) + "] [" + dilim[i].grup + "] " + m);
  }
  return out.join("\n");
}

function _govde(sistem, icerik, opts) {
  var g = {
    model: String(_ayar(opts, "model") || MODEL),
    max_tokens: _sayi(_ayar(opts, "maxTokens")),
    system: sistem,
    /* Düşünme KAPALI — vurucu.js ile aynı gerekçe: açık bırakılırsa düşünme token'ları
       bütçeyi yiyip JSON'u ortasından keser. temperature/top_p/top_k GÖNDERİLMEZ. */
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: icerik }]
  };
  if (_ayar(opts, "yapisalCikti")) g.output_config = { format: { type: "json_schema", schema: SEMA } };
  return g;
}

/* Cevabı ayrıştırır ve DİLİME göre doğrular. Aralık dışı numara ATILIR ve SAYILIR. */
function _cevapCoz(VUR, metin, dilim, sayac) {
  var j = null;
  try { j = JSON.parse(String(metin)); }
  catch (e) {
    /* Şemasız geri düşmede model metnin içine JSON gömebiliyor. */
    var m = String(metin).match(/\{[\s\S]*\}/);
    if (m) { try { j = JSON.parse(m[0]); } catch (e2) { j = null; } }
  }
  if (!j || !j.kesitler || !j.kesitler.length) return [];
  var out = [], i;
  for (i = 0; i < j.kesitler.length; i++) {
    var k = j.kesitler[i];
    var b = Math.round(Number(k.basNo)), s = Math.round(Number(k.bitNo));
    /* ── KORUMA 2: aralık kapısı. Geçmeyen ATILIR ve SAYILIR. ── */
    if (!isFinite(b) || !isFinite(s) || b < 1 || s < 1 || b > dilim.length || s > dilim.length || s < b) {
      sayac.siraDisi++;
      continue;
    }
    /* ── KORUMA 3: gerçek cümleler panelin KENDİ kaydından. ── */
    var basC = dilim[b - 1], bitC = dilim[s - 1];
    out.push({
      bas: basC.bas, bit: bitC.bit,
      grup: basC.grup, grupIdx: basC.grupIdx,
      globalIdx: basC.globalIdx, globalSon: bitC.globalIdx,
      metin: (b === s) ? basC.metin : (basC.metin + " … " + bitC.metin),
      puan: Math.max(1, Math.min(10, Math.round(Number(k.puan)) || 5)),
      sebep: String(k.sebep || "").slice(0, 200)
    });
  }
  return out;
}

/* Kesitleri süre/çakışma/adet kurallarına göre eler. ⚠ Bu aritmetik MODELDE DEĞİL BURADA. */
function _butceUygula(adaylar, opts, sayac) {
  var kesitMin = _sayi(_ayar(opts, "kesitMin")), kesitMax = _sayi(_ayar(opts, "kesitMax"));
  var maxSure = _sayi(_ayar(opts, "maxSure")), adetMax = _sayi(_ayar(opts, "adetMax"));
  var i, secili = [];
  /* Puan sırası: en iyiden başla, çakışanı ve bütçeyi aşanı düşür. */
  var sirali = adaylar.slice().sort(function (a, b) {
    if (b.puan !== a.puan) return b.puan - a.puan;
    return a.bas - b.bas;
  });
  var toplam = 0;
  for (i = 0; i < sirali.length && secili.length < adetMax; i++) {
    var k = sirali[i];
    var sure = k.bit - k.bas;
    if (sure < kesitMin) { sayac.kisaElenen++; continue; }
    /* ⚠ KIRPMA CÜMLE SINIRINDAN — asla ortadan bölünmez. Kesit çok uzunsa BAŞTAN alınır
       (ilk cümleler bağlamı kurar); sonu kırpmak "yarım cümle" üretmez çünkü bit zaten
       bir cümle sonu değil, kesit sonu olur. Bu yüzden uzun kesit tümden ELENİR, kırpılmaz —
       kırpmak cümlenin ortasına denk gelir ve kullanıcının açık isteğini bozar. */
    if (sure > kesitMax) { sayac.uzunElenen++; continue; }
    var cakisma = false;
    for (var q = 0; q < secili.length; q++) {
      if (k.bas < secili[q].bit && k.bit > secili[q].bas) { cakisma = true; break; }
    }
    if (cakisma) { sayac.cakismaElenen++; continue; }
    if (toplam + sure > maxSure) { sayac.sureElenen++; continue; }
    secili.push(k);
    toplam += sure;
  }
  /* Timeline sırasına diz — Shorts kronolojik akmalı, puan sırasına değil. */
  secili.sort(function (a, b) { return a.bas - b.bas; });
  return { kesitler: secili, toplam: toplam };
}

/*
 * ANA İŞ.
 *   extRoot : anthropic-key.txt'nin arandığı uzantı kökü
 *   gruplar : [{ad, cues}] — vurucuSec ile aynı giriş biçimi
 *   opts    : yukarıdaki VARSAYILAN alanları + {damga, onLog}
 * Diziler DEĞİŞTİRİLMEZ, cue nesnelerine hiçbir alan yazılmaz.
 */
async function shortsSec(VUR, anahtar, gruplar, opts) {
  opts = opts || {};
  var log = opts.onLog || function () {};
  var damga = opts.damga;
  var sayac = { siraDisi: 0, cakismaElenen: 0, sureElenen: 0, kisaElenen: 0, uzunElenen: 0,
                parcaToplam: 0, parcaBasarisiz: 0 };

  var cumleler = cumleleriTopla(VUR, gruplar, opts);
  if (!cumleler.length) {
    return { hata: "Shorts için cümle bulunamadı — önce altyazı üret.", kesitler: [] };
  }
  log("Shorts: " + cumleler.length + " cümle değerlendirilecek.");

  var parcaCumle = _sayi(_ayar(opts, "parcaCumle"));
  var metinSiniri = _sayi(_ayar(opts, "metinSiniri"));
  var elemeAday = _sayi(_ayar(opts, "elemeAday"));
  var adaylar = [], hatalar = [];

  /* ── TUR 1: ELEME ── Cümleler dilimlere bölünür, her dilimden en iyi K aday istenir.
     ⚠ Tek dilim varsa bu tur ATLANIR — bütün cümleler zaten tek istekte karşılaştırılabilir,
     iki tur göndermek parayı boşa harcar (vurucu.js'teki "aday yoksa istek gönderme" dersi). */
  var dilimler = [], p;
  for (p = 0; p < cumleler.length; p += parcaCumle) dilimler.push(cumleler.slice(p, p + parcaCumle));
  sayac.parcaToplam = dilimler.length;

  if (dilimler.length === 1) {
    adaylar = cumleler.slice();          // final turu hepsini görecek
    log("Shorts: tek parça — eleme turu atlandı.");
  } else {
    for (p = 0; p < dilimler.length; p++) {
      if (VUR.iptalEdildiMi && VUR.iptalEdildiMi(damga)) return { hata: "İptal edildi", kesitler: [] };
      var dilim = dilimler[p];
      var icerik = "Bu bölümden en iyi " + elemeAday + " anı seç.\n\n" + _dilimMetni(dilim, metinSiniri);
      var metin;
      try {
        metin = await VUR.istekGonder(anahtar, _govde(SISTEM_ELEME, icerik, opts), opts, damga, log);
      } catch (e) {
        if (e && e.iptal) return { hata: "İptal edildi", kesitler: [] };
        sayac.parcaBasarisiz++;
        hatalar.push("eleme parça " + (p + 1) + ": " + (e.message || e));
        log("Shorts: eleme parçası " + (p + 1) + " alınamadı — " + (e.message || e));
        continue;
      }
      var bulunan = _cevapCoz(VUR, metin, dilim, sayac);
      log("Shorts: eleme parçası " + (p + 1) + "/" + dilimler.length + " → " + bulunan.length + " aday");
      adaylar = adaylar.concat(bulunan);
    }
    if (!adaylar.length) {
      return { hata: "Yapay zekâ hiç aday bulamadı (" + sayac.parcaBasarisiz + " parça düştü).",
               kesitler: [], sayac: sayac, hatalar: hatalar };
    }
  }

  /* ── TUR 2: FINAL ── Adaylar TEK istekte karşılaştırılır.
     ⚠ Bu tur olmadan parçalar ARASI karşılaştırma hiç yapılmaz: her parça kendi en iyisini
     döndürür ve panel hangisinin daha iyi olduğunu bilemez. */
  if (VUR.iptalEdildiMi && VUR.iptalEdildiMi(damga)) return { hata: "İptal edildi", kesitler: [] };
  var finalDilim = adaylar.slice(0, 120);        // token tavanı; puan sırası yok, zaman sırası korunur
  finalDilim.sort(function (a, b) { return a.bas - b.bas; });
  var adetMin = _sayi(_ayar(opts, "adetMin")), adetMax2 = _sayi(_ayar(opts, "adetMax"));
  var hedef = _sayi(_ayar(opts, "hedefSure"));
  var finalIcerik = "Toplam " + hedef + " saniyelik bir Shorts için " + adetMin + "-" + adetMax2 +
                    " an seç ve puanla. Her an yaklaşık " + _sayi(_ayar(opts, "kesitMin")) + "-" +
                    _sayi(_ayar(opts, "kesitMax")) + " saniye olmalı.\n\n" +
                    _dilimMetni(finalDilim, metinSiniri);
  var finalMetin;
  try {
    finalMetin = await VUR.istekGonder(anahtar, _govde(SISTEM_FINAL, finalIcerik, opts), opts, damga, log);
  } catch (e2) {
    if (e2 && e2.iptal) return { hata: "İptal edildi", kesitler: [] };
    return { hata: "Final seçimi alınamadı: " + (e2.message || e2), kesitler: [], sayac: sayac };
  }
  var finalAdaylar = _cevapCoz(VUR, finalMetin, finalDilim, sayac);
  if (!finalAdaylar.length) {
    return { hata: "Yapay zekâ geçerli bir seçim döndürmedi" +
                   (sayac.siraDisi ? " (" + sayac.siraDisi + " numara aralık dışıydı)" : "") + ".",
             kesitler: [], sayac: sayac };
  }

  var son = _butceUygula(finalAdaylar, opts, sayac);
  var minSure = _sayi(_ayar(opts, "minSure"));
  var uyari = "";
  if (son.kesitler.length < adetMin) {
    uyari = son.kesitler.length + " kesit bulundu (hedef " + adetMin + "-" + adetMax2 + ").";
  } else if (son.toplam < minSure) {
    uyari = "Shorts " + son.toplam.toFixed(1) + " sn — hedeflenen " + minSure + "-" +
            _sayi(_ayar(opts, "maxSure")) + " sn aralığının altında.";
  }
  if (sayac.siraDisi) {
    uyari = (uyari ? uyari + " " : "") + sayac.siraDisi +
            " numara aralık dışıydı ve atıldı (cevap kısmen bozuk).";
  }
  if (sayac.parcaBasarisiz) {
    uyari = (uyari ? uyari + " " : "") + sayac.parcaBasarisiz +
            " bölüm alınamadı — videonun bir kısmı hiç değerlendirilmedi.";
  }

  log("Shorts seçimi: " + son.kesitler.length + " kesit · toplam " + son.toplam.toFixed(1) + " sn · " +
      "elenen: " + sayac.cakismaElenen + " çakışma, " + sayac.sureElenen + " bütçe, " +
      sayac.kisaElenen + " kısa, " + sayac.uzunElenen + " uzun.");

  return {
    kesitler: son.kesitler, toplamSure: son.toplam,
    cumleSayisi: cumleler.length, sayac: sayac, hatalar: hatalar, uyari: uyari
  };
}

module.exports = {
  MODEL: MODEL, VARSAYILAN: VARSAYILAN, SEMA: SEMA,
  shortsSec: shortsSec,
  // test edilebilirlik için iç parçalar
  cumleleriTopla: cumleleriTopla, _cevapCoz: _cevapCoz, _butceUygula: _butceUygula,
  _dilimMetni: _dilimMetni
};
