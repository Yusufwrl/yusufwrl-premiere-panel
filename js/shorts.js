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
  elemeAday: 8,         // eleme turunda parça başına kaç aday (6'ydı: final turuna az aday kalıyordu)
  parcaCumle: 250,      // emoji.js ile aynı: bir istekte kaç cümle
  metinSiniri: 220,     // cümle metni bu kadar karakterde kesilir (token bütçesi)
  maxTokens: 4000,
  yapisalCikti: true,
  shortsAdet: 5          // Çoklu Shorts: kaç ayrı sekans (kullanıcı isteği: 5)
};

/* ⚠ İSTEM KULLANICI GERİ BİLDİRİMİYLE GÜÇLENDİRİLDİ (11 Ağustos 2026: "en iyi yerleri
   Shorts için daha zekice düşünüp yapsın"). İlk sürüm yalnız "ilgi çekici an" diyordu ve
   model sıradan sohbeti de seçebiliyordu. Artık Shorts'un GERÇEK kısıtları anlatılıyor:
   izleyici videoyu görmedi, ilk saniyede kaçabilir, ses tek başına taşımalı. */
var SISTEM_ELEME =
  "Sen Minecraft/Roblox içerikleri kurgulayan deneyimli bir YouTube kurgucususun. " +
  "Sana bir videonun konuşma dökümünden bir bölüm veriliyor.\n\n" +
  "GÖREV: bu bölümdeki, YouTube Shorts'ta tek başına izlenebilecek anları seç.\n\n" +
  "GÜÇLÜ AN (seç):\n" +
  "· Bir ŞEY OLUYOR: ölüm, kazanma, kaybetme, yakalanma, sürpriz, plan tutması/tutmaması\n" +
  "· GERÇEK TEPKİ: çığlık, panik, kahkaha, şok, kızgınlık, itiraz — sesin yükseldiği yer\n" +
  "· ÇATIŞMA: birbirine laf atma, suçlama, iddia, meydan okuma, yakalanma anı\n" +
  "· KOMİK: saçmalık, yanlış anlama, beklenmedik cevap, kendine gülme\n" +
  "· MERAK: bir şeyin açıklandığı, ortaya çıktığı, ilk kez görüldüğü an\n\n" +
  "ZAYIF AN (SEÇME):\n" +
  "· Bağlam gerektiren: \"onu oraya koyalım\", \"az önce dediğim gibi\" — izleyici videoyu GÖRMEDİ\n" +
  "· Sıradan koordinasyon: \"sen şuraya git\", \"tamam bekle\", \"geliyorum\"\n" +
  "· Tekrar, düşünme sesi, yarım cümle, konu dışı sohbet\n" +
  "· Yalnız bir kişinin tek düze anlattığı yer (diyalog daha güçlü)\n\n" +
  "Her satır bir CÜMLE, başında o parçaya ait sıra numarası var. Bir an birden çok ardışık " +
  "cümleden oluşabilir — basNo ve bitNo ile aralık ver ve anın TAMAMINI al: tepkinin " +
  "öncesindeki kurulum cümlesi de içeride kalsın, yoksa an havada kalır.\n" +
  "SADECE bu parçadaki numaraları kullan. Numara uydurma.";

var SISTEM_FINAL =
  "Sen Minecraft/Roblox içerikleri kurgulayan deneyimli bir YouTube kurgucususun. " +
  "Sana bir videodan seçilmiş aday anlar veriliyor.\n\n" +
  "GÖREV: bunlardan 30-40 saniyelik bir Shorts kurmak. Anlar arka arkaya eklenecek.\n\n" +
  "SHORTS'UN GERÇEĞİ — puanlarken bunları düşün:\n" +
  "1. İzleyici videoyu GÖRMEDİ ve tanımıyor. Her an kendi başına anlaşılmalı.\n" +
  "2. İlk 2 saniyede kaçıyor. EN GÜÇLÜ an, listedeki en yüksek puanı almalı — panel onu " +
  "   zaman sırasına dizecek ama puan neyin taşıdığını belirler.\n" +
  "3. Ses tek başına taşımalı: görüntüyü anlatan değil, DUYGUSU olan anlar kazanır.\n" +
  "4. Çeşitlilik: hepsi aynı kişiden veya aynı tipten olmasın. Farklı karakterlerin " +
  "   birbirine tepki verdiği anlar en iyisidir.\n" +
  "5. Bir an tek başına komik/şaşırtıcı değilse, ne kadar önemli olursa olsun ALMA.\n" +
  "6. VİDEONUN HER YERİNDEN seç — başı, ortası, sonu. Shorts izleyiciyi asıl videoya " +
  "   yönlendirmeli, yani videonun tamamından bir tat vermeli. Hepsini videonun ilk " +
  "   dakikalarından seçme; sonlara doğru olan güçlü anları özellikle ara.\n\n" +
  "⚠ PUANLARI AYIRT EDİCİ VER. Hepsine 9-10 verirsen sıralama anlamsızlaşır ve seçim " +
  "videonun başına yığılır. Gerçekten en güçlü 2-3 ana 9-10, ötekilere 5-8 ver.\n" +
  "puan: 1-10. 9-10 = tek başına Shorts taşır · 7-8 = güçlü · 5-6 = idare eder · " +
  "4 ve altı = alma.\n" +
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

function _govde(sistem, icerik, opts, sema) {
  var g = {
    model: String(_ayar(opts, "model") || MODEL),
    max_tokens: _sayi(_ayar(opts, "maxTokens")),
    system: sistem,
    /* Düşünme KAPALI — vurucu.js ile aynı gerekçe: açık bırakılırsa düşünme token'ları
       bütçeyi yiyip JSON'u ortasından keser. temperature/top_p/top_k GÖNDERİLMEZ. */
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: icerik }]
  };
  if (_ayar(opts, "yapisalCikti")) g.output_config = { format: { type: "json_schema", schema: (sema || SEMA) } };
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

/* Kesitleri süre/çakışma/adet/DAĞILIM kurallarına göre eler.
   ⚠ Bu aritmetik MODELDE DEĞİL BURADA — model saniye toplayamaz.

   ⚠⚠ ZAMAN DAĞILIMI ŞART — GERÇEK HATA (kullanıcı, 11 Ağustos 2026: "klip seçimleri de
   olmamış, dümdüz videonun başını almışsın").
   SEBEP: eski sürüm yalnız puana göre sıralıyor, eşit puanda `a.bas - b.bas` ile ERKEN olanı
   seçiyordu. Model 8-10 ana aynı puanı verince (veriyor — 9-10 arası puanlar yığılıyor)
   sıralama tamamen zamana düşüyor ve HEP videonun başındakiler kazanıyordu. Sonuç "videonun
   özeti" değil "videonun ilk 40 saniyesi" oluyordu.
   ÇÖZÜM: video eşit bölgelere ayrılır ve İLK GEÇİŞTE her bölgeden yalnız BİR kesit alınır.
   Yer kalırsa ikinci geçiş bölge kuralını gevşetir — yani dağılım öncelikli, ama bütçe boş
   kalmıyor. Kullanıcının gerekçesi: "Shorts videoya yönlendirebilmeli", yani videonun her
   yerinden bir tat vermeli. */
function _butceUygula(adaylar, opts, sayac) {
  var kesitMin = _sayi(_ayar(opts, "kesitMin")), kesitMax = _sayi(_ayar(opts, "kesitMax"));
  var maxSure = _sayi(_ayar(opts, "maxSure")), adetMax = _sayi(_ayar(opts, "adetMax"));
  var i, secili = [], toplam = 0, doluBolge = {};

  /* Bölge sınırları adayların YAYILIMINDAN kurulur (video süresi elde yok). İlk aday 0'dan
     çok sonra başlıyorsa bölgeler o aralığa sıkışır — istenen de bu: "videonun her yeri"
     demek, konuşmanın olduğu her yer demek. */
  var enErken = Infinity, enGec = 0;
  for (i = 0; i < adaylar.length; i++) {
    if (adaylar[i].bas < enErken) enErken = adaylar[i].bas;
    if (adaylar[i].bit > enGec) enGec = adaylar[i].bit;
  }
  if (!isFinite(enErken)) enErken = 0;
  var yayilim = Math.max(1, enGec - enErken);
  var bolgeSay = Math.max(1, adetMax);
  function bolgeNo(k) {
    var b = Math.floor(((k.bas - enErken) / yayilim) * bolgeSay);
    return Math.max(0, Math.min(bolgeSay - 1, b));
  }

  var sirali = adaylar.slice().sort(function (a, b) {
    if (b.puan !== a.puan) return b.puan - a.puan;
    return a.bas - b.bas;
  });

  /* Bir adayı almayı dener. `bolgeSarti` false ise bölge kuralı uygulanmaz (2. geçiş). */
  function dene(k, bolgeSarti, say) {
    if (secili.length >= adetMax) return false;
    var sure = k.bit - k.bas;
    if (sure < kesitMin) { if (say) sayac.kisaElenen++; return false; }
    /* ⚠ KIRPMA CÜMLE SINIRINDAN — asla ortadan bölünmez. Uzun kesit tümden ELENİR,
       kırpılmaz: kırpmak cümlenin ortasına denk gelir ve kullanıcının açık isteğini bozar. */
    if (sure > kesitMax) { if (say) sayac.uzunElenen++; return false; }
    if (bolgeSarti && doluBolge[bolgeNo(k)]) { return false; }
    for (var q = 0; q < secili.length; q++) {
      if (k.bas < secili[q].bit && k.bit > secili[q].bas) { if (say) sayac.cakismaElenen++; return false; }
    }
    if (toplam + sure > maxSure) { if (say) sayac.sureElenen++; return false; }
    secili.push(k);
    doluBolge[bolgeNo(k)] = 1;
    toplam += sure;
    return true;
  }

  /* ⚠ SAYAÇLAR YALNIZ 2. GEÇİŞTE — her aday TAM BİR KEZ sayılsın diye.
     1. geçişte sayılsaydı bölge kuralına takılan aday hem orada hem 2. geçişte sayılır ve
     kullanıcıya gösterilen "kaç tanesi neden elendi" sayısı şişerdi. Elenme sebebi ancak
     ikinci geçişten sonra KESİNLEŞİYOR (bölge kuralı orada kalkıyor). */
  /* 1. GEÇİŞ — her bölgeden en iyi bir tane. */
  for (i = 0; i < sirali.length; i++) dene(sirali[i], true, false);
  /* 2. GEÇİŞ — bölge kuralını gevşet, seçilmeyen her adayın sebebini say. */
  for (i = 0; i < sirali.length; i++) {
    if (secili.indexOf(sirali[i]) === -1) dene(sirali[i], false, true);
  }
  /* ⚠ 3. GEÇİŞ — SÜRE HEDEFİ ADET TAVANINDAN ÖNCELİKLİ (kullanıcı, 11 Ağustos 2026:
     "30-40 aralığında saniye demiştim"). Shorts 17.9 sn / 2 kesit çıkmıştı: adetMax'a
     ulaşılmamıştı ama uygun aday kalmamıştı. Kullanıcının asıl ölçüsü SÜRE; kesit sayısı
     onu tutturmanın aracı. Bu yüzden minSure'ın altında kalındıysa adet tavanı gevşetilir
     — maxSure yine SERT sınır, yani Shorts asla 42 sn'yi aşmaz. */
  var minSure = _sayi(_ayar(opts, "minSure"));
  if (toplam < minSure) {
    var eskiTavan = adetMax;
    adetMax = Math.max(adetMax, 8);
    for (i = 0; i < sirali.length && toplam < minSure; i++) {
      if (secili.indexOf(sirali[i]) === -1) dene(sirali[i], false, false);
    }
    if (secili.length > eskiTavan) sayac.adetGevsetildi = secili.length;
  }

  /* Timeline sırasına diz — Shorts kronolojik akmalı, puan sırasına değil. */
  secili.sort(function (a, b) { return a.bas - b.bas; });
  sayac.bolgeSay = bolgeSay;
  sayac.doluBolgeSay = 0;
  for (var bk in doluBolge) if (Object.prototype.hasOwnProperty.call(doluBolge, bk)) sayac.doluBolgeSay++;
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
  /* ⚠ TOKEN TAVANI BAŞTAN KESMEZ, EŞİT ARALIKLA SEYRELTİR. `slice(0,120)` videonun ilk
     parçalarını alıp sonunu tümden atıyordu — "hep başından seçiyor" hatasının ikinci
     kaynağı buydu (birincisi _butceUygula'daki eşit-puan sıralaması). */
  var finalDilim = adaylar.slice();
  finalDilim.sort(function (a, b) { return a.bas - b.bas; });
  if (finalDilim.length > 120) {
    var seyrek = [], adim = finalDilim.length / 120, sx;
    for (sx = 0; sx < 120; sx++) seyrek.push(finalDilim[Math.floor(sx * adim)]);
    finalDilim = seyrek;
  }
  var adetMin = _sayi(_ayar(opts, "adetMin")), adetMax2 = _sayi(_ayar(opts, "adetMax"));
  var hedef = _sayi(_ayar(opts, "hedefSure"));
  /* ⚠ MODELDEN GEREKENDEN FAZLA ADAY İSTENİR (8-12), panel bunlardan bütçeye uyanı seçer.
     Gerçek hata (11 Ağustos 2026): "3-5 an seç" denince model 2-3 aday döndürüyor, biri de
     çakışma/süre kuralına takılınca Shorts 17.9 saniyeye düşüyordu. Fazla aday BEDAVA —
     aynı istekte geliyor ve panel zaten adetMax + maxSure ile kendi tavanını uyguluyor. */
  var finalIcerik = "Toplam " + hedef + " saniyelik bir Shorts kurulacak (en az " +
                    _sayi(_ayar(opts, "minSure")) + " sn). Bana 8-12 ADAY an seç ve puanla — " +
                    "hepsi kullanılmayacak, ben en iyilerinden " + adetMin + "-" + adetMax2 +
                    " tanesini seçip birleştireceğim. Her an yaklaşık " +
                    _sayi(_ayar(opts, "kesitMin")) + "-" + _sayi(_ayar(opts, "kesitMax")) +
                    " saniye olmalı.\n\n" + _dilimMetni(finalDilim, metinSiniri);
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

/* ══════════════════════ ÇOKLU SHORTS ══════════════════════
   Kullanıcı isteği (11 Ağustos 2026): "5 tane Shorts sequence'ı oluşturacak ve videonun 5
   tane kısmını alacak — tekli Shorts'taki gibi videonun karışık en iyi anları DEĞİL, parça
   parça anları gibi olacak. Örneğin videonun başında kaçırılma oluyor, sonra kafes sahnesi,
   sonra kurtarılma; çoklu Shorts biri kaçırılmayı, biri kafesi, biri kurtarılmayı alsın."

   ⚠ TEKLİDEN FARKI TEMELDE: tekli Shorts videonun HER YERİNDEN en iyi anları toplayıp tek
   bir özet kuruyor (zaman dağılımı kuralı bunun için var). Çoklu Shorts ise videoyu ÖNCE
   anlatı bölümlerine (sahne) ayırıyor, sonra HER BÖLÜMÜN KENDİ İÇİNDEN bir Shorts kuruyor.
   Yani beş Shorts birbirinden bağımsız beş hikâye — aynı havuzdan beş kesit değil. */

var SISTEM_BOLUM =
  "Sen Minecraft/Roblox içerikleri kurgulayan deneyimli bir YouTube kurgucususun. " +
  "Sana bir videonun konuşma dökümü veriliyor.\n\n" +
  "GÖREV: bu videoyu ANLATI BÖLÜMLERİNE ayır. Her bölüm kendi başına bir hikâye parçası " +
  "olmalı — bir olayın başladığı, geliştiği ve sonuçlandığı bir kesit.\n\n" +
  "ÖRNEK BÖLÜMLEME: (1) kaçırılma sahnesi · (2) kafeste mahsur kalma · (3) kaçış planı · " +
  "(4) kurtarılma · (5) intikam.\n\n" +
  "İYİ BÖLÜM:\n" +
  "· Kendi içinde bir OLAY var: bir şey başlıyor ve bitiyor\n" +
  "· Tek başına izlenince anlaşılıyor — izleyici videonun geri kalanını görmedi\n" +
  "· İçinde güçlü an var: tepki, çatışma, sürpriz, kahkaha\n\n" +
  "KÖTÜ BÖLÜM: yalnız yer değişikliği, hazırlık/koordinasyon, konu dışı sohbet.\n\n" +
  "Bölümler ARDIŞIK ve ÇAKIŞMASIZ olmalı, videonun tamamına yayılsın. Her satır bir CÜMLE " +
  "ve başında o parçaya ait sıra numarası var; bölümü basNo-bitNo aralığıyla ver.\n" +
  "baslik: bölümü 2-5 kelimeyle anlat (\"kafes sahnesi\", \"kaçırılma\").\n" +
  "SADECE bu listedeki numaraları kullan. Numara uydurma.";

var SEMA_BOLUM = {
  type: "object", additionalProperties: false, required: ["bolumler"],
  properties: {
    bolumler: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["basNo", "bitNo", "baslik", "puan"],
        properties: {
          basNo: { type: "integer" }, bitNo: { type: "integer" },
          baslik: { type: "string" }, puan: { type: "integer" }
        }
      }
    }
  }
};

/* Bölüm cevabını çözer — numaralandırma korumaları shortsSec ile BİREBİR aynı. */
function _bolumCoz(metin, dilim, sayac) {
  var j = null;
  try { j = JSON.parse(String(metin)); }
  catch (e) {
    var m = String(metin).match(/\{[\s\S]*\}/);
    if (m) { try { j = JSON.parse(m[0]); } catch (e2) { j = null; } }
  }
  if (!j || !j.bolumler || !j.bolumler.length) return [];
  var out = [], i;
  for (i = 0; i < j.bolumler.length; i++) {
    var b = j.bolumler[i];
    var bn = Math.round(Number(b.basNo)), sn = Math.round(Number(b.bitNo));
    if (!isFinite(bn) || !isFinite(sn) || bn < 1 || sn < 1 ||
        bn > dilim.length || sn > dilim.length || sn < bn) { sayac.siraDisi++; continue; }
    out.push({
      bas: dilim[bn - 1].bas, bit: dilim[sn - 1].bit,
      basIdx: bn - 1, bitIdx: sn - 1,
      baslik: String(b.baslik || "").slice(0, 60),
      puan: Math.max(1, Math.min(10, Math.round(Number(b.puan)) || 5))
    });
  }
  out.sort(function (a, b2) { return a.bas - b2.bas; });
  return out;
}

/*
 * Videoyu anlatı bölümlerine ayırır ve HER BÖLÜM İÇİN ayrı bir kesit listesi kurar.
 * Dönüş: { shortslar: [{baslik, kesitler, toplamSure}], ... }
 * Her eleman TEK BİR Shorts sekansına karşılık gelir.
 */
async function coklukSec(VUR, anahtar, gruplar, opts) {
  opts = opts || {};
  var log = opts.onLog || function () {};
  var damga = opts.damga;
  var adet = _sayi(_ayar(opts, "shortsAdet"));
  var sayac = { siraDisi: 0, bolumElenen: 0 };

  var cumleler = cumleleriTopla(VUR, gruplar, opts);
  if (!cumleler.length) return { hata: "Cümle bulunamadı — önce altyazı üret.", shortslar: [] };
  log("Çoklu Shorts: " + cumleler.length + " cümle, " + adet + " bölüm aranıyor.");

  /* ⚠ BÖLÜMLEME TEK İSTEKTE — parçalara bölünürse model videonun TAMAMINI göremez ve
     "anlatı bölümü" kavramı çöker (her parça kendi içinde bölümlenirdi). Bu yüzden
     cümleler seyreltilerek tek dilime sığdırılıyor: bölüm sınırı için kaba çözünürlük
     yeter, kesitler zaten bölüm İÇİNDE ayrıca seçiliyor. */
  var metinSiniri = _sayi(_ayar(opts, "metinSiniri"));
  var kabaDilim = cumleler;
  var KABA_TAVAN = 200;
  if (cumleler.length > KABA_TAVAN) {
    var seyrek = [], adim = cumleler.length / KABA_TAVAN, si;
    for (si = 0; si < KABA_TAVAN; si++) seyrek.push(cumleler[Math.floor(si * adim)]);
    kabaDilim = seyrek;
    log("Çoklu Shorts: " + cumleler.length + " cümle " + KABA_TAVAN + "'e seyreltildi (bölümleme için).");
  }
  var icerik = "Bu videoyu " + adet + " anlatı bölümüne ayır. Her bölüm 30-40 saniyelik bir " +
               "Shorts'a kaynak olacak, yani içinde en az bir dakikalık konuşma bulunsun.\n" +
               "puan: bölümün Shorts potansiyeli, 1-10.\n\n" + _dilimMetni(kabaDilim, metinSiniri);
  var cevap;
  try {
    cevap = await VUR.istekGonder(anahtar, _govde(SISTEM_BOLUM, icerik, opts, SEMA_BOLUM), opts, damga, log);
  } catch (e) {
    if (e && e.iptal) return { hata: "İptal edildi", shortslar: [] };
    return { hata: "Bölümleme alınamadı: " + (e.message || e), shortslar: [] };
  }
  var bolumler = _bolumCoz(cevap, kabaDilim, sayac);
  if (!bolumler.length) {
    return { hata: "Yapay zekâ bölüm bulamadı" +
                   (sayac.siraDisi ? " (" + sayac.siraDisi + " numara aralık dışı)" : "") + ".",
             shortslar: [], sayac: sayac };
  }
  log("Çoklu Shorts: " + bolumler.length + " bölüm bulundu — " +
      bolumler.map(function (b) { return b.baslik; }).join(" · "));

  /* ── HER BÖLÜM İÇİN KENDİ KESİTLERİ ──
     ⚠ Bölüm İÇİNDEKİ cümlelerle çalışılır: bir bölümün Shorts'u başka bölümden kesit
     ALMAMALI, yoksa "parça parça" isteği bozulur ve tekli Shorts'a dönüşür. */
  var shortslar = [], bi;
  for (bi = 0; bi < bolumler.length && shortslar.length < adet; bi++) {
    if (VUR.iptalEdildiMi && VUR.iptalEdildiMi(damga)) return { hata: "İptal edildi", shortslar: [] };
    var b = bolumler[bi];
    var icCumle = cumleler.filter(function (c) { return c.bas >= b.bas && c.bit <= b.bit; });
    if (icCumle.length < 3) { sayac.bolumElenen++; log("Bölüm atlandı (çok az cümle): " + b.baslik); continue; }
    /* Numaralar bölüm içinde YENİDEN verilir (1..N) — parça numaralandırma kuralı. */
    var yerel = icCumle.slice();
    var bIcerik = "Bu bölümün adı: \"" + b.baslik + "\". Buradan " +
                  _sayi(_ayar(opts, "adetMin")) + "-" + _sayi(_ayar(opts, "adetMax")) +
                  " an seç ve puanla; toplam " + _sayi(_ayar(opts, "hedefSure")) +
                  " saniyelik bir Shorts kurulacak (en az " + _sayi(_ayar(opts, "minSure")) + " sn).\n\n" +
                  _dilimMetni(yerel, metinSiniri);
    var bCevap;
    try {
      bCevap = await VUR.istekGonder(anahtar, _govde(SISTEM_FINAL, bIcerik, opts), opts, damga, log);
    } catch (e2) {
      if (e2 && e2.iptal) return { hata: "İptal edildi", shortslar: [] };
      log("Bölüm '" + b.baslik + "' seçimi alınamadı: " + (e2.message || e2));
      continue;
    }
    var adaylar = _cevapCoz(VUR, bCevap, yerel, sayac);
    if (!adaylar.length) { sayac.bolumElenen++; log("Bölüm '" + b.baslik + "' → geçerli aday yok."); continue; }
    var bSay = { cakismaElenen: 0, sureElenen: 0, kisaElenen: 0, uzunElenen: 0 };
    var son = _butceUygula(adaylar, opts, bSay);
    if (!son.kesitler.length) { sayac.bolumElenen++; continue; }
    shortslar.push({
      baslik: b.baslik, kesitler: son.kesitler, toplamSure: son.toplam,
      bolumBas: b.bas, bolumBit: b.bit, puan: b.puan, sayac: bSay
    });
    log("Bölüm " + shortslar.length + "/" + adet + " hazır: " + b.baslik + " · " +
        son.kesitler.length + " kesit · " + son.toplam.toFixed(1) + " sn");
  }
  if (!shortslar.length) return { hata: "Hiçbir bölümden Shorts çıkmadı.", shortslar: [], sayac: sayac };
  return { shortslar: shortslar, sayac: sayac, bolumSay: bolumler.length };
}

/* ══════════════════════ BAŞLIK / HASHTAG / ETİKET ══════════════════════
   Kullanıcı isteği: "o klibe uygun en çok izlenecek başlığı bulacak, emojiyi ve hashtagleri
   ekleyecek, sonra Shorts'a özel etiket üretecek, biz oradan direkt kopyalayabilecez."
   Örnek biçim: EJDERHA Sen KIZLARI ETKİLEDİN !! 😍 #shorts #minecraft */
var SISTEM_BASLIK =
  "Sen YouTube Shorts başlığı yazan bir uzmansın. Türkçe, Minecraft/Roblox içerikleri.\n\n" +
  "Sana bir Shorts'un konuşma metni veriliyor. Üreteceklerin:\n\n" +
  "1) BAŞLIK — tıklanma için yazılmış, MERAK uyandıran, kısa (en fazla 60 karakter).\n" +
  "   · Büyük harf VURGU için kullanılır ama tamamı büyük olmaz\n" +
  "   · Sonunda 1-2 emoji\n" +
  "   · Ünlem serbest (!!)\n" +
  "   · İçeriği ANLATMA, merak uyandır: \"ne olduğunu\" değil \"ne olacağını\" hissettir\n" +
  "   · Örnek biçim: EJDERHA Sen KIZLARI ETKİLEDİN !! 😍\n" +
  "2) HASHTAG — 3-5 tane, #shorts MUTLAKA olsun, oyun adı olsun (#minecraft/#roblox), " +
  "   kalanı içerikle ilgili. Küçük harf, Türkçe karakter YOK.\n" +
  "3) ETIKETLER — YouTube \"tags\" alanı için 12-18 arama terimi. Virgülle ayrılacak, " +
  "   küçük harf. Karışım: oyun adı, içerik türü, karakter adları, arama kalıpları " +
  "   (\"minecraft komik anlar\" gibi). Hashtag işareti KOYMA.\n\n" +
  "Metinde geçen karakter adlarını kullan. Uydurma olay ekleme.";

var SEMA_BASLIK = {
  type: "object", additionalProperties: false,
  required: ["baslik", "hashtagler", "etiketler"],
  properties: {
    baslik: { type: "string" },
    hashtagler: { type: "array", items: { type: "string" } },
    etiketler: { type: "array", items: { type: "string" } }
  }
};

/* Tek bir Shorts için başlık paketi üretir. Ağ hatasında Shorts DÜŞMEZ — başlık boş kalır. */
async function baslikUret(VUR, anahtar, metin, opts) {
  opts = opts || {};
  var icerik = "Bu Shorts'un konuşma metni:\n\n" + String(metin || "").slice(0, 2500);
  var cevap;
  try {
    cevap = await VUR.istekGonder(anahtar, _govde(SISTEM_BASLIK, icerik, opts, SEMA_BASLIK),
                                  opts, opts.damga, opts.onLog || function () {});
  } catch (e) { return { hata: (e && e.message) || String(e) }; }
  var j = null;
  try { j = JSON.parse(String(cevap)); }
  catch (e2) {
    var m = String(cevap).match(/\{[\s\S]*\}/);
    if (m) { try { j = JSON.parse(m[0]); } catch (e3) { j = null; } }
  }
  if (!j || !j.baslik) return { hata: "Başlık çözülemedi" };
  var ht = (j.hashtagler || []).map(function (h) {
    h = String(h).replace(/^#+/, "").trim().toLowerCase();
    return h ? ("#" + h) : "";
  }).filter(Boolean);
  /* ⚠ #shorts GARANTİ — kullanıcının verdiği biçimde var ve YouTube'da Shorts olarak
     sınıflanması için gerekiyor. Model unutursa panel ekler. */
  if (ht.indexOf("#shorts") === -1) ht.unshift("#shorts");
  var et = (j.etiketler || []).map(function (t) {
    return String(t).replace(/^#+/, "").trim().toLowerCase();
  }).filter(Boolean);
  return {
    baslik: String(j.baslik).trim(),
    hashtagler: ht,
    etiketler: et,
    /* Kopyala-yapıştır satırı: başlık + hashtagler (kullanıcının örnek biçimi). */
    tamBaslik: String(j.baslik).trim() + " " + ht.join(" ")
  };
}

module.exports = {
  MODEL: MODEL, VARSAYILAN: VARSAYILAN, SEMA: SEMA,
  shortsSec: shortsSec, coklukSec: coklukSec, baslikUret: baslikUret,
  _bolumCoz: _bolumCoz,
  // test edilebilirlik için iç parçalar
  cumleleriTopla: cumleleriTopla, _cevapCoz: _cevapCoz, _butceUygula: _butceUygula,
  _dilimMetni: _dilimMetni
};
