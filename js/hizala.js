/*
 * Otomatik ses hizalama — iki kaydın arasındaki gecikmeyi (offset) bulur.
 *
 * NEDEN ZARF: 40 dakikalık 16 kHz ses = 38 milyon örnek; ham örnek üzerinden çapraz korelasyon
 * pratik değil. Bunun yerine ses PENCERE PENCERE enerjiye (RMS) indirgenir — 20 ms pencerede
 * 50 Hz'lik bir "konuşma ritmi" sinyali kalır. Kim ne zaman konuştu deseni korunduğu için
 * hizalama bozulmaz, veri 300 kat küçülür.
 *
 * NEDEN KODEK FARKI SORUN DEĞİL: OBS ham kayıt, Craig ise Opus/AAC sıkıştırılmış. Dalga biçimleri
 * birebir aynı değil ama konuşma-sessizlik ritmi aynı; zarf tam da onu ölçüyor.
 *
 * İKİ AŞAMA: önce 200 ms pencereyle geniş tarama (kaba konum), sonra 20 ms pencereyle o konumun
 * ±0.4 sn çevresinde ince ayar. Tek aşamada 20 ms ile geniş taramak gereksiz yere yavaş olurdu.
 *
 * GÜVEN SKORU: kaba aşamanın Pearson korelasyonu (r) — 0..1. Yanına ikincil gösterge olarak
 * z-skoru (tepe, diğer denemelerin ortalamasından kaç standart sapma yukarıda) hesaplanır.
 * DİKKAT: r tek başına doğru/yanlış eşleşmeyi ayıramaz (bkz. tutarlilikKontrol yorumu);
 * asıl karar dosyaların birbirini doğrulamasıyla verilir.
 *
 * EŞLEŞME YOKSA SAYI ÜRETİLMEZ: sessiz kayıt / alakasız dosya / arama sınırında biten tepe
 * durumlarında offsetBul HATA FIRLATIR (e.hizalamaHatasi = true). Eskiden bu durumlar geçerli
 * görünen bir sayı (ör. "+180.40 sn") olarak geri dönüyor, panel de onu timeline'a uyguluyordu.
 * Yanlış hizalama tüm videoda ses/altyazı kayması demek, sessizce geçilmemeli.
 */
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

var ORNEK_HZ = 8000;   // zarf için fazlasıyla yeterli; decode süresini yarıya indirir

// Ses dosyasını (m4a/flac/wav farketmez) geçici 8 kHz mono WAV'a çevirir
function _decode(ffmpegExe, girdi, cikti, maxSaniye) {
  return new Promise(function (resolve, reject) {
    var args = ["-hide_banner", "-loglevel", "error", "-i", girdi];
    if (maxSaniye > 0) args.push("-t", String(maxSaniye));
    /* -map_metadata -1: kaynak dosyanın etiketleri (comment/title/artist…) çıktı WAV'ına
       LIST/INFO chunk'ı olarak kopyalanmasın. Etiket metninde "data" geçtiğinde _zarf'ın
       chunk taraması yanılıyordu; artık _zarf chunk'ları düzgün yürüyor ama etiketi hiç
       taşımamak hem daha hızlı hem de ikinci bir güvenlik katmanı. */
    args.push("-map_metadata", "-1");
    args.push("-ac", "1", "-ar", String(ORNEK_HZ), "-c:a", "pcm_s16le", "-y", cikti);
    execFile(ffmpegExe, args, { cwd: path.dirname(ffmpegExe), maxBuffer: 8 * 1024 * 1024 }, function (err) {
      if (err) reject(new Error("Ses çözülemedi: " + path.basename(girdi)));
      else resolve(cikti);
    });
  });
}

// 16-bit mono WAV -> pencere başına RMS dizisi
function _zarf(wavYolu, pencereMs) {
  var buf = fs.readFileSync(wavYolu);
  /* WAV chunk'larını DÜZGÜN yürü (eskiden 12. bayttan itibaren ham bayt dizisinde "data"
     harfleri aranıyordu). ffmpeg kaynak dosyanın etiketlerini "data"dan ÖNCE gelen bir
     LIST/INFO chunk'ına yazıyor; etiket metninde "data" geçerse tarama ses verisinin
     başlangıcını yanlış buluyordu. Kayma TEK baytsa 16-bit örnekler yarım bayt kayıp tüm
     dalga biçimi çöpe dönüyordu (ölçüldü: aynı dosya kendisiyle 0.00 yerine 20.30 sn kaymış
     çıkıyordu). Örnek sayısı da artık dosya boyutundan değil data chunk'ının kendi
     uzunluğundan hesaplanıyor — sondaki chunk'lar örnek sanılmıyor. */
  var hz = 0, veri = -1, uzunluk = 0, o = 12;
  while (o + 8 <= buf.length) {
    var id = buf.toString("ascii", o, o + 4);
    var sz = buf.readUInt32LE(o + 4);
    // fmt gövdesi: +0 biçim, +2 kanal, +4 örnekleme hızı. Yarım kalmış dosyada readUInt32LE
    // aralık dışı hata fırlatıp "hizalanamadı" yerine ham bir JS hatası verirdi — sınırı kontrol et.
    if (id === "fmt " && o + 16 <= buf.length) hz = buf.readUInt32LE(o + 12);
    else if (id === "data") { veri = o + 8; uzunluk = sz; break; }
    o += 8 + sz + (sz % 2);                                // chunk'lar çift bayta hizalanır
  }
  if (veri < 0) { veri = 44; uzunluk = buf.length - 44; }   // başlık okunamadı: eski varsayılana dön
  if (uzunluk <= 0 || veri + uzunluk > buf.length) uzunluk = Math.max(0, buf.length - veri);
  if (!hz) hz = ORNEK_HZ;
  var pencere = Math.max(1, Math.round(hz * pencereMs / 1000));
  var n = Math.floor(uzunluk / 2);
  var adet = Math.floor(n / pencere);
  var out = new Float64Array(adet);
  for (var w = 0; w < adet; w++) {
    var toplam = 0, bas = veri + w * pencere * 2;
    for (var j = 0; j < pencere; j++) { var s = buf.readInt16LE(bas + j * 2); toplam += s * s; }
    out[w] = Math.sqrt(toplam / pencere);
  }
  return out;
}

/* Ortalamayı çıkar — iki kaydın ses seviyesi farkı korelasyonu bozmasın.
   NOT: _enIyiKayma artık ortalamayı ÖRTÜŞEN bölgeden ayrıca çıkarıyor, yani bu adım
   matematiksel olarak gereksiz. Yine de duruyor: sayıları 0 çevresine indirdiği için
   Pearson formülündeki büyük kare toplamlarında duyarlılık kaybını azaltıyor. */
function _merkezle(a) {
  var ort = 0, i;
  for (i = 0; i < a.length; i++) ort += a[i];
  ort /= (a.length || 1);
  var o = new Float64Array(a.length);
  for (i = 0; i < a.length; i++) o[i] = a[i] - ort;
  return o;
}

/* b dizisi a'ya göre kaç pencere kaymış?
   Skor olarak NORMALİZE KORELASYON (Pearson r, -1..1) kullanılır — ham çarpım toplamı değil.
   Sebep ölçüldü: ham skorun z-değeri kaydın UZUNLUĞUNA bağlı çıkıyor; 60 saniyelik DOĞRU bir
   eşleşme (z=2.6) ile 150 saniyelik YANLIŞ bir eşleşme (z=3.4) ayırt edilemiyordu.
   Pearson r uzunluktan bağımsız ve doğrudan yorumlanabilir: doğru eşleşme ~0.5+, yanlış ~0.1.

   ÖRTÜŞME KURALI (kısa kayıtlarda hayati): her kayma denemesi farklı UZUNLUKTA bir örtüşme
   bölgesi bırakır, ama r'ler doğrudan karşılaştırılıyor. Kısa örtüşmenin r'si şişer —
   30 örneklik rastgele gürültü bile r=0.6 verebiliyorken karışık kanaldaki DOĞRU eşleşme
   r=0.37'de kalıyor. Eski eşik (sabit 30 pencere = 6 saniye) buna izin veriyordu ve ölçüldü:
   60 sn'lik bir kayıtta gerçek kayma +2.00 iken sonuç -53.76 sn ve "güven: yuksek" çıkıyordu.
   Artık örtüşme, kısa dizinin en az %60'ı olmak zorunda.

   ORTALAMA ÖRTÜŞMEDEN ÇIKARILIR: eski kod ortalamayı tüm zarftan çıkarıp (bkz. _merkezle)
   kısa örtüşmelerde bozuk bir r üretiyordu. Pearson artık [bas, son) aralığının kendi
   ortalamasıyla hesaplanıyor.

   SESSİZLİK: payda 0 ise (tamamen sessiz/sabit bölge) eskiden r=0 atanıp yarışa sokuluyordu;
   her deneme 0 olunca kazanan, aralığın ilk denemesi yani EN UÇ kayma oluyordu ve "offset
   +180 sn" gibi geçerli görünen bir sayı geri dönüyordu. Artık bu denemeler hiç sayılmıyor;
   hiç geçerli deneme kalmazsa kayma null döner ve offsetBul hata verir. */
function _enIyiKayma(a, b, minK, maxK, ortusmeOran) {
  var oran = (ortusmeOran == null) ? 0.6 : ortusmeOran;
  var enKisa = Math.min(a.length, b.length);
  var minOrtusme = Math.max(30, Math.floor(enKisa * oran));
  var enIyi = null, enIyiR = -Infinity, skorlar = [], ilkK = null, sonK = null;
  for (var k = minK; k <= maxK; k++) {
    var bas = Math.max(0, -k), son = Math.min(a.length, b.length - k);
    var n = son - bas;
    if (n < minOrtusme) continue;
    var sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    for (var i = bas; i < son; i++) {
      var x = a[i], y = b[i + k];
      sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y;
    }
    var payda = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    if (!(payda > 0)) continue;                       // sinyal yok: skor üretme
    var r = (n * sxy - sx * sy) / payda;
    skorlar.push(r);
    if (ilkK === null) ilkK = k;
    sonK = k;
    if (r > enIyiR) { enIyiR = r; enIyi = k; }
  }
  if (enIyi === null) return { kayma: null, r: 0, z: 0, deneme: 0, ucta: false };
  // z-skoru ikincil gösterge: tepe, diğer denemelerden kaç sapma yukarıda
  var ort = 0, m;
  for (m = 0; m < skorlar.length; m++) ort += skorlar[m];
  ort /= (skorlar.length || 1);
  var vary = 0;
  for (m = 0; m < skorlar.length; m++) vary += (skorlar[m] - ort) * (skorlar[m] - ort);
  var sapma = Math.sqrt(vary / (skorlar.length || 1));
  var z = sapma > 0 ? (enIyiR - ort) / sapma : 0;
  /* Tepe, DENENEBİLEN aralığın ucunda mı? Gerçek bir eşleşmenin tepesi aralığın içinde bir
     yerdedir; tam sınırda biten tepe hemen her zaman "aralıkta doğru cevap yok" demektir. */
  return { kayma: enIyi, r: enIyiR, z: z, deneme: skorlar.length,
           ucta: (skorlar.length > 1 && (enIyi === ilkK || enIyi === sonK)) };
}

/* Hizalama hatalarını işaretle: çağıran taraf (app.js) bu dosyayı atlayıp diğerlerine
   devam edebilsin diye hata nesnesine bayrak konur. */
function _hata(mesaj) {
  var e = new Error(mesaj);
  e.hizalamaHatasi = true;
  return e;
}

/*
 * İki ses dosyası arasındaki gecikmeyi saniye cinsinden döndürür.
 * POZİTİF = hedef, referanstan GEÇ başlıyor (timeline'da o kadar ileri konmalı).
 * opts = { maxKaymaSn:120, analizSn:0 (0 = tüm dosya), workDir }
 * Döner: { offset, z, guven:"yuksek|orta|dusuk", sure }
 * Eşleşme bulunamazsa SAYI DÖNDÜRMEZ, hata fırlatır (e.hizalamaHatasi = true) — yanlış bir
 * offset'i sessizce timeline'a uygulamaktansa o dosyayı hiç yerleştirmemek doğrudur.
 */
async function offsetBul(ffmpegExe, refDosya, hedefDosya, opts) {
  opts = opts || {};
  var maxKayma = opts.maxKaymaSn || 120;
  var analiz = opts.analizSn || 0;
  var work = opts.workDir || path.dirname(hedefDosya);
  var t0 = Date.now();
  var damga = Date.now() + "_" + Math.floor(Math.random() * 1e6);
  var w1 = path.join(work, "hiz_ref_" + damga + ".wav");
  var w2 = path.join(work, "hiz_hed_" + damga + ".wav");
  try {
    await Promise.all([
      _decode(ffmpegExe, refDosya, w1, analiz),
      _decode(ffmpegExe, hedefDosya, w2, analiz)
    ]);

    // 1) KABA: 200 ms pencere, ±maxKayma
    var kabaMs = 200;
    var A1 = _merkezle(_zarf(w1, kabaMs)), B1 = _merkezle(_zarf(w2, kabaMs));
    if (A1.length < 40 || B1.length < 40) throw _hata("Ses çok kısa, hizalanamadı.");
    /* Arama aralığı yalnızca maxKaymaSn ile sınırlanır. Kısa kayıtlarda "örtüşmesi neredeyse
       hiç kalmayan sahte tepe" sorununu _enIyiKayma'nın ÖRTÜŞME KURALI zaten kapatıyor:
       örtüşmesi yetersiz olan k'lar hiç puanlanmıyor, ilkK/sonK de denenebilen gerçek sınırı
       gösterdiği için "ucta" kontrolü doğru çalışıyor.
       DİKKAT — burada ayrıca "p'yi kısa dosyanın %40'ına kelepçele" YAPILMAZ: eşit uzunlukta
       iki dosyada o kelepçe örtüşme kuralıyla aynı yerde bittiği için hiçbir şey eklemiyor,
       AMA uzunluklar farklıysa gereksiz yere daraltıyordu. Örnek (ölçüldü): A2 referansı 30
       dakikalık sekans, arkadaşın Craig kaydı 6 dakika ve 150 sn sonra katılmış. Örtüşme kuralı
       ±180 sn'nin tamamına izin verirken kelepçe aramayı ±144 sn'ye indiriyor, doğru cevap
       aralığın DIŞINDA kalıyordu. Üstelik sonuç hata bile vermiyordu: aralık içindeki sahte bir
       tepe (-13.96 sn, r=0.16) uçta olmadığı için tüm kontrolleri geçip sessizce uygulanıyordu.
       Kelepçe kalktığında aynı test +150.00 sn (r=1.00) buluyor. */
    var p = Math.round(maxKayma * 1000 / kabaMs);
    var k1 = _enIyiKayma(A1, B1, -p, p);

    /* BAŞARISIZLIĞI SAYIYA ÇEVİRME. Eskiden sessiz referans / eşleşmesiz kayıt bile geçerli
       görünen bir offset (ör. +180.40 sn) döndürüyordu; panel bunu yerleştirip klibi 3 dakika
       öteye atıyordu ve tek dosya varsa tutarlılık kontrolü de bir şey diyemiyordu. */
    if (k1.kayma === null || !isFinite(k1.r)) {
      throw _hata("Bu kayıtta konuşma bulunamadı (ses baştan sona sessiz olabilir), hizalanamadı.");
    }
    if (k1.r <= 0.05) {
      throw _hata("Ses eşleşmesi bulunamadı — bu kayıt aynı ana ait değil ya da konuşma yok. Hizalanamadı.");
    }
    if (k1.ucta) {
      throw _hata("Hizalama noktası arama sınırında çıktı; bu neredeyse her zaman yanlış eşleşme " +
                  "demektir. Kayıt hizalanamadı — bu dosyayı elle yerleştirmen gerekir.");
    }
    var kabaSn = -k1.kayma * kabaMs / 1000;

    // 2) İNCE: 20 ms pencere, kaba sonucun ±0.4 sn çevresi
    var inceMs = 20;
    var A2 = _merkezle(_zarf(w1, inceMs)), B2 = _merkezle(_zarf(w2, inceMs));
    var merkez = Math.round(-kabaSn * 1000 / inceMs), yari = Math.round(400 / inceMs);
    var k2 = _enIyiKayma(A2, B2, merkez - yari, merkez + yari, 0.5);
    // İnce aşamada geçerli deneme kalmazsa (çok kısa dosya) kaba sonuç zaten doğrulanmıştı
    var offset = (k2.kayma === null) ? kabaSn : (-k2.kayma * inceMs / 1000);

    /* Güven KABA aşamanın korelasyonundan okunur: ince aşama zaten dar bir pencerede arıyor,
       orada bütün adaylar birbirine yakın çıkar ve yanıltıcı olur.
       Eşikler gerçek ölçümle kalibre edildi. ÖNEMLİ: referans karışık kanal olduğunda
       (4 kişi aynı anda) DOĞRU eşleşme bile r≈0.37'ye iner — bu yüzden düşük r "yanlış" demek
       DEĞİLDİR, sadece "tek başına kanıt değil" demektir. Asıl karar tutarlilikKontrol()'de,
       dosyaların offset'leri birbirini doğruluyor mu diye bakılarak verilir. */
    var r = k1.r;
    var guven = (r >= 0.55) ? "yuksek" : (r >= 0.30 ? "orta" : "dusuk");
    /* z (tepe, diğer denemelerden kaç sapma yukarıda) düşükse tepe "belirgin" değildir.
       Ölçüldü: doğru eşleşmelerde z 3.9–16.9 çıkarken, doğru cevabın arama aralığı DIŞINDA
       kaldığı sahte tepede z=2.0 idi. Reddetmeye yetecek kadar keskin bir sınır değil
       (yanlışlıkla doğru dosyayı elemek daha kötü), ama güveni düşürmeye yeter. */
    if (k1.z < 2.5) guven = "dusuk";
    return {
      offset: offset,
      kabaOffset: kabaSn, r: r, z: k1.z, guven: guven,
      sure: (Date.now() - t0) / 1000
    };
  } finally {
    try { fs.unlinkSync(w1); } catch (e) {}
    try { fs.unlinkSync(w2); } catch (e) {}
  }
}

/*
 * TUTARLILIK KONTROLÜ — yanlış hizalamayı yakalamanın en güvenilir yolu.
 *
 * Korelasyon değeri tek başına yetmiyor: ölçüldü, referans karışık kanal olduğunda (4 kişi
 * aynı anda) DOĞRU bir eşleşme r=0.37 verirken, ilgisiz iki kayıt r=0.47 verebiliyor.
 * Yani sadece r'ye bakıp "bu güvenilir" demek yanlış.
 *
 * Ama Craig bütün konuşmacıları AYNI ANDA kaydetmeye başlar. Dolayısıyla hepsinin OBS kaydına
 * göre gecikmesi de aynı olmalı. Bir dosyanın offset'i diğerlerinden sapıyorsa o dosya yanlış
 * hizalanmıştır — bu, r'den çok daha keskin bir sinyal.
 *
 * ÇAPRAZ KONTROL (caprazOffset): videoyu çekenin KENDİ Craig kaydının offset'i. O dosya A1
 * referansıyla, diğerleri A2 referansıyla ölçülür ama iki referans WAV'ı da aynı fonksiyonla
 * (snkRefWav -> buildTimelineAudio) üretiliyor ve her klip sekansın 0'ına göre yerleştiriliyor;
 * yani İKİ ÖLÇÜMÜN DE t=0'ı aynı andır ve değerler doğrudan karşılaştırılabilir. Bu, kanalın
 * en sık kurulumunda (Tofi + Moni, yerleşecek TEK dosya) elimizdeki tek gerçek kontroldür —
 * onsuz "tekDosya:true" deyip hiçbir şey denetlemiyorduk. Medyana KATILMAZ (o dosya timeline'a
 * konmuyor), sadece doğrulama olarak kullanılır.
 *
 * sonuclar: [{ad, offset, r, ...}]  ->  her birine .aykiri ve .sapma eklenir, medyan döner.
 */
function tutarlilikKontrol(sonuclar, toleransSn, caprazOffset) {
  var tol = (toleransSn != null) ? toleransSn : 0.5;
  // Çapraz ölçüm farklı referansla (A1) yapıldığı için biraz daha geniş tolerans
  var caprazTol = tol * 2;
  var capraz = (caprazOffset != null && isFinite(caprazOffset)) ? caprazOffset : null;
  var gecerli = (sonuclar || []).filter(function (s) { return s && isFinite(s.offset); });
  if (!gecerli.length) {
    return { medyan: 0, aykiriSayisi: 0, tekDosya: true, yayilim: 0, capraz: capraz, caprazUyusmuyor: false };
  }
  if (gecerli.length < 2) {
    /* Tek dosya: birbirini doğrulayacak ikinci ölçüm yok. Çeken kendi kaydını da hizalattıysa
       ona göre kontrol et — yanlış hizalamayı yakalayabilecek tek sinyal budur. */
    var tekOff = gecerli[0].offset;
    var tekUyusmaz = (capraz !== null) && (Math.abs(tekOff - capraz) > caprazTol);
    gecerli[0].sapma = (capraz !== null) ? (tekOff - capraz) : 0;
    gecerli[0].aykiri = tekUyusmaz;
    return { medyan: tekOff, aykiriSayisi: tekUyusmaz ? 1 : 0, tekDosya: true,
             yayilim: 0, capraz: capraz, caprazUyusmuyor: tekUyusmaz };
  }
  var sirali = gecerli.map(function (s) { return s.offset; }).sort(function (a, b) { return a - b; });
  var orta = Math.floor(sirali.length / 2);
  var medyan = (sirali.length % 2) ? sirali[orta] : (sirali[orta - 1] + sirali[orta]) / 2;
  var yayilim = sirali[sirali.length - 1] - sirali[0];
  var aykiri = 0;
  gecerli.forEach(function (s) {
    s.sapma = s.offset - medyan;
    s.aykiri = Math.abs(s.sapma) > tol;
    if (s.aykiri) aykiri++;
  });
  /* MEDYAN TUZAĞI: çift sayıda sonuçta medyan iki ortanın ORTALAMASI oluyor. Tam 2 dosyada bu,
     sapmaları farkın yarısına indiriyor ve iki dosya arasında 0.9 sn'lik kayma varken bile
     (tol=0.5) hiçbiri aykırı işaretlenmiyordu. Aynı tuzak [0,0,1,1] gibi ikiye bölünmüş
     durumlarda da var. Craig herkesi AYNI ANDA kaydettiği için yayılımın ~0 olması gerekir:
     kimse tek başına sapmıyor ama yayılım toleransı aşıyorsa hangisinin yanlış olduğunu
     bilemeyiz — hepsini işaretle, kullanıcı kontrol etsin. */
  if (!aykiri && yayilim > tol) {
    gecerli.forEach(function (s) { s.aykiri = true; });
    aykiri = gecerli.length;
  }
  var caprazUyusmuyor = (capraz !== null) && (Math.abs(medyan - capraz) > caprazTol);
  return { medyan: medyan, aykiriSayisi: aykiri, tekDosya: false,
           yayilim: yayilim, capraz: capraz, caprazUyusmuyor: caprazUyusmuyor };
}

/* GÜVENLİ KAYMA — "bu ölçüme güvenmiyorum" denen bir dosya hangi kaymaya konsun?
   (18 Ağustos 2026 denetiminde eklendi; politika app.js'ten BURAYA taşındı ki ölçülebilsin.)

   ⚠ NEDEN app.js'te DEĞİL: eski hâlinde referans doğrudan `tut.medyan`dı ve nöbetçi test
   yalnızca app.js'te "tut.medyan" ile "cekenKontrol" DİZGELERİNİ arıyordu. İkisi de yerinde
   duruyordu, test yeşildi ve koruma yine de ÇALIŞMIYORDU. Politika saf bir fonksiyon olunca
   gerçek sayılarla sınanabiliyor (tumtest 21. bölüm) — dizge aramak bir daha yeterli olmasın.

   HATANIN KENDİSİ: `tut.medyan` AYKIRI ölçümleri de içeriyor.
     • Çift sayıda sonuçta medyan iki ortanın ORTALAMASI (yukarıdaki MEDYAN TUZAĞI notu):
       iki dosyada çöp ölçüm sonucu yarı yarıya kirletiyor -> [7.72, -123.48] -> -57.88.
     • Tek dosyada `tut.medyan` = o dosyanın KENDİ güvenilmez ölçümü (tekDosya dalı), yani
       "cekenKontrol yedeği" hiç devreye girmiyordu (medyan her zaman sonlu).
   İkisinde de sonuç negatif kaldığı için app.js kırpma dalına giriyor ve dosyanın BAŞINDAN
   ses siliyordu — üstelik ekranda "KESİLMEDİ" yazarken.

   KURAL: referans yalnız AYKIRI OLMAYAN ölçümlerden gelir. Hiç sağlam ölçüm yoksa çekenin
   kendi kaydıyla ölçülen bağımsız değere düşülür. O da yoksa referans YOKTUR (null) —
   çağıran tarafın kırpma yapmaması gerekir. Uydurulmuş bir referans, kesilmiş sesten iyidir. */
function guvenliKayma(sonuclar, cekenKontrol) {
  var saglam = [];
  var liste = sonuclar || [];
  for (var i = 0; i < liste.length; i++) {
    var s = liste[i];
    if (s && !s.aykiri && isFinite(s.offset)) saglam.push(s.offset);
  }
  if (saglam.length) {
    saglam.sort(function (a, b) { return a - b; });
    var o = Math.floor(saglam.length / 2);
    var m = (saglam.length % 2) ? saglam[o] : (saglam[o - 1] + saglam[o]) / 2;
    return { ofs: m, kaynak: "saglam", saglamSayisi: saglam.length };
  }
  if (cekenKontrol != null && isFinite(cekenKontrol)) {
    return { ofs: cekenKontrol, kaynak: "ceken", saglamSayisi: 0 };
  }
  return { ofs: null, kaynak: "yok", saglamSayisi: 0 };
}

module.exports = { offsetBul: offsetBul, tutarlilikKontrol: tutarlilikKontrol,
                   guvenliKayma: guvenliKayma, ORNEK_HZ: ORNEK_HZ };
