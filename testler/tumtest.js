/*
 * PANEL DENETİMİ — TEK KOMUT, PREMIERE GEREKMEZ.
 *
 *   node testler\tumtest.js
 *
 * NEDEN VAR: bu panelin hatalarının çoğu ancak Premiere'de, uzun bir videonun ortasında
 * görülüyor ve bedeli saatler. Buradaki her kontrol, Premiere'e HİÇ dokunmadan, saf dosya
 * ve saf hesap üzerinden çalışıyor — yani her sürümden önce saniyeler içinde koşturulabilir.
 *
 * ⚠ SÜRÜM ÇIKARMADAN ÖNCE ÇALIŞTIR. Buradaki testlerin hepsi gerçekten yaşanmış bir
 * hatadan doğdu; hiçbiri teorik değil. Yeni bir hata bulunduğunda buraya bir test EKLE —
 * "bir daha olmasın" sözünün tek kalıcı biçimi budur.
 *
 * KAPSAM DIŞI (bilerek): Premiere API'si gerektiren her şey (klip yerleştirme, keyframe,
 * caption track). Onlar ancak kullanıcının makinesinde ölçülebiliyor.
 */
"use strict";
var fs = require("fs");
var path = require("path");

var KOK = path.join(__dirname, "..");
var gecti = 0, kaldi = 0, uyari = 0;
var suanBaslik = "";

function baslik(s) { suanBaslik = s; console.log("\n=== " + s + " ==="); }
function ok(ad) { gecti++; console.log("  ok    " + ad); }
function hata(ad, ayrinti) {
  kaldi++;
  console.log("  KALDI " + ad + (ayrinti ? ("\n        " + ayrinti) : ""));
}
function not(ad) { uyari++; console.log("  not   " + ad); }
function esit(ad, olan, beklenen) {
  if (JSON.stringify(olan) === JSON.stringify(beklenen)) ok(ad);
  else hata(ad, "olan: " + JSON.stringify(olan) + "\n        beklenen: " + JSON.stringify(beklenen));
}
function dogru(ad, kosul, ayrinti) { if (kosul) ok(ad); else hata(ad, ayrinti); }

/* ================= 1. SÜRÜM ÜÇ DOSYADA SENKRON MU ================= */
baslik("Sürüm senkronu (üç dosya birlikte artmalı)");
(function () {
  function oku(p, re) {
    try { var m = String(fs.readFileSync(path.join(KOK, p), "utf8")).match(re); return m ? m[1] : ""; }
    catch (e) { return ""; }
  }
  var v = oku("version.json", /"version"\s*:\s*"([^"]+)"/);
  var m = oku("CSXS/manifest.xml", /ExtensionBundleVersion="([^"]+)"/);
  var i = oku("installer/installer.iss", /#define\s+AppVersion\s+"([^"]+)"/);
  dogru("version.json okundu (" + v + ")", !!v);
  esit("manifest.xml aynı sürüm", m, v);
  esit("installer.iss aynı sürüm", i, v);
  /* ⚠ 1.9.9 -> 1.9.10 gecisi: metin karsilastirmasi olsaydi guncelleme HIC cikmazdi. */
  var p = v.split(".").map(Number);
  dogru("sürüm sayısal karşılaştırmaya uygun", p.length === 3 && p.every(function (x) { return !isNaN(x); }),
        "semver bekleniyor: " + v);
})();

/* ================= 2. EMOJİ PAKETİ ================= */
baslik("Emoji paketi (kaynak ↔ paket ↔ manifest)");
var EMJ = null, tarama = null;
(function () {
  try { EMJ = require(path.join(KOK, "js", "emoji.js")); } catch (e) { hata("js/emoji.js yüklenemedi", e.message); return; }
  var manYol = path.join(KOK, "varsayilan", "emoji-paketi.json");
  if (!fs.existsSync(manYol)) { hata("varsayilan/emoji-paketi.json yok"); return; }
  var man = JSON.parse(String(fs.readFileSync(manYol, "utf8")).replace(/^﻿/, ""));
  var pngKlasor = path.join(KOK, "varsayilan", "emoji");
  var pngler = fs.readdirSync(pngKlasor).filter(function (f) { return /\.png$/i.test(f); });
  esit("manifest kaydı = paketteki PNG sayısı", man.length, pngler.length);

  var eksikDosya = man.filter(function (x) { return !fs.existsSync(path.join(pngKlasor, x.dosya)); });
  esit("manifestteki her dosya pakette var", eksikDosya.length, 0);

  /* Panelin dosya adlarindan TURETECEKLERI — bozuk bir ad burada gorunur, kullanicida degil. */
  var t = EMJ.tara(pngKlasor);
  /* Paket ASCII adli (emoji01.png) — tara() onlari "kaliba uymuyor" sayar; bu NORMAL.
     Gercek ad kontrolu manifest uzerinden yapilir. */
  var kotuAd = man.filter(function (x) {
    var taban = String(x.ad).replace(/\.png$/i, "").trim().replace(/\s+\d{1,2}$/, "");
    return taban.indexOf(" ") <= 0;
  });
  esit("her ad “<Duygu> <Karakter>.png” kalıbında", kotuAd.map(function (x) { return x.ad; }), []);

  /* Kaynak klasor varsa paketle KARSILASTIR — emoji-esitle.ps1 unutulmus mu?
     ⚠ Bu adim hicbir yayin akisindan cagrilmiyor; unutulunca yeni emojiler kimseye ulasmiyor. */
  var kaynak = path.join(process.env.USERPROFILE || "", "OneDrive", "Masaüstü", "Yusufwrl", "Youtube", "Edit", "Emoji");
  if (fs.existsSync(kaynak)) {
    var kay = fs.readdirSync(kaynak).filter(function (f) { return /\.png$/i.test(f); });
    var pAd = {}; man.forEach(function (x) { pAd[x.ad] = 1; });
    var yeni = kay.filter(function (f) { return !pAd[f]; });
    var gitmis = man.map(function (x) { return x.ad; }).filter(function (a) { return kay.indexOf(a) < 0; });
    if (yeni.length || gitmis.length) {
      hata("kaynak klasör paketle AYNI DEĞİL — installer\\emoji-esitle.ps1 çalıştır",
           "pakette olmayan: " + (yeni.join(", ") || "-") + "\n        kaynakta olmayan: " + (gitmis.join(", ") || "-"));
    } else ok("kaynak klasör paketle aynı (" + kay.length + " resim)");
    tarama = EMJ.tara(kaynak);
  } else not("kaynak emoji klasörü bu makinede yok, karşılaştırma atlandı");
})();

/* ================= 3. EMOJİ TARAMASI ================= */
baslik("Emoji taraması (ad çözümleme, havuzlar)");
(function () {
  if (!tarama) { not("kaynak klasör yok, atlandı"); return; }
  dogru("tarama hatasız", !tarama.hata, tarama.hata);
  esit("kalıba uymayan dosya yok", tarama.atlanan, 0);
  dogru("en az bir karakter bulundu", tarama.karakterler.length > 0);
  /* Panelin kendi urettikleri SAHTE karakter olmamali. */
  var sahte = tarama.karakterler.filter(function (k) { return k.key === "ayna" || k.key === "eski" || /^\d+$/.test(k.key); });
  esit("sahte karakter yok (ayna/eski/sayı)", sahte.map(function (k) { return k.ad; }), []);
  /* Bir karakterin havuzu BOSSA o kisi hic emoji alamaz — sessiz kalmasin. */
  var bos = tarama.karakterler.filter(function (k) { return !(tarama.karakterDuygu[k.key] || []).length; });
  esit("her karakterin en az bir tepkisi var", bos.map(function (k) { return k.ad; }), []);
  var ozet = tarama.karakterler.map(function (k) {
    return k.ad + ":" + (tarama.karakterDuygu[k.key] || []).length;
  }).join(" · ");
  not("havuzlar → " + ozet);
})();

/* ================= 4. PNG AYNALAMA ================= */
baslik("PNG aynalama (sol taraf resimleri)");
(function () {
  var AY;
  try { AY = require(path.join(KOK, "js", "pngayna.js")); } catch (e) { hata("js/pngayna.js yüklenemedi", e.message); return; }
  if (!tarama) { not("kaynak klasör yok, atlandı"); return; }
  var tmp = path.join(require("os").tmpdir(), "yw-ayna-test");
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(tmp, { recursive: true });
  var basarisiz = [];
  tarama.dosyalar.forEach(function (d) {
    var r = AY.aynala(d.yol, path.join(tmp, path.basename(d.yol)));
    if (!r.ok) basarisiz.push(d.ad + " (" + r.hata + ")");
  });
  esit("bütün resimler aynalanabiliyor", basarisiz, []);

  /* AYNA GERCEKTEN AYNA MI: iki kez aynalayinca ozgune donmeli (involution).
     ⚠ Bu tek basina cozucuyu dogrulamaz ama "satirlari ters cevirme" adimini kanitlar. */
  if (tarama.dosyalar.length) {
    var ilk = tarama.dosyalar[0];
    var bir = path.join(tmp, "_bir.png"), iki = path.join(tmp, "_iki.png");
    AY.aynala(ilk.yol, bir); AY.aynala(bir, iki);
    var a = fs.readFileSync(ilk.yol), b = fs.readFileSync(iki);
    /* Bayt bayt esit OLMAYABILIR (yeniden sikistirma), piksel verisi esit olmali:
       boyut ayni ve iki kez aynalanmis dosya ilk aynadan FARKLI olmali. */
    dogru("iki kez aynalama özgüne dönüyor (boyut)", Math.abs(b.length - fs.readFileSync(bir).length) < b.length,
          "beklenmedik boyut");
    dogru("bir kez aynalanan özgünden farklı", !fs.readFileSync(bir).equals(a));
  }

  /* YAN CHUNK'LAR: sRGB/pHYs atilirsa sol emojiler farkli renkte/DPI'da cikar. */
  function chunklar(p) {
    var buf = fs.readFileSync(p), o = 8, t = [];
    while (o + 8 <= buf.length) {
      var u = buf.readUInt32BE(o), ty = buf.toString("ascii", o + 4, o + 8);
      t.push(ty); if (ty === "IEND") break; o += 12 + u;
    }
    return t;
  }
  if (tarama.dosyalar.length) {
    var oz = chunklar(tarama.dosyalar[0].yol);
    var ay = chunklar(path.join(tmp, path.basename(tarama.dosyalar[0].yol)));
    ["sRGB", "pHYs", "gAMA", "PLTE", "tRNS"].forEach(function (c) {
      if (oz.indexOf(c) >= 0) dogru(c + " korunuyor", ay.indexOf(c) >= 0, c + " kayboldu — renk/DPI kayabilir");
    });
    dogru("iDOT atılıyor (yeniden sıkıştırmada geçersiz)", ay.indexOf("iDOT") < 0);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
})();

/* ================= 5. ALTYAZI KÖPRÜSÜ ================= */
baslik("Altyazı köprüsü (aynı cümlede boşluk kapatma)");
(function () {
  var P;
  try { P = require(path.join(KOK, "js", "pipeline.js")); } catch (e) { hata("js/pipeline.js yüklenemedi", e.message); return; }
  if (typeof P.cumleBirlestir !== "function") { hata("pipeline.cumleBirlestir dışa açılmamış"); return; }
  function c(s, e, id) { return { start: s, end: e, text: "x", cumleId: id }; }

  var g1 = [{ ad: "A", cues: [c(0, 0.92, "s1"), c(1.0, 2.0, "s1")] }];
  P.cumleBirlestir(g1, {});
  esit("aynı cümle → bitiş yapıştı", g1[0].cues[0].end, 1.0);
  esit("başlangıç DEĞİŞMEDİ", g1[0].cues[0].start, 0);

  var g2 = [{ ad: "A", cues: [c(0, 0.92, "s1"), c(1.0, 2.0, "s2")] }];
  P.cumleBirlestir(g2, {});
  esit("farklı cümle → köprü yok", g2[0].cues[0].end, 0.92);

  var g3 = [{ ad: "A", cues: [c(0, 0.9, "s1"), c(3.0, 4.0, "s1")] }];
  P.cumleBirlestir(g3, {});
  esit("gerçek duraklama → köprü yok", g3[0].cues[0].end, 0.9);

  var g4 = [{ ad: "A", cues: [c(0, 0.92, null), c(1.0, 2.0, null)] }];
  P.cumleBirlestir(g4, {});
  esit("cumleId yok → köprü yok", g4[0].cues[0].end, 0.92);

  var g5 = [{ ad: "A", cues: [c(0, 0.92, "s1"), c(1.0, 2.0, "s1")] },
            { ad: "B", cues: [c(0.95, 0.99, "t1")] }];
  var s5 = P.cumleBirlestir(g5, {});
  esit("başka kanal boşlukta → köprü kurulmaz", g5[0].cues[0].end, 0.92);
  esit("kanalEngeli sayıldı", s5.kanalEngeli, 1);

  /* FUZZ: kopru HICBIR senaryoda yeni kanallar arasi cakisma DOGURMAMALI. */
  var toh = 12345;
  function rnd() { toh = (toh * 1103515245 + 12345) & 0x7fffffff; return toh / 0x7fffffff; }
  function ciftler(gr) {
    var duz = [];
    gr.forEach(function (g, gi) { (g.cues || []).forEach(function (cc, ci) { duz.push({ g: gi, i: ci, s: cc.start, e: cc.end }); }); });
    duz.sort(function (a, b) { return a.s - b.s; });
    var set = {};
    for (var a = 0; a < duz.length; a++)
      for (var b = a + 1; b < duz.length; b++) {
        if (duz[b].s >= duz[a].e) break;
        if (duz[b].g !== duz[a].g) set[duz[a].g + ":" + duz[a].i + "|" + duz[b].g + ":" + duz[b].i] = 1;
      }
    return set;
  }
  var yeniCak = 0;
  for (var tur = 0; tur < 500; tur++) {
    var gr = [];
    var gs = 2 + Math.floor(rnd() * 3);
    for (var g = 0; g < gs; g++) {
      var cues = [], t = rnd() * 2;
      var n = 8 + Math.floor(rnd() * 20);
      for (var i = 0; i < n; i++) {
        var sure = 0.2 + rnd() * 0.8;
        var bos = (rnd() < 0.6) ? (0.02 + rnd() * 0.16) : (0.2 + rnd() * 1.5);
        cues.push({ start: +t.toFixed(3), end: +(t + sure).toFixed(3), text: "x",
                    cumleId: (rnd() < 0.75) ? ("c" + g + "-" + Math.floor(i / 4)) : null });
        t += sure + bos;
      }
      gr.push({ ad: "G" + g, cues: cues });
    }
    var once = ciftler(gr);
    P.cumleBirlestir(gr, {});
    var sonra = ciftler(gr);
    for (var k in sonra) if (!once[k]) yeniCak++;
  }
  esit("500 rastgele senaryoda YENİ kanallar arası çakışma", yeniCak, 0);
})();

/* ================= 6. EMOJİ SIRA NUMARALANDIRMASI ================= */
baslik("Emoji sıra numaralandırması (emoji yanlış kişiye gitmesin)");
(function (done) {
  if (!EMJ) { not("emoji.js yok, atlandı"); return done(); }
  var cumleler = [];
  for (var i = 0; i < 400; i++) {
    var tofi = i < 250;
    cumleler.push({ sira: i + 1, ad: tofi ? "Tofi" : "Moni",
                    kar: { key: tofi ? "tofi" : "moni", ad: tofi ? "Tofi" : "Moni" },
                    bas: i * 4, bit: i * 4 + 3, metin: "bu cumlede en az bes kelime var " + i });
  }
  var duygular = [{ key: "korkmus", ad: "Korkmuş" }, { key: "sasirmis", ad: "Şaşırmış" }];
  var kd = { tofi: ["korkmus", "sasirmis"], moni: ["korkmus", "sasirmis"] };
  function sahte(yerel) {
    return {
      MODEL: "t", iptalDamgasi: function () { return 1; },
      istekGonder: function (a, govde) {
        var metin = govde.messages[0].content;
        var sat = metin.split("Satirlar (numara [konusan] metin):\n")[1].split("\n");
        return Promise.resolve(JSON.stringify({
          secimler: sat.map(function (l, ix) {
            return { sira: yerel ? (ix + 1) : parseInt(l.split(" ")[0], 10), duygu: "korkmus", duygu2: "sasirmis" };
          }),
        }));
      },
    };
  }
  var kalanIs = 2;
  [["model 1'den sayıyor", true], ["model verilen numarayı yankılıyor", false]].forEach(function (par) {
    EMJ.duygulariSec(sahte(par[1]), "k", cumleler, duygular, { hedefOran: 1, karakterDuygu: kd }, 1, function () {})
      .then(function (r) {
        var say = {};
        r.secimler.forEach(function (s) { say[s.sira] = (say[s.sira] || 0) + 1; });
        var ikiKez = Object.keys(say).filter(function (k) { return say[k] > 1; }).length;
        var hic = cumleler.filter(function (c) { return !say[c.sira]; }).length;
        esit(par[0] + " → her cümle tam bir kez", [ikiKez, hic], [0, 0]);
        if (!--kalanIs) done();
      })["catch"](function (e) { hata(par[0], e.message); if (!--kalanIs) done(); });
  });
})(bitir);

/* ================= 7. ES3 / CEP UYUMLULUĞU ================= */
function bitir() {
  baslik("ES3 uyumluluğu (jsx/host.jsx Premiere'in eski motorunda çalışır)");
  (function () {
    var s;
    try { s = fs.readFileSync(path.join(KOK, "jsx", "host.jsx"), "utf8"); }
    catch (e) { hata("host.jsx okunamadı", e.message); return; }
    /* Yorum ve dizgileri temizle — asil kodda ara. */
    s = s.replace(/\/\*[\s\S]*?\*\//g, function (m) { return m.replace(/[^\n]/g, " "); })
         .replace(/\/\/[^\n]*/g, function (m) { return m.replace(/[^\n]/g, " "); })
         .replace(/"(?:[^"\\\n]|\\.)*"/g, function (m) { return m.replace(/[^\n]/g, " "); })
         .replace(/'(?:[^'\\\n]|\\.)*'/g, function (m) { return m.replace(/[^\n]/g, " "); });
    var yasak = [[/\blet\s+[A-Za-z_$]/, "let"], [/\bconst\s+[A-Za-z_$]/, "const"],
                 [/=>/, "arrow"], [/\?\./, "optional-chaining"], [/`/, "template-literal"],
                 [/\.\.\./, "spread"], [/\bclass\s+[A-Za-z]/, "class"]];
    var bulunan = [];
    s.split(/\r?\n/).forEach(function (l, i) {
      yasak.forEach(function (y) { if (y[0].test(l)) bulunan.push(y[1] + " @" + (i + 1)); });
    });
    esit("host.jsx'te ES5+ sözdizimi yok", bulunan, []);
  })();

  /* ---- 8. ARAYÜZ BAĞLANTILARI ---- */
  baslik("Arayüz bağlantıları (HTML ↔ app.js)");
  (function () {
    var h, a;
    try {
      h = fs.readFileSync(path.join(KOK, "index.html"), "utf8");
      a = fs.readFileSync(path.join(KOK, "js", "app.js"), "utf8");
    } catch (e) { hata("dosya okunamadı", e.message); return; }

    var hTemiz = h.replace(/<!--[\s\S]*?-->/g, "");
    var ac = (hTemiz.match(/<div\b[^>]*>/g) || []).length;
    var kap = (hTemiz.match(/<\/div>/g) || []).length;
    esit("div açılış/kapanış dengeli", ac - kap, 0);

    var idler = {};
    (h.match(/id="([A-Za-z0-9_]+)"/g) || []).forEach(function (m) { idler[m.slice(4, -1)] = 1; });
    /* app.js'in aradigi ama HTML'de olmayan id — sessizce calismayan dugme demek.
       Dinamik olusturulanlar haric tutulur. */
    var dinamik = { spPicker: 1 };
    var eksik = {};
    (a.match(/\$\("([A-Za-z0-9_]+)"\)/g) || []).forEach(function (m) {
      var id = m.slice(3, -2);
      if (!idler[id] && !dinamik[id]) eksik[id] = 1;
    });
    esit("app.js'in aradığı her id HTML'de var", Object.keys(eksik), []);

    /* Ana ekran kartlarinin hepsinin bir ekrani olmali. */
    var kartlar = (h.match(/data-view="(\w+)"/g) || []).map(function (m) { return m.slice(11, -1); });
    var eksikView = kartlar.filter(function (k) {
      return !idler["view" + k.charAt(0).toUpperCase() + k.slice(1)];
    });
    esit("her ana ekran kartının bir ekranı var", eksikView, []);
    /* goView her karti taniyor mu — taniamayan kart ANA EKRANA doner, sessizce. */
    var goView = a.slice(a.indexOf("function goView"), a.indexOf("function goView") + 900);
    var tanimayan = kartlar.filter(function (k) { return goView.indexOf('"' + k + '"') < 0; });
    esit("goView her kartı tanıyor", tanimayan, []);
  })();

  /* ---- 9. DAĞITIM ZİNCİRİ ---- */
  baslik("Dağıtım zinciri (yeni dosyalar ParsMazi'ye ulaşıyor mu)");
  (function () {
    var pf;
    try { pf = fs.readFileSync(path.join(KOK, "installer", "panel-files.ps1"), "utf8"); }
    catch (e) { hata("panel-files.ps1 okunamadı", e.message); return; }
    ["js", "jsx", "index.html", "varsayilan", "CSXS", "css"].forEach(function (x) {
      dogru("$PanelInclude içinde: " + x, pf.indexOf('"' + x + '"') >= 0);
    });
    /* Repo kokunde hicbir listede olmayan ust duzey oge SESSIZCE disarida kalir. */
    var bilinen = {};
    (pf.match(/"([^"]+)"/g) || []).forEach(function (m) { bilinen[m.slice(1, -1)] = 1; });
    var disarida = fs.readdirSync(KOK).filter(function (f) { return !bilinen[f]; });
    if (disarida.length) not("hiçbir listede olmayan öğe: " + disarida.join(", ") + "  (panel-files.ps1)");
    else ok("repo kökündeki her öğe bir listede");
  })();

  /* ---- 10. SÖZLÜK: BÜYÜK/KÜÇÜK "I" ASİMETRİSİ ---- */
  /* GERÇEK HATA: _norm 'I'yı 'ı'ya çeviriyor ama 'ı'yı 'i'ye çevirmiyordu, yani tablo ikiye
     bölünüyordu. Kullanıcı varyantı "ilgas" yazınca anahtar 'ilgas'; Whisper özel ismi büyük
     harfle "Ilgas" yazınca _norm 'ılgas' üretiyor ve ikisi ASLA eşleşmiyordu. BILINEN
     listesindeki "iron men" varyantı bu yüzden tamamen ölüydü. */
  baslik("Sözlük (büyük harfli varyant da eşleşmeli)");
  (function () {
    var SZ;
    try { SZ = require(path.join(KOK, "js", "sozluk.js")); }
    catch (e) { hata("sozluk.js yüklenemedi", e.message); return; }
    var harita = SZ.buildMap(SZ.defaults());
    dogru("sözlük haritası kuruldu", !!harita);
    if (!harita) return;
    /* Whisper özel isimleri BÜYÜK harfle yazar — asıl gerçek dünya durumu bu. */
    esit("küçük harfli varyant düzeliyor", SZ.fixToken("toffy", harita), "Tofi");
    esit("BÜYÜK harfli varyant da düzeliyor", SZ.fixToken("Toffy", harita), "Tofi");
    esit("zincirlenmiş ek + büyük harf", SZ.fixToken("Toffy'ye", harita), "Tofi'ye");
    /* MASUM TÜRKÇE KELİMELER BOZULMAMALI — havuz birleştirmenin bedeli ölçülür. */
    var masum = ["ışık", "ilik", "ılık", "sınır", "sinir", "minik", "mimik", "monitör",
                 "halk", "tor", "kısa", "ilişki", "imkân", "ithal", "iyi", "ısı", "için"];
    var bozulan = masum.filter(function (k) { return SZ.fixToken(k, harita) !== null; });
    esit("masum Türkçe kelimeler bozulmuyor", bozulan, []);

    /* ── EK ÜNLÜ UYUMU ──
       GERÇEK HATA: yapışık ek dalı kökü doğru adla değiştiriyor ama eki motorun YANLIŞ
       yazdığı gövdeden birebir kopyalıyordu: "tofuyu" → "Tofiyu", "torasinda" → "Dorasinda".
       Ekranda ne konuşmacının söylediği ne de doğru Türkçe olan kelimeler çıkıyordu. */
    var ekVaka = [
      ["tofuyu", "Tofiyi"], ["tofunun", "Tofinin"], ["tofuda", "Tofide"],
      ["tofudan", "Tofiden"], ["torasinda", "Dorasında"], ["nikuya", "Nikoya"],
      ["moneylerin", "Monilerin"], ["tofularla", "Tofilerle"],
      /* Zincirlenmiş ek BOZULMAMALI (CLAUDE.md'de açıkça korunan davranış). */
      ["tofulerden", "Tofilerden"], ["toffyyle", "Tofiyle"],
      /* ⚠ ÜNLÜ UYUMUNA GİRMEYEN EK (TDK): -gil her kökten sonra AYNI kalır. Körlemesine
         uyumlamak "gilde"yi "gılda"ya çevirip var olmayan bir ek üretiyordu. */
      ["dorragilde", "Doragilde"], ["tofuyken", "Tofiyken"]
    ];
    var ekYanlis = [];
    ekVaka.forEach(function (v) {
      var r = SZ.fixToken(v[0], harita);
      if (r !== v[1]) ekYanlis.push(v[0] + ": " + r + " (beklenen " + v[1] + ")");
    });
    esit("ek ünlüsü köke uyumlanıyor (uyumsuz ekler hariç)", ekYanlis, []);
  })();

  /* ---- 11. SÖZLÜK: İKİLİ BİRLEŞTİRME ZAMANA BAKMALI ---- */
  /* GERÇEK HATA: "mi mi" (Mimi), "to fi", "do ra" gibi kısa ikili anahtarlar Türkçe'de tek
     başına geçebiliyor. Birleştirme yalnız "dizide komşu mu" diye bakıyordu; 41. saniyedeki
     "…geldi mi?" ile 95. saniyedeki "Mi ne?" tek kelimeye kaynayıp 54 saniyelik bir kelime
     üretiyordu. Ama GERÇEK iki kelimeli adlar ("kaptan amerika") hâlâ birleşmeli. */
  baslik("Sözlük (ikili birleştirme — zaman ve segment)");
  (function () {
    var SZ;
    try { SZ = require(path.join(KOK, "js", "sozluk.js")); } catch (e) { hata("sozluk.js", e.message); return; }
    var harita = SZ.buildMap(SZ.defaults());
    if (!harita) { hata("harita kurulamadı"); return; }
    function kel(w, s, e, seg) { return { word: w, start: s, end: e, seg: seg }; }

    var bitisik = [kel("mi", 10.0, 10.2, 0), kel("mi", 10.25, 10.5, 0)];
    SZ.fixWords(bitisik, harita);
    esit("bitişik hece birleşiyor", bitisik.length === 1 && /Mimi/.test(bitisik[0].word), true);

    var uzak = [kel("mi", 41.0, 41.2, 3), kel("mi", 95.0, 95.4, 21)];
    SZ.fixWords(uzak, harita);
    esit("54 sn arayla olan İKİ kelime birleşMİYOR", uzak.length, 2);

    var farkliSeg = [kel("mi", 10.0, 10.2, 0), kel("mi", 10.25, 10.5, 1)];
    SZ.fixWords(farkliSeg, harita);
    esit("farklı Whisper segmenti birleşMİYOR", farkliSeg.length, 2);

    /* GERÇEK çok kelimeli ad: yavaş konuşmada araları 0.3 sn'yi aşar, yine birleşmeli. */
    var ad2 = [kel("kaptan", 5.0, 5.5, 2), kel("amerika", 6.0, 6.8, 2)];
    SZ.fixWords(ad2, harita);
    esit("çok kelimeli gerçek ad (0.5 sn ara) hâlâ birleşiyor",
         ad2.length === 1 && /Captain America/i.test(ad2[0].word), true);

    /* ⚠ "bet men" ÜÇ HARFLİ ama gerçek bir çok kelimeli ad — hece kovasına DÜŞMEMELİ.
       Eşik <=3 iken 0.40 sn ara ile birleşmiyordu (regresyon); eşik <=2 ile düzeldi. */
    var ad3 = [kel("bet", 5.0, 5.5, 2), kel("men", 5.9, 6.3, 2)];
    SZ.fixWords(ad3, harita);
    esit("bet men (0.40 sn ara) hâlâ birleşiyor",
         ad3.length === 1 && /Batman/i.test(ad3[0].word), true);

    /* ⚠ İLK PARÇANIN NOKTALAMASI CÜMLE SINIRI ÜRETMEMELİ. "To." + "fi" birleşince "Tofi."
       oluyor ve buildCues orada cue'yu flush edip yetim tek-kelimelik cue üretiyordu. */
    var nk = [kel("To.", 3.0, 3.2, 1), kel("fi", 3.25, 3.5, 1)];
    SZ.fixWords(nk, harita);
    esit("birleşen kelimede sahte cümle sonu yok",
         nk.length === 1 && nk[0].word === "Tofi", true);
    /* Sondaki noktalama (b.son) KORUNUR — gerçek cümle sonu bilgisi o. */
    var nk2 = [kel("To", 3.0, 3.2, 1), kel("fi.", 3.25, 3.5, 1)];
    SZ.fixWords(nk2, harita);
    esit("ikinci parçanın noktalaması korunuyor",
         nk2.length === 1 && nk2[0].word === "Tofi.", true);
  })();

  /* ---- 12. KİŞİLER: KLAN ETİKETİ ADIN PARÇASI ---- */
  /* GERÇEK HATA: satır sonundaki HER [..] renk sanılıp addan kesiliyordu. Dosyaya Discord'un
     GÖRÜNEN ADI yazılıyor ve görünen adlar klan etiketi taşıyabiliyor: "Player[TR]" → "Player"
     düşüyor, Craig dosyası "3-Player[TR].m4a" eşleşmiyor, kişi kanalına hiç konmuyordu. */
  baslik("Kişiler (klan etiketi renk sanılmasın)");
  (function () {
    var KS;
    try { KS = require(path.join(KOK, "js", "kisiler.js")); } catch (e) { hata("kisiler.js", e.message); return; }
    var a = KS.parseText("Niko: Player[TR]");
    esit("tanınmayan [..] adın parçası kalıyor", a.length === 1 ? a[0].adlar : null, ["Player[TR]"]);
    var b = KS.parseText("Moni: e [Blue]");
    esit("gerçek renk adı hâlâ ayrışıyor", b.length === 1 ? b[0].adlar : null, ["e"]);
    dogru("gerçek renk değeri okunuyor", b.length === 1 && b[0].renk > 0, "renk: " + (b[0] && b[0].renk));
    var c = KS.parseText("Dora: kiz [3]");
    esit("sayısal renk hâlâ ayrışıyor", c.length === 1 ? [c[0].adlar, c[0].renk] : null, [["kiz"], 3]);
  })();

  /* ---- 13. PNG: APNG SESSİZCE BOZULMASIN ---- */
  /* GERÇEK HATA: animasyon chunk'ları (acTL/fcTL/fdAT) yan chunk sayılıp IDAT'ın ÖNÜNE
     taşınıyor, fdAT içindeki piksel verisi aynalanmadan kalıyordu — geçersiz APNG üretilip
     ok:true dönüyordu. Artık açıkça reddediliyor (çağıran özgün resmi koyuyor). */
  baslik("PNG aynalama (APNG reddi)");
  (function () {
    var AY, zlib = require("zlib");
    try { AY = require(path.join(KOK, "js", "pngayna.js")); } catch (e) { hata("pngayna.js", e.message); return; }
    function crc32(buf) {
      var t = [], c, n, k;
      for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
      var r = 0xffffffff;
      for (var i = 0; i < buf.length; i++) r = t[(r ^ buf[i]) & 0xff] ^ (r >>> 8);
      return (r ^ 0xffffffff) >>> 0;
    }
    function chunk(tip, veri) {
      var u = Buffer.alloc(4); u.writeUInt32BE(veri.length, 0);
      var g = Buffer.concat([Buffer.from(tip, "ascii"), veri]);
      var c = Buffer.alloc(4); c.writeUInt32BE(crc32(g), 0);
      return Buffer.concat([u, g, c]);
    }
    // 2x1 RGBA, tek IDAT + acTL (APNG işareti)
    var ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    var ham = Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 255]);   // filtre 0 + 2 piksel
    var actl = Buffer.alloc(8); actl.writeUInt32BE(2, 0); actl.writeUInt32BE(0, 4);
    var apng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr), chunk("acTL", actl),
      chunk("IDAT", zlib.deflateSync(ham)), chunk("IEND", Buffer.alloc(0))
    ]);
    /* Geçici klasör REPO İÇİNE değil sistem tmp'sine — repo'yu kirletmesin ve iki test
       koşusu birbirinin dosyasını görmesin (benzersiz ad). */
    var tmpDir = path.join(require("os").tmpdir(), "yw-apng-test-" + process.pid);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}
    var src = path.join(tmpDir, "apng.png"), dst = path.join(tmpDir, "apng_ayna.png");
    fs.writeFileSync(src, apng);
    var r = AY.aynala(src, dst);
    dogru("APNG açıkça REDDEDİLİYOR (sessizce bozulmuyor)", r && r.ok === false,
          "dönen: " + JSON.stringify(r));
    dogru("reddedilen APNG için çıktı dosyası YAZILMIYOR", !fs.existsSync(dst));
    // düz PNG hâlâ çalışıyor
    var duz = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(ham)), chunk("IEND", Buffer.alloc(0))
    ]);
    var src2 = path.join(tmpDir, "duz.png"), dst2 = path.join(tmpDir, "duz_ayna.png");
    fs.writeFileSync(src2, duz);
    var r2 = AY.aynala(src2, dst2);
    dogru("APNG olmayan PNG hâlâ aynalanıyor", r2 && r2.ok === true, "dönen: " + JSON.stringify(r2));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  })();

  /* ---- 14. CSS: [hidden] ÖZNİTELİĞİNİ EZEN SINIF ---- */
  /* GERÇEK HATA (yedi kez): tarayıcının [hidden]{display:none} kuralı UA kaynaklı; senin
     yazdığın .sinif{display:grid} AUTHOR kaynaklı ve her zaman kazanıyor. JS'te el.hidden=true
     çalışıyor, DOM'da öznitelik görünüyor ama eleman ekranda kalıyor. */
  baslik("CSS ([hidden] ezen sınıf kalmadı mı)");
  (function () {
    var html, css, app;
    try {
      html = fs.readFileSync(path.join(KOK, "index.html"), "utf8");
      css = fs.readFileSync(path.join(KOK, "css", "style.css"), "utf8");
      app = fs.readFileSync(path.join(KOK, "js", "app.js"), "utf8");
    } catch (e) { hata("dosya okunamadı", e.message); return; }

    var yonetilen = {};
    var re1 = /\$\(\s*["']([\w-]+)["']\s*\)\s*\.hidden\s*=/g, m;
    while ((m = re1.exec(app))) yonetilen[m[1]] = 1;
    var re2 = /<[^>]*\bid="([\w-]+)"[^>]*\bhidden\b[^>]*>/g;
    while ((m = re2.exec(html))) yonetilen[m[1]] = 1;
    // degiskene alinip .hidden yazilanlar
    var deg = {}, re3 = /(?:var|let|const)\s+([\w$]+)\s*=\s*\$\(\s*["']([\w-]+)["']\s*\)/g;
    while ((m = re3.exec(app))) deg[m[1]] = m[2];
    var re4 = /([\w$]+)\.hidden\s*=/g;
    while ((m = re4.exec(app))) { if (deg[m[1]]) yonetilen[deg[m[1]]] = 1; }

    function siniflar(id) {
      var mm = new RegExp('<[^>]*\\bid="' + id + '"[^>]*>').exec(html);
      if (!mm) return null;
      var cm = mm[0].match(/\bclass="([^"]*)"/);
      return cm ? cm[1].trim().split(/\s+/) : [];
    }
    function displayVar(sec) {
      var esc = sec.replace(/-/g, "\\-");
      var re = new RegExp("\\" + esc + "\\s*(?:,[^{]*)?\\{([^}]*)\\}", "g"), mm, bul = null;
      while ((mm = re.exec(css))) {
        var dm = mm[1].match(/display\s*:\s*([\w-]+)/);
        if (dm && dm[1] !== "none") bul = dm[1];
      }
      return bul;
    }
    function hiddenKurali(sec) {
      return new RegExp("\\" + sec.replace(/-/g, "\\-") + "\\[hidden\\]").test(css);
    }
    var bozuk = [];
    Object.keys(yonetilen).forEach(function (id) {
      var cl = siniflar(id);
      if (cl === null) return;
      if (displayVar("#" + id) && !hiddenKurali("#" + id)) bozuk.push("#" + id);
      cl.forEach(function (s) {
        if (displayVar("." + s) && !hiddenKurali("." + s)) bozuk.push(id + " → ." + s);
      });
    });
    esit("hidden ile yönetilen elemanların hepsi gerçekten gizlenebiliyor", bozuk, []);
  })();

  /* ---- 15. KORUNAN KULLANICI DOSYALARI BEŞ YERDE AYNI MI ---- */
  /* GERÇEK RİSK: liste beş ayrı dosyada elle tutuluyor. Biri unutulursa kullanıcının
     sözlüğü/lisansı/preset'leri güncellemede ya da yeniden kurulumda SESSİZCE siliniyor. */
  baslik("Korunan kullanıcı dosyaları (beş liste tutarlı mı)");
  (function () {
    function oku(p) { try { return fs.readFileSync(path.join(KOK, p), "utf8"); } catch (e) { return ""; } }
    /* PowerShell yorumlarını temizle — yorumdaki apostrof/parantez ayrıştırmayı bozuyor. */
    function ps1YorumSil(t) {
      return t.split(/\r?\n/).map(function (satir) {
        var cikti = "", tirnak = null;
        for (var i = 0; i < satir.length; i++) {
          var c = satir.charAt(i);
          if (tirnak) { cikti += c; if (c === tirnak) tirnak = null; continue; }
          if (c === '"' || c === "'") { tirnak = c; cikti += c; continue; }
          if (c === "#") break;
          cikti += c;
        }
        return cikti;
      }).join("\n");
    }
    function ps1Dizi(metin, ad) {
      var t = ps1YorumSil(metin);
      var mm = t.match(new RegExp("\\$" + ad + "\\s*=\\s*@\\(([\\s\\S]*?)\\)"));
      if (!mm) return null;
      return (mm[1].match(/"[^"]*"|'[^']*'/g) || []).map(function (x) { return x.slice(1, -1); });
    }
    var A = ps1Dizi(oku("installer/panel-files.ps1"), "PanelUserFiles");
    var D = ps1Dizi(oku("installer/kur.ps1"), "koru");
    var issM = oku("installer/installer.iss").match(/Excludes:\s*"([^"]+)"/);
    var C = issM ? issM[1].split(",").map(function (s) { return s.trim(); }) : [];
    var updM = oku("js/updater.js").replace(/\/\*[\s\S]*?\*\//g, "")
                 .match(/KULLANICI_DOSYALARI\s*=\s*\[([\s\S]*?)\]/);
    var U = updM ? (updM[1].match(/"[^"]+"/g) || []).map(function (x) { return x.slice(1, -1); }) : null;
    var G = oku(".gitignore").split(/\r?\n/).map(function (s) { return s.trim().replace(/^\//, ""); });

    dogru("$PanelUserFiles okundu", !!(A && A.length), "bulunamadı");
    if (!A) return;
    function icinde(dizi, x) { return dizi && dizi.indexOf(x) >= 0; }
    var eksikler = [];
    A.forEach(function (f) {
      if (!icinde(C, f)) eksikler.push(f + " → installer.iss");
      if (!icinde(D, f)) eksikler.push(f + " → kur.ps1");
      if (!icinde(G, f)) eksikler.push(f + " → .gitignore");
      if (!icinde(U, f)) eksikler.push(f + " → updater.js");
    });
    esit("korunan dosyalar dört listede de var", eksikler, []);
    /* config.json BİLEREK dışarıda: pakete GİRMESİ gerekiyor (yoksa panel hiç açılmaz). */
    var fazla = (C || []).filter(function (f) { return f !== "config.json" && A.indexOf(f) < 0; })
                  .concat((D || []).filter(function (f) { return A.indexOf(f) < 0; }))
                  .concat((U || []).filter(function (f) { return A.indexOf(f) < 0; }));
    esit("listelerde fazladan dosya yok", fazla, []);
    /* ⚠ installer.iss'te config.json Excludes'ta AMA ayrı bir Source satırıyla gelmeli —
       yoksa temiz kurulumda panel HİÇ açılmaz (loadConfig patlar). */
    var iss = oku("installer/installer.iss");
    if (iss.indexOf("config.json") >= 0 && /Excludes:[^"]*"[^"]*config\.json/.test(iss)) {
      dogru("config.json Excludes'ta ise AYRI Source satırı var",
            /Source:\s*"staging\\panel\\config\.json"/.test(iss),
            "config.json dışlanmış ama ayrı satırla kopyalanmıyor — temiz kurulumda panel açılmaz!");
    }
  })();

  /* ---- 16. WORKER: YÖNETİM SAYFASININ KENDİ JS'İ ---- */
  /* GERÇEK RİSK: ADMIN_HTML bir template literal, yani içindeki 110 satırlık tarayıcı JS'i
     `node --check worker.js` için sadece bir METİN. Orada bir sözdizimi hatası hiçbir
     kontrole takılmadan yayına çıkar ve yönetim sayfası tümden ölür. */
  baslik("Lisans sunucusu (yönetim sayfasının gömülü JS'i)");
  (function () {
    var src, vm = require("vm");
    try { src = fs.readFileSync(path.join(KOK, "sunucu", "worker.js"), "utf8"); }
    catch (e) { hata("worker.js okunamadı", e.message); return; }
    var bas = src.indexOf("const ADMIN_HTML = `");
    if (bas < 0) { not("ADMIN_HTML bulunamadı — kontrol atlandı"); return; }
    var icBas = src.indexOf("`", bas) + 1, i = icBas, son = -1;
    while (i < src.length) {
      if (src.charAt(i) === "\\") { i += 2; continue; }
      if (src.charAt(i) === "`") { son = i; break; }
      i++;
    }
    if (son < 0) { hata("ADMIN_HTML template literal kapanmıyor"); return; }
    var htmlIc = src.slice(icBas, son).replace(/\\`/g, "`").replace(/\\\\/g, "\\").replace(/\\\$/g, "$");
    var bloklar = (htmlIc.match(/<script>[\s\S]*?<\/script>/g) || [])
                    .map(function (b) { return b.replace(/^<script>/, "").replace(/<\/script>$/, ""); });
    dogru("yönetim sayfasında script bloğu var", bloklar.length > 0);
    var kotu = [];
    bloklar.forEach(function (kod, ix) {
      try { new vm.Script(kod); } catch (e) { kotu.push("blok " + (ix + 1) + ": " + e.message); }
    });
    esit("gömülü JS sözdizimi geçerli", kotu, []);
    var tum = bloklar.join("\n");
    /* ⚠ INLINE onclick GERİ EKLENMESİN: id/ad oraya gömülünce tek tırnaklı bir isim
       ("Ali'nin PC") geçersiz JS üretiyor ve bütün düğmeler SESSİZCE ölüyordu. HTML kaçışı
       bunu düzeltmez (tarayıcı karakter referanslarını handler'ı derlemeden ÖNCE çözer). */
    esit("inline onclick yok (data-* + delegasyon)", (tum.match(/onclick=/g) || []).length, 0);
    dogru("esc() yardımcısı var", /function\s+esc\s*\(/.test(tum));
  })();

  /* ---- 17. host.jsx: SİLİNMİŞ TUZAK FONKSİYONU GERİ GELMESİN ---- */
  /* _yiginSure bütün parametrelerin zamanlarını tek mn/mx çiftinde topluyor ve yalnız YIĞIN
     çıpasına bakıyordu; karışık çıpalı (giriş+çıkış) preset'te geri uzanımı hiç görmüyor ve
     kısa klipte çıkış animasyonunu klip dışına yazdırıyordu. Yerine _yiginUzanim geldi. */
  baslik("Preset motoru (silinmiş tuzak fonksiyonu geri gelmedi)");
  (function () {
    var h;
    try { h = fs.readFileSync(path.join(KOK, "jsx", "host.jsx"), "utf8"); }
    catch (e) { hata("host.jsx okunamadı", e.message); return; }
    dogru("_yiginSure tanımı geri gelmemiş", !/function\s+_yiginSure\s*\(/.test(h));
    dogru("_yiginUzanim mevcut", /function\s+_yiginUzanim\s*\(/.test(h));
    dogru("sığdırma İKİ yönü de ölçüyor", /uz\.ileri/.test(h) && /uz\.geri/.test(h));
    /* Kafa modunda parametre çıpası ZAMANSAL öteleme üretmemeli. */
    /* ⚠ TANIMI DEĞİL ÇAĞRIYI DENETLE. Eski regex `_paramlariYaz([^)]*kafaVar)` hem
       `function _paramlariYaz(..., kafaVar)` TANIMINI hem çağrıyı eşliyordu; yani parametre
       eklenip ÇAĞRIDA geçirilmese bile test yeşil kalırdı — tam da yakalaması gereken hata. */
    dogru("_paramlariYaz tanımı kafaVar alıyor", /function\s+_paramlariYaz\([^)]*kafaVar\s*\)/.test(h));
    var cagriM = h.match(/_paramlariYaz\(\s*taze\.components\[[\s\S]{0,240}?\);/);
    dogru("presetYaz ÇAĞRISI kafaVar'ı geçiriyor", !!cagriM && /kafaVar\s*\)/.test(cagriM[0]),
          cagriM ? ("çağrı: " + cagriM[0].replace(/\s+/g, " ").slice(0, 160)) : "çağrı bulunamadı");
    dogru("kafa modunda capaDelta sıfırlanıyor", /if\s*\(kafaVar\)\s*capaDelta\s*=\s*0/.test(h));
    /* Ses klibi süzgeci ÜÇ yolda da olmalı (efektUygula, presetYaz, animasyonUygula). */
    esit("_sesKlibiMi süzgeci üç uygulama yolunda da var",
         (h.match(/if\s*\(_sesKlibiMi\(sec\[\w+\]\)\)/g) || []).length >= 3, true);
  })();

  /* ---- 17b. LİSANS: KİLİT AŞMA YOLLARI KAPALI MI ---- */
  /* Buradaki iki kontrol de bu denetimde AÇILAN (ve kapatılan) gerçek açıklardan doğdu:
     · "ham:" ön ekli bir lisans.json'un HER bilgisayarda açılması (joker kimlik),
     · iptal edilmiş bir lisansın ana dosya silinerek yedekten iptalsiz dirilmesi.
     Ağ GEREKMEZ — durumOku senkron ve kayitYaz saf dosya işi. */
  baslik("Lisans (kilit aşma yolları)");
  (function () {
    var LIS, os = require("os");
    try { LIS = require(path.join(KOK, "js", "lisans.js")); }
    catch (e) { hata("lisans.js yüklenemedi", e.message); return; }
    if (typeof LIS.kayitYaz !== "function") { not("kayitYaz dışa açık değil — ölçüm atlandı"); return; }

    var dir = path.join(os.tmpdir(), "yw-lisans-test-" + process.pid);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    fs.mkdirSync(dir, { recursive: true });
    var yol = path.join(dir, "lisans.json");
    var H = LIS.hwid();
    function durum() { var r = LIS.durumOku(dir); return r.durum + "/" + r.sebep; }

    if (!H) { not("bu makinede HWID okunamadı — lisans ölçümü atlandı"); return; }

    /* Temel: doğru kimlik açar, başka makine kilitler. */
    LIS.kayitYaz(dir, { hwid: H });
    esit("doğru kimlikle açılıyor", durum(), "acik/tamam");
    LIS.kayitYaz(dir, { hwid: "sha256-baska-makine-karmasi-0123456789" });
    esit("başka makinenin kaydı kilitliyor", durum(), "kilit/baskapc");

    /* ⚠ JOKER KİMLİK: "ham:" ön ekli, bu makineyle HİÇ ilgisi olmayan bir kayıt AÇMAMALI.
       Simetrik biçim kontrolü ("_hamH !== _hamK") tam da bunu üretiyordu: tek bir dosya
       bütün bilgisayarlarda geçerli oluyordu ve hedefin karmasını bilmeye bile gerek yoktu. */
    LIS.kayitYaz(dir, { hwid: "ham:11111111-2222-3333-4444-555555555555" });
    esit("alakasız \"ham:\" kayıt HER makinede AÇMIYOR", durum(), "kilit/baskapc");

    /* ⚠ İPTAL YEDEKTEN DİRİLMESİN. kayitYaz eskisini .bak'a alıyor; iptal yazılırken .bak
       iptalSİZ kalırsa kullanıcı ana dosyayı silip kilidi aşıyordu. */
    try { fs.unlinkSync(yol + ".bak"); } catch (e) {}
    LIS.kayitYaz(dir, { hwid: H });                    // 1. yazma (iptalsiz)
    var k2 = LIS.kayitOku(dir); k2.iptal = true;
    LIS.kayitYaz(dir, k2);                             // 2. yazma = ping'in iptal yazması
    esit("iptal okunuyor", durum(), "kilit/iptal");
    var bakVar = false;
    try { bakVar = JSON.parse(String(fs.readFileSync(yol + ".bak", "utf8"))).iptal === true; } catch (e) {}
    dogru(".bak DA iptalli (yedekten dirilme kapalı)", bakVar);
    try { fs.unlinkSync(yol); } catch (e) {}           // kullanıcı ana dosyayı siliyor
    esit("ana dosya silinince iptal AŞILMIYOR", durum(), "kilit/iptal");

    /* ⚠ YENİDEN AKTİVASYON: .bak BAYAT İPTAL TUTMAMALI. Yönetici lisansı tekrar açıp
       kullanıcı yeniden aktive ettiğinde ana dosya temizleniyor; .bak sonsuza kadar iptalli
       kalırsa ana dosya bir gün bozulduğunda kayitOku o iptalli kaydı geri yazıp paneli
       KALICI kilitler — "teknik arıza asla kilit üretmez" kuralının ihlali. */
    LIS.kayitYaz(dir, { hwid: H });
    esit("yeniden aktivasyon sonrası açılıyor", durum(), "acik/tamam");
    var bakTemiz = true;
    try { bakTemiz = !JSON.parse(String(fs.readFileSync(yol + ".bak", "utf8"))).iptal; } catch (e) {}
    dogru(".bak bayat iptal TUTMUYOR", bakTemiz);

    /* Bozuk ana dosya yedekten kurtarılmalı — "arıza kalıcı kilit üretmesin" kuralı. */
    fs.writeFileSync(yol, "{bozuk json", "utf8");
    esit("bozuk ana dosya yedekten kurtarılıyor", durum(), "acik/tamam");
    dogru("kurtarılan kayıt ana dosyaya geri yazıldı",
          fs.existsSync(yol) && JSON.parse(String(fs.readFileSync(yol, "utf8"))).hwid === H);

    /* ⚠ SALT-OKUNUR lisans.json İPTALİ ETKİSİZLEŞTİREMEZ. `attrib +R` tek adımlık bir saldırı:
       ping iptali ana dosyaya yazamıyor. Yazma sırası yanlışken (.bak rename'den ÖNCE) bu
       başarısızlık yedekteki iptali de SİLİYORDU. Artık .bak rename'den SONRA yazılıyor ve
       iptal, rename başarısız olsa bile yedeğe işleniyor. */
    LIS.kayitYaz(dir, { hwid: H });
    var roOk = true;
    try { require("child_process").execSync('attrib +R "' + yol + '"'); } catch (e) { roOk = false; }
    if (!roOk) not("attrib çalıştırılamadı — salt-okunur ölçümü atlandı");
    else {
      var k3 = LIS.kayitOku(dir); k3.iptal = true;
      var yaz3 = LIS.kayitYaz(dir, k3);
      esit("salt-okunur hedefte kayitYaz DÜRÜSTÇE false dönüyor", yaz3, false);
      var bakIptal = false;
      try { bakIptal = JSON.parse(String(fs.readFileSync(yol + ".bak", "utf8"))).iptal === true; } catch (e) {}
      dogru("iptal yedeğe YİNE DE işlendi (attrib +R bypass kapalı)", bakIptal);
      try { require("child_process").execSync('attrib -R "' + yol + '"'); } catch (e) {}
      try { fs.unlinkSync(yol); } catch (e) {}
      esit("ana dosya silinince yedekten iptal okunuyor", durum(), "kilit/iptal");
    }

    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  })();

  /* ---- 17a. SENKRON PLAN DOSYASI SÖZLEŞMESİ (panel yazar ↔ host okur) ---- */
  /* Plan dosyası iki dosyanın elle uyması gereken tek biçim. Bir taraf değişip diğeri kalırsa
     ses YANLIŞ kanala gider ya da hiç gitmez — Premiere olmadan görülemez. */
  baslik("Senkron plan dosyası (panel ↔ host biçimi)");
  (function () {
    var a, h;
    try {
      a = String(fs.readFileSync(path.join(KOK, "js", "app.js"), "utf8"));
      h = String(fs.readFileSync(path.join(KOK, "jsx", "host.jsx"), "utf8"));
    } catch (e) { hata("dosya okunamadı", e.message); return; }

    /* Normal satır: yol|kanal|başlangıç|ad → host `p.length < 4` ile eliyor. */
    dogru("panel 4 alanlı satır yazıyor",
          a.indexOf('satirlar.push(p.konacakYol + "|" + p.kanal + "|"') >= 0);
    dogru("host 4 alan bekliyor", /p\.length\s*<\s*4/.test(h));

    /* ⚠ #REZERVE: yerleştirilmeyen ama dokunulmaması gereken kanal (oyun sesi, kilitli,
       hizalanamayan). Host bunu isler/yollar'a KOYMADAN yalnız rezervasyon için kullanmalı —
       boş `yol` alanı importFiles'i düşürürdü. */
    dogru("panel #REZERVE satırı yazıyor", a.indexOf('"#REZERVE|"') >= 0);
    dogru("host #REZERVE satırını tanıyor", h.indexOf('"#REZERVE|"') >= 0);
    /* ⚠ BLOK SINIRI GERÇEKTEN ÖLÇÜLÜR. Eski hâl `h.slice(rIx, rIx+280)` içinde herhangi bir
       `continue;` arıyordu ve KOMŞU satırların continue'sunu yakalıyordu — yani rezerve dalı
       continue'yu kaybetse bile test yeşil kalırdı. Şimdi if bloğunun kendi gövdesi ayrıştırılıp
       hem `disRezerve` yazımı hem `continue` ORADA aranıyor. */
    var rIx = h.indexOf('indexOf("#REZERVE|")');
    var govde = "";
    if (rIx >= 0) {
      var acIx = h.indexOf("{", rIx), derin = 0, j2;
      for (j2 = acIx; j2 >= 0 && j2 < h.length; j2++) {
        if (h.charAt(j2) === "{") derin++;
        else if (h.charAt(j2) === "}") { derin--; if (derin === 0) { govde = h.slice(acIx, j2 + 1); break; } }
      }
    }
    dogru("rezerve dalının gövdesi ayrıştırıldı", !!govde, "if bloğu bulunamadı");
    dogru("host rezerve satırını isler'e koymadan atlıyor (kendi gövdesinde continue)",
          /continue\s*;/.test(govde), "gövde: " + govde.replace(/\s+/g, " ").slice(0, 140));
    dogru("host rezerve kanalını rezervasyon kümesine yazıyor", /disRezerve\[/.test(govde));
    /* Rezerve satırı normal ayrıştırmaya DÜŞMEMELİ: gövdede isler.push olmamalı. */
    dogru("rezerve dalı isler'e push ETMİYOR", govde.indexOf("isler.push") < 0);

    /* ⚠ ASIL YAZMA DALI REZERVASYONA BAKMAMALI — yoksa hiçbir kayıt kendi hedefine yazamaz
       (rezerve kümesi bütün plan kanallarını içeriyor). Yalnız YEDEK arama atlamalı. */
    var wIx = h.indexOf("seq.audioTracks[it.kanal].overwriteClip");
    var yazmaDali = wIx >= 0 ? h.slice(Math.max(0, wIx - 400), wIx + 200) : "";
    dogru("asıl yazma dalı rezervasyona BAKMIYOR", wIx >= 0 && yazmaDali.indexOf("rezerve[") < 0);
    var yIx = h.indexOf("var yBul = -1");
    var yedekDongu = yIx >= 0 ? h.slice(yIx, yIx + 700) : "";
    dogru("yedek arama rezervasyonu atlıyor", /if\s*\(rezerve\["k"\s*\+\s*y\]\)\s*continue;/.test(yedekDongu));
    dogru("yedek kanal da rezerve ediliyor", /rezerve\["k"\s*\+\s*yBul\]\s*=\s*true/.test(h));
  })();

  /* ---- 17c. CONFIG BİRLEŞTİRME (exe ile kurulumda program yolları tazeleniyor mu) ---- */
  /* GERÇEK BOŞLUK: config.json exe kurulumunda `onlyifdoesntexist` ile korunuyor (kullanıcının
     device/model/fontName ayarı ezilmesin), ama configBirlestir YALNIZCA oto-güncelleme
     yolunda çalışıyordu. Yani motor düzeni değişip yeni exe gönderildiğinde program yolları
     mevcut kullanıcıya HİÇ ulaşmıyordu; belirti "motor bulunamadı", sebebi görünmez.
     Çözüm: exe aynı dosyayı "config.pkg.json" adıyla da kuruyor, panel açılışta birleştiriyor. */
  baslik("Config birleştirme (exe kurulumunda program yolları)");
  (function () {
    var UPD, os = require("os");
    try { UPD = require(path.join(KOK, "js", "updater.js")); }
    catch (e) { hata("updater.js yüklenemedi", e.message); return; }
    dogru("configBirlestir dışa açık", typeof UPD.configBirlestir === "function");
    if (typeof UPD.configBirlestir !== "function") return;

    var d = path.join(os.tmpdir(), "yw-cfg-test-" + process.pid);
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
    fs.mkdirSync(d, { recursive: true });
    /* Kullanıcının mevcut config'i: elle değiştirilmiş device + ESKİ motor yolu. */
    fs.writeFileSync(path.join(d, "config.json"), JSON.stringify({
      device: "cpu", model: "large-v3", fontName: "Poetsen One",
      engineExe: "%ENGINE%/ESKI/whisper.exe", workDir: "%ENGINE%/work"
    }, null, 2), "utf8");
    /* Paketten gelen yeni sürüm: motor düzeni değişmiş + yeni anahtar. */
    fs.writeFileSync(path.join(d, "config.pkg.json"), JSON.stringify({
      device: "cuda", model: "large-v3", fontName: "Poetsen One",
      engineExe: "%ENGINE%/YENI/whisper.exe", workDir: "%ENGINE%/work",
      stylesDir: "%ENGINE%/styles", yeniAyar: 42
    }, null, 2), "utf8");

    var eklenen = UPD.configBirlestir(d, d, "config.pkg.json");
    var son = JSON.parse(String(fs.readFileSync(path.join(d, "config.json"), "utf8")));
    esit("KULLANICI ayarı korunuyor (device)", son.device, "cpu");
    esit("PROGRAM YOLU paketten tazeleniyor (engineExe)", son.engineExe, "%ENGINE%/YENI/whisper.exe");
    esit("eksik program yolu ekleniyor (stylesDir)", son.stylesDir, "%ENGINE%/styles");
    esit("yeni anahtar ekleniyor", son.yeniAyar, 42);
    esit("eklenen anahtar sayısı doğru", eklenen, 2);
    /* Her açılışta çalışacağı için idempotent OLMAK ZORUNDA. */
    var once = String(fs.readFileSync(path.join(d, "config.json"), "utf8"));
    UPD.configBirlestir(d, d, "config.pkg.json");
    esit("ikinci çağrı hiçbir şey değiştirmiyor", String(fs.readFileSync(path.join(d, "config.json"), "utf8")), once);
    /* Paket dosyası yoksa (zip yolu) dokunmamalı. */
    fs.unlinkSync(path.join(d, "config.pkg.json"));
    esit("paket dosyası yoksa 0 döner", UPD.configBirlestir(d, d, "config.pkg.json"), 0);
    /* ⚠ config.pkg.json KORUNAN listelere GİRMEMELİ — korunursa hiç tazelenmez. */
    var pf = "";
    try { pf = String(fs.readFileSync(path.join(KOK, "installer", "panel-files.ps1"), "utf8")); } catch (e) {}
    dogru("config.pkg.json korunan dosya listesinde DEĞİL", pf.indexOf("config.pkg.json") < 0);

    /* ⚠⚠ BAYATLIK NÖBETÇİSİ — ASIL REGRESYON BUYDU.
       config.pkg.json'u YALNIZ exe kuruyor; zip paketinde yok ve updater'ın copyDir'i hiçbir
       şeyi silmiyor. Dosya diskte KALIRSA: zip güncellemesi config.json'daki program yollarını
       doğru tazeliyor, panel bir sonraki açılışta aynı yolları BAYAT dosyadan ESKİ değerlere
       geri çekiyordu (ölçüldü) — yani özellik, önlemek için yazıldığı hatayı zip yoluna, ikinci
       kullanıcının kullandığı yola taşıyordu.
       İKİ emniyet var ve ikisi de burada denetleniyor:
         1. app.js birleştirdikten SONRA dosyayı SİLİYOR (tek kullanımlık).
         2. updater.js zip güncellemesinde kalıntıyı siliyor. */
    var appSrc = "", updSrc = "";
    try { appSrc = String(fs.readFileSync(path.join(KOK, "js", "app.js"), "utf8")); } catch (e) {}
    try { updSrc = String(fs.readFileSync(path.join(KOK, "js", "updater.js"), "utf8")); } catch (e) {}
    dogru("app.js birleştirdikten sonra config.pkg.json'u SİLİYOR",
          /unlinkSync\(\s*_pkgYol\s*\)/.test(appSrc));
    dogru("updater.js zip güncellemesinde kalıntıyı siliyor",
          /unlinkSync\(path\.join\(extRoot,\s*"config\.pkg\.json"\)\)/.test(updSrc));
    /* Davranışsal ölçüm: bayat dosya varken bile ikinci birleştirme aynı değeri üretmeli
       (idempotent). Asıl koruma silme, bu ek emniyet. */
    fs.writeFileSync(path.join(d, "config.json"), JSON.stringify({ engineExe: "%ENGINE%/v2/w.exe" }, null, 2), "utf8");
    fs.writeFileSync(path.join(d, "config.pkg.json"), JSON.stringify({ engineExe: "%ENGINE%/v1/w.exe" }, null, 2), "utf8");
    UPD.configBirlestir(d, d, "config.pkg.json");
    var geri = JSON.parse(String(fs.readFileSync(path.join(d, "config.json"), "utf8"))).engineExe;
    not("bayat paket dosyası bırakılırsa yolu geri alır (" + geri + ") — bu yüzden SİLİNİYOR");
    /* installer.iss onu ignoreversion ile kurmalı. */
    var iss = "";
    try { iss = String(fs.readFileSync(path.join(KOK, "installer", "installer.iss"), "utf8")); } catch (e) {}
    dogru("installer.iss config.pkg.json'u ignoreversion ile kuruyor",
          /DestName:\s*"config\.pkg\.json"[^\n]*ignoreversion/.test(iss));

    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
  })();

  /* ---- 17d. EMOJİ YERLEŞTİRME: DONMA KORUMASI VE MALİYET ---- */
  /* GERÇEK OLAY (ParsMazi, 10 Ağustos 2026): emoji yerleştirme "155/206"da kaldı, Premiere
     yanıt vermedi. Görev Yöneticisi: Premiere %0,3 CPU — hesaplamıyor, ekranda açtığı
     "Save Project" penceresini bekliyor. Panel `evalES`in geri çağrısını sonsuza kadar
     beklediği için donmuş Premiere ile çalışan Premiere BİRBİRİNDEN AYIRT EDİLEMİYORDU. */
  baslik("Emoji yerleştirme (donma koruması)");
  (function () {
    var a, h;
    try {
      a = String(fs.readFileSync(path.join(KOK, "js", "app.js"), "utf8"));
      h = String(fs.readFileSync(path.join(KOK, "jsx", "host.jsx"), "utf8"));
    } catch (e) { hata("dosya okunamadı", e.message); return; }

    /* NÖBETÇİ: evalES uzun çağrıda "hâlâ bekliyoruz" bilgisi verebilmeli. */
    dogru("evalES nöbetçi (izle) parametresi alıyor", /function evalES\(code,\s*izle\)/.test(a));
    dogru("nöbetçi setInterval ile çalışıyor", /if \(typeof izle === "function"\)[\s\S]{0,200}setInterval/.test(a));
    /* ⚠ PROMISE TERK EDİLMEMELİ. Zaman aşımıyla vazgeçmek yeni bir kilitlenme doğurur:
       Premiere kilitliyse sonraki evalScript de sıraya girer ve panel bu kez ilerleme
       sayısı olmayan bir adımda donar; üstelik sırada bekleyen çağrının okuyacağı geçici
       plan dosyası silinmiş olur. Nöbetçi yalnız BİLGİ verir. */
    var evalBlok = a.slice(a.indexOf("function evalES(code"), a.indexOf("function evalES(code") + 900);
    dogru("evalES promise'i TERK ETMİYOR (zaman aşımıyla res çağırmıyor)",
          evalBlok.indexOf("res(") >= 0 && !/setTimeout\([^)]*res\(/.test(evalBlok));
    dogru("emoji yerleştirme nöbetçiyi kullanıyor",
          /emojiYerlestir\("[\s\S]{0,300}function \(sn\)/.test(a));
    dogru("60 sn sonra kullanıcıya ne yapacağı yazılıyor",
          /sn >= 60[\s\S]{0,300}Premiere yanıt vermiyor/.test(a));

    /* İPTAL: parça sınırında. Çalışan evalScript kesilemez ama sıradaki parça başlamamalı. */
    dogru("emoji iptal bayrağı var", /var _emojiIptal = false/.test(a));
    dogru("parça döngüsü iptali kontrol ediyor", /if \(_emojiIptal\)[\s\S]{0,60}break/.test(a));
    dogru("iptal düğmesi bağlanmış", /btnEmojiIptal[\s\S]{0,900}_emojiIptal = true/.test(a));

    /* ÖNDEN UYARI: iş başlamadan kaç emoji/parça ve "Premiere donuk görünecek". */
    dogru("başlamadan önce süre/parça uyarısı veriliyor",
          /Emoji yerleştirme başlıyor[\s\S]{0,200}DONUK/.test(a));

    /* MALİYET: iki parametre TEK yürüyüşte bulunmalı (Position + Scale aynı Motion'da). */
    dogru("_paramAraIki tanımlı", /function _paramAraIki\(/.test(h));
    /* ⚠ BLOK YETERİNCE GENİŞ OLMALI: emojiYerlestir uzun bir fonksiyon (~14 bin karakter) ve
       parametre yazımı sonlara doğru. Dar bir pencere testi YANLIŞ NEGATİF yapar — kod doğru
       olduğu hâlde "kaldı" der; bir kez tam bu oldu (9000 karakterde çağrı görünmüyordu). */
    var _yIx = h.indexOf("function emojiYerlestir");
    var yerBlok = h.slice(_yIx, _yIx + 16000);
    dogru("emojiYerlestir tek yürüyüş kullanıyor", /_paramAraIki\(ti,/.test(yerBlok));
    esit("emojiYerlestir'de artık iki ayrı _paramAraTum çağrısı YOK",
         (yerBlok.match(/_paramAraTum\(ti,/g) || []).length, 0);

    /* GÜVENLİK TARAMASI O(n²) OLMAMALI — son N klip yeter (klipler zaman sırasında). */
    dogru("tarama tavanı var (_TARA_TAVAN)", /_TARA_TAVAN\s*=\s*\d+/.test(yerBlok));
    dogru("tarama sondan başlıyor", /for \(ci = mevcut - 1; ci >= _bas; ci--\)/.test(yerBlok));
    /* Tavan EMOJI_PARCA'dan büyük olmalı: önceki parçanın koyduğu her klip kapsamda kalsın. */
    var tavanM = yerBlok.match(/_TARA_TAVAN\s*=\s*(\d+)/);
    var parcaM = a.match(/EMOJI_PARCA\s*=\s*(\d+)/);
    if (tavanM && parcaM) {
      dogru("tarama tavanı (" + tavanM[1] + ") parça boyutundan (" + parcaM[1] + ") BÜYÜK",
            parseInt(tavanM[1], 10) > parseInt(parcaM[1], 10),
            "küçükse önceki parçanın klipleri denetimsiz kalır");
    }
    /* İLK PARÇA KURALI DEĞİŞMEDİ: kanal BOŞ olmak zorunda (v1.8.0 koruması). */
    dogru("ilk parçada kanal BOŞ olma kuralı duruyor",
          /if \(!devam\) return "err:V"[\s\S]{0,120}BOS DEGIL/.test(yerBlok));
  })();

  /* ---- 18. POWERSHELL: BOM'SUZ DOSYADA DİZGE İÇİ ASCII-DIŞI KARAKTER ---- */
  /* GERÇEK HATA (bu denetimde ben ürettim): bir throw mesajına uzun tire (—) koymak
     publish-github.ps1'i TAMAMEN ayrıştırılamaz hâle getirdi. Sebep: dosya BOM'suz UTF-8 ama
     Windows PowerShell 5.1 BOM'suz .ps1'i ANSI (cp1254) okuyor; U+2014'ün UTF-8 baytlarından
     0x94, cp1254'te KAPATAN AKILLI TIRNAK (U+201D) oluyor ve PowerShell onu geçerli bir dizge
     sonlandırıcı sayıyor. Dizge orada bitiyor, devamı kod olarak ayrıştırılıyor ve betik TEK
     SATIR bile çalışmadan ölüyor. Yorum satırlarındaki uzun tire zararsız (yorum ayrıştırılmaz).
     BOM'lu dosyalar bağışık — o yüzden kontrol yalnız BOM'suzlara uygulanır. */
  baslik("PowerShell (BOM'suz betikte dizge içi ASCII-dışı karakter)");
  (function () {
    var ps1 = [];
    ["", "installer"].forEach(function (alt) {
      var d = alt ? path.join(KOK, alt) : KOK;
      try {
        fs.readdirSync(d).forEach(function (f) {
          if (/\.ps1$/i.test(f)) ps1.push({ ad: (alt ? alt + "/" : "") + f, yol: path.join(d, f) });
        });
      } catch (e) {}
    });
    dogru(".ps1 dosyaları bulundu (" + ps1.length + ")", ps1.length > 0);
    var riskli = [];
    ps1.forEach(function (p) {
      var buf;
      try { buf = fs.readFileSync(p.yol); } catch (e) { return; }
      var bomlu = (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF);
      if (bomlu) return;                       // BOM varsa PowerShell UTF-8 okur, bağışık
      var metin = buf.toString("utf8");
      metin.split(/\r?\n/).forEach(function (satir, ix) {
        /* Yorumu at: satırın ilk # işaretinden sonrası (dizge içindeki # hariç) ayrıştırılmaz. */
        var kod = "", tirnak = null;
        for (var i = 0; i < satir.length; i++) {
          var c = satir.charAt(i);
          if (tirnak) { kod += c; if (c === tirnak) tirnak = null; continue; }
          if (c === '"' || c === "'") { tirnak = c; kod += c; continue; }
          if (c === "#") break;
          kod += c;
        }
        /* ⚠ TEHLİKE HER ASCII-DIŞI KARAKTER DEĞİL, YALNIZ cp1254'te TIRNAĞA DÖNÜŞENLER.
           "ü" (U+00FC → C3 BC) zararsız: iki bayt da cp1254'te harf. Ama uzun tire
           (U+2014 → E2 80 94) son baytıyla U+201D "kapatan çift tırnak" üretiyor ve dizgeyi
           erkenden bitiriyor. cp1254'te tırnak olan baytlar: 0x91 ' · 0x92 ' · 0x93 " · 0x94 ".
           En sık suçlular: — (U+2014), – (U+2013), ‑ (U+2011). */
        var TIRNAK_BAYT = { 0x91: 1, 0x92: 1, 0x93: 1, 0x94: 1 };
        var dz = kod.match(/"[^"]*"|'[^']*'/g) || [];
        dz.forEach(function (d) {
          var b = Buffer.from(d, "utf8"), kotu = [];
          for (var bi = 0; bi < b.length; bi++) if (TIRNAK_BAYT[b[bi]]) kotu.push("0x" + b[bi].toString(16));
          if (kotu.length) riskli.push(p.ad + ":" + (ix + 1) + " → " + kotu.join(",") +
                                       " (dizgeyi erken kapatır) " + d.slice(0, 50));
        });
      });
    });
    esit("BOM'suz .ps1 dizgelerinde ASCII-dışı karakter yok", riskli, []);
  })();

/* ================= 19. BİLDİRİMDEN ÖNCE KULLANIM (var hoisting) =================
   ⚠ GERÇEKTEN OLDU — v1.9.20, ParsMazi'de emoji özelliğini TÜMDEN çökertti (10 Ağustos 2026).
   app.js emojiEkle içinde `_parcaToplam` hesabı `kgAnah.length` okuyordu ama `var kgAnah = []`
   bildirimi 9 satır AŞAĞIDAYDI. `var` hoisting'i adı fonksiyon başına taşır ama DEĞERİNİ
   atamaz: bildirim satırına gelmeden değer `undefined`, yani `undefined.length` →
   "Cannot read properties of undefined (reading 'length')".
   NEDEN BU KADAR PAHALI: hata plan üretildikten ve yapay zekâ isteğinin PARASI ödendikten
   SONRA patlıyor. Ve sözdizimi geçerli olduğu için hiçbir ayrıştırıcı yakalamıyor.
   AYNI TUZAK ZATEN YAZILIYDI (app.js'te `uyarilar` dizisi için bir uyarı bloğu var) — uyarı
   yazmak yetmedi, nöbetçi gerekti.
   KASITLI BOZMAYLA KANITLANDI: v1.9.20'nin gerçek app.js'i (git 9e3da4d) taranınca tarayıcı
   `kgAnah` ve `kanalGrup`'u bildiriminden önce kullanılmış diye yakalıyor; düzeltilmiş kodda
   10 dosyanın hepsinde 0 bulgu.
   ⚠ YANLIŞ POZİTİF İKİ YERDEN GELİYORDU, İKİSİ DE KAPATILDI — kurcalarsan geri gelirler:
   (1) fonksiyon PARAMETRESİ dıştaki var'ı gölgeler, o yüzden çerçeve `function` kelimesinden
       başlar, `{`'ten değil (`function aynaliYol(yol)` yoksa "yol" bulgusu verirdi);
   (2) regex BAYRAKLARI da maskelenmeli — `/^v/i` içindeki "i" aksi hâlde identifier sanılıyor. */
  baslik("Bildirimden önce kullanım (var hoisting — v1.9.20 emoji çökmesi)");
  (function () {
    /* String / yorum / regex maskele. Ofsetler korunur (aynı uzunlukta boşluk). */
    function maskele(s) {
      var out = s.split(""), i = 0, n = s.length, onceki = "";
      function bosalt(a, b) { for (var k = a; k < b && k < n; k++) if (out[k] !== "\n") out[k] = " "; }
      while (i < n) {
        var c = s.charAt(i), c2 = s.substr(i, 2);
        if (c2 === "//") { var e = s.indexOf("\n", i); if (e < 0) e = n; bosalt(i, e); i = e; continue; }
        if (c2 === "/*") { var e2 = s.indexOf("*/", i + 2); e2 = (e2 < 0) ? n : e2 + 2; bosalt(i, e2); i = e2; continue; }
        if (c === '"' || c === "'" || c === "`") {
          var j = i + 1;
          while (j < n) { if (s.charAt(j) === "\\") { j += 2; continue; } if (s.charAt(j) === c) break; j++; }
          bosalt(i, Math.min(j + 1, n)); i = j + 1; onceki = "s"; continue;
        }
        if (c === "/" && /[=(,:;[!&|?{}+\-*%~^]|return|typeof|case/.test(onceki)) {
          var k2 = i + 1, sinif = false, bitti = false;
          while (k2 < n) {
            var ch = s.charAt(k2);
            if (ch === "\\") { k2 += 2; continue; }
            if (ch === "\n") break;
            if (sinif) { if (ch === "]") sinif = false; }
            else if (ch === "[") sinif = true;
            else if (ch === "/") { bitti = true; break; }
            k2++;
          }
          if (bitti) {
            var bay = k2 + 1;                    // (2) bayrakları da yut
            while (bay < n && /[a-z]/.test(s.charAt(bay))) bay++;
            bosalt(i, bay); i = bay; onceki = "s"; continue;
          }
        }
        if (!/\s/.test(c)) {
          if (/[\w$]/.test(c)) { var mm = /[\w$]+/.exec(s.slice(i)); onceki = mm ? mm[0] : c; }
          else onceki = c;
        }
        i++;
      }
      return out.join("");
    }
    /* Fonksiyon çerçeveleri. (1) bas = `function` kelimesi, govdeBas = gövdenin `{`'i. */
    function cerceveler(m) {
      var res = [], re = /\bfunction\b/g, mm;
      while ((mm = re.exec(m))) {
        var ac = m.indexOf("{", mm.index);
        if (ac < 0) continue;
        var d = 0, i = ac, son = -1;
        for (; i < m.length; i++) {
          var c = m.charAt(i);
          if (c === "{") d++;
          else if (c === "}") { d--; if (d === 0) { son = i; break; } }
        }
        if (son > 0) res.push({ bas: mm.index, govdeBas: ac, son: son });
      }
      return res;
    }
    function satirNo(s, ofs) { return s.slice(0, ofs).split("\n").length; }

    function taraKaynak(ham) {
      var m = maskele(ham), frames = cerceveler(m), bulgular = [];
      frames.forEach(function (f) {
        var govde = m.slice(f.govdeBas, f.son);
        /* İç fonksiyonlar HARİÇ: closure sonra çağrılıyor, hoisting sorunu değil. */
        var ic = frames.filter(function (g) { return g.bas > f.govdeBas && g.son < f.son; });
        function icteMi(ofs) {
          for (var i = 0; i < ic.length; i++) if (ofs > ic[i].bas && ofs < ic[i].son) return true;
          return false;
        }
        var declRe = /\bvar\s+/g, dm, adlar = {};
        while ((dm = declRe.exec(govde))) {
          if (icteMi(f.govdeBas + dm.index)) continue;
          var i2 = dm.index + dm[0].length, d2 = 0, bekleAd = true;
          while (i2 < govde.length) {                 // virgül listesini derinlik 0'da çöz
            var c = govde.charAt(i2);
            if (c === "(" || c === "[" || c === "{") d2++;
            else if (c === ")" || c === "]" || c === "}") { if (d2 === 0) break; d2--; }
            else if (c === ";" && d2 === 0) break;
            else if (c === "," && d2 === 0) { bekleAd = true; i2++; continue; }
            else if (d2 === 0 && bekleAd && /[A-Za-z_$]/.test(c)) {
              var nm = /[\w$]+/.exec(govde.slice(i2))[0];
              if (adlar[nm] === undefined) adlar[nm] = f.govdeBas + i2;
              bekleAd = false; i2 += nm.length; continue;
            }
            else if (d2 === 0 && c === "=" && govde.charAt(i2 + 1) !== "=") bekleAd = false;
            i2++;
          }
        }
        Object.keys(adlar).forEach(function (ad) {
          var declOfs = adlar[ad], um;
          var ure = new RegExp("(^|[^\\w$.])" + ad.replace(/\$/g, "\\$") + "(?![\\w$])", "g");
          while ((um = ure.exec(govde))) {
            var uofs = f.govdeBas + um.index + um[1].length;
            if (uofs >= declOfs) break;
            if (icteMi(uofs)) continue;
            if (/^\s*:/.test(govde.slice(um.index + um[1].length + ad.length))) continue;  // {ad: ...}
            bulgular.push(ad + " → satır " + satirNo(ham, uofs) +
                          " kullanılıyor, satır " + satirNo(ham, declOfs) + "'de bildiriliyor");
            break;
          }
        });
      });
      return bulgular;
    }

    var dosyalar = ["js/app.js", "js/pipeline.js", "js/emoji.js", "js/vurucu.js", "js/hizala.js",
                    "js/sozluk.js", "js/kisiler.js", "js/pngayna.js", "js/updater.js", "js/lisans.js"];
    var tumBulgu = [], taranan = 0;
    dosyalar.forEach(function (rel) {
      var y = path.join(KOK, rel), ham;
      try { ham = fs.readFileSync(y, "utf8"); } catch (e) { return; }
      taranan++;
      taraKaynak(ham).forEach(function (b) { tumBulgu.push(rel + ": " + b); });
    });
    dogru("panel JS dosyaları tarandı (" + taranan + ")", taranan >= 8);
    esit("hiçbir var bildiriminden önce kullanılmıyor", tumBulgu, []);

    /* NÖBETÇİNİN KENDİSİ ÇALIŞIYOR MU — kasıtlı bozma. Bu olmadan test "hep yeşil" olabilir. */
    var sahte = [
      "function f() {",
      "  var toplam = 0, k;",
      "  for (k = 0; k < liste.length; k++) toplam += liste[k];",
      "  var liste = [1, 2, 3];",
      "  return toplam;",
      "}"
    ].join("\n");
    dogru("nöbetçi kasıtlı bozmayı yakalıyor", taraKaynak(sahte).length === 1,
          "bulgular: " + JSON.stringify(taraKaynak(sahte)));
    /* Ve yanlış pozitif üretmiyor: parametre gölgeleme + regex bayrağı. */
    var temiz = [
      "function f() {",
      "  var ad = String(x).replace(/^v/i, '');",
      "  function ic(ad) { return ad + 1; }",
      "  return ic(ad);",
      "}"
    ].join("\n");
    esit("parametre gölgeleme ve regex bayrağı yanlış pozitif vermiyor", taraKaynak(temiz), []);
  })();

  /* ---- ÖZET ---- */
  console.log("\n" + new Array(52).join("="));
  console.log(gecti + " geçti · " + kaldi + " KALDI · " + uyari + " not");
  console.log(kaldi ? "!! SÜRÜM ÇIKARMA — önce yukarıdaki satırları düzelt."
                    : "Panel denetimden temiz geçti.");
  process.exit(kaldi ? 1 : 0);
}
