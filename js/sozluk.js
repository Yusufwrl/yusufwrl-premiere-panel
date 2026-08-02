/*
 * Karakter/özel isim sözlüğü — Whisper'ın yanlış yazdığı isimleri düzeltir.
 *
 * İKİ KATMAN:
 *   1) --hotwords: motora "bu isimler geçecek" ipucu verilir (doğru yazma olasılığı artar).
 *      Motorun --reprompt varsayılanı True olduğu için ipucu TÜM video boyunca taşınır.
 *   2) Transkript sonrası kelime bazlı düzeltme (GARANTİ katman): "Toffy'ye" -> "Tofi'ye".
 *      Model ipucuna uymasa bile burada düzelir.
 *
 * Sözlük dosyası: <uzantı kökü>\sozluk.json — YOKSA aşağıdaki VARSAYILAN kullanılır.
 * Bu dosya panel paketine (pack-panel.ps1) girmez ve oto-güncellemede (updater.js) ezilmez,
 * yani kullanıcının kendi eklediği kelimeler güncellemeden sağ çıkar.
 */
var fs = require("fs");
var path = require("path");

var DOSYA = "sozluk.json";

/* Varsayılan karakterler. varyant = Whisper'ın ürettiği YANLIŞ yazımlar (küçük harfle yazılır,
   karşılaştırma zaten küçük harf üzerinden yapılır). Doğru yazımın kendisi otomatik eklenir,
   böylece "tofi" -> "Tofi" (büyük harf düzeltmesi) de yapılır.
   DİKKAT: gerçek Türkçe kelimelere benzeyen varyant EKLEME — masum kelimeler bozulur
   (ör. "mini" -> Mimi, "mani" -> Moni gibi eşleşmeler bilerek listeye alınmadı). */
var VARSAYILAN = [
  { ad: "Tofi", varyant: ["toffy", "toffi", "tofy", "tofu", "topi", "toffee", "tofie", "dofi", "to fi"] },
  { ad: "Moni", varyant: ["money", "monny", "mony", "monie", "monnie", "mo ni"] },
  { ad: "Dora", varyant: ["dorra", "doora", "tora", "dorah", "do ra"] },
  { ad: "Mimi", varyant: ["mimmi", "mimy", "mimie", "mimmy", "mi mi"] },
  { ad: "Niko", varyant: ["nico", "nikko", "nicko", "niku", "nikoo", "ni ko"] }
];

// Harf sayılan karakterler (Türkçe dahil). Noktalamayı kelimeden ayırmak için.
var RE_HARF = /[A-Za-z0-9ÇçĞğİıŞşÖöÜüÂâÎîÛû]/;
// Apostrof aileleri — "Tofi'ye" gibi eklerin ayracı
var RE_APOS = /['’‘`´]/;

/* Karşılaştırma normali: Türkçe küçük harf + apostrof/şapka temizliği.
   JS toLowerCase 'I'->'i' verir; Türkçe'de I->ı, İ->i olmalı. */
function _norm(s) {
  s = String(s).replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
  s = s.replace(/['’‘`´]/g, "");
  return s.replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u");
}

/* Türkçe çekim ekleri — apostrofsuz yapışık yazımı ("tofiye") yakalamak için.
   Liste dışı bir kalan varsa düzeltme YAPILMAZ; böylece "monitor" -> "Moni"+"tor" olmaz. */
var _EK = (function () {
  var list = ["e", "a", "i", "ı", "u", "ü", "ye", "ya", "yi", "yı", "yu", "yü",
    "de", "da", "te", "ta", "den", "dan", "ten", "tan", "nde", "nda", "nden", "ndan",
    "in", "ın", "un", "ün", "nin", "nın", "nun", "nün", "ni", "nı", "nu", "nü",
    "ne", "na", "le", "la", "yle", "yla", "ile", "ler", "lar", "lere", "lara", "leri", "ları",
    "si", "sı", "su", "sü", "m", "n", "miz", "mız", "niz", "nız", "yiz", "yız",
    "ce", "ca", "ci", "cı", "cu", "cü", "li", "lı", "lu", "lü", "siz", "sız",
    "gil", "gile", "gili", "gilde", "gilden", "yim", "yım", "sin", "sın",
    // ek fiil ve zaman ekleri: "Tofiydi", "Tofiymiş", "Tofiyken", "Tofiyse"
    "ydi", "ydı", "ydu", "ydü", "ymiş", "ymış", "ymuş", "ymüş", "yse", "ysa",
    "yken", "ken", "dir", "dır", "dur", "dür", "tir", "tır", "tur", "tür",
    "ki", "lik", "lık", "luk", "lük", "cik", "cık", "cuk", "cük", "ndeki", "ndaki"];
  var s = {}; for (var i = 0; i < list.length; i++) s[list[i]] = true; return s;
})();

/* Kalan harfler geçerli bir EK ZİNCİRİ mi? ("lerden" = "ler" + "den")
   Tek ekli biçimler zaten tek adımda çözülüyordu ama "Tofilerden", "Monilerin", "Tofiydi"
   gibi zincirlenmiş — ve tamamen normal — Türkçe yazımlar çözülemiyor, her videoda elle
   düzeltiliyordu.
   İKİ GÜVENLİK SINIRI: (1) zincirin ARA halkaları en az 2 harf olmalı — tek harfli eke izin
   verilirse "mimik" -> "Mimi"+"k" gibi masum kelimeler bozuluyor; (2) en fazla 3 halka. */
function _ekZinciri(kalan, kalanAdim) {
  if (!kalan) return true;
  if (_EK[kalan]) return true;                       // tamamı tek ek (tek harfli olabilir: "m", "n")
  if (kalanAdim <= 0) return false;
  for (var L = Math.min(6, kalan.length - 1); L >= 2; L--) {
    if (_EK[kalan.slice(0, L)] && _ekZinciri(kalan.slice(L), kalanAdim - 1)) return true;
  }
  return false;
}

// Kelimeyi baş-noktalama / gövde / son-noktalama olarak üçe ayırır ("(Toffy'ye," -> "(" + "Toffy'ye" + ",")
function _bol(tok) {
  var s = String(tok), i = 0, j = s.length;
  while (i < j && !RE_HARF.test(s.charAt(i))) i++;
  while (j > i && !RE_HARF.test(s.charAt(j - 1))) j--;
  return { on: s.slice(0, i), govde: s.slice(i, j), son: s.slice(j) };
}

/* Sözlük girdilerinden arama tablosu üretir.
   { tek: {normVaryant: "DoğruAd"}, ikili: {"iki kelime": "DoğruAd"} } — girdi yoksa null. */
function buildMap(entries) {
  var tek = {}, ikili = {}, varMi = false;
  entries = entries || [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e || !e.ad) continue;
    var ad = String(e.ad).trim();
    if (!ad) continue;
    var list = (e.varyant || []).concat([ad]);
    for (var j = 0; j < list.length; j++) {
      var v = _norm(list[j]).replace(/\s+/g, " ").trim();
      if (!v) continue;
      if (v.indexOf(" ") >= 0) ikili[v] = ad;   // "to fi" — model ismi ikiye bölmüşse
      else tek[v] = ad;
      varMi = true;
    }
  }
  return varMi ? { tek: tek, ikili: ikili } : null;
}

/* Tek kelimeyi düzeltir. Değişiklik yoksa null döner.
   Noktalama, apostroflu ek ve yapışık Türkçe ek korunur. */
function fixToken(tok, map) {
  if (!map) return null;
  var p = _bol(tok);
  if (!p.govde) return null;

  // apostroflu ek: "Toffy'ye" -> gövde "Toffy", ek "'ye"
  var ai = p.govde.search(RE_APOS);
  var kok = ai >= 0 ? p.govde.slice(0, ai) : p.govde;
  var ek = ai >= 0 ? p.govde.slice(ai) : "";
  var nk = _norm(kok);
  if (!nk) return null;

  var dogru = map.tek[nk];
  // apostrofsuz yapışık ek: "toffiye" -> "toffi" + "ye" (kalan geçerli bir Türkçe ek olmalı)
  if (!dogru && !ek) {
    for (var L = nk.length - 1; L >= 3; L--) {
      var onek = nk.slice(0, L), kalan = nk.slice(L);
      if (map.tek[onek] && _ekZinciri(kalan, 3)) { dogru = map.tek[onek]; ek = kok.slice(L); break; }
    }
  }
  if (!dogru) return null;

  var yeni = p.on + dogru + ek + p.son;
  return (yeni === String(tok)) ? null : yeni;   // zaten doğruysa "düzeltme" sayma
}

/* Whisper kelime listesini (flattenWords çıktısı) YERİNDE düzeltir; düzeltme sayısını döner.
   İkili varyant eşleşirse iki kelime tek kelimede birleşir (zaman damgası genişletilir). */
function fixWords(words, map) {
  if (!map || !words || !words.length) return 0;
  var n = 0;
  for (var i = 0; i < words.length; i++) {
    // önce ikili dene: model ismi bölmüş olabilir ("To" + "fi")
    if (i + 1 < words.length) {
      var a = _bol(words[i].word), b = _bol(words[i + 1].word);
      var dogru = map.ikili[_norm(a.govde) + " " + _norm(b.govde)];
      if (dogru) {
        words[i].word = a.on + dogru + b.son;
        words[i].end = words[i + 1].end;
        words.splice(i + 1, 1);
        n++;
        continue;
      }
    }
    var f = fixToken(words[i].word, map);
    if (f !== null) { words[i].word = f; n++; }
  }
  return n;
}

// Düz metni düzeltir (panelde elle yazılan/düzenlenen satırlar için)
function fixText(text, map) {
  if (!map) return String(text);
  var parcalar = String(text).split(/(\s+)/);
  for (var i = 0; i < parcalar.length; i++) {
    if (/^\s*$/.test(parcalar[i])) continue;
    var f = fixToken(parcalar[i], map);
    if (f !== null) parcalar[i] = f;
  }
  return parcalar.join("");
}

// Motora verilecek ipucu dizesi: "Tofi, Moni, Dora, Mimi, Niko"
function hotwords(entries) {
  var out = [];
  entries = entries || [];
  for (var i = 0; i < entries.length; i++) {
    var ad = entries[i] && entries[i].ad ? String(entries[i].ad).trim() : "";
    if (ad) out.push(ad);
  }
  return out.join(", ");
}

/* Panel metin kutusu formatı:  DoğruYazım: yanlış1, yanlış2
   Boş satırlar ve '#' ile başlayan satırlar yok sayılır. */
function parseText(text) {
  var out = [], lines = String(text == null ? "" : text).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln || ln.charAt(0) === "#") continue;
    var ix = ln.indexOf(":");
    var ad = (ix >= 0 ? ln.slice(0, ix) : ln).trim();
    if (!ad) continue;
    var vs = (ix >= 0 ? ln.slice(ix + 1) : "").split(/[,;]/);
    var temiz = [];
    for (var j = 0; j < vs.length; j++) { var v = vs[j].trim(); if (v) temiz.push(v); }
    out.push({ ad: ad, varyant: temiz });
  }
  return out;
}
function toText(entries) {
  var out = [];
  entries = entries || [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e || !e.ad) continue;
    out.push(String(e.ad) + ((e.varyant && e.varyant.length) ? ": " + e.varyant.join(", ") : ""));
  }
  return out.join("\n");
}

function defaults() { return JSON.parse(JSON.stringify(VARSAYILAN)); }

function load(extRoot) {
  try {
    var p = path.join(extRoot, DOSYA);
    if (fs.existsSync(p)) {
      var raw = fs.readFileSync(p, "utf8");
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);   // BOM'a dayanıklılık
      var j = JSON.parse(raw);
      if (j && j.entries && j.entries.length) return j.entries;
      if (j && j.entries) return [];   // kullanıcı bilerek boşalttıysa varsayılana DÖNME
    }
  } catch (e) {}
  return defaults();
}
function save(extRoot, entries) {
  fs.writeFileSync(path.join(extRoot, DOSYA), JSON.stringify({ entries: entries || [] }, null, 2), "utf8");
  return path.join(extRoot, DOSYA);
}

module.exports = {
  load: load, save: save, defaults: defaults,
  parseText: parseText, toText: toText,
  buildMap: buildMap, fixWords: fixWords, fixToken: fixToken, fixText: fixText,
  hotwords: hotwords, DOSYA: DOSYA,
};
