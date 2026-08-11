/*
 * SHORTS ZAMAN HARİTALAMA — saf hesap, Premiere GEREKMEZ.
 *
 * Shorts, uzun videodan seçilmiş 3-5 aralığı ARKA ARKAYA dizer:
 *     kaynak [120-132] [340-349] [610-622]  ->  Shorts [0-12] [12-21] [21-33]
 * Altyazı cue'ları ve emoji zamanları bu yeni eksene taşınmak zorunda. Bu dosya yalnız o
 * dönüşümü yapar; hiçbir Premiere çağrısı, hiçbir dosya işi yok — yani `tumtest.js` gerçek
 * veriyle sınayabiliyor.
 *
 * ⚠ GİRDİ NESNELERİ ASLA DEĞİŞTİRİLMEZ. Bu projede tam bu tuzağa bir kez düşüldü:
 * placeCaptions'ta `c.slice()` yalnız DİZİYİ kopyalıyordu, cue nesneleri `state.a1Cues`'un
 * TA KENDİSİYDİ ve çakışma gidericileri state'i kalıcı bozuyordu (saveSession bozuk
 * zamanları diske yazıyordu). Burada her cue için YENİ nesne üretilir. Nöbetçi testi var.
 *
 * ⚠ POLİTİKA: KIRP -> (çok kısaldıysa) GİZLE -> İTME ASLA.
 * Altyazı tarafındaki `kanallarArasiCakisma` ile birebir aynı politika ve aynı sebep:
 * itmek senkronu bozar, kullanıcının şikâyet ettiği kaymanın ta kendisidir.
 *
 * ⚠ `cumleId`'YE KESİT NUMARASI EKLENİR. Aynı cümlenin iki ayrı kesite düşen parçaları
 * arasında `cumleBirlestir` köprü kurmamalı — köprü "aynı cümlede kelime arası boşluk
 * kapansın" diye var, ama kesit sınırında iki parça arasında GERÇEKTE dakikalar var.
 * Kimlik yalnız KOPYADA değişir (yukarıdaki mutasyon kuralı).
 */
"use strict";

/* buildCues'un MIN_GORUNUR'ü ile aynı sayı: bunun altına inen altyazı göz kırpması gibi
   durur. Kırpma sonrası buraya düşen cue GİZLENİR (silinmez, işaretlenir). */
var MIN_GORUNUR = 0.25;

/* Bir kaynak zamanı Shorts zamanına çevirir. Hangi kesite düştüğünü bulur.
   Dönen: {shorts: sn, kesit: idx} · hiçbir kesite düşmüyorsa null. */
function zamanCevir(kesitler, t) {
  var ofs = 0, i, k;
  for (i = 0; i < kesitler.length; i++) {
    k = kesitler[i];
    if (t >= k.bas && t <= k.bit) return { shorts: ofs + (t - k.bas), kesit: i };
    ofs += (k.bit - k.bas);
  }
  return null;
}

/* Kesitlerin toplam süresi = Shorts'un uzunluğu. */
function toplamSure(kesitler) {
  var s = 0, i;
  for (i = 0; i < kesitler.length; i++) s += (kesitler[i].bit - kesitler[i].bas);
  return s;
}

/*
 * Cue listesini Shorts eksenine taşır.
 *   kesitler : [{bas, bit}] KAYNAK zaman, zaman sıralı ve çakışmasız olmalı
 *   cues     : [{start, end, text, cumleId?, ...}] — DEĞİŞTİRİLMEZ
 *   opts.minGorunur : kırpma sonrası bu sürenin altına düşen cue gizlenir (varsayılan 0.25)
 *
 * Dönen cue'lar YENİ nesnelerdir ve şu ek alanları taşır:
 *   kesitNo      : hangi kesitten geldiği
 *   kaynakBas    : uzun videodaki özgün başlangıcı (hata ayıklama + emoji eşleşmesi için)
 *   kirpildi     : kesit sınırında kısaltıldı mı
 *   gizliKesit   : kırpılıp MIN_GORUNUR altına düştü (SRT'ye yazılmaz, silinmez)
 */
function cueHarita(kesitler, cues, opts) {
  opts = opts || {};
  var minGor = (typeof opts.minGorunur === "number") ? opts.minGorunur : MIN_GORUNUR;
  var cikti = [], sayac = { disarida: 0, kirpilan: 0, gizlenen: 0, tasinan: 0 };
  var ofsler = [], ofs = 0, i, j;
  for (i = 0; i < kesitler.length; i++) { ofsler.push(ofs); ofs += (kesitler[i].bit - kesitler[i].bas); }

  for (j = 0; j < (cues || []).length; j++) {
    var c = cues[j];
    var s = Number(c.start), e = Number(c.end);
    if (!isFinite(s) || !isFinite(e)) { sayac.disarida++; continue; }

    /* Cue hangi kesitle ÖRTÜŞÜYOR? Bir cue en fazla bir kesite konur: iki kesite yayılan
       cue'yu bölmek metni ikiye ayırır ve iki yarım cümle üretir — kullanıcı için
       kırpılmış tek cue'dan daha kötü. En çok örtüşen kesit seçilir. */
    var enIyi = -1, enIyiOrtak = 0;
    for (i = 0; i < kesitler.length; i++) {
      var ort = Math.min(e, kesitler[i].bit) - Math.max(s, kesitler[i].bas);
      if (ort > enIyiOrtak) { enIyiOrtak = ort; enIyi = i; }
    }
    if (enIyi < 0 || enIyiOrtak <= 0) { sayac.disarida++; continue; }

    var k = kesitler[enIyi];
    var ys = Math.max(s, k.bas), ye = Math.min(e, k.bit);
    var kirpildi = (ys > s + 1e-9) || (ye < e - 1e-9);
    var yeni = {};
    /* Genel kopya: cue'da başka alanlar da var (cumleId, konusmaci, vurucuGoster…) ve
       alan listesi TUTULMAZ — yeni bir alan eklendiğinde sessizce düşmesin. */
    for (var alan in c) { if (Object.prototype.hasOwnProperty.call(c, alan)) yeni[alan] = c[alan]; }
    yeni.start = ofsler[enIyi] + (ys - k.bas);
    yeni.end = ofsler[enIyi] + (ye - k.bas);
    yeni.kesitNo = enIyi;
    yeni.kaynakBas = s;
    yeni.kirpildi = kirpildi;
    /* ⚠ GİZLEME ŞARTI YALNIZ KIRPILANLARA: kaynakta zaten MIN_GORUNUR'den kısa cue'lar var
       (gerçek oturumda ölçüldü: %12.5) ve onlar uzun videoda ekranda GÖRÜNÜYOR. Şart
       olmadan sebepsiz yere gizleniyorlardı. */
    yeni.gizliKesit = kirpildi && ((yeni.end - yeni.start) < minGor);
    /* Kesit numarası kimliğe girer — farklı kesitlerdeki aynı cümle köprülenmesin. */
    if (yeni.cumleId) yeni.cumleId = String(yeni.cumleId) + "@s" + enIyi;

    if (kirpildi) sayac.kirpilan++;
    if (yeni.gizliKesit) sayac.gizlenen++;
    sayac.tasinan++;
    cikti.push(yeni);
  }
  cikti.sort(function (a, b) { return a.start - b.start; });
  return { cues: cikti, sayac: sayac, sure: toplamSure(kesitler) };
}

/* Emoji/cümle aralıklarını taşır. Cue'dan farkı: alan adları bas/bit ve kırpılan değil
   DÜŞÜRÜLEN mantığı — emoji yarım gösterilmez, ya tam sığar ya konmaz. */
function araliklariHarita(kesitler, araliklar) {
  var cikti = [], dusen = 0, i, j;
  var ofsler = [], ofs = 0;
  for (i = 0; i < kesitler.length; i++) { ofsler.push(ofs); ofs += (kesitler[i].bit - kesitler[i].bas); }
  for (j = 0; j < (araliklar || []).length; j++) {
    var a = araliklar[j];
    var s = Number(a.bas), e = Number(a.bit);
    var enIyi = -1;
    for (i = 0; i < kesitler.length; i++) {
      if (s >= kesitler[i].bas && s <= kesitler[i].bit) { enIyi = i; break; }
    }
    if (enIyi < 0) { dusen++; continue; }
    var k = kesitler[enIyi];
    var yeni = {};
    for (var alan in a) { if (Object.prototype.hasOwnProperty.call(a, alan)) yeni[alan] = a[alan]; }
    yeni.bas = ofsler[enIyi] + (s - k.bas);
    yeni.bit = ofsler[enIyi] + (Math.min(e, k.bit) - k.bas);
    yeni.kesitNo = enIyi;
    if (yeni.bit <= yeni.bas) { dusen++; continue; }
    cikti.push(yeni);
  }
  cikti.sort(function (x, y) { return x.bas - y.bas; });
  return { araliklar: cikti, dusen: dusen };
}

/*
 * SON NÖBETÇİ — SRT ve emoji planı diske yazılmadan HEMEN ÖNCE çağrılır.
 * ⚠ Neden şart: `fmtTime` negatif zamanı SESSİZCE 0 yapıyor (pipeline.js), yani işareti
 * ters bir ofset hata vermez — bütün altyazıyı 00:00:00,000'a yığar ve panel "ok" der.
 * Aralık dışı emoji de host tarafından sessizce yutulur. Tek bir ihlalde bile HİÇBİR ŞEY
 * yazılmamalı: sessiz kırpma/kelepçeleme yasak.
 */
/*
 * SHORTS SONUNA KIRP — kare yuvarlaması payı.
 * ⚠ GERÇEK HATA (11 Ağustos 2026): host `sure`yi son klibin GERİ OKUNAN bitişinden alıyor,
 * panel cue'ları kaynak kesit sınırlarından hesaplıyor; Premiere kareye yuvarladığı için
 * arada ~0.06 sn fark kalabiliyor. `dogrula` bunu mantık hatası sanıp bütün altyazı
 * yazımını durduruyordu (5 karakterden yalnız 1'inin altyazısı yazıldı).
 * POLİTİKA ALTYAZIDAKİYLE AYNI: KIRP → (çok kısaldıysa) DÜŞÜR → İTME ASLA.
 * ⚠ `pay` KÜÇÜK TUTULUR (0.5 sn): bunun üstü yuvarlama değil, gerçek bir hesap hatasıdır
 * ve `dogrula`nın yakalaması GEREKİR — sessizce kırpmak o hatayı gizlerdi.
 */
function sonaKirp(cues, sure, opts) {
  opts = opts || {};
  var pay = (typeof opts.pay === "number") ? opts.pay : 0.5;
  var enAz = (typeof opts.enAz === "number") ? opts.enAz : 0.05;
  var cikti = [], sayac = { kirpilan: 0, dusen: 0, buyukTasma: 0 };
  for (var i = 0; i < (cues || []).length; i++) {
    var c = cues[i];
    if (c.end > sure) {
      /* Pay dışındaki taşma KIRPILMAZ — olduğu gibi bırakılır ki dogrula yakalasın. */
      if (c.end - sure > pay) { sayac.buyukTasma++; cikti.push(c); continue; }
      var yeni = {};
      for (var alan in c) { if (Object.prototype.hasOwnProperty.call(c, alan)) yeni[alan] = c[alan]; }
      yeni.end = sure;
      sayac.kirpilan++;
      if (yeni.end - yeni.start < enAz) { sayac.dusen++; continue; }
      cikti.push(yeni);
      continue;
    }
    cikti.push(c);
  }
  return { cues: cikti, sayac: sayac };
}

function dogrula(cues, sure, opts) {
  opts = opts || {};
  var tol = (typeof opts.tolerans === "number") ? opts.tolerans : 0.05;
  var hatalar = [], i, c;
  for (i = 0; i < (cues || []).length; i++) {
    c = cues[i];
    if (!isFinite(c.start) || !isFinite(c.end)) { hatalar.push("cue " + i + ": zaman sayı değil"); continue; }
    if (c.start < -1e-9) hatalar.push("cue " + i + ": başlangıç NEGATİF (" + c.start.toFixed(3) + ")");
    if (c.end <= c.start) hatalar.push("cue " + i + ": bitiş başlangıçtan küçük/eşit");
    if (c.end > sure + tol) hatalar.push("cue " + i + ": bitiş Shorts süresini aşıyor (" +
                                         c.end.toFixed(3) + " > " + sure.toFixed(3) + ")");
  }
  return hatalar;
}

module.exports = {
  MIN_GORUNUR: MIN_GORUNUR,
  zamanCevir: zamanCevir, toplamSure: toplamSure,
  cueHarita: cueHarita, araliklariHarita: araliklariHarita,
  sonaKirp: sonaKirp, dogrula: dogrula
};
