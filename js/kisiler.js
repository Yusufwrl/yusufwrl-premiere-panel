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
var VARSAYILAN = [
  { karakter: "Tofi", adlar: ["yusufwrl"], renk: 6 },
  { karakter: "Moni", adlar: ["e", "31241324asdwq12123"], renk: 9 },
  { karakter: "Dora", adlar: ["dielyzed"], renk: 13 },
  { karakter: "Mimi", adlar: ["1298721"], renk: 11 },
  { karakter: "Sage", adlar: ["tenebrissa"], renk: 10 },
  { karakter: "Niko", adlar: ["pompa456", "adsadsaadas"], renk: 15 }
];

// Karşılaştırma normali: Türkçe küçük harf + yalnız harf/rakam (Discord adlarında . _ - sık)
function _norm(s) {
  s = String(s == null ? "" : s).replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
  return s.replace(/[^a-z0-9çğıöşü]/g, "");
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
  ad = ad.replace(/_\d+$/, "");                     // "kullanici_2" -> "kullanici"
  return ad.trim();
}

// Ad -> kişi kaydı. Bulunamazsa null.
function bul(entries, ad) {
  var n = _norm(ad);
  if (!n) return null;
  entries = entries || [];
  for (var i = 0; i < entries.length; i++) {
    var k = entries[i], adlar = (k && k.adlar) || [];
    for (var j = 0; j < adlar.length; j++) if (_norm(adlar[j]) === n) return k;
  }
  // tam eşleşme yoksa: kayıtlı ad, dosyadaki adın içinde geçiyor mu (Craig ek koymuş olabilir)
  for (var a = 0; a < entries.length; a++) {
    var k2 = entries[a], ad2 = (k2 && k2.adlar) || [];
    for (var b = 0; b < ad2.length; b++) {
      var m = _norm(ad2[b]);
      if (m.length >= 4 && n.indexOf(m) === 0) return k2;
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
   Örn:  Moni: e, 31241324asdwq12123 [Blue] */
function parseText(text) {
  var out = [], lines = String(text == null ? "" : text).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln || ln.charAt(0) === "#") continue;
    var renk = 0;
    var rm = ln.match(/\[([^\]]+)\]\s*$/);
    if (rm) {
      var r = rm[1].trim();
      var sayi = parseInt(r, 10);
      if (!isNaN(sayi) && sayi >= 0 && sayi < LABELLER.length) renk = sayi;
      else { for (var q = 0; q < LABELLER.length; q++) if (_norm(LABELLER[q]) === _norm(r)) { renk = q; break; } }
      ln = ln.slice(0, rm.index).trim();
    }
    var ix = ln.indexOf(":");
    var kar = (ix >= 0 ? ln.slice(0, ix) : ln).trim();
    if (!kar) continue;
    var ham = (ix >= 0 ? ln.slice(ix + 1) : "").split(/[,;]/), adlar = [];
    for (var j = 0; j < ham.length; j++) { var v = ham[j].trim(); if (v) adlar.push(v); }
    out.push({ karakter: kar, adlar: adlar, renk: renk });
  }
  return out;
}
function toText(entries) {
  var out = [];
  entries = entries || [];
  for (var i = 0; i < entries.length; i++) {
    var k = entries[i];
    if (!k || !k.karakter) continue;
    out.push(k.karakter + ": " + ((k.adlar || []).join(", ")) + " [" + (LABELLER[k.renk] || "Violet") + "]");
  }
  return out.join("\n");
}

function defaults() { return JSON.parse(JSON.stringify(VARSAYILAN)); }

function load(extRoot) {
  try {
    var p = path.join(extRoot, DOSYA);
    if (fs.existsSync(p)) {
      var raw = fs.readFileSync(p, "utf8");
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      var j = JSON.parse(raw);
      if (j && j.kisiler) return j.kisiler;
    }
  } catch (e) {}
  return defaults();
}
function save(extRoot, entries) {
  fs.writeFileSync(path.join(extRoot, DOSYA), JSON.stringify({ kisiler: entries || [] }, null, 2), "utf8");
}

module.exports = {
  load: load, save: save, defaults: defaults,
  parseText: parseText, toText: toText,
  adCikar: adCikar, bul: bul, karakterBul: karakterBul,
  LABELLER: LABELLER, DOSYA: DOSYA,
};
