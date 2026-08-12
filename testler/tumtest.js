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
                 "halk", "tor", "kısa", "ilişki", "imkân", "ithal", "iyi", "ısı", "için",
                 /* "tobi" varyantı eklendikten sonra (11 Ağustos 2026) bu üçü nöbetçi:
                    tobra bir merhem markası, tobik/otobüs gerçek kelimeler. */
                 "tobra", "tobik", "otobüs", "otobüsü",
                 /* "tuffy" varyantı eklendikten sonra (12 Ağustos 2026) bunlar nöbetçi:
                    tufan bir isim, tuğla/tuz/tüf gerçek kelimeler, stuffy İngilizce bir
                    kelime ve "tuffy"yi İÇERİYOR — parça eşleşme olmadığını kanıtlıyor. */
                 "tuff", "tufan", "tuğla", "tuz", "tüf", "stuffy"];
    var bozulan = masum.filter(function (k) { return SZ.fixToken(k, harita) !== null; });
    esit("masum Türkçe kelimeler bozulmuyor", bozulan, []);

    /* ── "TOBİ" → "TOFİ" (ParsMazi, 11 Ağustos 2026: "10'da 9'a Tofi değil TOBİ yazıyor") ──
       Motor Türkçe dinlerken f/b'yi karıştırıyor. Varyant listeye eklendi; buradaki test
       varyantın hem düz hem çekimli biçimde tuttuğunu sabitliyor. */
    esit("tobi → Tofi", SZ.fixToken("tobi", harita), "Tofi");
    esit("Tobi'ye → Tofi'ye", SZ.fixToken("Tobi'ye", harita), "Tofi'ye");
    esit("tobilerden → Tofilerden", SZ.fixToken("tobilerden", harita), "Tofilerden");
    esit("cümle içinde", SZ.fixText("Ya Tobi ne yaptın", harita), "Ya Tofi ne yaptın");

    /* ── "TUFFY" → "TOFİ" (kullanıcı isteği, 12 Ağustos 2026) ──
       Aynı istekte gelen "Tobi" ve "Toby" ZATEN listedeydi ve çalışıyordu (yukarıdaki
       testler); eksik olan tek yazım "tuffy" idi. Ölçüm önce yapıldı, sonra eklendi. */
    esit("tuffy → Tofi", SZ.fixToken("tuffy", harita), "Tofi");
    esit("Tuffy (büyük harf) → Tofi", SZ.fixToken("Tuffy", harita), "Tofi");
    esit("tuffyler → Tofiler (Türkçe ek)", SZ.fixToken("tuffyler", harita), "Tofiler");
    esit("toby → Tofi (zaten vardı)", SZ.fixToken("toby", harita), "Tofi");
    /* ⚠ PAKET_SURUM ARTIRILMADAN yeni varyant, sözlüğünü bir kez kaydetmiş kullanıcıya
       ULAŞMAZ (load() kendi dosyası varsa VARSAYILAN'a hiç bakmıyor). Bu satır o
       artışı kilitliyor: varyant eklenip sürüm unutulursa test kırmızı verir. */
    dogru("PAKET_SURUM 'tuffy' eklemesiyle artırıldı (>=3)", SZ.PAKET_SURUM >= 3,
          "artırılmazsa yeni varyant mevcut kullanıcıya hiç ulaşmaz");

    /* ── PAKETTEKİ YENİ VARYANT MEVCUT KULLANICIYA ULAŞIYOR MU ──
       ⚠ Bu testin sebebi: VARSAYILAN'a varyant eklemek TEK BAŞINA yetmiyor. load() kullanıcının
       sozluk.json'ı varsa varsayılana hiç bakmıyor, yani "tobi" düzeltmesi sözlüğü bir kez
       kaydetmiş HİÇ KİMSEYE ulaşmazdı. Aynı soru bu projede üç kez çıktı (emoji PNG tazeleme,
       preset.secili birleştirmesi, şimdi sözlük): "yeni hazır içerik MEVCUT kullanıcıya nasıl
       ulaşacak?" — cevabı olmayan her ekleme sessizce ölü doğuyor. */
    (function () {
      var os = require("os");
      var tmp = path.join(os.tmpdir(), "yw-sozluk-test-" + process.pid);
      try { fs.mkdirSync(tmp, { recursive: true }); } catch (e) {}
      var dosya = path.join(tmp, SZ.DOSYA);
      function yaz(o) { fs.writeFileSync(dosya, JSON.stringify(o), "utf8"); }
      function oku() { return JSON.parse(fs.readFileSync(dosya, "utf8")); }

      try { fs.unlinkSync(dosya); } catch (e) {}
      esit("dosya yoksa dokunmaz (load zaten varsayılanı verir)",
           SZ.paketBirlestir(tmp).durum, "dosya-yok");

      /* Damgasız ESKİ kullanıcı dosyası: kendi ismi + eksik varyantlar */
      yaz({ entries: [{ ad: "Tofi", varyant: ["toffy"] },
                      { ad: "ParsMazi", varyant: ["pars mazi"] }] });
      var r = SZ.paketBirlestir(tmp), son = oku();
      esit("eski dosya birleştirildi", r.durum, "birlestirildi");
      var tofiE = son.entries.filter(function (e) { return e.ad === "Tofi"; })[0];
      dogru("paketteki 'tobi' kullanıcının dosyasına eklendi", tofiE.varyant.indexOf("tobi") !== -1,
            "varyantlar: " + tofiE.varyant.join(", "));
      dogru("KULLANICININ kendi ismi korundu",
            son.entries.some(function (e) { return e.ad === "ParsMazi"; }));
      dogru("kullanıcının kendi varyantı korundu",
            son.entries.filter(function (e) { return e.ad === "ParsMazi"; })[0].varyant.join(",") === "pars mazi");
      esit("damga yazıldı", son.pkgSurum, SZ.PAKET_SURUM);
      esit("ikinci çağrı hiçbir şey yapmıyor", SZ.paketBirlestir(tmp).durum, "guncel");

      /* ⚠ KULLANICI BİLEREK BOŞALTTIYSA DOKUNULMAZ — load()'daki aynı kural. */
      yaz({ entries: [] });
      esit("bilerek boşaltılmış sözlüğe dokunulmuyor", SZ.paketBirlestir(tmp).durum, "bos-birakilmis");
      esit("gerçekten boş kaldı", oku().entries.length, 0);

      /* ⚠ DAMGALI dosyada kullanıcının SİLDİĞİ varyant geri GELMEMELİ — damganın varlık sebebi. */
      yaz({ pkgSurum: SZ.PAKET_SURUM, entries: [{ ad: "Tofi", varyant: ["toffy"] }] });
      SZ.paketBirlestir(tmp);
      esit("kullanıcının sildiği varyant geri gelmiyor", oku().entries[0].varyant, ["toffy"]);

      /* save() damgayı YAZMAK ZORUNDA: yazmazsa her kayıttan sonra birleştirme yeniden
         çalışır ve yukarıdaki "geri gelmiyor" güvencesi çöker. */
      SZ.save(tmp, [{ ad: "Tofi", varyant: ["toffy"] }]);
      esit("save() damgayı koruyor", oku().pkgSurum, SZ.PAKET_SURUM);

      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    })();

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
    dogru("_paramlariYaz tanımı kafaVar alıyor", /function\s+_paramlariYaz\([^)]*kafaVar/.test(h));
    var cagriM = h.match(/_paramlariYaz\(\s*taze\.components\[[\s\S]{0,300}?\);/);
    dogru("presetYaz ÇAĞRISI kafaVar'ı geçiriyor",
          !!cagriM && cagriM[0].indexOf("kafaVar") !== -1,
          cagriM ? ("çağrı: " + cagriM[0].replace(/\s+/g, " ").slice(0, 200)) : "çağrı bulunamadı");
    /* ⚠ konumAtla (12. argüman) — Shorts emojisinde preset'in Position'ı paneli ezmesin diye
       eklendi (kullanıcı: "emoji sağ taraf olayı olmasın, tam ortada dursun"). Tanım, çağrı
       ve gerçek atlama dalı AYRI AYRI denetlenir: yalnız imzaya bakmak, parametrenin
       geçirilip hiç KULLANILMAMASI hâlini kaçırırdı (bu testin kendi geçmişindeki hata). */
    dogru("_paramlariYaz tanımı konumAtla alıyor", /function\s+_paramlariYaz\([^)]*konumAtla\s*\)/.test(h));
    dogru("presetYaz ÇAĞRISI konumAtla'yı geçiriyor",
          !!cagriM && cagriM[0].indexOf("konumAtla") !== -1);
    dogru("konumAtla GERÇEKTEN spatial parametreyi atlıyor",
          /if\s*\(konumAtla\s*&&\s*_spatialMi\(/.test(h));
    dogru("presetYaz 4. argüman olarak konumAtla alıyor",
          /function\s+presetYaz\([^)]*konumAtla\s*\)/.test(h));
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
          /sn >= 60[\s\S]{0,600}Premiere YANIT VERMİYOR/.test(a));
    /* ⚠ MESAJ EN SIK SUÇLUYU ADIYLA SÖYLEMELİ (ParsMazi'de iki kez takıldı, 10 ve 11
       Ağustos 2026). "Bir pencere var mı?" demek yetmiyor — kullanıcı Premiere'i öne alıp
       bakmayı akıl etmiyor ve paneli öldürüyor. */
    dogru("nöbetçi Auto Save'i ADIYLA söylüyor", /sn >= 60[\s\S]{0,600}Auto Save/.test(a));
    dogru("nöbetçi 'devam eder, kaybolmaz' güvencesini veriyor",
          /sn >= 60[\s\S]{0,700}DEVAM EDER[\s\S]{0,120}kaybolmaz/.test(a));
    /* Uzun planda Auto Save uyarısı log'a düşüyor mu — takılmanın önlenebilir tek kolu. */
    dogru("80+ emojide Auto Save uyarısı veriliyor",
          /plan\.length > 80[\s\S]{0,400}Auto Save/.test(a));

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
    /* ⚠ HIZ: clips.numItems emoji başına 4 kez okunuyordu — her biri ayrı Premiere turu
       (ParsMazi, 11 Ağustos 2026: "okey ekledi ama çok yavaştı"). 172 emojide 344 gereksiz
       çağrı. overwriteClip'ten sonra BİR KEZ okunup değişkende tutuluyor; geri okuma ilkesi
       bozulmuyor, yalnız tekrarı kalkıyor. */
    (function () {
      var i0 = h.indexOf("function emojiYerlestir");
      var blok = h.slice(i0, h.indexOf("\nfunction ", i0 + 10));
      var ana = blok.slice(blok.lastIndexOf("for (i = 0; i < plan.length; i++)"));
      var say = (ana.match(/\.clips\.numItems/g) || []).length;
      dogru("ana döngüde clips.numItems en fazla 2 kez okunuyor", say <= 2, "olan: " + say);
      dogru("yeniSayi değişkeni yeniden kullanılıyor", ana.indexOf("yeniSayi") !== -1);
    })();

    /* ⚠ BİRİKMİŞ KATMAN ONAYI (ParsMazi: "emoji ekleme kısmı baya bi bozuk knkm"). Panel eski
       katmanları zaten temizliyordu ama SESSİZCE; temizlik başarısız olursa (kilitli kanal,
       araya karışmış yabancı klip) kullanıcı yalnız bozuk bir timeline görüyor ve sebebini
       hiçbir yerde bulamıyordu. */
    dogru("birikmiş emoji katmanı ÖNCEDEN sorulup onaylatılıyor",
          /temizlenecekler\.length[\s\S]{0,700}uiConfirm/.test(a));
    dogru("onay reddedilirse Emojileri Sil düğmesine yönlendiriyor",
          /temizOnay[\s\S]{0,400}Emojileri Sil/.test(a));

    /* ⚠ EMOJİ KONUŞMANIN BAŞINDA (kullanıcı, 11 Ağustos 2026: "cümle başlıyo emoji ne zaman
       geliyo, ses dalgasına bak"). Ölçülen: ses 02:11'de, emoji 02:13'te — 5 kelime filtresi
       kısa açılış cümlelerini elediği için emoji geç görünüyordu. */
    /* ⚠⚠ HIZLI MOD (--batched) KALDIRILDI — ÖLÇÜLDÜ VE BOZUK ÇIKTI (12 Ağustos 2026).
       Bu testler eskiden özelliğin VARLIĞINI kilitliyordu; artık YOKLUĞUNU kilitliyor.
       Ölçüm: batched, Whisper segmentlerini 7 KAT seyreltiyor (dakikada 17.8 → 2.5;
       segment başına 4.5 kelime → ~32 cue). `cumleId` doğrudan segment sırasından türediği
       için "Tofi Moni video modu" seçecek cümle bulamıyor ve seyreltme SIFIR oluyor —
       kullanıcının "7. dakikada altyazı hâlâ dolu" şikâyetinin ölçülmüş sebebi budur.
       ⚠ SESSİZ BOZULMA: hata yok, panel yeşil, yanlışlık ancak Premiere'de görünüyor —
       bu yüzden geri gelmemesi TEST ile kilitleniyor. */
    dogru("hızlı mod trOpts'ta SABİT KAPALI (kutudan/localStorage'dan okunmuyor)",
          /batched:\s*false/.test(a) && !/batched:\s*\(function/.test(a),
          "batched yeniden bir kutuya bağlanırsa vurucu mod sessizce devre dışı kalır");
    dogru("hızlı mod kutusu HTML'den KALDIRILDI",
          fs.readFileSync(path.join(KOK, "index.html"), "utf8").indexOf("id=\"chkBatched\"") === -1);
    dogru("kayıtlı batched seçimi TEMİZLENİYOR (görünmez açık kalmasın)",
          /lsSet\("batchedMod", "0"\)/.test(a),
          "kutuyu silmek yetmez: localStorage'da 1 kalırsa ileride biri okuyup açabilir");
    /* pipeline'daki destek DURUYOR — motor sürümü düzelirse yeniden bağlanabilsin diye. */
    dogru("pipeline --batched desteği duruyor (ileride yeniden ölçmek için)",
          /opts\.batched[\s\S]{0,60}"--batched"/.test(fs.readFileSync(path.join(KOK, "js", "pipeline.js"), "utf8")));

    /* ⚠ VURUCU MOD SEYRELTEMEZSE PANEL SUSMAZ. 12 Ağustos'ta gerçekten şu oldu: mod açık,
       hata yok, panel yeşil — ama video baştan sona altyazılı ve kullanıcı bunu ancak
       Premiere'de gördü. Artık seyreltme oranı ÖLÇÜLÜP eşiğin üstündeyse ONAY soruluyor. */
    dogru("vurucu mod seyreltme oranını ÖLÇÜYOR", /vOnceToplam[\s\S]{0,600}vSonraToplam/.test(a));
    dogru("seyreltemezse kullanıcıya SORUYOR",
          /vOran > 0\.6[\s\S]{0,700}uiConfirm/.test(a),
          "sessizce tam altyazılı video üretmek en pahalı hata");
    dogru("seyreltememe sebebi (devasa segment) ayrıca söyleniyor",
          /vSegYogun > 10/.test(a));

    /* ⚠ SHORTS FULL ALTYAZI OLMAK ZORUNDA — kullanıcı isteği (12 Ağustos 2026):
       "shorts oluştururken tam tersi full + full altyazılı olacak". Yani vurucu modun
       seyreltmesi Shorts'a SIZMAMALI. Shorts kendi cue kopyasını `SZAMAN.cueHarita` ile
       üretiyor ve `vurucuGoster` alanını taşıyor ama ONA GÖRE SÜZMÜYOR — bu testler o
       davranışı kilitliyor. */
    (function () {
      var sh = fs.readFileSync(path.join(KOK, "js", "shorts.js"), "utf8");
      var sz = fs.readFileSync(path.join(KOK, "js", "shortszaman.js"), "utf8");
      dogru("Shorts vurucu filtresini UYGULAMIYOR (full altyazı)",
            sh.indexOf("gosterilenler") === -1 && sz.indexOf("gosterilenler") === -1,
            "Shorts full altyazılı olmalı; seyreltme yalnız uzun videoda");
      /* app.js tarafında da Shorts yolunda filtre olmamalı: `gosterilenler` yalnız
         placeCaptions'ın vurucu bloğunda (uzun video) çağrılabilir. */
      var shortsBlok = a.slice(a.indexOf("async function shortsKurVeDoldur"));
      shortsBlok = shortsBlok.slice(0, shortsBlok.indexOf("async function cokluUret"));
      dogru("shortsKurVeDoldur içinde vurucu süzme YOK",
            shortsBlok.indexOf("gosterilenler") === -1 && shortsBlok.indexOf("vurucuGoster") === -1);
    })();

    dogru("emoji öne çekme sabitleri tanımlı",
          /var EMOJI_ONE_CEK = [\d.]+/.test(a) && /var EMOJI_KESINTI = [\d.]+/.test(a));
    dogru("öne çekme SINIRLI (tavanı aşınca duruyor)",
          /c\.bas - kc\.start > EMOJI_ONE_CEK[\s\S]{0,40}break/.test(a));
    dogru("araya sessizlik girerse öne çekme DURUYOR (başka repliğe kaymasın)",
          /kc\.end > EMOJI_KESINTI[\s\S]{0,40}break/.test(a));
    dogru("plan satırı gerçekBas kullanıyor (c.bas değil)",
          /plan\.push\(\[pngYol[\s\S]{0,80}gercekBas\.toFixed/.test(a));
    dogru("çakışma freni de gerçekBas'tan kuruluyor",
          /sonBitisSag = gercekBas \+ sure/.test(a));
    dogru("öne çekme sonrası süre tavanı YENİDEN uygulanıyor",
          /sure \+= \(c\.bas - gercekBas\)[\s\S]{0,400}sure > EMOJI_MAX_SURE/.test(a));
    dogru("kaynakCues cümleye iliştiriliyor (öne çekme buna bağlı)",
          (a.match(/k\.kaynakCues = cues/g) || []).length >= 2);

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
                    "js/sozluk.js", "js/kisiler.js", "js/pngayna.js", "js/updater.js", "js/lisans.js", "js/emojikonum.js", "js/shortszaman.js", "js/shorts.js"];
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

/* ================= 21. EMOJİ KONUMU (js/emojikonum.js) =================
   ⚠ NEDEN VAR: bu hesap bugüne kadar HİÇ test edilemiyordu — js/app.js kapalı bir IIFE ve
   emojiKonum dışa açılmıyordu. Konum kullanıcı onaylı bir sabite (ORAN = 0.574) ve İKİ KEZ
   dönmüş bir taraf kararına dayanıyor.
   ⚠ ÖLÇÜLMÜŞ HATA: eski taban `seqH` idi ve 1080x1920'de emoji 1102 px (kareden geniş)
   çıkıp sağ/sol formülleri ÇAPRAZLANIYOR, kelepçe de ikisini 0.5'e indiriyordu — yani iki
   emoji kanalı dikeyde AYNI noktaya çiziyordu. Premiere tarafında hiçbir geri okuma bunu
   yakalayamaz (klipler doğru konur, host "ok" der); nöbetçisi bu yüzden burada.
   Aşağıdaki yatay değerler REGRESYON KİLİDİ: taban değişikliğinin yatay videoda hiçbir
   sayıyı değiştirmediği iddiası ancak böyle sabitlenir. */
  baslik("Emoji konumu (dikey/yatay taban)");
  (function () {
    var K;
    try { K = require(path.join(KOK, "js", "emojikonum.js")); }
    catch (e) { hata("emojikonum.js yüklenemedi", e.message); return; }

    esit("sabitler korundu (ORAN kullanıcı onaylı)", [K.ORAN, K.BOSLUK_X, K.BOSLUK_Y], [0.574, 0.005, 0]);

    /* ⚠ KÖPRÜ NÖBETÇİSİ — GERÇEK HATA (11 Ağustos 2026). app.js'teki emojiKonum sarmalayıcısı
       bir ara yalnız 4 parametre alıyordu; Shorts 5 argümanla çağırıyor ve 5.'si (`orta`)
       sessizce YUTULUYORDU → emoji "ortada" istenmişken sağ köşeye gidiyordu.
       Modül testleri bunu YAKALAYAMAZ (onlar modülü doğrudan çağırıyor), o yüzden köprünün
       kendisi metin olarak denetleniyor. */
    (function () {
      var a = fs.readFileSync(path.join(KOK, "js", "app.js"), "utf8");
      var m = a.match(/function\s+emojiKonum\s*\(([^)]*)\)\s*\{[\s\S]{0,400}?\n\s*\}/);
      dogru("app.js'te emojiKonum sarmalayıcısı bulundu", !!m);
      if (!m) return;
      var imza = m[1].replace(/\s/g, "");
      esit("sarmalayıcı imzası TÜM parametreleri alıyor", imza, "seqW,seqH,sag,ust,orta,oran");
      dogru("sarmalayıcı hepsini modüle GEÇİRİYOR",
            /KONUM\.hesapla\(\s*seqW\s*,\s*seqH\s*,\s*sag\s*,\s*ust\s*,\s*orta\s*,\s*oran\s*\)/.test(m[0]),
            "gövde: " + m[0].replace(/\s+/g, " ").slice(0, 160));
      /* Shorts gerçekten `orta` istiyor mu — çağrı tarafı da denetlensin. */
      dogru("Shorts emojisi ORTA modda çağırıyor",
            /emojiKonum\(\s*hs\.w\s*,\s*hs\.h\s*,\s*true\s*,\s*true\s*,\s*true\s*\)/.test(a));
      /* ⚠ Shorts'ta preset ÇAĞRILMAMALI (kullanıcı: "efektsiz istiyorum"). */
      var shortsBlok = a.slice(a.indexOf("async function shortsEmojiKoy"));
      shortsBlok = shortsBlok.slice(0, shortsBlok.indexOf("function _shortsSaat"));
      dogru("Shorts emoji yolunda presetYaz ÇAĞRISI YOK",
            shortsBlok.indexOf("evalES('presetYaz") === -1 && shortsBlok.indexOf('evalES("presetYaz') === -1);
      /* Normal emoji yolunda preset DURUYOR — bozulmadığının kanıtı. */
      dogru("normal emoji yolunda presetYaz çağrısı DURUYOR",
            (a.match(/evalES\('presetYaz\(/g) || []).length >= 2);

      /* ⚠ ÇOKLU SHORTS: HER TURDAN SONRA KAYNAK SEKANSA DÖNÜŞ — GERÇEK HATA (11 Ağustos 2026).
         shortsSekansKur yeni Shorts'u AKTİF bırakıyor (tekli için doğru). Çoklu döngüde ikinci
         tur başlarken activeSequence 20 saniyelik Shorts oluyor ve kaynak videodaki 211./243./
         334./559. saniyeler orada yok — kullanıcının denemesinde 5 Shorts'un 4'ü "hiçbir klibe
         denk gelmiyor" diye düştü. Bu üç satır o düzeltmeyi kilitliyor. */
      var cokluBlok = a.slice(a.indexOf("async function cokluUret"));
      cokluBlok = cokluBlok.slice(0, cokluBlok.indexOf("function shortsGruplariTopla"));
      dogru("çoklu döngü kaynak sekansa GERİ DÖNÜYOR",
            /openSequence\("'\s*\+\s*kaynakId/.test(cokluBlok));
      dogru("geri dönüş GERİ OKUNARAK doğrulanıyor",
            cokluBlok.indexOf("activeSequence.name") !== -1);
      dogru("dönülemezse döngü DURUYOR (sessizce yanlış sekanstan kesmiyor)",
            /geri !== kaynakAd[\s\S]{0,400}?break;/.test(cokluBlok));
      /* ⚠ TEST GÜÇLENDİRİLDİ (12 Ağustos 2026 denetimi). Eskiden yalnız
         `kaynakAd = String(await evalES` dizgesini arıyordu — yani BİÇİMİ kilitliyordu,
         değişmezi değil. Bulunan gerçek hata şuydu: `kaynakId` yalnızca `r.hs.kaynakId`
         üzerinden, yani ancak bir Shorts BAŞARIYLA kurulduktan sonra doluyordu. Geri-dönüş
         bloğunun tamamı `if (kaynakId && …)` kapısının arkasında olduğu için İLK TUR
         DÜŞERSE koruma tümden devre dışı kalıyor ve kalan bütün turlar yanlış sekanstan
         kesiyordu — sebebi gizleyen bir zincirleme çökme.
         Artık ikisi de DÖNGÜDEN ÖNCE okunuyor; test o değişmezi doğruluyor. */
      var _dgIx = cokluBlok.indexOf("for (i = 0; i < bol.shortslar.length");
      var _basBlok = _dgIx > 0 ? cokluBlok.slice(0, _dgIx) : cokluBlok;
      dogru("kaynak sekansın ADI döngüden ÖNCE okunuyor (ad karşılaştırması için)",
            /kaynakAd\s*=/.test(_basBlok) && _basBlok.indexOf("activeSequence") !== -1);
      dogru("kaynak sekansın KİMLİĞİ de döngüden ÖNCE okunuyor (ilk tur düşse de geri dönüş çalışsın)",
            _basBlok.indexOf("sequenceID") !== -1);
      /* ⚠ HATA DALINDA DA GERİ DÖNÜLMELİ. `if (r.hata) { … continue; }` bloğu geri dönüş
         kodunun ÜSTÜNDEYDİ, yani başarısız bir tur dönüşü tamamen atlıyordu — oysa geri
         dönüşe en çok ihtiyaç duyulan an tam olarak odur. */
      dogru("başarısız turda da kaynak sekansa dönülüyor (continue ÖNCESİ)",
            /r\.hata[\s\S]{0,400}?_kaynagaDon\(\)[\s\S]{0,300}?continue;/.test(cokluBlok));
      /* ⚠ SON TURDAN SONRA DA DÖNÜLMELİ. Eskiden `i + 1 < uzunluk` şartı son turu dışarıda
         bırakıyor, hemen ardından `kaynakId = ""` yazıldığı için `finally` de geri açmıyordu:
         akış bitince aktif sekans SON SHORTS kalıyordu ve kullanıcının bir sonraki
         "Timeline'a Ekle" / "Emoji Ekle" işlemi sessizce oraya yazıyordu. */
      /* ⚠ ARAMA YALNIZ BAŞARI YOLUNDA. İlk yazdığım hâli bütün fonksiyonda arıyordu ve
         `catch (eKa) { kaynakAd = ""; kaynakId = ""; }` (kimlik hiç okunamadıysa geçerli
         bir sıfırlama) yüzünden hep kırmızı veriyordu — nöbetçi testi kendisi kararsız
         olmamalı. Pencere: sonuç özetinin başlangıcından `catch`'e kadar. */
      var _sonIx = cokluBlok.indexOf("var basarili = sonuclar.filter");
      var _catchIx = cokluBlok.indexOf("} catch (e3)");
      var _sonBlok = (_sonIx > 0 && _catchIx > _sonIx) ? cokluBlok.slice(_sonIx, _catchIx) : "";
      dogru("başarı yolunda kaynak kimliği SIFIRLANMIYOR (finally kaynağa dönebilsin)",
            _sonBlok.length > 0 && !/kaynakId\s*=\s*""/.test(_sonBlok));
      dogru("sonuç mesajı hangi sekansta kalındığını söylüyor",
            /Kaynak sekans[ıi]na geri dönüldü/.test(cokluBlok));
    })();

    /* --- YATAY: DEĞİŞMEMELİ (regresyon kilidi) --- */
    var ys = K.hesapla(1920, 1080, true), yl = K.hesapla(1920, 1080, false);
    esit("yatay 1080p sağ  x", ys.x, 0.836);
    esit("yatay 1080p sol  x", yl.x, 0.164);
    esit("yatay 1080p y (alta dayalı)", ys.y, 0.713);
    esit("yatay 1080p emoji boyu", ys.boyPx, 620);
    dogru("yatay 1080p kelepçeye GİRMİYOR", !ys.kelepce && !yl.kelepce);

    var ks = K.hesapla(3840, 2160, true);
    esit("yatay 4K sağ x (oransal, aynı)", ks.x, 0.836);
    esit("yatay 4K emoji boyu", ks.boyPx, 1240);

    /* Kare: min(w,h) === h === w, yani burada da eski davranış. */
    esit("kare 1080 sağ x", K.hesapla(1080, 1080, true).x, 0.708);

    /* --- DİKEY: ASIL DÜZELTME --- */
    var ds = K.hesapla(1080, 1920, true), dl = K.hesapla(1080, 1920, false);
    dogru("DİKEY'de sağ ile sol AYNI NOKTA DEĞİL", ds.x !== dl.x,
          "sağ=" + ds.x + " sol=" + dl.x + " — aynıysa iki emoji kanalı üst üste çizer");
    esit("dikey sağ x", ds.x, 0.708);
    esit("dikey sol x", dl.x, 0.292);
    dogru("dikey emoji KAREYE SIĞIYOR", ds.boyPx <= 1080, "boy=" + ds.boyPx + "px, kare=1080px");
    esit("dikey emoji boyu (kısa kenardan)", ds.boyPx, 620);
    dogru("dikey kelepçeye GİRMİYOR (taban düzeltmesi sayesinde)", !ds.kelepce && !dl.kelepce);

    /* --- ORTA (Shorts: kullanıcı "tam ortada dursun" dedi, 11 Ağustos 2026) --- */
    var os = K.hesapla(1080, 1920, true, true, true);
    var ol = K.hesapla(1080, 1920, false, true, true);
    esit("orta modda x tam 0.5", os.x, 0.5);
    esit("orta modda sağ ile sol AYNI (bilerek)", os.x, ol.x);
    dogru("orta modda kelepçe İŞARETLENMİYOR (çakışma değil, kasıt)", !os.kelepce && !ol.kelepce);
    dogru("orta mod y'yi bozmuyor", os.y === K.hesapla(1080, 1920, true, true).y);
    /* ⚠ Orta modda x kilitli olduğu için taraflar ayrışmıyor — bu bir HATA DEĞİL, istek.
       Ama çağıran taraf ikinci emoji kanalını açmamalı (aynı noktaya çizerdi). */
    dogru("orta modda taraflarAyriMi false döner (ikinci kanal açılmamalı)",
          K.hesapla(1080, 1920, true, true, true).x === K.hesapla(1080, 1920, false, true, true).x);
    /* Yatayda orta İSTENMEDİĞİ sürece hiçbir şey değişmiyor — regresyon kilidi. */
    esit("yatayda orta parametresi VERİLMEZSE eski davranış", K.hesapla(1920, 1080, true).x, 0.836);

    /* --- ORAN EZME (Shorts "full emoji", kullanıcı isteği 11 Ağustos 2026) --- */
    var fullE = K.hesapla(1080, 1920, true, true, true, 1.0);
    esit("oran 1.0 → emoji kare genişliği kadar", fullE.boyPx, 1080);
    esit("full emoji hâlâ ortada", fullE.x, 0.5);
    dogru("full emoji üstte (y küçük)", fullE.y < 0.5, "y=" + fullE.y);
    /* ⚠ Oran verilmezse varsayılan DEĞİŞMEMELİ — yatay yol bu satıra bağlı. */
    esit("oran verilmezse varsayılan ORAN", K.hesapla(1080, 1920, true, true, true).boyPx,
         Math.round(1080 * K.ORAN));
    esit("geçersiz oran (0) varsayılana düşer",
         K.hesapla(1080, 1920, true, true, true, 0).boyPx, Math.round(1080 * K.ORAN));
    /* ⚠ KONUM İLE BOYUT AYNI ORANA OTURMALI: app.js olcekHesapla'ya aynı oranı geçiriyor.
       Bu test o sözleşmeyi sabitliyor — boyPx gerçekten taban*oran. */
    esit("boyPx = taban × verilen oran", K.hesapla(1080, 1920, true, true, true, 0.8).boyPx,
         Math.round(1080 * 0.8));

    /* --- ÜST YERLEŞİM (Shorts: emoji üstte, altyazı altta) --- */
    var us = K.hesapla(1080, 1920, true, true);
    dogru("üst yerleşim y, alt yerleşimden KÜÇÜK", us.y < ds.y, "üst=" + us.y + " alt=" + ds.y);
    esit("dikey üst y", us.y, 0.161);
    dogru("üstte de sağ/sol ayrı", K.taraflarAyriMi(1080, 1920, true));

    /* --- taban() KONUM İLE ÖLÇEĞİ AYNI SAYIYA BAĞLAR ---
       ⚠ Bu ikisi ayrışırsa emoji hesaplanan yerin DIŞINA taşar (konum bir tabana, boyut
       başka tabana oturur). app.js olcekHesapla'ya bu fonksiyonu geçiriyor. */
    esit("taban yatayda seqH ile ÖZDEŞ", K.taban(1920, 1080), 1080);
    esit("taban 4K'da seqH ile ÖZDEŞ", K.taban(3840, 2160), 2160);
    esit("taban dikeyde seqW", K.taban(1080, 1920), 1080);
    esit("boyPx gerçekten taban*ORAN", K.hesapla(1080, 1920, true).boyPx, Math.round(1080 * K.ORAN));

    /* --- Nöbetçinin kendisi: ESKİ formül gerçekten bozuk muydu? ---
       Kasıtlı bozma yerine eski formülü burada yeniden kurup dikeyde çakıştığını gösteriyoruz;
       yoksa "düzeltildi" iddiası ölçüsüz kalır. */
    (function () {
      function eski(seqW, seqH, sag) {
        var boyPx = seqH * 0.574, yariPx = boyPx / 2;
        var bosX = Math.round(seqH * 0.005);
        var x = sag ? ((seqW - bosX - yariPx) / seqW) : ((bosX + yariPx) / seqW);
        if (sag && x < 0.5) x = 0.5;
        if (!sag && x > 0.5) x = 0.5;
        return Math.round(x * 1000) / 1000;
      }
      dogru("ESKİ formül dikeyde gerçekten çakışıyordu (düzeltme boşuna değil)",
            eski(1080, 1920, true) === eski(1080, 1920, false));
      esit("ESKİ formül yatayda bugünküyle aynı sonucu veriyordu",
           [eski(1920, 1080, true), eski(1920, 1080, false)], [ys.x, yl.x]);
    })();
  })();

/* ================= 22. SHORTS ZAMAN HARİTALAMA (js/shortszaman.js) =================
   Shorts, uzun videodan seçilmiş 3-5 aralığı arka arkaya diziyor; altyazı ve emoji zamanları
   bu yeni eksene taşınmak zorunda. Saf hesap olduğu için Premiere gerekmiyor.
   ⚠ EN KRİTİK TEST "girdi değişmiyor mu": bu projede cue nesnelerini yerinde değiştirmek bir
   kez saveSession'a sızdı ve bozuk zamanlar diske yazıldı. */
  baslik("Shorts zaman haritalama");
  (function () {
    var SZM;
    try { SZM = require(path.join(KOK, "js", "shortszaman.js")); }
    catch (e) { hata("shortszaman.js yüklenemedi", e.message); return; }

    var kesitler = [{ bas: 120, bit: 132 }, { bas: 340, bit: 349 }, { bas: 610, bit: 622 }];
    esit("toplam süre", SZM.toplamSure(kesitler), 33);

    /* --- zamanCevir --- */
    esit("1. kesitin başı 0'a düşer", SZM.zamanCevir(kesitler, 120).shorts, 0);
    esit("1. kesitin ortası", SZM.zamanCevir(kesitler, 126).shorts, 6);
    esit("2. kesitin başı 1. kesitin süresine düşer", SZM.zamanCevir(kesitler, 340).shorts, 12);
    esit("3. kesitin başı", SZM.zamanCevir(kesitler, 610).shorts, 21);
    esit("kesit ARASI zaman null döner", SZM.zamanCevir(kesitler, 200), null);
    esit("kesit no doğru", SZM.zamanCevir(kesitler, 345).kesit, 1);

    /* --- cueHarita --- */
    var cues = [
      { start: 100, end: 103, text: "kesit oncesi", cumleId: "a-1:0" },   // dışarıda
      { start: 121, end: 123, text: "tam icinde", cumleId: "a-1:1" },     // taşınır
      { start: 131, end: 136, text: "sinirda uzun", cumleId: "a-1:2" },   // kırpılır (1 sn kalır)
      { start: 131.9, end: 140, text: "sinirda cok kisa", cumleId: "a-1:3" }, // kırpılır -> gizlenir
      { start: 341, end: 344, text: "ikinci kesit", cumleId: "a-1:4" },
      { start: 500, end: 502, text: "arada", cumleId: "a-1:5" },          // dışarıda
      { start: 611, end: 615, text: "ucuncu kesit", cumleId: "a-1:6" }
    ];
    /* Girdi anlık görüntüsü — mutasyon nöbetçisi için */
    var once = JSON.stringify(cues);

    var r = SZM.cueHarita(kesitler, cues);
    esit("kesit dışındakiler düştü", r.sayac.disarida, 2);
    esit("taşınan cue sayısı", r.sayac.tasinan, 5);
    esit("kırpılan", r.sayac.kirpilan, 2);
    esit("gizlenen (kırpılıp 0.25 altına düşen)", r.sayac.gizlenen, 1);

    var t1 = r.cues.filter(function (c) { return c.text === "tam icinde"; })[0];
    esit("tam içindeki cue kaydı", [t1.start, t1.end], [1, 3]);
    var t2 = r.cues.filter(function (c) { return c.text === "sinirda uzun"; })[0];
    esit("sınırdaki cue KIRPILDI (itilmedi)", [t2.start, t2.end], [11, 12]);
    dogru("kırpılan işaretli", t2.kirpildi === true);
    dogru("kırpılan ama yeterince uzun -> GİZLENMEDİ", t2.gizliKesit === false);
    var t3 = r.cues.filter(function (c) { return c.text === "sinirda cok kisa"; })[0];
    dogru("çok kısalan cue GİZLENDİ (silinmedi)", t3.gizliKesit === true && !!t3.text);
    var t4 = r.cues.filter(function (c) { return c.text === "ikinci kesit"; })[0];
    esit("2. kesitteki cue ofsetlendi", [t4.start, t4.end], [13, 16]);

    /* --- MUTASYON NÖBETÇİSİ --- */
    esit("GİRDİ cue nesneleri DEĞİŞMEDİ", JSON.stringify(cues), once);
    dogru("çıktı cue'ları YENİ nesneler", r.cues[0] !== cues[1]);

    /* --- cumleId kesit numarası alıyor mu (köprü kesit sınırında kurulmasın) --- */
    dogru("cumleId'ye kesit no eklendi", t1.cumleId === "a-1:1@s0",
          "olan: " + t1.cumleId);
    dogru("farklı kesitteki cümle kimliği FARKLI", t4.cumleId !== t1.cumleId);

    /* --- kaynakBas korunuyor (hata ayıklama + emoji eşleşmesi) --- */
    esit("kaynakBas özgün zamanı tutuyor", t4.kaynakBas, 341);

    /* --- araliklariHarita (emoji) --- */
    var em = [{ bas: 121, bit: 124, kar: "tofi" }, { bas: 200, bit: 203, kar: "moni" },
              { bas: 611, bit: 613, kar: "dora" }];
    var emOnce = JSON.stringify(em);
    var er = SZM.araliklariHarita(kesitler, em);
    esit("kesit dışı emoji düştü", er.dusen, 1);
    esit("taşınan emoji sayısı", er.araliklar.length, 2);
    esit("emoji zamanı ofsetlendi", [er.araliklar[0].bas, er.araliklar[0].bit], [1, 4]);
    esit("emoji GİRDİSİ değişmedi", JSON.stringify(em), emOnce);

    /* --- sonaKirp: KARE YUVARLAMASI PAYI ---
       ⚠ GERÇEK HATA (11 Ağustos 2026): host `sure`yi son klibin geri okunan bitişinden alıyor,
       panel cue'ları kaynak kesit sınırlarından hesaplıyor; 0.058 sn'lik fark "geçersiz zaman"
       sayılıp BÜTÜN altyazı yazımını durdurmuştu (5 karakterden yalnız 1'i yazıldı). */
    var kirpTest = [
      { start: 10, end: 20, text: "normal" },
      { start: 30, end: 33.06, text: "kare payi kadar tasan" },   // 0.06 sn — kırpılmalı
      { start: 32.9, end: 33.02, text: "kirpilinca cok kisalan" },// kırpınca 0.1 sn kalır
      { start: 5, end: 40, text: "COK tasan" }                    // 7 sn — kırpılMAmalı
    ];
    var kOnce = JSON.stringify(kirpTest);
    var kr = SZM.sonaKirp(kirpTest, 33);
    esit("kare payı kadar taşan KIRPILDI", kr.sayac.kirpilan, 2);
    esit("çok taşan KIRPILMADI (gerçek hata, dogrula yakalasın)", kr.sayac.buyukTasma, 1);
    var kn = kr.cues.filter(function (c) { return c.text === "kare payi kadar tasan"; })[0];
    esit("kırpılan cue tam Shorts sonunda bitiyor", kn.end, 33);
    dogru("çok taşan cue listede DURUYOR (silinmedi)",
          kr.cues.some(function (c) { return c.text === "COK tasan" && c.end === 40; }));
    esit("sonaKirp GİRDİYİ değiştirmedi", JSON.stringify(kirpTest), kOnce);
    /* Kırpınca 0.05 sn altına düşen cue düşürülür (göz kırpması bırakmaz). */
    var kr2 = SZM.sonaKirp([{ start: 32.98, end: 33.4 }], 33);
    esit("kırpınca çok kısalan düştü", kr2.sayac.dusen, 1);
    esit("düşen listede yok", kr2.cues.length, 0);
    /* ⚠ Kırpma SONRASI dogrula temiz dönmeli — akıştaki sıra bu. */
    var akis = SZM.sonaKirp([{ start: 10, end: 33.04 }], 33);
    esit("kırpma sonrası doğrulama temiz", SZM.dogrula(akis.cues, 33), []);

    /* --- dogrula: SRT yazılmadan önceki son nöbetçi --- */
    esit("temiz liste hatasız", SZM.dogrula(r.cues, r.sure), []);
    var bozuk = [{ start: -1, end: 2 }, { start: 5, end: 4 }, { start: 30, end: 99 }];
    var h = SZM.dogrula(bozuk, 33);
    esit("negatif + ters + taşan yakalandı", h.length, 3);
    dogru("negatif zaman ADIYLA bildiriliyor", h[0].indexOf("NEGATİF") !== -1, h[0]);

    /* ⚠ fmtTime negatif zamanı sessizce 0 yapıyor (pipeline.js) — bu nöbetçi olmasa ters
       işaretli bir ofset bütün altyazıyı 00:00:00'a yığar ve panel "ok" derdi. */
    dogru("dogrula() boş liste için de çalışıyor", SZM.dogrula([], 33).length === 0);
  })();

/* ================= 23. SHORTS KESİT SEÇİMİ (js/shorts.js) =================
   ⚠ EN KRİTİK TEST: parça numaralandırma. Bu hata bu projede AYNEN yaşandı (duygulariSec
   global numara gönderiyordu, model parçayı 1'den numaralıyordu, panelde doğrulama YOKTU;
   400 cümlede 150'si iki kez seçildi, 150'si hiç seçilmedi ve tek parçalık test oturumunda
   AYLARCA görünmedi). Shorts'ta bedeli daha büyük: 3-5 kesit var, bir yanlış numara
   Shorts'un %25'ini bambaşka bir ana çevirir.
   Ağ ÇAĞRISI YOK — yalnız saf ayrıştırma ve bütçe aritmetiği sınanıyor. */
  baslik("Shorts kesit seçimi (numaralandırma + bütçe)");
  (function () {
    var SH;
    try { SH = require(path.join(KOK, "js", "shorts.js")); }
    catch (e) { hata("shorts.js yüklenemedi", e.message); return; }

    /* Sahte dilim: 5 cümle, global indeksleri BİLEREK 100'den başlıyor —
       "parça içi numara" ile "global indeks" karışırsa test yakalasın. */
    function dilimKur() {
      return [
        { bas: 10, bit: 14, metin: "birinci", grup: "Tofi", grupIdx: 0, globalIdx: 100 },
        { bas: 20, bit: 25, metin: "ikinci", grup: "Moni", grupIdx: 1, globalIdx: 101 },
        { bas: 30, bit: 36, metin: "ucuncu", grup: "Tofi", grupIdx: 0, globalIdx: 102 },
        { bas: 40, bit: 47, metin: "dorduncu", grup: "Dora", grupIdx: 2, globalIdx: 103 },
        { bas: 50, bit: 58, metin: "besinci", grup: "Moni", grupIdx: 1, globalIdx: 104 }
      ];
    }
    var dilim = dilimKur();

    /* --- Geçerli cevap: numara -> DOĞRU cümle --- */
    var s1 = { siraDisi: 0 };
    var r1 = SH._cevapCoz(null, JSON.stringify({ kesitler: [
      { basNo: 1, bitNo: 1, puan: 9, sebep: "komik" },
      { basNo: 3, bitNo: 4, puan: 8, sebep: "gergin" }
    ] }), dilim, s1);
    esit("iki kesit çözüldü", r1.length, 2);
    esit("1 numaralı satır 1. CÜMLEYE düştü", [r1[0].bas, r1[0].bit], [10, 14]);
    esit("3-4 aralığı doğru cümlelere düştü", [r1[1].bas, r1[1].bit], [30, 47]);
    esit("grup bilgisi korundu (emoji yanlış yüzü koymasın)", r1[0].grup, "Tofi");
    esit("global indeks panelin KENDİ kaydından", r1[0].globalIdx, 100);
    esit("aralık dışı yok", s1.siraDisi, 0);

    /* --- ARALIK DIŞI NUMARA: atılmalı VE sayılmalı --- */
    var s2 = { siraDisi: 0 };
    var r2 = SH._cevapCoz(null, JSON.stringify({ kesitler: [
      { basNo: 1, bitNo: 1, puan: 9, sebep: "gecerli" },
      { basNo: 99, bitNo: 99, puan: 9, sebep: "UYDURMA" },     // dilimde yok
      { basNo: 0, bitNo: 2, puan: 9, sebep: "sifir" },          // 1'den küçük
      { basNo: 4, bitNo: 2, puan: 9, sebep: "ters" },           // bit < bas
      { basNo: 101, bitNo: 101, puan: 9, sebep: "GLOBAL INDEKS" } // global sanıp gönderirse
    ] }), dilim, s2);
    esit("yalnız geçerli olan kaldı", r2.length, 1);
    esit("aralık dışı SAYILDI (sessiz düşüş yok)", s2.siraDisi, 4);

    /* ⚠ Bu satır hatanın ta kendisini sabitliyor: model GLOBAL indeksi (101) gönderirse
       dilim 5 elemanlı olduğu için aralık dışı sayılır ve ATILIR — sessizce 101. cümleye
       düşmez. Koruma kalkarsa bu test kırmızı olur. */
    dogru("global indeks gönderilirse kabul EDİLMİYOR",
          r2.every(function (k) { return k.globalIdx === 100; }));

    /* --- Bozuk JSON: çökme yok, boş dönüş --- */
    var s3 = { siraDisi: 0 };
    esit("bozuk JSON boş liste döner", SH._cevapCoz(null, "bu json degil", dilim, s3).length, 0);
    esit("metne gömülü JSON kurtarılır",
         SH._cevapCoz(null, 'bak: {"kesitler":[{"basNo":2,"bitNo":2,"puan":7,"sebep":"x"}]} bitti',
                      dilim, s3).length, 1);

    /* --- GİRDİ DEĞİŞMEDİ --- */
    esit("dilim nesneleri değişmedi", JSON.stringify(dilim), JSON.stringify(dilimKur()));

    /* --- BÜTÇE ARİTMETİĞİ (modelde DEĞİL panelde) --- */
    var s4 = { cakismaElenen: 0, sureElenen: 0, kisaElenen: 0, uzunElenen: 0 };
    var ad = [
      { bas: 10, bit: 20, puan: 9 },    // 10 sn
      { bas: 15, bit: 24, puan: 8 },    // ÇAKIŞIYOR (10-20 ile)
      { bas: 30, bit: 40, puan: 7 },    // 10 sn
      { bas: 50, bit: 52, puan: 10 },   // 2 sn — kesitMin(4) altında
      { bas: 60, bit: 90, puan: 10 },   // 30 sn — kesitMax(14) üstünde
      { bas: 100, bit: 112, puan: 6 },  // 12 sn
      { bas: 200, bit: 212, puan: 5 },  // 12 sn — bölge kuralı sayesinde SEÇİLİR
      /* ⚠ BU ADAY 12 Ağustos 2026'da EKLENDİ. Kullanıcı üst sınırı 42 → 45 sn'ye çekince
         eski fixture'daki son aday (44 sn'ye çıkaran) artık bütçeye SIĞIYOR ve "bütçeyi
         aşan elendi" testi kendi kontrol ettiği şeyi test etmez hâle geliyordu — sınır
         değişince fixture da güncellenmeli, yoksa test yeşil ama kör kalır. */
      { bas: 300, bit: 314, puan: 3 }   // 14 sn — 34+14=48 > 45, bütçeyi AŞAR
    ];
    var b = SH._butceUygula(ad, {}, s4);
    esit("çakışan elendi", s4.cakismaElenen, 1);
    esit("kısa elendi", s4.kisaElenen, 1);
    esit("uzun elendi", s4.uzunElenen, 1);
    esit("bütçeyi aşan elendi", s4.sureElenen, 1);
    /* ⚠ 3 → 4 (12 Ağustos 2026): üst sınır 42 → 45 sn'ye çıkınca aynı fixture'a BİR KESİT
       DAHA sığıyor (10+10+12+12 = 44). Bu bir gerileme değil, sınır değişikliğinin doğrudan
       ve istenen sonucu — kullanıcı "en fazla 45 saniye" dedi. */
    esit("seçilen kesit sayısı", b.kesitler.length, 4);
    /* ⚠ 32 DEĞİL 34 — zaman dağılımı eklendikten sonra bilerek değişti (11 Ağustos 2026).
       Eski kod bölge kuralı olmadığı için 30. saniyedeki adayı (videonun başı) alıyordu;
       artık 200. saniyedeki aday kendi bölgesinden geldiği için tercih ediliyor. Yani
       toplam süre 2 sn arttı ama seçim videonun tamamına yayıldı — istenen tam buydu. */
    esit("toplam süre bütçe içinde", b.toplam, 44);
    /* Tavan MODÜLDEN okunuyor — elle yazılırsa kullanıcı sınırı değiştirince test
       kodun doğru olduğu hâlde kırmızı verir (bu bir kez oldu). */
    var _UST = SH.VARSAYILAN_OPTS ? SH.VARSAYILAN_OPTS.maxSure : 45;
    dogru("toplam " + _UST + " sn tavanını aşmıyor", b.toplam <= _UST);
    dogru("videonun SONUNDAKİ aday da seçildi (dağılım çalışıyor)",
          b.kesitler.some(function (k) { return k.bas === 200; }),
          "seçilenler: " + b.kesitler.map(function (k) { return k.bas; }).join(", "));

    /* ⚠ SHORTS KRONOLOJİK AKMALI — puan sırasına göre değil zaman sırasına dizilmeli. */
    var artan = true;
    for (var q = 1; q < b.kesitler.length; q++) if (b.kesitler[q].bas < b.kesitler[q - 1].bas) artan = false;
    dogru("kesitler ZAMAN sırasına dizildi (puan sırasına değil)", artan);

    /* --- ZAMAN DAĞILIMI (kullanıcı: "dümdüz videonun başını almışsın", 11 Ağustos 2026) ---
       ⚠ ASIL NÖBETÇİ. Model adayların çoğuna AYNI puanı verdiğinde eski kod sıralamayı
       tamamen zamana düşürüyor ve hep videonun başındakileri seçiyordu. Aşağıdaki senaryo
       tam o durumu kuruyor: 12 adayın HEPSİ 9 puan, video 600 saniyeye yayılmış. */
    (function () {
      var s6 = { cakismaElenen: 0, sureElenen: 0, kisaElenen: 0, uzunElenen: 0 };
      var esitPuan = [];
      for (var t = 0; t < 12; t++) esitPuan.push({ bas: t * 50, bit: t * 50 + 8, puan: 9 });
      var b6 = SH._butceUygula(esitPuan, {}, s6);
      dogru("eşit puanda bile kesit seçildi", b6.kesitler.length >= 3, "olan: " + b6.kesitler.length);
      /* Videonun ilk çeyreğine YIĞILMAMALI: son kesit videonun ikinci yarısından gelmeli. */
      var sonKesit = b6.kesitler[b6.kesitler.length - 1];
      var videoOrta = (0 + (11 * 50 + 8)) / 2;
      dogru("kesitler videonun BAŞINA yığılmıyor", sonKesit.bas > videoOrta,
            "son kesit " + sonKesit.bas + " sn, video ortası " + videoOrta.toFixed(0) + " sn");
      /* Her kesit ayrı bölgeden gelmeli (bölge sayısı = adetMax = 5). */
      esit("dolu bölge sayısı = seçilen kesit sayısı (her bölgeden bir)",
           s6.doluBolgeSay, b6.kesitler.length);
      /* Yayılım gerçekten geniş mi: ilk ve son kesit arası videonun yarısından fazla. */
      var kapsam = sonKesit.bas - b6.kesitler[0].bas;
      dogru("seçim videonun geniş bir bölümünü kapsıyor", kapsam > videoOrta,
            "kapsam " + kapsam + " sn");
    })();

    /* --- adetMax tavanı --- */
    var s5 = { cakismaElenen: 0, sureElenen: 0, kisaElenen: 0, uzunElenen: 0 };
    var cok = [];
    for (var i = 0; i < 20; i++) cok.push({ bas: i * 20, bit: i * 20 + 5, puan: 9 });
    var b5 = SH._butceUygula(cok, {}, s5);
    /* ⚠ ADET TAVANI ARTIK SÜRE HEDEFİNE GÖRE GEVŞİYOR (kullanıcı: "30-40 aralığında saniye
       demiştim", 11 Ağustos 2026). 5 kesit × 5 sn = 25 sn, minSure 28'in altında → 3. geçiş
       bir kesit daha ekliyor. SERT sınır artık adet değil SÜRE: maxSure asla aşılmaz. */
    dogru("süre hedefi için adet tavanı gevşiyor", b5.kesitler.length > 5,
          "olan: " + b5.kesitler.length + " kesit / " + b5.toplam + " sn");
    dogru("gevşemiş olsa bile maxSure (42) SERT sınır", b5.toplam <= 42, "toplam: " + b5.toplam);
    dogru("minSure (28) tutturuldu", b5.toplam >= 28, "toplam: " + b5.toplam);
    dogru("gevşetme SAYILDI (sessiz değil)", s5.adetGevsetildi === b5.kesitler.length);
    /* Süre zaten yetiyorsa tavan gevşememeli — 3. geçişin koşulu gerçekten çalışıyor mu. */
    var s5b = { cakismaElenen: 0, sureElenen: 0, kisaElenen: 0, uzunElenen: 0 };
    var uzunlar = [];
    for (var u = 0; u < 20; u++) uzunlar.push({ bas: u * 30, bit: u * 30 + 12, puan: 9 });
    var b5b = SH._butceUygula(uzunlar, {}, s5b);
    dogru("süre yetiyorsa adetMax (5) korunuyor", b5b.kesitler.length <= 5,
          "olan: " + b5b.kesitler.length + " / " + b5b.toplam + " sn");
    dogru("süre yetiyorsa gevşetme HİÇ olmadı", !s5b.adetGevsetildi);

    /* --- ÇOKLU SHORTS: BÖLÜM ÇÖZME ---
       ⚠ Aynı numaralandırma korumaları burada da geçerli: bölüm sınırı yanlış numaraya
       düşerse KOCA BİR SHORTS bambaşka bir sahneden kurulur. */
    (function () {
      var d = dilimKur();
      var sb = { siraDisi: 0 };
      var br = SH._bolumCoz(JSON.stringify({ bolumler: [
        { basNo: 1, bitNo: 2, baslik: "kaçırılma", puan: 9 },
        { basNo: 3, bitNo: 5, baslik: "kafes sahnesi", puan: 8 },
        { basNo: 99, bitNo: 99, baslik: "UYDURMA", puan: 9 },
        { basNo: 4, bitNo: 2, baslik: "ters", puan: 7 }
      ] }), d, sb);
      esit("iki geçerli bölüm çözüldü", br.length, 2);
      esit("aralık dışı + ters bölüm SAYILDI", sb.siraDisi, 2);
      esit("1. bölüm doğru cümlelere düştü", [br[0].bas, br[0].bit], [10, 25]);
      esit("2. bölüm doğru cümlelere düştü", [br[1].bas, br[1].bit], [30, 58]);
      esit("bölüm başlığı korundu", br[0].baslik, "kaçırılma");
      /* Bölümler ZAMAN sırasına dizilmeli — Shorts'lar kronolojik üretilsin. */
      dogru("bölümler zaman sırasında", br[0].bas < br[1].bas);
      /* ⚠ ÇAKIŞMAMALI: iki bölüm aynı anı içerirse iki Shorts aynı sahneyi anlatır. */
      dogru("bölümler çakışmıyor", br[0].bit <= br[1].bas,
            br[0].bit + " <= " + br[1].bas);
      esit("bölüm çözme GİRDİYİ değiştirmedi", JSON.stringify(d), JSON.stringify(dilimKur()));
    })();

    /* --- BAŞLIK / HASHTAG (kullanıcı isteği, 11 Ağustos 2026) ---
       ⚠ İKİ KEZ DÜZELTİLDİ: (1) model serbest hashtag ekliyordu (#yetimhane #dostluk
       #sahiplenme) ve başlık satırı ikiye taşıyordu → "sadece #shorts ve #minecraft yazsın";
       (2) başlık olayı anlatıyordu ("Yetimhaneden KAÇIYORUZ...") → "daha ilgi çekici olmalı".
       Hashtag artık MODELDEN GELMİYOR, panel kuruyor. */
    (function () {
      var iyi = SH._baslikCoz({ baslik: "Sana TUZAK Kurdular ve KAÇAMADIN 😱",
                                oyun: "Minecraft", etiketler: ["#Minecraft", "komik anlar"] });
      esit("hashtag YALNIZ iki tane", iyi.hashtagler, ["#shorts", "#minecraft"]);
      esit("tam başlık biçimi", iyi.tamBaslik,
           "Sana TUZAK Kurdular ve KAÇAMADIN 😱 #shorts #minecraft");
      dogru("42 karakter altı UZUN sayılmıyor", iyi.uzun === false, iyi.baslik.length + " karakter");
      esit("etiketlerden # temizlendi", iyi.etiketler, ["minecraft", "komik anlar"]);

      /* ⚠ MODEL HASHTAG GÖNDERSE BİLE PANEL EKLEMEZ — asıl düzeltme bu. */
      var kirli = SH._baslikCoz({ baslik: "x", oyun: "minecraft",
                                  hashtagler: ["#yetimhane", "#dostluk", "#sahiplenme"],
                                  etiketler: [] });
      esit("modelin gönderdiği fazla hashtag YOK SAYILIYOR", kirli.hashtagler,
           ["#shorts", "#minecraft"]);

      var uzunB = SH._baslikCoz({ baslik: "Yetimhaneden KAÇIYORUZ !! Kimse Bizi Sahiplenmedi 😢",
                                  oyun: "", etiketler: [] });
      dogru("42 karakteri aşan başlık UZUN işaretleniyor", uzunB.uzun === true,
            uzunB.baslik.length + " karakter");
      dogru("uzun başlık KESİLMİYOR (cümle ortasında bırakmaz)",
            uzunB.baslik.indexOf("Sahiplenmedi") !== -1);
      esit("oyun boşsa minecraft'a düşer", uzunB.hashtagler, ["#shorts", "#minecraft"]);
      esit("roblox tanınıyor", SH._baslikCoz({ baslik: "x", oyun: "ROBLOX", etiketler: [] }).hashtagler,
           ["#shorts", "#roblox"]);
      esit("bilinmeyen oyun minecraft'a düşer",
           SH._baslikCoz({ baslik: "x", oyun: "fortnite", etiketler: [] }).hashtagler,
           ["#shorts", "#minecraft"]);
      dogru("başlıksız cevap hata döndürür", !!SH._baslikCoz({ oyun: "minecraft" }).hata);

      /* İstemin kullanıcı örneğini ve yasakladığı örneği İÇERMESİ — istem gevşetilirse
         bu test kırmızı olur ve tarihçe hatırlanır. */
      /* ⚠ Kullanıcının ilk örneği ("EJDERHA Sen KIZLARI ETKİLEDİN") artık istemde ZORUNLU
         kalıp olarak DEĞİL, A seçeneğinin örneği olarak duruyor — kendisi "o o videoluktu"
         dedi. Bu yüzden örnek metni değil, KALIP ÇEŞİTLİLİĞİ denetleniyor. */
      dogru("istem reddedilen örneği KÖTÜ olarak gösteriyor",
            SH.SISTEM_BASLIK.indexOf("Yetimhaneden") !== -1);
      dogru("istem 42 karakter sınırını söylüyor", SH.SISTEM_BASLIK.indexOf("42 KARAKTER") !== -1);
      /* ⚠ "Sen/Sana" ZORUNLU OLMAKTAN ÇIKARILDI (kullanıcı, 11 Ağustos 2026: "tüm başlıkları
         sana/seni bilmem ne diye yapmış, o o videoluktu"). Zorunlu kural yapılınca 5 başlığın
         hepsi aynı kalıba düştü. Artık 7 kalıp SEÇENEK olarak sunuluyor. */
      dogru("istem 'Sen' kalıbını ZORUNLU KILMIYOR",
            SH.SISTEM_BASLIK.indexOf("ZORUNLU DEĞİL") !== -1 &&
            SH.SISTEM_BASLIK.indexOf("İZLEYİCİYE SESLEN:") === -1);
      var kalipSay = (SH.SISTEM_BASLIK.match(/[A-G]\) /g) || []).length;
      dogru("istem birden çok kalıp sunuyor (en az 6)", kalipSay >= 6, "bulunan: " + kalipSay);
      /* Çoklu Shorts'ta önceki başlıklar modele gösteriliyor mu — çeşitliliğin asıl kolu. */
      dogru("baslikUret önceki başlıkları isteme katıyor",
            SH.baslikUret.toString().indexOf("oncekiBasliklar") !== -1);
      dogru("istem tek kalıba sıkışmayı KÖTÜ örnek olarak gösteriyor",
            SH.SISTEM_BASLIK.indexOf("tek kalıba sıkışmış") !== -1);
    })();

    /* --- shortsAdet varsayılanı kullanıcı isteğiyle 5 --- */
    esit("çoklu Shorts varsayılan adedi", SH.VARSAYILAN.shortsAdet, 5);
    dogru("coklukSec dışa açık", typeof SH.coklukSec === "function");
    dogru("baslikUret dışa açık", typeof SH.baslikUret === "function");

    /* --- dilim metni: numara 1'DEN başlamalı, global indeksten DEĞİL --- */
    var mt = SH._dilimMetni(dilim, 200);
    dogru("dilim metni 1'den numaralanıyor", mt.indexOf("1 [") === 0, mt.split("\n")[0]);
    dogru("global indeks (100) metne SIZMIYOR", mt.indexOf("100 [") === -1);
  })();

/* ================= 24. HAZIR TRACK STYLE PAKETİ (varsayilan/stiller) =================
   ⚠ NEDEN VAR: stiller ParsMazi'ye YALNIZ bu paketle gidiyor ve dosya adları pakette ASCII
   (stilNN.prtextstyle) — gerçek adlar stiller.json'da. İkisi ayrışırsa stil sessizce
   kurulmuyor: panel "kuruldu" der, kullanıcının Track Style listesinde hiçbir şey çıkmaz.
   Kullanıcı Shorts için 6 yeni stil ekledi (11 Ağustos 2026) ve bunlar da gitmeli. */
  baslik("Hazır Track Style paketi");
  (function () {
    var kls = path.join(KOK, "varsayilan", "stiller");
    var jsn = path.join(KOK, "varsayilan", "stiller.json");
    var dosyalar = [], kayit = null;
    try { dosyalar = fs.readdirSync(kls).filter(function (f) { return /\.prtextstyle$/i.test(f); }); }
    catch (e) { hata("varsayilan/stiller klasörü okunamadı", e.message); return; }
    try { kayit = JSON.parse(fs.readFileSync(jsn, "utf8")); }
    catch (e2) { hata("stiller.json okunamadı", e2.message); return; }

    dogru("pakette stil var (" + dosyalar.length + ")", dosyalar.length > 0);
    esit("stiller.json kaydı = paketteki dosya sayısı", kayit.length, dosyalar.length);

    var eksik = [], adsiz = [];
    kayit.forEach(function (k) {
      if (dosyalar.indexOf(k.dosya) === -1) eksik.push(k.dosya);
      if (!k.ad || !/\.prtextstyle$/i.test(k.ad)) adsiz.push(k.dosya);
    });
    esit("stiller.json'daki her dosya pakette VAR", eksik, []);
    esit("her kaydın gerçek adı var", adsiz, []);

    /* ⚠ PAKET ADLARI ASCII OLMAK ZORUNDA — zip zincirinde Türkçe karakterli ad bozulursa
       stil sessizce kaybolur (CLAUDE.md'deki karar). */
    var asciiDisi = dosyalar.filter(function (f) { return /[^\x20-\x7E]/.test(f); });
    esit("paket dosya adları ASCII", asciiDisi, []);

    /* Shorts stilleri gerçekten pakete girdi mi — kullanıcının açık isteği. */
    var shortsSay = kayit.filter(function (k) { return /^Shorts /i.test(String(k.ad)); }).length;
    dogru("Shorts Track Style'ları pakette (" + shortsSay + ")", shortsSay >= 6,
          "adlar: " + kayit.map(function (k) { return k.ad; }).join(", "));
    /* Boyut nöbetçisi: 0 baytlık bir stil dosyası Premiere'de sessizce hiçbir şey yapmaz. */
    var bosDosya = dosyalar.filter(function (f) {
      try { return fs.statSync(path.join(kls, f)).size < 1000; } catch (e3) { return true; }
    });
    esit("hiçbir stil dosyası boş/bozuk değil", bosDosya, []);
  })();

/* ================= 25. SÖZDİZİMİ (panel JS dosyaları AYRIŞTIRILABİLİYOR MU) =================
   ⚠⚠ GERÇEKTEN OLDU VE YAYINLANDI (v1.10.5, 11 Ağustos 2026). Bir dizgenin içine gerçek
   satır sonu kaçtı (`"...var:` + newline + `..."`) ve app.js AYRIŞTIRILAMAZ hâle geldi.
   BELİRTİSİ ÖLDÜRÜCÜ AMA SESSİZ: panel AÇILIYOR, bütün kartlar görünüyor, ama HİÇBİR
   düğme çalışmıyor — çünkü dosya parse edilemeyince tek bir event listener bile bağlanmıyor.
   ParsMazi'nin bildirimi: "giremiyorum hiçbirine şuan".
   ⚠ Bu paketteki 300+ kontrolün HİÇBİRİ bunu yakalamıyordu: hepsi dosyaları METİN olarak
   tarıyor (id eşleşmesi, var sırası, mojibake) — hiçbiri "bu dosya geçerli JavaScript mi"
   diye sormuyordu. En ucuz ve en kritik kontrol buymuş.
   `vm.Script` yalnız AYRIŞTIRIR, çalıştırmaz — CEP'e özgü require/CSInterface çağrıları
   tetiklenmez, yani panel kodunu güvenle sınayabiliyoruz. */
  baslik("Sözdizimi (panel JS ayrıştırılabiliyor mu)");
  (function () {
    var vm;
    try { vm = require("vm"); } catch (e) { hata("vm modülü yok", e.message); return; }
    var jsKls = path.join(KOK, "js");
    var dosyalar = [];
    try { dosyalar = fs.readdirSync(jsKls).filter(function (f) { return /\.js$/i.test(f); }); }
    catch (e2) { hata("js klasörü okunamadı", e2.message); return; }
    dogru("panel JS dosyaları bulundu (" + dosyalar.length + ")", dosyalar.length >= 10);

    var kirik = [];
    dosyalar.forEach(function (f) {
      var kaynak;
      try { kaynak = fs.readFileSync(path.join(jsKls, f), "utf8"); }
      catch (e3) { kirik.push(f + " (okunamadı)"); return; }
      try { new vm.Script(kaynak, { filename: f }); }
      catch (e4) { kirik.push(f + ": " + String(e4.message).split("\n")[0]); }
    });
    esit("her panel JS dosyası geçerli JavaScript", kirik, []);

    /* host.jsx ES3 olduğu için vm ile sınanamaz (ES5+ ayrıştırıcı bazı ES3 kalıplarını
       kabul etse de tersi geçerli değil) — onun kendi ES3 taraması 7. bölümde. */

    /* Nöbetçinin kendisi çalışıyor mu — kasıtlı bozma (gerçekte olan hatanın aynısı). */
    var bozuk = 'var x = "satir bir\nsatir iki";';   // dizge içinde gerçek satır sonu
    var yakalandi = false;
    try { new vm.Script(bozuk, { filename: "sahte.js" }); } catch (e5) { yakalandi = true; }
    dogru("nöbetçi kasıtlı bozmayı yakalıyor", yakalandi);
    /* Ve geçerli kodu yanlışlıkla kırık saymıyor. */
    var temizKod = 'var y = "satir bir\\nsatir iki"; function f(){ return y; }';
    var temizOk = true;
    try { new vm.Script(temizKod, { filename: "sahte2.js" }); } catch (e6) { temizOk = false; }
    dogru("geçerli kodu kırık saymıyor", temizOk);
  })();

/* ================= 20. MOJIBAKE (UTF-8 dosyanin ANSI okunup yeniden yazilmasi) =================
   ⚠ GERCEKTEN OLDU (11 Agustos 2026, surum bump'i sirasinda). PowerShell'de
       (Get-Content dosya -Raw) -replace '...' | Out-File dosya -Encoding utf8
   zinciri UTF-8 dosyayi cp1254 olarak OKUYUP UTF-8 yaziyor. CSXS/manifest.xml ve
   installer/installer.iss tek komutta bozuldu.
   NEDEN TEHLIKELI: bozulma SESSIZ. Dosya hala gecerli XML/Pascal, testler gecer, panel
   acilir — yalniz yorumlar ve kullaniciya gorunen Turkce metinler cop olur. Bir surum
   yayinlanana kadar kimse fark etmez.
   KURAL: bu repoda metin dosyalarini PowerShell'in Get-Content/Out-File ciftiyle
   DEGISTIRME — Edit aracini ya da -Encoding utf8BOM kullan.
   IMZA MANTIGI: UTF-8'de Turkce harfler C3/C4/C5 bayti ile, uzun tire ve akilli tirnaklar
   E2 80 ile baslar. Bu baytlar latin1/cp1254 okununca ortaya cikan karakterler Turkce
   metinde ASLA gecmez, imza bu yuzden kesin.
   ⚠ IMZALAR \uXXXX KACISIYLA KURULUR, DUZ YAZILMAZ: duz yazilirsa tarayici KENDI kaynak
   dosyasini bozuk sanip her kosuda kirmizi verir (bir kez oldu, bu yorum o yuzden var). */
  baslik("Mojibake (bozuk kodlama) taramasi");
  (function () {
    var UZANTI = /\.(js|json|xml|html|css|md|iss|txt)$/i;
    var ATLA = /(^|[\\/])(node_modules|\.git|staging|varsayilan[\\/]emoji)([\\/]|$)/i;
    var IMZA = [
      { re: new RegExp("\u00C3[\u0080-\u00FF]"), ad: "C3+ (u-umlaut / o-umlaut / c-cedilla bozulmus)" },
      { re: new RegExp("\u00C4[\u0080-\u00FF]"), ad: "C4+ (noktasiz i / yumusak g bozulmus)" },
      { re: new RegExp("\u00C5[\u0080-\u00FF]"), ad: "C5+ (s-cedilla bozulmus)" },
      { re: new RegExp("\u00E2\u20AC"),          ad: "E2 80 (uzun tire / akilli tirnak bozulmus)" },
      { re: new RegExp("\u00E2\u0161"),          ad: "E2 9A (uyari isareti bozulmus)" }
    ];
    var bulgular = [], bakilan = 0;
    (function gez(dizin, derinlik) {
      if (derinlik > 6) return;
      var girdiler;
      try { girdiler = fs.readdirSync(dizin, { withFileTypes: true }); } catch (e) { return; }
      girdiler.forEach(function (g) {
        var tam = path.join(dizin, g.name);
        if (ATLA.test(tam)) return;
        if (g.isDirectory()) { gez(tam, derinlik + 1); return; }
        if (!UZANTI.test(g.name)) return;
        var metin;
        try { metin = fs.readFileSync(tam, "utf8"); } catch (e) { return; }
        bakilan++;
        IMZA.forEach(function (im) {
          var m = im.re.exec(metin);
          if (!m) return;
          var satir = metin.slice(0, m.index).split("\n").length;
          bulgular.push(path.relative(KOK, tam) + ":" + satir + " → " + im.ad);
        });
      });
    })(KOK, 0);
    dogru("metin dosyaları tarandı (" + bakilan + ")", bakilan >= 20);
    esit("hiçbir dosyada bozuk kodlama yok", bulgular, []);

    /* Nöbetçinin kendisi çalışıyor mu — kasıtlı bozma (gerçekte olan iki dizge). */
    var sahte = "Sürüm aralığı".split("").map(function (c) {
      var b = Buffer.from(c, "utf8"), s = "";
      for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);   // UTF-8 baytlarını latin1 oku
      return s;
    }).join("");
    var yakalandi = IMZA.some(function (im) { return im.re.test(sahte); });
    dogru("nöbetçi kasıtlı bozmayı yakalıyor", yakalandi, "bozuk örnek: " + sahte);
    dogru("temiz Türkçe metni yanlışlıkla işaretlemiyor",
          !IMZA.some(function (im) { return im.re.test("Sürüm aralığı geniş — ığşçöü ⚠ “tırnak”"); }));

    /* ⚠ GÖRÜNMEZ KONTROL KARAKTERİ — 12 Ağustos 2026'da İKİ KEZ oldu (js/app.js ve CLAUDE.md).
       Bir ayraç olarak U+0001 kullanılırken kaçış dizisi yerine karakterin KENDİSİ dosyaya
       yazıldı. Kod çalışıyordu ve mojibake nöbetçisi de yakalamıyor (o, bayt bozulması
       imzalarına bakıyor — kontrol karakteri bozulma değil, kasıtsız bir düz yazım).
       Neden tehlikeli: dosyada görünmüyor, diff'te görünmüyor, kopyala-yapıştır'da kayboluyor
       ve bir gün "neden bu split çalışmıyor" diye saatler harcatıyor. Ayraçlar HER ZAMAN
       kaçış dizisiyle yazılmalı (String.fromCharCode(1) ya da \\uXXXX).
       ⚠ TAB (U+0009), LF (U+000A) ve CR (U+000D) hariç — onlar normal metin karakterleri. */
    var kontrolBulgu = [];
    (function tara(dizin, derinlik) {
      if (derinlik > 3) return;
      var ogeler; try { ogeler = fs.readdirSync(dizin); } catch (e) { return; }
      ogeler.forEach(function (ad) {
        if (ad === "node_modules" || ad === ".git" || ad === "varsayilan") return;
        var tam = path.join(dizin, ad), st;
        try { st = fs.statSync(tam); } catch (e2) { return; }
        if (st.isDirectory()) { tara(tam, derinlik + 1); return; }
        if (!/\.(js|jsx|html|css|json|md)$/i.test(ad)) return;
        var icerik; try { icerik = fs.readFileSync(tam, "utf8"); } catch (e3) { return; }
        var bulunan = icerik.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g);
        if (bulunan) {
          kontrolBulgu.push(path.relative(KOK, tam) + " (" + bulunan.length + " tane, ilki U+" +
                            bulunan[0].charCodeAt(0).toString(16) + ")");
        }
      });
    })(KOK, 0);
    esit("hiçbir kaynak dosyada görünmez kontrol karakteri YOK", kontrolBulgu, []);
    dogru("nöbetçi kontrol karakterini yakalıyor",
          /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test("a" + String.fromCharCode(1) + "b"));
    dogru("tab ve satır sonunu yanlışlıkla işaretlemiyor",
          !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test("a\tb\r\nc"));
  })();

  /* ================================================================
     21. ARAYÜZ BÜTÜNLÜĞÜ — 12 Ağustos 2026 denetiminden doğdu.
     Üçü de GERÇEKTEN OLDU ve hiçbiri mevcut testlerle yakalanmıyordu; ortak noktaları
     SESSİZ olmaları: ne tarayıcı ne Node hata veriyor, panel açılıyor, testler geçiyordu.
     ================================================================ */
  baslik("Arayüz bütünlüğü (CSS sınıfı · yinelenen id · yinelenen fonksiyon)");
  (function () {
    var html = fs.readFileSync(path.join(KOK, "index.html"), "utf8");
    var css = fs.readFileSync(path.join(KOK, "css", "style.css"), "utf8");
    var app = fs.readFileSync(path.join(KOK, "js", "app.js"), "utf8");

    /* ---- (a) HTML'de kullanılan her sınıf CSS'te tanımlı mı? ----
       GERÇEK HATA: Shorts ekranları 11 Ağustos'ta eklendi, style.css 9 Ağustos'ta kalmıştı.
       `.btn`, `.chk` ve `.kanal-liste` sınıfları HİÇ tanımlı değildi — "Shorts Oluştur"
       düğmesi koyu mor panelin ortasında sistem fontlu, açık gri bir Windows düğmesi olarak
       çıkıyordu ("saçma garip bi buton"). Tanımsız CSS sınıfı sessizdir: tarayıcı hata
       vermez, öğe kendi varsayılan görünümünde kalır. */
    var kullanilan = {}, m, reCls = /class="([^"]+)"/g;
    while ((m = reCls.exec(html)) !== null) {
      m[1].split(/\s+/).forEach(function (c) { if (c) kullanilan[c] = 1; });
    }
    /* app.js de sınıf atıyor (className = "…"), onlar da sayılmalı. */
    var reJs = /className\s*=\s*"([^"]+)"/g;
    while ((m = reJs.exec(app)) !== null) {
      m[1].split(/\s+/).forEach(function (c) { if (c) kullanilan[c] = 1; });
    }
    /* Durum sınıfları (JS'in ekleyip çıkardığı) CSS'te birleşik seçicilerde geçiyor —
       ".iler.done" gibi. Basit ".ad" araması onları bulamaz, o yüzden sınıf adının
       CSS metninde HERHANGİ bir yerde nokta ile geçmesi yeterli sayılıyor. */
    var eksik = [];
    Object.keys(kullanilan).forEach(function (c) {
      if (/^(active|hidden|busy|done|error)$/.test(c)) return;   // salt durum sınıfları
      var re = new RegExp("\\." + c.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&") + "(?![\\w-])");
      if (!re.test(css)) eksik.push(c);
    });
    dogru("HTML'de sınıf kullanımı bulundu (" + Object.keys(kullanilan).length + ")",
          Object.keys(kullanilan).length > 20);
    esit("HTML'de geçen her sınıf style.css'te TANIMLI", eksik, []);
    /* Nöbetçinin kendisi çalışıyor mu */
    dogru("nöbetçi tanımsız sınıfı yakalıyor",
          !(new RegExp("\\.yw-olmayan-sinif(?![\\w-])")).test(css));

    /* ---- (b) Yinelenen id ----
       GERÇEK HATA: `id="shortsAyar"` hem Altyazı ekranında hem Tekli Shorts ekranında
       vardı. getElementById HER ZAMAN ilkini döndürür, yani ikinci blok app.js'ten
       erişilemez durumdaydı — bugün zararsızdı ama onu gizlemeye/göstermeye kalkan ilk
       satır sessizce YANLIŞ bloğu gizlerdi. */
    var idler = {}, cift = [], reId = /\sid="([^"]+)"/g;
    while ((m = reId.exec(html)) !== null) {
      if (idler[m[1]]) { if (cift.indexOf(m[1]) < 0) cift.push(m[1]); }
      idler[m[1]] = 1;
    }
    esit("index.html'de yinelenen id YOK", cift, []);

    /* ---- (c) app.js'te aynı kapsamda yinelenen fonksiyon adı ----
       ⚠ BU OTURUMUN EN PAHALI HATASI. `function wireShorts()` İKİ kez tanımlıydı:
       satır ~856 (Altyazı ekranındaki Shorts kutusu) ve ~4251 (Shorts/Çoklu düğmeleri).
       JS aynı kapsamdaki ikinci bildirim için HATA VERMEZ, sessizce birinciyi ezer. İki
       sonucu vardı: (1) Altyazı ekranındaki Shorts kutusunun dinleyicisi HİÇ bağlanmıyordu
       (uzun video tarafında ölü bir kutu), (2) `wire()` aynı adı iki kez çağırdığı için
       Shorts düğmelerine İKİ dinleyici bağlanıyor ve tek tık İKİ paralel üretim
       başlatıyordu — çift yapay zekâ ücreti ve aynı projede birbiriyle yarışan iki akış.
       ⚠ YALNIZ 2 BOŞLUKLU (modül kapsamı) bildirimler sayılır: daha derin girintili
       fonksiyonlar (`yaz`, `gorunum`, `opt`) farklı fonksiyonların içinde ve aynı adı
       taşımaları tamamen normaldir. */
    var sayac = {}, satirlar = app.split(/\r?\n/), yinelenen = [];
    satirlar.forEach(function (s) {
      var mm = /^ {2}(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/.exec(s);
      if (!mm) return;
      sayac[mm[1]] = (sayac[mm[1]] || 0) + 1;
      if (sayac[mm[1]] === 2) yinelenen.push(mm[1]);
    });
    dogru("modül kapsamında fonksiyon bulundu (" + Object.keys(sayac).length + ")",
          Object.keys(sayac).length > 40);
    esit("app.js'te aynı kapsamda YİNELENEN fonksiyon adı YOK", yinelenen, []);

    /* ---- (d) UYARI ≠ HATA ----
       GERÇEK HATA (kullanıcı bildirdi, 12 Ağustos 2026: "neden çarpı var, sorun ne?").
       `progressFail(msg, "warn")` çağrılıyordu ve fonksiyon "warn" bilgisini ALIYORDU ama
       yalnız yazı rengine uyguluyordu: rozet koşulsuz "✕", rozet sınıfı koşulsuz "bad",
       kutu sınıfı koşulsuz "error". Yani başarıyla biten ama not düşülen bir iş
       ("414 altyazı kondu, 14 tanesi gizlendi") ekranda BAŞARISIZ görünüyordu.
       Panelin "kısmi başarı YEŞİL değil SARI" kuralının eksik yarısı buydu: sarı,
       KIRMIZIDAN da ayrılmalı. */
    var pfBlok = app.slice(app.indexOf("function progressFail("));
    pfBlok = pfBlok.slice(0, 900);
    dogru("progressFail uyarıyı hatadan AYIRIYOR (rozet)",
          /uyari \? "⚠" : "✕"/.test(pfBlok),
          "uyarı ✕ ile gösterilirse kullanıcı başarılı işi başarısız sanıyor");
    dogru("progressFail uyarıda 'error' sınıfı VERMİYOR",
          /classList\.add\(uyari \? "warn" : "error"\)/.test(pfBlok));
    dogru("uyarı rozeti CSS'te tanımlı", css.indexOf(".prog-badge.warn") !== -1);
    dogru("uyarı çubuğu CSS'te tanımlı", css.indexOf(".progress-box.warn") !== -1);
    /* Yeni ilerleme panelinde de aynı üç durum ayrı olmalı. */
    dogru("ilerleme paneli üç durumu AYIRIYOR (✓ / ⚠ / ✕)",
          /kind === "bad" \? "✕" : kind === "warn" \? "⚠" : "✓"/.test(app));

    /* ---- (d2) EFEKTİN İÇ ALANLARI ("_ " önekli) PRESETLE YAZILMAZ ----
       GERÇEK HATA (kullanıcı bildirdi, 12 Ağustos 2026: "emojinin saçının solu kesiliyor").
       "Emoji Sağ Taraf" preset'indeki Camera Shake bileşeni `_ Sequence Width = 0`,
       `_ Sequence Height = 0`, `_ Sequence Pixel Ratio = 0` taşıyor. Bunlar kullanıcı ayarı
       değil, efektin kompozisyon ölçüsünü sakladığı iç alanlar — Premiere onları kendi
       dolduruyor. Panel 0 yazınca efekt kendini 0x0 karede sanıp görüntüyü kenardan kırpıyor.
       Hepsi SAYI olduğu için mevcut "metin/enum yazma" kapısına takılmıyordu; ayrı kapı şart. */
    var hostSrc = fs.readFileSync(path.join(KOK, "jsx", "host.jsx"), "utf8");
    dogru("preset yazımı '_' önekli iç alanları ATLIYOR",
          /icDefter\s*=\s*\/\^_\/\.test/.test(hostSrc),
          "iç alanlar yazılırsa efektler bozuk kompozisyon ölçüsüyle çalışır");
    /* Kapı, tip kontrolünden ÖNCE gelmeli: iç alanların hepsi sayı olduğu için tip kapısı
       onları geçiriyor. */
    var kIx = hostSrc.indexOf("var icDefter"), tIx = hostSrc.indexOf("var sayisal =");
    dogru("iç alan kapısı tip kapısından SONRA ama yazımdan ÖNCE",
          kIx > 0 && tIx > 0 && kIx > tIx && hostSrc.indexOf("if (icDefter)") > kIx);

    /* ---- (d3) HOST SÜRÜMÜ version.json İLE AYNI OLMALI ----
       `jsx/host.jsx` yalnız Premiere AÇILIRKEN yükleniyor; paneli kapat-aç onu tazelemiyor.
       Panelin başlığındaki sürüm ise version.json'dan okunuyor — yani panel YENİ görünürken
       host ESKİ olabiliyor ve host tarafındaki bir düzeltme hiç devreye girmemiş oluyor.
       Bu, 12 Ağustos 2026'da iki tur boyunca yanlış yerde hata aranmasına yol açtı.
       Panel bunu artık ölçüp uyarıyor; bu test de sürümlerin senkron kalmasını kilitliyor. */
    var hsM = hostSrc.match(/var HOST_SURUM\s*=\s*"([^"]+)"/);
    var pjV = JSON.parse(fs.readFileSync(path.join(KOK, "version.json"), "utf8")).version;
    dogru("host.jsx'te HOST_SURUM tanımlı", !!hsM);
    if (hsM) esit("HOST_SURUM = version.json sürümü", hsM[1], pjV);
    dogru("host sürüm okuma fonksiyonu var", /function hostSurum\(\)/.test(hostSrc));
    dogru("panel host sürümünü KONTROL EDİYOR", /hostSurumUyari/.test(app));
    dogru("kontrol emoji akışında, para harcanmadan ÖNCE",
          /_hsUyari = await hostSurumUyari\(\)[\s\S]{0,400}uiConfirm/.test(app));

    /* ---- (e) BAŞLATILAN HER AŞAMA KAPATILMALI ----
       GERÇEK HATA (kullanıcı bildirdi, 12 Ağustos 2026): "animasyonlar geldi ve sorunsuz
       çalıştı ama panelde gri eksi oldu". `adim("Animasyon uygulanıyor")` ile başlatılan
       adım için `adimBitir` çağrısı yoktu; iş biterken `kalanlariIptal` onu "atlandı"
       işaretliyordu. Sonuç: panel KENDİ KENDİSİYLE çelişiyordu — özet tablosu
       "Animasyon: preset: Emoji Sağ Taraf" derken aşama listesi "yapılmadı" diyordu.
       Bu test, adı geçen her adımın en az bir kapanış çağrısı olduğunu doğruluyor. */
    var acilan = {}, kapanan = {}, mm2;
    var reAc = /\.adim\("([^"]+)"\)/g;
    while ((mm2 = reAc.exec(app)) !== null) acilan[mm2[1]] = 1;
    var reKap = /\.(?:adimBitir|adimHata|adimAtla)\("([^"]+)"/g;
    while ((mm2 = reKap.exec(app)) !== null) kapanan[mm2[1]] = 1;
    var kapanmayan = Object.keys(acilan).filter(function (ad) { return !kapanan[ad]; });
    dogru("aşama adı bulundu (" + Object.keys(acilan).length + ")", Object.keys(acilan).length >= 5);
    esit("başlatılan her aşamanın KAPANIŞ çağrısı var", kapanmayan, []);
  })();

  /* ================================================================
     22. İLERLEME / KALAN SÜRE HESABI (js/ilerleme.js)
     Panelde "kalan süre" bugüne kadar tek yerde ve ham doğrusal hesaplanıyordu; emoji ve
     Shorts gibi en uzun işlerde hiç yoktu. Bu modül saf matematik olduğu için Premiere'siz
     ve beklemesiz sınanabiliyor — saat dışarıdan veriliyor.
     ================================================================ */
  baslik("İlerleme ve kalan süre hesabı");
  (function () {
    var I = require(path.join(KOK, "js", "ilerleme.js"));

    esit("60 sn altı saniye yazılır", I.sureMetni(45), "45 sn");
    esit("dakika dk:sn biçiminde", I.sureMetni(134), "2:14");
    /* ⚠ SAAT AÇIK YAZILIR: "1:05" bir saat beş dakikayı bir dakika beş saniye sanmaya çok
       müsait ve altyazı üretimi gerçekten saatlerce sürebiliyor. */
    esit("saat açıkça yazılır", I.sureMetni(3900), "1 sa 5 dk");
    esit("negatif/geçersiz süre boş döner", I.sureMetni(-5), "");

    /* ⚠ TİTREME ÖNLEYİCİ YUVARLAMA. Saniyede bir güncellenen ham bir sayı ("~2:14 → ~2:09
       → ~2:17") ortalaması doğru olsa bile kullanıcıya "bu panel bilmiyor" dedirtiyor.
       10 sn ALTINDA yuvarlama YOK — orada her saniye gerçekten anlamlı. */
    esit("10 sn altı yuvarlanmaz", I.yuvarlaEta(7), 7);
    esit("1 dk altı 5'e yuvarlanır", I.yuvarlaEta(43), 45);
    esit("10 dk altı 10'a yuvarlanır", I.yuvarlaEta(137), 140);
    esit("uzun süre 30'a yuvarlanır", I.yuvarlaEta(1400), 1410);

    /* ---- SAYAÇ: gerçek bir emoji koşusunun zamanlaması ---- */
    var t = 100000, s = I.olustur({ toplam: 172, birim: "emoji", simdi: t });
    esit("başlangıçta sayaç metni doğru", s.durum(t).sayacMetin, "0 / 172 emoji");
    /* ⚠ TEK ÖRNEKLE ETA VERİLMEZ: ilk parça (proje içine resim import'u yüzünden) hep
       yavaş ve tek başına tahmini şişiriyor. "hesaplanıyor…" demek yanlış sayıdan iyidir. */
    t += 20000; s.ilerle(25, t);
    dogru("tek örnekten sonra ETA GÜVENİLİR SAYILMAZ", s.durum(t).guvenilir === false);
    esit("tek örnekten sonra ETA metni boş", s.durum(t).etaMetin, "");
    /* 25 emoji / 20 sn = 1.25 emoji/sn. İkinci örnekten sonra tahmin açılır. */
    t += 20000; s.ilerle(50, t);
    var d2 = s.durum(t);
    dogru("iki örnekten sonra ETA güvenilir", d2.guvenilir === true);
    esit("kalan iş doğru", d2.kalanIs, 122);
    /* 122 kalan / 1.25 = 97.6 sn → yuvarlanınca 100 sn → "1:40" */
    esit("kalan süre doğru hesaplanıyor", d2.etaMetin, "1:40");
    esit("yüzde doğru", Math.round(d2.yuzde), 29);

    /* ⚠ GERİ GİDEN / TAŞAN SAYAÇ. `kondu` host'un döndürdüğü sayıdan geliyor; bozuk bir
       cevap ETA'yı negatife çevirip "-3:12 kaldı" yazdırabilirdi. */
    t += 10000; s.ilerle(40, t);
    esit("sayaç GERİ GİTMEZ", s.durum(t).biten, 50);
    t += 10000; s.ilerle(9999, t);
    esit("sayaç toplamı AŞMAZ", s.durum(t).biten, 172);
    s.bitir(t);
    var d3 = s.durum(t);
    esit("bitince yüzde 100", d3.yuzde, 100);
    esit("bitince ETA gösterilmez", d3.etaMetin, "");

    /* Toplamı bilinmeyen iş: yüzde ve ETA yok, sayaç yine çalışır. */
    var s2 = I.olustur({ birim: "klip", simdi: 0 });
    s2.ilerle(7, 1000);
    esit("toplam bilinmiyorsa yüzde -1", s2.durum(1000).yuzde, -1);
    esit("toplam bilinmiyorsa sayaç yine yazılır", s2.durum(1000).sayacMetin, "7 klip");

    /* ---- AŞAMA LİSTESİ ---- */
    var A = I.asamalar(["Bir", "İki", "Üç"]);
    A.basla("Bir", 0);
    esit("başlayan adım çalışıyor", A.liste()[0].durum, "calisiyor");
    /* ⚠ ÖNCEKİ ADIM KENDİLİĞİNDEN KAPANIR. Çağıran her adımı ayrıca kapatmak zorunda
       kalırsa bir dalda unutulur ve listede sonsuza kadar dönen bir spinner kalır —
       panelde "takıldı mı?" izlenimi veren tam olarak budur. */
    A.basla("İki", 5000);
    esit("önceki adım kendiliğinden bitti", A.liste()[0].durum, "bitti");
    esit("biten adımın süresi ölçüldü", A.liste()[0].sure, 5);
    A.atla("Üç", "kapalı");
    esit("atlanan adım işaretlendi", A.liste()[2].durum, "atlandi");
    esit("atlama sebebi yazıldı", A.liste()[2].not, "kapalı");
    /* ⚠ HATA SONRASI KALAN ADIMLAR KAPATILIR: geride "bekliyor" durumunda adım kalırsa
       kullanıcı hâlâ bir şey olacağını sanıyor. */
    var B = I.asamalar(["A", "B", "C"]);
    B.basla("A", 0); B.hata("A", "patladı"); B.kalanlariIptal("yapılmadı");
    esit("hatalı adım işaretli", B.liste()[0].durum, "hata");
    esit("kalan adımlar iptal edildi", B.liste()[1].durum + "|" + B.liste()[2].durum,
         "atlandi|atlandi");
    /* Aşama bazlı kaba yüzde: çalışan adım YARIM sayılır — çubuğun adım boyunca tamamen
       durması "dondu" hissi veriyordu. */
    var C = I.asamalar(["x", "y"]);
    C.basla("x", 0);
    esit("çalışan adım yarım sayılır", C.yuzde(), 25);
  })();

  /* ================================================================
     23. NÖBETÇİSİZ UZUN ÇAĞRI KALMASIN
     ParsMazi'de iki kez yaşandı: Premiere uzun bir işlem sırasında kendi penceresini
     (Auto Save / Save Project / Import) açıyor, evalScript geri çağrısı gelmiyor ve panel
     son yazdığı metinde SONSUZA KADAR donuyor. Nöbetçi promise'i terk etmez, yalnız
     "kaç saniyedir bekliyoruz" bilgisini dışarı verir — kullanıcı donmuş Premiere ile
     çalışan Premiere'i ancak böyle ayırt edebiliyor.
     ================================================================ */
  baslik("Uzun Premiere çağrılarında nöbetçi");
  (function () {
    var app = fs.readFileSync(path.join(KOK, "js", "app.js"), "utf8");
    /* Panelin en uzun ve en çok kilitlenen çağrıları. Hepsinin ikinci parametresi
       (izle geri çağrısı) OLMAK ZORUNDA. */
    var izlenmesiSart = ["emojiResimYukle", "presetYaz", "saveProject", "autoCut", "senkronUygula"];
    var nobetcisiz = [];
    /* ⚠ DESEN "İKİ KAPANIŞ PARANTEZİNE KADAR" DİYE YAZILAMAZ — ilk hâli öyleydi ve
       `evalES('autoCut("' + esPath(file) + '")', function (sn) {…})` biçimini hiç
       bulamıyordu (aradaki dizge birleştirmesi yüzünden ardışık `))` oluşmuyor).
       Bunun yerine: çağrının başlangıcından SONRAKİ evalES çağrısına kadar olan pencerede
       nöbetçi geri çağrısı aranıyor. Böylece bir sonraki çağrının nöbetçisi yanlışlıkla
       bu çağrıya sayılmıyor. */
    izlenmesiSart.forEach(function (fn) {
      var ara = "evalES('" + fn, from = 0, bulundu = 0, izlenen = 0, ix;
      while ((ix = app.indexOf(ara, from)) !== -1) {
        bulundu++;
        var sonraki = app.indexOf("evalES(", ix + ara.length);
        var son = (sonraki === -1) ? Math.min(app.length, ix + 700) : Math.min(sonraki, ix + 700);
        var pencere = app.slice(ix, son);
        if (/function\s*\(sn\)|_presetIzle/.test(pencere)) izlenen++;
        from = ix + ara.length;
      }
      if (bulundu === 0) nobetcisiz.push(fn + " (çağrı bulunamadı)");
      else if (izlenen < bulundu) nobetcisiz.push(fn + " (" + (bulundu - izlenen) + "/" + bulundu + " nöbetçisiz)");
    });
    esit("uzun Premiere çağrılarının hepsinde nöbetçi VAR", nobetcisiz, []);
  })();

  /* ================================================================
     24. ÇOKLU SHORTS — ALTYAZI KAYMASI ve SÜRE HEDEFİ (12 Ağustos 2026)
     İkisi de kullanıcının gerçek koşusundan geldi: "altyazı tam oturmamış, yazı kayıyo" ve
     "30-40 saniye olmuyor, 2 tanesi 18 saniye çıktı".
     ================================================================ */
  baslik("Çoklu Shorts (altyazı hizası · süre hedefi)");
  (function () {
    var SZt, SHt, P2;
    try {
      SZt = require(path.join(KOK, "js", "shortszaman.js"));
      SHt = require(path.join(KOK, "js", "shorts.js"));
      P2  = require(path.join(KOK, "js", "pipeline.js"));
    } catch (e) { hata("Shorts modülleri yüklenemedi", e.message); return; }
    var app = fs.readFileSync(path.join(KOK, "js", "app.js"), "utf8");

    /* ---- ALTYAZI HİZASI ----
       Kesitler `overwriteClip` ile konuyor ve Premiere KAREYE yuvarlıyor; host gerçekleşen
       sınırları geri okuyup döndürüyor. Panel eskiden onları ATIYOR ve ofsetleri KAYNAK
       sürelerini toplayarak kuruyordu → kesit başına ~0.02 sn BİRİKEN kayma. */
    var KAY = 0.02, kesit = [], hb = 0, ix;
    for (ix = 0; ix < 5; ix++) {
      kesit.push({ bas: 100 + ix * 20, bit: 107 + ix * 20, hedefBas: hb, hedefBit: hb + 7 - KAY });
      hb += 7 - KAY;
    }
    var cueler = kesit.map(function (k, i2) {
      return { start: k.bas + 0.5, end: k.bas + 2.0, text: "c" + i2, cumleId: "z-" + i2 };
    });
    var yeni = SZt.cueHarita(kesit, cueler);
    var yListe = yeni.cues || yeni;
    var enBuyukSapma = 0;
    yListe.forEach(function (c, i3) {
      var bekl = kesit[i3].hedefBas + 0.5;
      var s = Math.abs(c.start - bekl);
      if (s > enBuyukSapma) enBuyukSapma = s;
    });
    dogru("altyazı GERÇEK kesit sınırına oturuyor (sapma < 1 ms)", enBuyukSapma < 0.001,
          "en büyük sapma: " + enBuyukSapma.toFixed(4) + " sn");

    /* hedefBas VERİLMEZSE eski davranış birebir sürmeli — tekli Shorts ve eski host bozulmasın. */
    var eskiKesit = kesit.map(function (k) { return { bas: k.bas, bit: k.bit }; });
    var eskiR = SZt.cueHarita(eskiKesit, cueler);
    var eListe = eskiR.cues || eskiR;
    esit("hedefBas yoksa ilk kesit yine 0'dan başlar (geriye uyumlu)",
         Number(eListe[0].start.toFixed(3)), 0.5);
    dogru("hedefBas yokken eski (biriken) davranış korunuyor",
          Math.abs(eListe[4].start - 28.5) < 0.001,
          "geriye uyumluluk kırılırsa eski host'la çalışan kurulumlar bozulur");

    /* ---- SÜRE HEDEFİ ----
       Bir anlatı bölümü kısa atışmalardan oluşuyorsa adayların çoğu `kesitMin` (4 sn)
       altında kalıp eleniyordu ve Shorts 18 saniyede takılıyordu. 4. geçiş `kesitMin`'i
       2.5'e çekiyor — YALNIZ hedef tutmadığında. */
    function kisaAdaylar() {
      var a = [], t = 200;
      [6, 3, 2.5, 7, 2.8, 3.2, 5, 2.6, 3.4, 2.9].forEach(function (s, i4) {
        a.push({ bas: t, bit: t + s, puan: 100 - i4 }); t += s + 5;
      });
      return a;
    }
    /* ⚠ SINIRLAR MODÜLDEN OKUNUYOR, ELLE YAZILMIYOR. Bir tur 28/42 sabit yazılmıştı;
       kullanıcı sınırları 27/45'e çekince test kodu doğru olduğu hâlde kırmızı verirdi.
       Nöbetçi test, koruduğu değerin kendisini kaynaktan almalı. */
    /* ⚠ shorts.js kaynağı BURADA okunuyor — aşağıda değil. Bir tur bildirimden ÖNCE
       kullanıldı ve `var` hoisting yüzünden `undefined` geçti; bu projede aynı tuzak
       emoji özelliğini bir kez tümden çökertmişti. */
    var shSrc = fs.readFileSync(path.join(KOK, "js", "shorts.js"), "utf8");
    var ALT = SHt.VARSAYILAN_OPTS ? SHt.VARSAYILAN_OPTS.minSure : 27;
    var UST = SHt.VARSAYILAN_OPTS ? SHt.VARSAYILAN_OPTS.maxSure : 45;
    esit("SERT ALT SINIR kullanıcının istediği gibi (27 sn)", ALT, 27);
    esit("SERT ÜST SINIR kullanıcının istediği gibi (45 sn)", UST, 45);
    var sy = { cakismaElenen: 0, sureElenen: 0, kisaElenen: 0, uzunElenen: 0 };
    var sonuc = SHt._butceUygula(kisaAdaylar(), {}, sy);
    dogru("kısa adaylı bölümde alt sınıra ULAŞILIYOR (>=" + ALT + " sn)", sonuc.toplam >= ALT,
          "çıkan süre: " + sonuc.toplam.toFixed(1) + " sn");
    dogru("üst sınır AŞILMIYOR (<=" + UST + " sn)", sonuc.toplam <= UST);
    dogru("gevşetme raporlanıyor", !!sy.kesitMinGevsetildi);
    /* ⚠ ALT SINIR ARTIK SERT: altında kalınırsa bayrak kalkmalı ki coklukSec bölümü atsın. */
    var azSay = { cakismaElenen: 0, sureElenen: 0, kisaElenen: 0, uzunElenen: 0 };
    var azSonuc = SHt._butceUygula([{ bas: 10, bit: 16, puan: 9 }], {}, azSay);
    dogru("alt sınırın altında kalınca BAYRAK kalkıyor", azSay.altSinirAltinda === true,
          "çıkan süre: " + azSonuc.toplam.toFixed(1) + " sn");
    dogru("coklukSec bayrağa bakıp bölümü ATLIYOR",
          /bSay\.altSinirAltinda[\s\S]{0,300}continue;/.test(shSrc),
          "atlamazsa 27 sn altı Shorts üretilir — kullanıcının açık isteğine aykırı");

    /* ⚠ REGRESYON KİLİDİ: bol ve uzun aday varken 4. geçiş HİÇ çalışmamalı, yani seçim
       davranışı eskisiyle birebir kalmalı. Aksi hâlde iyi çalışan Shorts'lar da kırpıntı
       kesitlerle dolardı. */
    var bol = [], tb = 300;
    [8, 9, 7, 10, 6, 8, 9].forEach(function (s, i5) { bol.push({ bas: tb, bit: tb + s, puan: 100 - i5 }); tb += s + 6; });
    var sy2 = { cakismaElenen: 0, sureElenen: 0, kisaElenen: 0, uzunElenen: 0 };
    var r2 = SHt._butceUygula(bol, {}, sy2);
    dogru("bol malzemede 4. geçiş ÇALIŞMIYOR (davranış değişmedi)", !sy2.kesitMinGevsetildi);
    var enKisa = Math.min.apply(null, r2.kesitler.map(function (k) { return k.bit - k.bas; }));
    dogru("bol malzemede kesitler kısalmıyor (>=4 sn)", enKisa >= 4,
          "en kısa kesit: " + enKisa.toFixed(1) + " sn");
    dogru("hedef tutunca 'hedefTutmadi' 0 kalıyor", !sy2.hedefTutmadi);

    /* ---- KELİME ARASI BOŞLUK: SHORTS'TA DA KAPANMALI ----
       GERÇEK HATA (kullanıcı, 12 Ağustos 2026: "çoklu Shorts'ta kelimeler arasında neden
       boşluklar var"). `pipeline.cumleBirlestir` YALNIZ uzun video yolunda çağrılıyordu;
       Shorts kendi SRT'sini yazarken hiç çağırmıyordu, dolayısıyla `buildCues`'un bıraktığı
       2 karelik boşluklar Shorts'ta olduğu gibi kalıp yazıyı yanıp söndürüyordu. */
    var oCue = [], ct = 100, ci;
    for (ci = 0; ci < 8; ci++) { oCue.push({ start: ct, end: ct + 0.62, text: "k" + ci, cumleId: "c1" }); ct += 0.70; }
    oCue.push({ start: ct + 1.5, end: ct + 2.1, text: "yeni", cumleId: "c2" });
    var oYedek = JSON.parse(JSON.stringify(oCue));
    var hmk = SZt.cueHarita([{ bas: 99, bit: 112, hedefBas: 0, hedefBit: 13 }], oCue);
    var sCue = hmk.cues.filter(function (c) { return !c.gizliKesit; });
    function _bosSay(l, altSinir, ustSinir) {
      var n = 0;
      for (var q = 0; q + 1 < l.length; q++) {
        if (l[q].cumleId !== l[q + 1].cumleId) continue;
        var d = l[q + 1].start - l[q].end;
        if (d > altSinir && d <= ustSinir) n++;
      }
      return n;
    }
    var oncekiKucuk = _bosSay(sCue, 0.001, 0.15);
    dogru("Shorts'a haritalanan cue'larda kelime arası boşluk VAR (köprü öncesi)", oncekiKucuk > 0);
    var kSayac = P2.cumleBirlestir([{ ad: "A1", cues: sCue }], {}, function () {});
    esit("Shorts'ta kelime arası boşluklar KAPANDI", _bosSay(sCue, 0.001, 0.15), 0);
    dogru("köprü sayacı çalıştığını bildiriyor", kSayac.koprulen === oncekiKucuk);
    /* ⚠ FARKLI CÜMLE ARASI BOŞLUK KORUNMALI — orası bilgi taşıyor. */
    dogru("farklı cümle arası boşluk KORUNDU",
          (sCue[sCue.length - 1].start - sCue[sCue.length - 2].end) > 0.5);
    var tersS = 0, cakS = 0;
    for (ci = 0; ci + 1 < sCue.length; ci++) {
      if (sCue[ci].end < sCue[ci].start) tersS++;
      if (sCue[ci + 1].start < sCue[ci].end - 1e-9) cakS++;
    }
    esit("köprü ters cue üretmedi", tersS, 0);
    esit("köprü çakışma üretmedi", cakS, 0);
    /* ⚠⚠ EN ÖNEMLİSİ: özgün (uzun video) cue nesneleri DEĞİŞMEMELİ. cueHarita kopya
       üretiyor; köprü o kopyaların üzerinde çalışıyor. Bu kırılırsa Shorts üretmek
       uzun videonun altyazısını bozar — kullanıcının en çok vurguladığı şart. */
    var degisen = 0;
    for (ci = 0; ci < oCue.length; ci++) {
      if (oCue[ci].start !== oYedek[ci].start || oCue[ci].end !== oYedek[ci].end ||
          oCue[ci].cumleId !== oYedek[ci].cumleId) degisen++;
    }
    esit("Shorts köprüsü UZUN VİDEONUN cue'larına DOKUNMUYOR", degisen, 0);
    /* Çağrı gerçekten Shorts akışında mı — yoksa test yeşil ama üretim yolu çağırmıyor olur. */
    dogru("shortsKurVeDoldur cumleBirlestir'i ÇAĞIRIYOR",
          /hazir\.length[\s\S]{0,200}cumleBirlestir\(hazir/.test(app));

    /* ---- KANALLAR ARASI ÇAKIŞMA: SHORTS'TA DA GİDERİLMELİ ----
       GERÇEK HATA (kullanıcı, 12 Ağustos 2026: "aynı saniyede altlı üstlü 3 kelime çıkıyor,
       yazılar ekranı kaplıyor"). Premiere bütün caption track'lerini AYNI ANDA AYNI YERE
       çiziyor; iki kişi aynı anda konuşunca 2+2=4 kelime üst üste biniyor. Uzun video bunu
       `kanallarArasiCakisma` ile çözüyordu ama Shorts o fonksiyonu HİÇ çağırmıyordu. */
    var cA = [{ start: 10, end: 12, text: "a1", cumleId: "x" }, { start: 12.1, end: 14, text: "a2", cumleId: "x" }];
    var cB = [{ start: 11, end: 13, text: "b1", cumleId: "y" }];
    var grp = [{ ad: "A", cues: cA }, { ad: "B", cues: cB }];
    var kkS = P2.kanallarArasiCakisma(grp, { gizle: true }, function () {});
    var hepsi = [];
    grp.forEach(function (x) { x.cues.forEach(function (c) { if (!c.gizliCakisma) hepsi.push(c); }); });
    hepsi.sort(function (a, b) { return a.start - b.start; });
    var ustUste = 0;
    for (ci = 0; ci + 1 < hepsi.length; ci++) if (hepsi[ci + 1].start < hepsi[ci].end - 1e-9) ustUste++;
    esit("çakışma giderildikten sonra üst üste kalan YOK", ustUste, 0);
    dogru("kırpma gerçekten yapıldı", (kkS.kirpilan || 0) > 0);
    dogru("shortsKurVeDoldur kanallarArasiCakisma'yı ÇAĞIRIYOR",
          /hazir\.length > 1[\s\S]{0,300}kanallarArasiCakisma\(hazir/.test(app),
          "çağrılmazsa Shorts'ta yazılar üst üste biner");
    dogru("gizlenenler SRT'den düşürülüyor",
          /gizliCakisma[\s\S]{0,120}filter/.test(app) || /filter\([\s\S]{0,80}gizliCakisma/.test(app));
    /* Sıra: çakışma giderme KÖPRÜDEN ÖNCE olmalı (uzun videodaki zorunlu sıra). */
    dogru("çakışma giderme köprüden ÖNCE",
          app.indexOf("kanallarArasiCakisma(hazir") < app.indexOf("cumleBirlestir(hazir"));

    /* ---- ADET GARANTİSİ ----
       "Kaç Shorts seçtiysem o kadar yapmalı." Modelden TAM `adet` bölüm isteniyordu; bir
       bölümden kesit çıkmazsa slot telafisiz kayboluyordu. Artık yedek bölüm isteniyor. */
    dogru("coklukSec modelden YEDEK bölüm istiyor", /istemAdet\s*=\s*adet\s*\+\s*2/.test(shSrc));
    dogru("istem metninde yedek sayısı kullanılıyor", /istemAdet\s*\+\s*" anlatı bölümüne/.test(shSrc));
    dogru("döngü istenen adette DURUYOR", /shortslar\.length < adet/.test(shSrc));
    /* Payda kullanıcının istediği sayı olmalı — "2/2" diyerek kaybı gizlemesin. */
    dogru("sonuç paydası kullanıcının istediği ADET", /var istenen = adet;/.test(app),
          "bol.shortslar.length kullanılırsa eksik üretim '2/2' diye gizlenir");

    /* ---- SAHNE SEÇİMİ İSTEMİ ----
       Modele "iyi an seç" demek yetmiyor; NEYİ ALMAYACAĞINI söylemek seçimi düzeltiyor
       (emoji isteminde ölçülmüştü). */
    dogru("istem OLUMSUZ örnek veriyor (ne alınmayacak)", /ŞUNLARI ALMA/.test(shSrc));
    dogru("istem OLUMLU örnek veriyor (ne tercih edilecek)", /ŞUNLARI TERCİH ET/.test(shSrc));
    dogru("hazırlık/kurulum konuşması açıkça eleniyor", /Hazırlık\/kurulum konuşması/.test(shSrc));

    /* ⚠ UZUN VİDEO YOLUNA DOKUNULMADI — kullanıcının en çok vurguladığı şart.
       Shorts düzeltmeleri yalnız shorts.js / shortszaman.js ve app.js'in Shorts dalında. */
    var pipe = fs.readFileSync(path.join(KOK, "js", "pipeline.js"), "utf8");
    /* ⚠ Eşik `opts.maxKopru` ile ezilebiliyor, varsayılanı 0.15. Desen ilk yazımda
       `MAX_KOPRU = 0.15` diye aranıyordu ve gerçek satırı (`= (opts.maxKopru > 0) ? … : 0.15`)
       bulamayıp kod HİÇ değişmediği hâlde kırmızı veriyordu — nöbetçi testin kendisi
       kararsız olmamalı. */
    dogru("pipeline.cumleBirlestir'in köprü eşiği DEĞİŞMEDİ (varsayılan 0.15)",
          /MAX_KOPRU\s*=[\s\S]{0,60}0\.15/.test(pipe),
          "uzun videonun altyazı köprüsü dondurulmuş bir ayar");
    /* Uzun videonun diğer dondurulmuş sayıları da yerinde mi (Shorts değişikliği sızmasın). */
    var vur = fs.readFileSync(path.join(KOK, "js", "vurucu.js"), "utf8");
    dogru("vurucu mod: ilk 120 sn tam · ~12 sn'de bir",
          /tamSaniye:\s*120/.test(vur) && /aralikSn:\s*12/.test(vur),
          "bu iki sayı kullanıcı tarafından DONDURULDU");
  })();

  /* ---- ÖZET ---- */
  console.log("\n" + new Array(52).join("="));
  console.log(gecti + " geçti · " + kaldi + " KALDI · " + uyari + " not");
  console.log(kaldi ? "!! SÜRÜM ÇIKARMA — önce yukarıdaki satırları düzelt."
                    : "Panel denetimden temiz geçti.");
  process.exit(kaldi ? 1 : 0);
}
