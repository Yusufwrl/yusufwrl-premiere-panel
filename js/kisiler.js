/*
 * Discord kullanıcısı -> karakter eşlemesi (Senkron kartı için).
 *
 * Craig bot kayıtları "1-yusufwrl.m4a", "2-dielyzed.aac" gibi <sıra>-<ad> biçiminde gelir.
 * Buradaki tablo o adı karaktere, karakteri de Premiere'in renk etiketine bağlar.
 *
 * Bir kişinin BİRDEN FAZLA adı olabilir: Discord'da "görünen ad" ile "kullanıcı adı" farklıdır
 * ve Craig sürümüne göre hangisini dosya adına yazdığı değişebiliyor. Bu yüzden her karakter
 * için ad listesi tutulur ve eşleşme hepsini dener.
 *
 * Liste <uzantı kökü>\kisiler.json'da; yoksa aşağıdaki VARSAYILAN kullanılır.
 * Dosya panel paketine girmez ve oto-güncellemede ezilmez (sozluk.json ile aynı muamele).
 */
var fs = require("fs");
var path = require("path");

var DOSYA = "kisiler.json";

/* Premiere'in Label renkleri — sıra SABİT, projectItem.setColorLabel(index) bunu bekler.
   (Adobe'nin kendi CEP örneğinde 4 = Cerulean olarak geçiyor.) */
var LABELLER = ["Violet", "Iris", "Caribbean", "Lavender", "Cerulean", "Forest", "Rose", "Mango",
  "Purple", "Blue", "Teal", "Magenta", "Tan", "Green", "Brown", "Yellow"];

/* Varsayılan kadro. renk = Premiere label indeksi; panelin karakter renklerine en yakın olan seçildi
   (Tofi kırmızı -> Rose, Moni mavi -> Blue, Dora yeşil -> Green, Mimi pembe -> Magenta,
    Niko sarı -> Yellow, Sage -> Teal). */
/* SIRA ÖNEMLİDİR — ses kanallarının sırasını bu liste belirler.
   A1 = videoyu çeken (Tofi/Moni'den hangisi seçiliyse), A2 = ikisinden diğeri,
   sonra bu listedeki sırayla kalan karakterler, en sonda oyun sesi.
   Videoda olmayan karakter atlanır ve alttakiler yukarı kayar. */
var VARSAYILAN = [
  { karakter: "Tofi", adlar: ["yusufwrl"], renk: 6 },
  { karakter: "Moni", adlar: ["e", "31241324asdwq12123"], renk: 9 },
  { karakter: "Mimi", adlar: ["1298721"], renk: 11 },
  { karakter: "Dora", adlar: ["dielyzed"], renk: 13 },
  { karakter: "Sage", adlar: ["tenebrissa"], renk: 10 },
  { karakter: "Niko", adlar: ["pompa456", "adsadsaadas"], renk: 15 },
  /* ⚠ SERA — YENİ KARAKTER (16 Ağustos 2026). Discord görünen adı HENÜZ BİLİNMİYOR;
     "sera" makul bir taban ama Craig dosyası başka bir adla geliyorsa (ör. "sera_yt",
     "Sera🌸") eşleşme TUTMAZ ve kaydı "bilinmeyen" olarak ayrı kanala düşer.
     Doğrusu panelden bakmak: Senkron → Craig klasörünü seç → dosya adlarında ne yazıyorsa
     "Kişiler" kutusuna onu ekle. Liste SIRASI ses kanalı sırasını belirliyor, Sera en sonda
     olduğu için mevcut kadronun kanal düzeni DEĞİŞMİYOR. */
  { karakter: "Sera", adlar: ["sera"], renk: 4 }
];

/* Karşılaştırma normali.
   DİKKAT: burada Türkçe "I -> ı" kuralı UYGULANMAZ. Discord kullanıcı adları Türkçe yazım
   kuralına göre değil; "Irmak" yazan bir adı "ırmak"a çevirirsek dosyadaki "irmak" ile
   eşleşmez. Her iki I de "i"ye indirilir.
   KÜÇÜK NOKTASIZ "ı" DA "i"ye iner: eskiden yalnız büyük harfler dönüştürülüyordu, yani
   "Işık" -> "isik" olurken "ışık" -> "ışık" kalıyor ve aynı isim kendisiyle eşleşmiyordu.
   (Kullanıcı panele adı Türkçe doğru yazıyor, Craig ise dosyaya Discord görünen adını
   baş harfi büyük yazabiliyor.) Bu kişi ÇEKEN'in kendisiyse eşleşmeme daha da pahalı:
   kendi kaydı referans sayılmak yerine timeline'a konup sesi çift çıkıyordu.
   Ayrıca sadece bilinen ayraçlar (. - _ boşluk) atılır — eskiden Latin dışı bütün harfler
   siliniyordu ve Kiril/Japonca adlar boş dizeye düşüp hiç eşleşmiyordu. */
function _norm(s) {
  s = String(s == null ? "" : s).replace(/[İIı]/g, "i").toLowerCase();
  return s.replace(/[.\-_\s]/g, "");
}

/* Craig dosya adından Discord adını çıkarır: "1-yusufwrl.m4a" -> "yusufwrl".
   Craig bazen "1-yusufwrl_2.flac" gibi ek de koyabiliyor; sondaki "_<sayı>" atılır.
   Baştaki sıra numarası yoksa dosya adının tamamı kullanılır. */
function adCikar(dosyaAdi) {
  var ad = String(dosyaAdi || "").replace(/\\/g, "/");
  ad = ad.slice(ad.lastIndexOf("/") + 1);           // yol varsa at
  ad = ad.replace(/\.[^.]+$/, "");                  // uzantıyı at
  var m = ad.match(/^\s*\d+\s*[-_.]\s*(.+)$/);      // "12-kullanici" / "3_kullanici"
  if (m) ad = m[1];
  return ad.trim();     // "_2" gibi ekler BURADA kırpılmaz; bkz. bul() — önce ham ad denenir
}

// "kullanici_2" -> "kullanici" (Craig aynı kişi iki kez bağlanınca ek koyabiliyor)
function _ekKirp(ad) { return String(ad).replace(/_\d+$/, ""); }

// Ad -> kişi kaydı. Bulunamazsa null.
function bul(entries, ad) {
  var n = _norm(ad);
  if (!n) return null;
  entries = entries || [];
  for (var i = 0; i < entries.length; i++) {
    var k = entries[i], adlar = (k && k.adlar) || [];
    for (var j = 0; j < adlar.length; j++) if (_norm(adlar[j]) === n) return k;
  }
  /* Tam eşleşme yoksa YALNIZCA Craig'in eklediği "_<sayı>" ekini kırpıp tekrar dene.
     Eskiden serbest önek eşleşmesi vardı (kayıtlı ad, dosya adının başında geçiyorsa kabul);
     bu, kayıtlı OLMAYAN yeni bir arkadaşı sessizce yanlış karaktere yapıştırıyordu
     (örnek: "monika" -> Moni; dosya Moni'nin kanalına Moni'nin rengiyle konuyordu). */
  var kirpik = _norm(_ekKirp(ad));
  if (kirpik && kirpik !== n) {
    for (var a = 0; a < entries.length; a++) {
      var k2 = entries[a], ad2 = (k2 && k2.adlar) || [];
      for (var b = 0; b < ad2.length; b++) if (_norm(ad2[b]) === kirpik) return k2;
    }
  }
  return null;
}

function karakterBul(entries, karakterAdi) {
  var n = _norm(karakterAdi);
  entries = entries || [];
  for (var i = 0; i < entries.length; i++) if (_norm(entries[i].karakter) === n) return entries[i];
  return null;
}

/* Panel metin kutusu biçimi:  Karakter: ad1, ad2   (renk adı ya da numarası sonda köşeli parantezde)
   Örn:  Moni: e, 31241324asdwq12123 [Blue]

   oncekiler (isteğe bağlı): düzenlemeden ÖNCEKİ kişi listesi. Köşeli parantezdeki renk
   tanınmazsa ("[Blu]" gibi bir yazım hatası) o karakterin eski rengi korunur — eskiden
   sessizce 0'a (Violet) düşüyordu ve kullanıcı Kaydet'e bastığı anda gerçek renk kalıcı
   olarak kayboluyordu. Tanınmayan değer ayrıca entry.renkHatasi'na yazılır ki panel
   "Bilinmeyen renk: Blu" diye uyarabilsin.
   PARAMETRE VERİLMEZSE son yüklenen/kaydedilen liste (_sonListe) kullanılır: panel
   parseText'i tek argümanla çağırıyor, o yüzden koruma yalnız parametreye bağlı kalsaydı
   hiç devreye girmezdi. */
function parseText(text, oncekiler) {
  var out = [], lines = String(text == null ? "" : text).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln || ln.charAt(0) === "#") continue;
    var renk = 0, renkHatasi = null;
    // Kapanmamış köşeli parantez ("[Blue" gibi) adın parçası sayılıp Discord adını bozuyordu.
    var acik = ln.match(/\[[^\]]*$/);
    if (acik) ln = ln.slice(0, acik.index).trim();
    var rm = ln.match(/\[([^\]]+)\]\s*$/);
    if (rm) {
      var r = rm[1].trim();
      var bulundu = false;
      // Sadece TAM sayı kabul: "3abc" eskiden parseInt ile 3 sayılıyordu
      if (/^\d+$/.test(r)) {
        var sayi = parseInt(r, 10);
        if (sayi >= 0 && sayi < LABELLER.length) { renk = sayi; bulundu = true; }
      } else {
        for (var q = 0; q < LABELLER.length; q++) if (_norm(LABELLER[q]) === _norm(r)) { renk = q; bulundu = true; break; }
      }
      if (!bulundu) renkHatasi = r;      // ne sayı ne bilinen renk adı — sessizce Violet'e DÜŞME
      /* ⚠ ADI YALNIZ RENK GERÇEKTEN TANINIRSA KES. Eskiden kesme koşulsuzdu: satır sonundaki
         HER köşeli parantez renk sanılıp addan atılıyordu. Ama buraya Discord'un GÖRÜNEN ADI
         yazılıyor ve görünen adlar klan etiketi taşıyabiliyor — "Player[TR]" adı "Player"a
         düşüyor, Craig dosyası "3-Player[TR].m4a" geldiğinde bul() eşleştiremiyor ve kişi
         "bilinmeyen"e düşüp kanalına HİÇ yerleştirilmiyordu. Kullanıcı adı panelde doğru
         yazdığı hâlde sebebini göremiyordu: renkHatasi işareti var ama arayüzdeki renk
         uyarısı kaldırılmış durumda, yani hiçbir yerde gösterilmiyor.
         Tanınmayan parantez artık adın parçası sayılır; "[Blue]"/"[3]" eskisi gibi çalışır. */
      if (bulundu) ln = ln.slice(0, rm.index).trim();
    }
    var ix = ln.indexOf(":");
    var kar = (ix >= 0 ? ln.slice(0, ix) : ln).trim();
    if (!kar) continue;
    var ham = (ix >= 0 ? ln.slice(ix + 1) : "").split(/[,;]/), adlar = [];
    for (var j = 0; j < ham.length; j++) { var v = ham[j].trim(); if (v) adlar.push(v); }
    var kayit = { karakter: kar, adlar: adlar, renk: renk };
    if (renkHatasi) {
      kayit.renkHatasi = renkHatasi;
      // eski rengi koru (varsa) — parametre yoksa diskten gelen son listeye bak
      var onceki = karakterBul(oncekiler || _sonListe, kar);
      if (onceki && onceki.renk != null && LABELLER[onceki.renk]) kayit.renk = onceki.renk;
    }
    out.push(kayit);
  }
  return out;
}
/* Renk etiketi ARTIK YAZILMIYOR: timeline'da klip renklendirme kaldırıldı (kafa karıştırıyordu).
   parseText hâlâ "[Mavi]" gibi eski satırları kabul ediyor ki kullanıcının mevcut listesi
   bozulmasın; sadece yeni yazımda gösterilmiyor.
   SIRA ÖNEMLİ: bu listenin sırası ses kanallarının sırasını belirler. */
function toText(entries) {
  var out = [];
  entries = entries || [];
  for (var i = 0; i < entries.length; i++) {
    var k = entries[i];
    if (!k || !k.karakter) continue;
    out.push(k.karakter + ": " + ((k.adlar || []).join(", ")));
  }
  return out.join("\n");
}

function defaults() { return JSON.parse(JSON.stringify(VARSAYILAN)); }

/* Son yüklenen/kaydedilen liste. parseText, tanınmayan bir renk etiketi gördüğünde eski rengi
   buradan okur; panel parseText'i tek argümanla çağırdığı için tek koruma noktası budur. */
var _sonListe = null;

/* SIRA GÖÇÜ (sürüm 2).
   Listenin SIRASI artık ses kanallarının sırasını belirliyor. Daha önce sıra hiçbir işe
   yaramadığı için kullanıcıların kayıtlı dosyası rastgele (eski varsayılan) sırada:
   Tofi, Moni, Dora, Mimi… Bu dosya olduğu gibi okunursa yeni düzen KULLANICIYA HİÇ ULAŞMAZ
   ve panel, sürüm notunda yazandan farklı bir kanal sırası üretir.
   Göç yalnızca SIRAYI düzeltir: kullanıcının eklediği Discord adları ve listede olmayan
   ekstra karakterler korunur (bilinmeyenler sona, kendi sıralarıyla). */
var SURUM = 2;
function _siraGocu(liste) {
  var hedef = VARSAYILAN, sirali = [], kalan = [], i, j;
  var alindi = {};
  for (i = 0; i < hedef.length; i++) {
    for (j = 0; j < liste.length; j++) {
      if (alindi[j]) continue;
      if (liste[j] && _norm(liste[j].karakter) === _norm(hedef[i].karakter)) {
        sirali.push(liste[j]); alindi[j] = true; break;
      }
    }
  }
  for (j = 0; j < liste.length; j++) if (!alindi[j] && liste[j]) kalan.push(liste[j]);
  return sirali.concat(kalan);
}

function load(extRoot) {
  var sonuc = null, gocGerekli = false;
  try {
    var p = path.join(extRoot, DOSYA);
    if (fs.existsSync(p)) {
      var raw = fs.readFileSync(p, "utf8");
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      var j = JSON.parse(raw);
      // dizi DEĞİLSE varsayılana dön — elle bozulmuş JSON paneli çökertiyordu
      if (j && Object.prototype.toString.call(j.kisiler) === "[object Array]") {
        sonuc = j.kisiler;
        gocGerekli = (parseInt(j.surum, 10) || 1) < SURUM;
      }
    }
  } catch (e) {}
  if (!sonuc) sonuc = defaults();
  else if (gocGerekli) {
    sonuc = _siraGocu(sonuc);
    try { save(extRoot, sonuc); } catch (e2) {}   // bir kez düzelt, bir daha uğraşma
  }
  _sonListe = sonuc;
  return sonuc;
}
function save(extRoot, entries) {
  // renkHatasi yalnızca panelin uyarı vermesi için üretilen geçici bir işaret; diske yazma
  var temiz = [], liste = entries || [];
  for (var i = 0; i < liste.length; i++) {
    var k = liste[i];
    if (!k) continue;
    temiz.push({ karakter: k.karakter, adlar: k.adlar || [], renk: (k.renk != null ? k.renk : 0) });
  }
  /* surum: sıra göçünün bir kez çalışıp bir daha çalışmaması için. Yazılmazsa panel her
     açılışta kullanıcının elle değiştirdiği sırayı varsayılana geri çevirirdi. */
  /* ⚠ pkgSurum + silinenVarsayilanlar: paket birleştirmesinin damgası ve kullanıcının
     BİLEREK sildiği varsayılan karakterlerin kaydı (bkz. paketBirlestir). Bunlar
     yazılmazsa birleştirme her açılışta yeniden çalışır ve silinen kişi geri gelir. */
  var eskiPkg = 0, silinen = [];
  try {
    var yolS = path.join(extRoot, DOSYA);
    if (fs.existsSync(yolS)) {
      var hamS = fs.readFileSync(yolS, "utf8");
      if (hamS.charCodeAt(0) === 0xFEFF) hamS = hamS.slice(1);
      var eskiJ = JSON.parse(hamS);
      eskiPkg = Number(eskiJ.pkgSurum || 0);
      if (Object.prototype.toString.call(eskiJ.silinenVarsayilanlar) === "[object Array]") {
        silinen = eskiJ.silinenVarsayilanlar.slice();
      }
    }
  } catch (eS) { eskiPkg = 0; silinen = []; }
  try {
    var varAd = {}, q;
    for (q = 0; q < temiz.length; q++) if (temiz[q].karakter) varAd[_norm(temiz[q].karakter)] = 1;
    var kayitliS = {};
    for (q = 0; q < silinen.length; q++) kayitliS[_norm(silinen[q])] = 1;
    /* ⚠⚠ SİLME KAYDI ANCAK DOSYA GÜNCEL PAKETTEN GEÇTİYSE ÇIKARILIR — sozluk.js ile aynı
       gerekçe ve aynı ölçülmüş hata. Koşulsuz hâli, listesi Sera'dan ÖNCE oluşmuş her
       kullanıcıda (yani herkeste) Sera'yı ilk kayıtta "silinmiş" işaretleyip birleştirmeyi
       kalıcı olarak etkisiz kılıyordu. `pkgSurum < PAKET_SURUM` iken yokluk "sildim" değil
       "bana hiç ulaşmadı" demektir.
       ⚠ Boşaltma da AYRI bir karar — orada da kayıt çıkarılmaz. */
    if (temiz.length && eskiPkg >= PAKET_SURUM) {
      VARSAYILAN.forEach(function (v) {
        var kk = _norm(v.karakter);
        if (!varAd[kk] && !kayitliS[kk]) { silinen.push(v.karakter); kayitliS[kk] = 1; }
      });
    }
  } catch (eS2) {}
  fs.writeFileSync(path.join(extRoot, DOSYA),
    JSON.stringify({ surum: SURUM, pkgSurum: Math.max(eskiPkg, PAKET_SURUM),
                     silinenVarsayilanlar: silinen, kisiler: temiz }, null, 2), "utf8");
  _sonListe = temiz;    // yazma başarılıysa "bilinen son iyi liste" bu olur
}

/* ⚠⚠ KADROYA EKLENEN YENİ KARAKTER MEVCUT KULLANICIYA NASIL ULAŞACAK?
   `load()` kullanıcının kisiler.json'ı varsa VARSAYILAN'a HİÇ bakmıyor — yani listeye
   eklenen Sera (16 Ağustos 2026) kişi listesini bir kez kaydetmiş kimseye ULAŞMAZ.
   Bu modülde hiç birleştirme YOKTU; sözlükteki `paketBirlestir` deseninin aynısı.

   KURALLAR:
   · YALNIZ EKLER — kullanıcının kendi karakterleri, Discord adları ve SIRASI korunur.
   · Yeni karakter listenin SONUNA eklenir. Sıra = ses kanalı sırası olduğu için başa
     eklemek mevcut kadronun bütün kanal düzenini kaydırırdı.
   · PAKET_SURUM damgasıyla BİR KEZ çalışır.
   · Kullanıcının SİLDİĞİ varsayılan karakter DİRİLTİLMEZ.
   · Liste bilerek boşaltıldıysa dokunulmaz.
   ⚠ Kadroya yeni karakter eklerken PAKET_SURUM'u ARTIR — yoksa kimseye gitmez. */
var PAKET_SURUM = 1;
function paketBirlestir(extRoot) {
  var p = path.join(extRoot, DOSYA), raw, j;
  try {
    if (!fs.existsSync(p)) return { durum: "dosya-yok", eklenen: [] };
    raw = fs.readFileSync(p, "utf8");
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    j = JSON.parse(raw);
  } catch (e) { return { durum: "okunamadi", eklenen: [], hata: String((e && e.message) || e) }; }
  if (!j || Object.prototype.toString.call(j.kisiler) !== "[object Array]") return { durum: "bicim", eklenen: [] };
  if (!j.kisiler.length) return { durum: "bos-birakilmis", eklenen: [] };
  if (Number(j.pkgSurum || 0) >= PAKET_SURUM) return { durum: "guncel", eklenen: [] };

  var eklenen = [], var_ = {}, i;
  for (i = 0; i < j.kisiler.length; i++) {
    if (j.kisiler[i] && j.kisiler[i].karakter) var_[_norm(j.kisiler[i].karakter)] = 1;
  }
  var silinenSet = {};
  try {
    if (Object.prototype.toString.call(j.silinenVarsayilanlar) === "[object Array]") {
      for (i = 0; i < j.silinenVarsayilanlar.length; i++) silinenSet[_norm(j.silinenVarsayilanlar[i])] = 1;
    }
  } catch (eS) {}
  VARSAYILAN.forEach(function (v) {
    var k = _norm(v.karakter);
    if (var_[k] || silinenSet[k]) return;
    j.kisiler.push({ karakter: v.karakter, adlar: (v.adlar || []).slice(), renk: v.renk || 0 });
    eklenen.push(v.karakter);
  });
  j.pkgSurum = PAKET_SURUM;
  try { fs.writeFileSync(p, JSON.stringify(j, null, 2), "utf8"); }
  catch (e2) { return { durum: "yazilamadi", eklenen: eklenen, hata: String((e2 && e2.message) || e2) }; }
  return { durum: "birlestirildi", eklenen: eklenen };
}

module.exports = {
  load: load, save: save, defaults: defaults,
  paketBirlestir: paketBirlestir, PAKET_SURUM: PAKET_SURUM,
  parseText: parseText, toText: toText,
  adCikar: adCikar, bul: bul, karakterBul: karakterBul, ekKirp: _ekKirp,
  LABELLER: LABELLER, DOSYA: DOSYA,
};
