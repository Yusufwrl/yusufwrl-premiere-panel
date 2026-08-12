/* js/ilerleme.js — İLERLEME + KALAN SÜRE HESABI.  SAF MANTIK: DOM YOK, Premiere YOK.

   NEDEN AYRI DOSYA:
   Panelde "kalan süre" bugüne kadar tek bir yerde vardı (transProgress) ve orada
   `geçen × (100-yüzde)/yüzde` diye ham doğrusal hesaplanıyordu. O formülün iki ölçülmüş
   sorunu var: (a) ilk %2'de payda küçük olduğu için ölçek dışı değerler üretiyor,
   (b) her çağrıda yeniden hesaplandığı için ekrandaki sayı saniyede bir zıplıyor.
   Zıplayan bir "kalan süre", ortalaması doğru olsa bile kullanıcıya "bu panel bilmiyor"
   dedirtiyor — yani doğruluk kadar KARARLILIK da bir gereksinim.

   Emoji/Shorts/altyazı yerleştirmede ise kalan süre HİÇ hesaplanmıyordu: durum satırı
   yalnız "kaç saniyedir bu parçadayız" yazıyordu (geçen süre), kullanıcının sorduğu
   "daha ne kadar sürecek" sorusunun cevabı hiçbir yerde yoktu.

   DOM'DAN AYRI TUTULMASININ SEBEBİ: burası test edilebilir olmalı. Saat DIŞARIDAN
   veriliyor (her fonksiyon `simdi` parametresi alıyor), yani `testler\tumtest.js`
   Premiere'siz ve beklemesiz senaryo koşturabiliyor. Ekrana çizme işi js/app.js'te.

   ⚠ ES5 KAL — panel JS'i CEP'in kendi eski motorunda çalışıyor (let/const/arrow yok). */

(function (disari) {
  "use strict";

  /* ---------- SÜRE BİÇİMİ ----------
     Kullanıcı saniye saymıyor, "ne kadar daha bekleyeceğim" diye bakıyor. Bu yüzden
     birim büyüklüğe göre değişiyor: 90 saniyeyi "90 sn" diye yazmak okunmuyor. */
  function sureMetni(sn) {
    if (sn == null || !isFinite(sn) || sn < 0) return "";
    sn = Math.round(sn);
    if (sn < 60) return sn + " sn";
    var dk = Math.floor(sn / 60), kalanSn = sn % 60;
    /* "2:14" — video süresi gibi okunuyor, birim eklemeye gerek yok. Denenip vazgeçildi:
       "2:14 dk" iki birim işareti taşıdığı için (":" ve "dk") tuhaf okunuyordu. */
    if (dk < 60) return dk + ":" + (kalanSn < 10 ? "0" : "") + kalanSn;
    /* Saat SEVİYESİNDE açık yazılır: "1:05" bir saat beş dakikayı bir dakika beş saniye
       sanmaya çok müsait, ve altyazı üretimi gerçekten saatlerce sürebiliyor. */
    var sa = Math.floor(dk / 60);
    return sa + " sa " + (dk % 60) + " dk";
  }

  /* ---------- TİTREME ÖNLEYİCİ YUVARLAMA ----------
     Kalan süre saniyede bir güncellenirse ekrandaki sayı sürekli oynar ve okunamaz hâle
     gelir. Çözüm süreyi büyüklüğüne göre kabalaştırmak: 3 dakikalık bir işte 5 saniyelik
     bir sapmanın kullanıcı için hiçbir anlamı yok, ama sayının durmadan değişmesinin var.
     ⚠ 10 sn ALTINDA YUVARLAMA YOK — orada her saniye gerçekten anlamlı ("bitmek üzere"). */
  function yuvarlaEta(sn) {
    if (sn == null || !isFinite(sn) || sn < 0) return 0;
    if (sn < 10) return Math.round(sn);
    if (sn < 60) return Math.round(sn / 5) * 5;
    if (sn < 600) return Math.round(sn / 10) * 10;
    return Math.round(sn / 30) * 30;
  }

  /* ---------- SAYAÇ (bir işin ilerlemesi + kalan süresi) ----------
     Kullanım:
       var s = ILER.olustur({ toplam: 172, birim: "emoji", simdi: Date.now() });
       s.ilerle(25, Date.now());            // 25 tanesi bitti
       var d = s.durum(Date.now());         // { yuzde, etaMetin, ... }

     ⚠ `simdi` MİLİSANİYE (Date.now()). Dışarıdan alınmasının tek sebebi test edilebilirlik.

     HIZ NEDEN ÜSTEL ORTALAMA (EWMA):
     Basit "toplam iş / toplam süre" hesabı, işin ortasında hız değişirse geç tepki verir;
     "son parçanın hızı" ise tek bir yavaş parçada ETA'yı üçe katlar. EWMA ikisinin arası:
     yeni ölçüme YUM kadar, birikmiş hıza (1-YUM) kadar ağırlık verir.
     Emoji yerleştirmede bu somut olarak şu demek: ilk parça (proje içine resim import'u
     yüzünden) hep yavaştır ve tek başına ETA'yı şişirir; sonraki parçalar geldikçe tahmin
     kendiliğinden ve yumuşak biçimde doğruya yaklaşır. */
  var YUM = 0.4;

  /* ⚠ EN AZ İKİ ÖRNEK BEKLENİR. Tek örnekle ETA vermek, ilk parçanın kurulum
     maliyetini tüm işe yaymak demek — ölçüldü: emojide ilk parça sonrası tahmin gerçeğin
     ~2 katı çıkıyor. "hesaplanıyor…" demek, yanlış sayı vermekten iyidir. */
  var EN_AZ_ORNEK = 2;
  /* Çok kısa işlerde tek örnek de yeter: iş zaten bitmek üzereyken "hesaplanıyor" yazmak
     saçma olurdu. Eşik: ilk örnekte işin en az %25'i bittiyse tahmine güven. */
  var TEK_ORNEK_ORAN = 0.25;

  function olustur(opt) {
    opt = opt || {};
    var toplam = Math.max(0, Number(opt.toplam) || 0);
    var t0 = Number(opt.simdi) || 0;
    var d = {
      toplam: toplam,
      birim: opt.birim || "",
      biten: 0,
      t0: t0,
      sonT: t0,
      hiz: 0,          // birim / saniye
      ornek: 0,
      bitti: false
    };

    /* Biten sayısı GERİ GİDEMEZ ve toplamı AŞAMAZ. İkisi de gerçek bir kaynaktan
       geliyor (host'un döndürdüğü "ok:N/M"); bozuk bir cevap ETA'yı negatife çevirip
       "-3:12 kaldı" yazdırabilirdi. */
    function ilerle(biten, simdi) {
      simdi = Number(simdi) || d.sonT;
      biten = Math.max(0, Number(biten) || 0);
      if (d.toplam > 0) biten = Math.min(biten, d.toplam);
      if (biten <= d.biten) { d.sonT = Math.max(d.sonT, simdi); return; }

      var dIs = biten - d.biten;
      var dSn = (simdi - d.sonT) / 1000;
      d.biten = biten;
      d.sonT = simdi;

      /* dSn <= 0 olabilir (aynı milisaniyede iki güncelleme, ya da test). Hız hesabına
         katmıyoruz — sıfıra bölme ve sonsuz hız üretirdi — ama biten sayısı yine işlendi. */
      if (dSn <= 0) return;

      var anlik = dIs / dSn;
      if (!isFinite(anlik) || anlik <= 0) return;
      d.hiz = (d.ornek === 0) ? anlik : (YUM * anlik + (1 - YUM) * d.hiz);
      d.ornek++;
    }

    function bitir(simdi) {
      d.bitti = true;
      if (d.toplam > 0) d.biten = d.toplam;
      d.sonT = Number(simdi) || d.sonT;
    }

    function durum(simdi) {
      simdi = Number(simdi) || d.sonT;
      var gecen = Math.max(0, (simdi - d.t0) / 1000);
      var kalanIs = d.toplam > 0 ? Math.max(0, d.toplam - d.biten) : -1;
      var yuzde = d.toplam > 0 ? (d.biten / d.toplam) * 100 : -1;
      if (d.bitti) yuzde = 100;

      /* ETA yalnız yeterli örnek varken. `guvenilir` dışarı veriliyor ki panel
         "hesaplanıyor…" ile gerçek tahmini AYIRT EDEBİLSİN — ikisini aynı göstermek
         kullanıcıyı ilk saniyelerde yanlış bir sayıya bağlar. */
      var yeterli = d.ornek >= EN_AZ_ORNEK ||
                    (d.ornek >= 1 && d.toplam > 0 && d.biten / d.toplam >= TEK_ORNEK_ORAN);
      var etaSn = -1;
      if (!d.bitti && yeterli && d.hiz > 0 && kalanIs > 0) etaSn = yuvarlaEta(kalanIs / d.hiz);

      return {
        yuzde: yuzde,
        biten: d.biten,
        toplam: d.toplam,
        kalanIs: kalanIs,
        gecen: gecen,
        gecenMetin: sureMetni(gecen),
        hiz: d.hiz,
        etaSn: etaSn,
        etaMetin: etaSn >= 0 ? sureMetni(etaSn) : "",
        guvenilir: !!yeterli,
        bitti: d.bitti,
        /* Sayaç metni tek yerde üretiliyor: "107 / 172 emoji". Panelin dört ayrı
           ekranında dört farklı biçimde yazılıyordu. */
        sayacMetin: d.toplam > 0
          ? (d.biten + " / " + d.toplam + (d.birim ? " " + d.birim : ""))
          : (d.biten + (d.birim ? " " + d.birim : ""))
      };
    }

    return { ilerle: ilerle, bitir: bitir, durum: durum };
  }

  /* ---------- AŞAMA LİSTESİ ----------
     Kullanıcının isteği: "şu şu oldu bu bu oldu değil, düzgün bir tasarımla alt alta".
     Bu yüzden uzun işler artık ADIMLARIYLA gösteriliyor; her adımın kendi durumu var.
     Buradaki model saf veri — çizimi app.js yapıyor.

     ⚠ DURUMLAR: "bekliyor" · "calisiyor" · "bitti" · "atlandi" · "hata"
     "atlandi" ŞART: kullanıcı Shorts'ta "Emoji de koy" kutusunu kapatabiliyor. O adımı
     listeden hiç çıkarmak yanlış olurdu — kullanıcı emojinin neden gelmediğini görmeli;
     "bitti" göstermek ise düpedüz yalan. */
  function asamalar(liste) {
    var a = [], i;
    for (i = 0; i < (liste || []).length; i++) {
      var g = liste[i];
      a.push({
        ad: (typeof g === "string") ? g : (g && g.ad) || "",
        durum: "bekliyor",
        not: "",
        /* ⚠ -1 = "hiç başlamadı", 0 DEĞİL. Başlangıç 0 iken kontrol `if (a.t0 && simdi)`
           biçimindeydi ve t0 gerçekten 0 olduğunda (saatin sıfır noktası) adım süresi
           hesaplanmıyordu. Panelde Date.now() asla 0 olmadığı için görünmezdi ama nöbetçi
           testi bunu ilk koşuda yakaladı — "doğruluk saatin değerine bağlı olmamalı". */
        t0: -1,
        sure: 0
      });
    }
    var aktif = -1;

    function _bul(x) {
      if (typeof x === "number") return (x >= 0 && x < a.length) ? x : -1;
      for (var i2 = 0; i2 < a.length; i2++) if (a[i2].ad === x) return i2;
      return -1;
    }
    /* Bir adım başlatılınca önceki ÇALIŞAN adım kendiliğinden "bitti" sayılır.
       Sebep: çağıran her adımı ayrıca kapatmak zorunda kalırsa bir dalda unutulur ve
       listede sonsuza kadar dönen bir spinner kalır — panelde "takıldı mı?" izlenimi
       veren tam olarak budur. */
    function basla(x, simdi) {
      var i3 = _bul(x); if (i3 < 0) return;
      if (aktif >= 0 && a[aktif].durum === "calisiyor") bitir(aktif, "", simdi);
      a[i3].durum = "calisiyor";
      var t = Number(simdi);
      a[i3].t0 = isFinite(t) ? t : -1;
      aktif = i3;
    }
    function bitir(x, not, simdi) {
      var i4 = _bul(x); if (i4 < 0) return;
      a[i4].durum = "bitti";
      if (not) a[i4].not = not;
      /* ⚠ `>= 0` ve isFinite — truthy kontrolü DEĞİL (bkz. t0 alanındaki not). */
      var ts = Number(simdi);
      if (a[i4].t0 >= 0 && isFinite(ts)) a[i4].sure = Math.max(0, (ts - a[i4].t0) / 1000);
      if (aktif === i4) aktif = -1;
    }
    function atla(x, not) {
      var i5 = _bul(x); if (i5 < 0) return;
      a[i5].durum = "atlandi"; a[i5].not = not || "";
      if (aktif === i5) aktif = -1;
    }
    function hata(x, not) {
      var i6 = _bul(x); if (i6 < 0) return;
      a[i6].durum = "hata"; a[i6].not = not || "";
      if (aktif === i6) aktif = -1;
    }
    function not(x, metin) {
      var i7 = _bul(x); if (i7 < 0) return;
      a[i7].not = metin || "";
    }
    /* Kalan adımları kapat: iş hata ile bittiğinde geride "bekliyor" durumunda adımlar
       kalıyor ve kullanıcı hâlâ bir şey olacak sanıyor. */
    /* ⚠ NOT VERİLMEDİYSE "yapılmadı" UYDURMA. Eski hâl `metin || "yapılmadı"` idi ve çağıran
       boş dizge geçtiğinde (başarıyla biten iş) adımın yanına "yapılmadı" yazıyordu —
       gerçekte yapılmış bir işi yapılmamış göstermenin ikinci yolu. Not YALNIZCA açıkça
       verilirse yazılır; zaten var olan bir not da EZİLMEZ. */
    function kalanlariIptal(metin) {
      for (var i8 = 0; i8 < a.length; i8++)
        if (a[i8].durum === "bekliyor" || a[i8].durum === "calisiyor") {
          a[i8].durum = "atlandi";
          if (metin) a[i8].not = metin;
        }
      aktif = -1;
    }
    function liste2() {
      var k = [], i9;
      for (i9 = 0; i9 < a.length; i9++)
        k.push({ ad: a[i9].ad, durum: a[i9].durum, not: a[i9].not, sure: a[i9].sure });
      return k;
    }
    /* Aşama bazlı KABA yüzde: sayaçtan bağımsız işlerde (Shorts kurulumu gibi) ilerleme
       çubuğunun yine de dolması için. Çalışan adım yarım sayılır — ilerleme çubuğunun
       adım boyunca tamamen durması "dondu" hissi veriyordu. */
    function yuzde() {
      if (!a.length) return -1;
      var p = 0, iA;
      for (iA = 0; iA < a.length; iA++) {
        if (a[iA].durum === "bitti" || a[iA].durum === "atlandi") p += 1;
        else if (a[iA].durum === "calisiyor") p += 0.5;
      }
      return (p / a.length) * 100;
    }
    return {
      basla: basla, bitir: bitir, atla: atla, hata: hata, not: not,
      kalanlariIptal: kalanlariIptal, liste: liste2, yuzde: yuzde
    };
  }

  var API = {
    olustur: olustur,
    asamalar: asamalar,
    sureMetni: sureMetni,
    yuvarlaEta: yuvarlaEta,
    _YUM: YUM,
    _EN_AZ_ORNEK: EN_AZ_ORNEK
  };

  /* Hem require() (panel + testler) hem doğrudan <script> ile çalışsın. */
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (disari) disari.ILER = API;
})(typeof window !== "undefined" ? window : null);
