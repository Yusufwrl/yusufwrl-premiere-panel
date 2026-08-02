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
 * GÜVEN SKORU: en iyi eşleşme, diğer denemelerin ortalamasından kaç standart sapma yukarıda?
 * (z-skoru). Düşükse eşleşme muhtemelen yanlış — panel kullanıcıyı uyarır. Yanlış hizalama
 * tüm videoda altyazı kayması demek, sessizce geçilmemeli.
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
  // "data" chunk'ını bul (başlık boyutu her zaman 44 değil)
  var veri = 44;
  for (var i = 12; i < Math.min(buf.length - 8, 8192); i++) {
    if (buf[i] === 0x64 && buf[i + 1] === 0x61 && buf[i + 2] === 0x74 && buf[i + 3] === 0x61) { veri = i + 8; break; }
  }
  var hz = buf.readUInt32LE(24) || ORNEK_HZ;
  var pencere = Math.max(1, Math.round(hz * pencereMs / 1000));
  var n = Math.floor((buf.length - veri) / 2);
  var adet = Math.floor(n / pencere);
  var out = new Float64Array(adet);
  for (var w = 0; w < adet; w++) {
    var toplam = 0, bas = veri + w * pencere * 2;
    for (var j = 0; j < pencere; j++) { var s = buf.readInt16LE(bas + j * 2); toplam += s * s; }
    out[w] = Math.sqrt(toplam / pencere);
  }
  return out;
}

// Ortalamayı çıkar — iki kaydın ses seviyesi farkı korelasyonu bozmasın
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
   Pearson r uzunluktan bağımsız ve doğrudan yorumlanabilir: doğru eşleşme ~0.5+, yanlış ~0.1. */
function _enIyiKayma(a, b, minK, maxK) {
  var enIyi = 0, enIyiR = -Infinity, skorlar = [];
  for (var k = minK; k <= maxK; k++) {
    var bas = Math.max(0, -k), son = Math.min(a.length, b.length - k);
    if (son - bas < 30) continue;
    var carpim = 0, na = 0, nb = 0;
    for (var i = bas; i < son; i++) {
      var x = a[i], y = b[i + k];
      carpim += x * y; na += x * x; nb += y * y;
    }
    var payda = Math.sqrt(na * nb);
    var r = payda > 0 ? (carpim / payda) : 0;
    skorlar.push(r);
    if (r > enIyiR) { enIyiR = r; enIyi = k; }
  }
  // z-skoru ikincil gösterge: tepe, diğer denemelerden kaç sapma yukarıda
  var ort = 0, m;
  for (m = 0; m < skorlar.length; m++) ort += skorlar[m];
  ort /= (skorlar.length || 1);
  var vary = 0;
  for (m = 0; m < skorlar.length; m++) vary += (skorlar[m] - ort) * (skorlar[m] - ort);
  var sapma = Math.sqrt(vary / (skorlar.length || 1));
  var z = sapma > 0 ? (enIyiR - ort) / sapma : 0;
  return { kayma: enIyi, r: enIyiR, z: z, deneme: skorlar.length };
}

/*
 * İki ses dosyası arasındaki gecikmeyi saniye cinsinden döndürür.
 * POZİTİF = hedef, referanstan GEÇ başlıyor (timeline'da o kadar ileri konmalı).
 * opts = { maxKaymaSn:120, analizSn:0 (0 = tüm dosya), workDir }
 * Döner: { offset, z, guven:"yuksek|orta|dusuk", sure }
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
    if (A1.length < 40 || B1.length < 40) throw new Error("Ses çok kısa, hizalanamadı.");
    var p = Math.round(maxKayma * 1000 / kabaMs);
    var k1 = _enIyiKayma(A1, B1, -p, p);
    var kabaSn = -k1.kayma * kabaMs / 1000;

    // 2) İNCE: 20 ms pencere, kaba sonucun ±0.4 sn çevresi
    var inceMs = 20;
    var A2 = _merkezle(_zarf(w1, inceMs)), B2 = _merkezle(_zarf(w2, inceMs));
    var merkez = Math.round(-kabaSn * 1000 / inceMs), yari = Math.round(400 / inceMs);
    var k2 = _enIyiKayma(A2, B2, merkez - yari, merkez + yari);

    /* Güven KABA aşamanın korelasyonundan okunur: ince aşama zaten dar bir pencerede arıyor,
       orada bütün adaylar birbirine yakın çıkar ve yanıltıcı olur.
       Eşikler gerçek ölçümle kalibre edildi. ÖNEMLİ: referans karışık kanal olduğunda
       (4 kişi aynı anda) DOĞRU eşleşme bile r≈0.37'ye iner — bu yüzden düşük r "yanlış" demek
       DEĞİLDİR, sadece "tek başına kanıt değil" demektir. Asıl karar tutarlilikKontrol()'de,
       dosyaların offset'leri birbirini doğruluyor mu diye bakılarak verilir. */
    var r = k1.r;
    var guven = (r >= 0.55) ? "yuksek" : (r >= 0.30 ? "orta" : "dusuk");
    return {
      offset: -k2.kayma * inceMs / 1000,
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
 * sonuclar: [{ad, offset, r, ...}]  ->  her birine .aykiri ve .sapma eklenir, medyan döner.
 */
function tutarlilikKontrol(sonuclar, toleransSn) {
  var tol = (toleransSn != null) ? toleransSn : 0.5;
  var gecerli = (sonuclar || []).filter(function (s) { return s && isFinite(s.offset); });
  if (gecerli.length < 2) return { medyan: gecerli.length ? gecerli[0].offset : 0, aykiriSayisi: 0, tekDosya: true };
  var sirali = gecerli.map(function (s) { return s.offset; }).sort(function (a, b) { return a - b; });
  var orta = Math.floor(sirali.length / 2);
  var medyan = (sirali.length % 2) ? sirali[orta] : (sirali[orta - 1] + sirali[orta]) / 2;
  var aykiri = 0;
  gecerli.forEach(function (s) {
    s.sapma = s.offset - medyan;
    s.aykiri = Math.abs(s.sapma) > tol;
    if (s.aykiri) aykiri++;
  });
  return { medyan: medyan, aykiriSayisi: aykiri, tekDosya: false };
}

module.exports = { offsetBul: offsetBul, tutarlilikKontrol: tutarlilikKontrol, ORNEK_HZ: ORNEK_HZ };
