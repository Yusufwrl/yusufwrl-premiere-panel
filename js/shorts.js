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
  /* ⚠ SÜRE KURALI SERT (kullanıcı isteği, 12 Ağustos 2026: "en az 27 saniye en fazla 45
     saniye kuralı getir, daha kısa ya da daha uzun Shorts istemiyorum").
     ÖNCEKİ: hedef 35 · min 28 · max 42 — ve min YUMUŞAK bir hedefti: kod ona ulaşmaya
     çalışıyor, ulaşamazsa kısa Shorts'u YİNE DE üretiyordu. Kullanıcının "yine kısa olmuş"
     şikâyetinin sebebi buydu. Artık min de SERT: altında kalan bölüm Shorts'a çevrilmiyor,
     sıradaki yedek bölüme geçiliyor (bkz. coklukSec). */
  hedefSure: 36,        // 27-45 aralığının ortası
  minSure: 27,          // SERT ALT SINIR — altında Shorts üretilmez
  maxSure: 45,          // SERT ÜST SINIR — hiçbir zaman aşılmaz
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
  "GÖREV: bunlardan 27-45 saniyelik (ideal 36 sn) bir Shorts kurmak. Anlar arka arkaya eklenecek.\n\n" +
  "SHORTS'UN GERÇEĞİ — puanlarken bunları düşün:\n" +
  "1. İzleyici videoyu GÖRMEDİ ve tanımıyor. Her an kendi başına anlaşılmalı.\n" +
  "2. İlk 2 saniyede kaçıyor. EN GÜÇLÜ an, listedeki en yüksek puanı almalı — panel onu " +
  "   zaman sırasına dizecek ama puan neyin taşıdığını belirler.\n" +
  "3. Ses tek başına taşımalı: görüntüyü anlatan değil, DUYGUSU olan anlar kazanır.\n" +
  "4. Çeşitlilik: hepsi aynı kişiden veya aynı tipten olmasın. Farklı karakterlerin " +
  "   birbirine tepki verdiği anlar en iyisidir.\n" +
  "5. Bir an tek başına komik/şaşırtıcı değilse, ne kadar önemli olursa olsun ALMA.\n" +
  /* ⚠ SOMUT OLUMSUZ ÖRNEKLER (kullanıcı isteği, 12 Ağustos 2026: "sahneleri daha akıllıca
     seçsin, daha izlenilebilecek olanları almalı"). Emoji isteminde ölçülmüştü: modele
     "iyi an seç" demek yetmiyor, NEYİ ALMAYACAĞINI söylemek seçimi belirgin düzeltiyor.
     Bu maddeler kullanıcının şikâyet ettiği tipteki anları adıyla eliyor. */
  "5b. ŞUNLARI ALMA — Shorts'ta izleyici kaçar:\n" +
  "   · Hazırlık/kurulum konuşması: “şimdi şunu yapacağız”, “bekle”, “bir saniye”, “geldim”\n" +
  "   · Oyun mekaniği anlatımı, envanter/eşya sayma, koordinat okuma\n" +
  "   · Tek kişinin kesintisiz uzun anlatımı — tepki veren kimse yoksa düz kalır\n" +
  "   · Bağlam gerektiren şaka: önceki 5 dakikayı bilmeyen anlamıyorsa ALMA\n" +
  "   · Sessizlik/dolgu: “eee”, “hı”, “tamam tamam” gibi içeriksiz alışverişler\n" +
  "6b. ŞUNLARI TERCİH ET — izlenirliği yüksek:\n" +
  "   · Beklenmedik dönüş: biri bir şey yapar, öteki şaşırır/bağırır/güler\n" +
  "   · Kısa atışma, laf sokma, karşılıklı tepki (en az iki farklı karakter konuşur)\n" +
  "   · Bir şeyin ters gitmesi: ölüm, kayıp, patlama, plan bozulması — ve ARDINDAN gelen tepki\n" +
  "   · Kendi başına anlaşılan tek cümlelik vurucu replikler\n" +
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

  /* ⚠ 4. GEÇİŞ — EN KISA KESİT SINIRINI GEVŞET (kullanıcı, 12 Ağustos 2026: "çoklu Shorts'ta
     30-40 saniye olmuyor, 2 tanesi 18 saniye çıktı").
     3. geçiş yalnız ADET tavanını gevşetiyordu; ama asıl darboğaz oradaki değil `kesitMin`
     (4 sn) idi. Çoklu Shorts'ta her sekans TEK BİR anlatı bölümünden kuruluyor ve bir bölüm
     kısa atışmalardan oluşuyorsa adayların çoğu 2-3 saniyelik oluyor, `kisaElenen`e düşüyor
     ve elde 18 saniye kalıyordu — adet tavanını gevşetmek işe yaramıyor çünkü alınacak
     aday zaten elenmiş durumda.
     ⚠ TABAN 2.5 sn: bunun altı "an" değil kırpıntı, üst üste dizilince Shorts zıplıyor.
     ⚠ SIRA ÖNEMLİ — bu geçiş EN SONDA: normal koşulda hiç çalışmıyor, yani bölümde yeterli
     uzun aday varsa seçim BİREBİR eskisi gibi. Yalnız hedefe ulaşılamadığında devreye giriyor.
     ⚠ `maxSure` HÂLÂ SERT: Shorts asla 42 sn'yi aşmaz, bu geçiş yalnız ALT sınırı kurtarıyor. */
  if (toplam < minSure && kesitMin > 2.5) {
    var eskiKesitMin = kesitMin;
    kesitMin = 2.5;
    for (i = 0; i < sirali.length && toplam < minSure; i++) {
      if (secili.indexOf(sirali[i]) === -1) dene(sirali[i], false, false);
    }
    if (toplam > 0 && kesitMin !== eskiKesitMin) sayac.kesitMinGevsetildi = eskiKesitMin + "→" + kesitMin;
  }
  /* Hedefe YİNE ulaşılamadıysa SESSİZ KALMA: bölümde yeterli malzeme yok demektir ve
     kullanıcı kısa Shorts'un sebebini bilmeli (yoksa panelde hata arar). */
  sayac.hedefTutmadi = (toplam < minSure) ? Number(toplam.toFixed(1)) : 0;
  /* ⚠ SERT ALT SINIR BAYRAĞI. Çağıran (coklukSec) buna bakıp bölümü tümden atıyor ve
     sıradaki YEDEK bölüme geçiyor — kullanıcı 27 sn altını istemiyor.
     Karar burada VERİLMİYOR, yalnız bildiriliyor: tekli Shorts'ta atmak "hiç Shorts yok"
     demek olurdu ve orada doğru davranış üretip UYARMAK. */
  sayac.altSinirAltinda = (toplam < minSure);

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
  /* ⚠⚠ YEDEK BÖLÜM İSTE — "kaç tane seçtiysem o kadar olsun" (kullanıcı, 12 Ağustos 2026:
     3 seçti, 2 Shorts çıktı).
     Eskiden modelden TAM `adet` bölüm isteniyordu ve bir bölümden geçerli kesit çıkmazsa
     (`bolumElenen`) o slot telafisiz kayboluyordu — 3 istenip 2 üretiliyordu. Model tek
     istekte fazladan bölüm vermek için ek ücret istemiyor; döngü zaten `shortslar.length <
     adet` şartıyla duruyor, yani fazlalar KULLANILMIYOR, yalnız yedek duruyorlar.
     ⚠ YEDEK SAYISI ILIMLI (+2): bölüm sayısı arttıkça her bölüm KISALIYOR ve içinden
     30-40 sn çıkarmak zorlaşıyor. +2, "bir-iki bölüm düşerse kurtar" için yeterli; daha
     fazlası asıl sorunu (kısa bölüm) büyütürdü. */
  var istemAdet = adet + 2;
  var sayac = { siraDisi: 0, bolumElenen: 0, istenenAdet: adet };

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
  /* İstenen `adet` değil `istemAdet` — fazlası YEDEK (bkz. yukarıdaki not). Modele de
     hangisinin asıl olduğu söyleniyor ki en güçlü bölümleri öne koysun. */
  var icerik = "Bu videoyu " + istemAdet + " anlatı bölümüne ayır (en güçlü " + adet +
               " tanesi kullanılacak, kalanı yedek). Her bölüm 27-45 saniyelik bir " +
               "Shorts'a kaynak olacak, yani içinde en az bir dakikalık konuşma bulunsun.\n" +
               "puan: bölümün Shorts potansiyeli, 1-10. En güçlü bölümlere en yüksek puanı ver.\n\n" +
               _dilimMetni(kabaDilim, metinSiniri);
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
    var bSay = { cakismaElenen: 0, sureElenen: 0, kisaElenen: 0, uzunElenen: 0, altSinirAltinda: false };
    var son = _butceUygula(adaylar, opts, bSay);
    if (!son.kesitler.length) { sayac.bolumElenen++; continue; }
    /* ⚠⚠ SERT ALT SINIR — 27 sn'nin altındaki bölüm SHORTS'A ÇEVRİLMEZ (kullanıcı isteği,
       12 Ağustos 2026: "daha kısa Shorts istemiyorum").
       Bölüm atlanıyor ve döngü sıradaki YEDEK bölüme geçiyor; bu yüzden modelden `adet + 2`
       bölüm isteniyor (yukarıdaki nota bak). Yedekler de yetmezse panel eksik üretimi
       sonuç mesajında AÇIKÇA söylüyor — sessizce kısa Shorts vermektense az Shorts vermek
       kullanıcının açık tercihi. */
    if (bSay.altSinirAltinda) {
      sayac.kisaElendi = (sayac.kisaElendi || 0) + 1;
      log("Bölüm '" + b.baslik + "' ATLANDI: yalnız " + son.toplam.toFixed(1) +
          " sn çıktı, alt sınır " + _sayi(_ayar(opts, "minSure")) + " sn.");
      continue;
    }
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
/* ⚠ BAŞLIK İSTEMİ KULLANICI GERİ BİLDİRİMİYLE İKİ KEZ SIKILAŞTIRILDI (11 Ağustos 2026).
   İlk sürüm "merak uyandır, 60 karakter" diyordu ve şu çıktı geldi:
       "Yetimhaneden KAÇIYORUZ !! Kimse Bizi Sahiplenmedi 😢"
   Kullanıcı reddetti: "yetimhaneden kaçıyoruz değil de böyle daha ilgi çekici şeyler olmalı".
   Sorun ölçülebilir: (a) olayı ANLATIYOR, merak bırakmıyor · (b) 50 karakter, iki satıra
   taşıyor · (c) izleyiciye seslenmiyor.
   Kullanıcının verdiği ÖRNEK bunların üçünü de çözüyor:
       EJDERHA Sen KIZLARI ETKİLEDİN !! 😍     (35 karakter, "Sen" var, sonucu ima ediyor)
   Aşağıdaki kurallar o örnekten TÜRETİLDİ — gevşetirken bu tarihçeyi oku. */
var SISTEM_BASLIK =
  "Sen YouTube Shorts başlığı yazan bir uzmansın. Türkçe, Minecraft/Roblox içerikleri, " +
  "hedef kitle 8-14 yaş.\n\n" +
  "Sana bir Shorts'un konuşma metni veriliyor.\n\n" +
  "═══ ZORUNLU KURALLAR ═══\n" +
  "1. EN FAZLA 42 KARAKTER (emoji dahil). Tek satıra sığmalı.\n" +
  "2. 1-2 kelime TAMAMEN BÜYÜK HARF (vurgu). Tamamı büyük OLMASIN.\n" +
  "3. Sonunda TEK emoji.\n" +
  "4. OLAYI ANLATMA — SONUCU İMA ET. İzleyici \"ne olmuş?\" diye merak edip tıklamalı.\n" +
  "5. \"!!\" kullanabilirsin.\n\n" +
  "═══ KALIPLAR — İÇERİĞE EN UYGUN OLANI SEÇ ═══\n" +
  "⚠ Bunlar SEÇENEK, hepsini uygulama. Her başlık aynı kalıpta olursa hepsi birbirine benzer " +
  "ve sıradanlaşır. İçerik hangisine uyuyorsa ONU kullan:\n\n" +
  "A) İzleyiciye seslenme:  Sana TUZAK Kurdular ve KAÇAMADIN 😱\n" +
  "B) Soru:                 Bu KAFESTEN Nasıl Kaçtık ?! 🔓\n" +
  "C) Şok/sonuç ima:        KİMSE Bunu Beklemiyordu 😳\n" +
  "D) Karakterle:           Moni'yi POLİSE Verdiler !! 🚔\n" +
  "E) Abartı:               EN KÖTÜ Gün Bu Oldu 💀\n" +
  "F) Çatışma:              Beni SUÇLADILAR ama Masumum 😤\n" +
  "G) Meydan okuma:         Bunu Yapabilene AŞK OLSUN 🔥\n\n" +
  "⚠ \"Sen/Sana/Senin\" ZORUNLU DEĞİL — yalnız A kalıbında var. İçerik ikinci şahsa uymuyorsa " +
  "KULLANMA; olayı karakter adıyla ya da soruyla anlatmak çoğu zaman daha iyi.\n\n" +
  "═══ KÖTÜ ÖRNEKLER (ve nedeni) ═══\n" +
  "  \"Yetimhaneden Kaçıyoruz Kimse Bizi Sahiplenmedi\" → olayı anlatıyor, merak bırakmıyor, çok uzun\n" +
  "  \"Minecraft'ta Ev Yaptık\" → hiçbir merak yok\n" +
  "  \"ÇOK KOMİK ANLAR\" → içerikle ilgisi yok, herkes yazıyor\n" +
  "  Hepsi \"Sana ...\" / \"Seni ...\" diye başlayan başlıklar → tek kalıba sıkışmış, sıradan\n\n" +
  "═══ OYUN ═══\n" +
  "Metne bakıp oyunu belirle: \"minecraft\" mı \"roblox\" mu. Emin değilsen \"minecraft\" yaz.\n\n" +
  "═══ ETİKETLER ═══\n" +
  "YouTube \"tags\" alanı için 12-18 arama terimi. Küçük harf, hashtag işareti YOK. " +
  "Karışım: oyun adı, içerik türü, karakter adları, gerçek arama kalıpları " +
  "(\"minecraft komik anlar\", \"minecraft türkçe\" gibi).\n\n" +
  "Metinde geçen karakter adlarını kullanabilirsin. Uydurma olay EKLEME.";

var SEMA_BASLIK = {
  type: "object", additionalProperties: false,
  required: ["baslik", "oyun", "etiketler"],
  properties: {
    baslik: { type: "string" },
    /* ⚠ HASHTAG MODELDEN İSTENMİYOR — kullanıcı isteği: "hashtagde sadece #shorts ve
       #minecraft yazsın, onlara başka yazmaya gerek yok". Model serbest bırakılınca
       #yetimhane #dostluk #sahiplenme gibi kimsenin aramadığı etiketler ekliyor ve
       başlık satırı ikiye taşıyordu. Panel yalnız oyunu soruyor, hashtag'i KENDİ kuruyor. */
    oyun: { type: "string" },
    etiketler: { type: "array", items: { type: "string" } }
  }
};

/* Tek bir Shorts için başlık paketi üretir. Ağ hatasında Shorts DÜŞMEZ — başlık boş kalır. */
async function baslikUret(VUR, anahtar, metin, opts) {
  opts = opts || {};
  var icerik = "Bu Shorts'un konuşma metni:\n\n" + String(metin || "").slice(0, 2500);
  /* ⚠ ÖNCEKİ BAŞLIKLAR MODELE GÖSTERİLİR — ÇOKLU SHORTS'TA ŞART.
     Her başlık AYRI istekle üretiliyor, yani model ötekileri görmüyor ve aynı kalıba
     düşüyor (kullanıcı bildirdi: "tüm başlıkları sana/seni bilmem ne diye yapmış").
     Önceki başlıkları göstermek tek etkili çözüm — istemdeki "kalıp seç" kuralı tek başına
     yetmiyor, çünkü model her seferinde aynı en-olası kalıbı seçiyor. */
  var onceki = (opts.oncekiBasliklar || []).filter(Boolean);
  if (onceki.length) {
    icerik += "\n\n⚠ Bu videodan ÜRETİLMİŞ başlıklar (aynı kalıbı TEKRARLAMA, farklı bir " +
              "kalıp seç):\n" + onceki.map(function (b) { return "  - " + b; }).join("\n");
  }
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
  return _baslikCoz(j);
}

/* Model cevabını panel kurallarına göre çözer — AĞ YOK, test edilebilir. */
function _baslikCoz(j) {
  if (!j || !j.baslik) return { hata: "Başlık çözülemedi" };

  /* ⚠ HASHTAG PANELDE KURULUR, MODELDEN GELMEZ (kullanıcı isteği: "sadece #shorts ve
     #minecraft yazsın"). Model yalnız oyunu söylüyor; serbest bırakılınca kimsenin
     aramadığı etiketler ekleyip başlığı ikinci satıra taşıyordu. */
  var oyun = String(j.oyun || "").toLowerCase().replace(/[^a-z]/g, "");
  if (oyun !== "roblox") oyun = "minecraft";        // emin değilse minecraft (kullanıcının ana oyunu)
  var ht = ["#shorts", "#" + oyun];

  var baslik = String(j.baslik).trim();
  /* ⚠ UZUNLUK FRENİ PANELDE — istemde "en fazla 42 karakter" yazıyor ama model bunu
     aşabiliyor ve uzun başlık kutuda ikinci satıra taşıyor (kullanıcı bildirdi).
     Kesmek yerine SAYIYI döndürüyoruz: kesmek cümlenin ortasında bırakır ve emojiyi yer;
     panel uzunluğu gösterip kullanıcıya kararı bırakıyor. */
  var uzun = baslik.length > 42;

  var et = (j.etiketler || []).map(function (t) {
    return String(t).replace(/^#+/, "").trim().toLowerCase();
  }).filter(Boolean);
  return {
    baslik: baslik,
    oyun: oyun,
    hashtagler: ht,
    etiketler: et,
    uzun: uzun,
    /* Kopyala-yapıştır satırı: başlık + iki hashtag (kullanıcının örnek biçimi). */
    tamBaslik: baslik + " " + ht.join(" ")
  };
}

module.exports = {
  MODEL: MODEL, VARSAYILAN: VARSAYILAN, SEMA: SEMA,
  shortsSec: shortsSec, coklukSec: coklukSec, baslikUret: baslikUret,
  _bolumCoz: _bolumCoz, _baslikCoz: _baslikCoz, SISTEM_BASLIK: SISTEM_BASLIK,
  // test edilebilirlik için iç parçalar
  cumleleriTopla: cumleleriTopla, _cevapCoz: _cevapCoz, _butceUygula: _butceUygula,
  _dilimMetni: _dilimMetni
};
